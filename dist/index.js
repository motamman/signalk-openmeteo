"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const node_fetch_1 = __importDefault(require("node-fetch"));
module.exports = function (app) {
    const plugin = {
        id: "signalk-open-meteo",
        name: "SignalK Open-Meteo Weather",
        description: "Position-based weather and marine forecast data from Open-Meteo API",
        schema: {},
        start: () => { },
        stop: () => { },
    };
    const state = {
        forecastInterval: null,
        navigationSubscriptions: [],
        currentConfig: undefined,
        currentPosition: null,
        currentHeading: null,
        currentSOG: null,
        lastForecastUpdate: 0,
        forecastEnabled: true,
        movingForecastEngaged: false,
    };
    // WMO Weather interpretation codes (used by Open-Meteo)
    // https://open-meteo.com/en/docs#weathervariables
    const wmoCodeDescriptions = {
        0: "Clear",
        1: "Mostly Clear",
        2: "Partly Cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing Rime Fog",
        51: "Light Drizzle",
        53: "Moderate Drizzle",
        55: "Dense Drizzle",
        56: "Light Freezing Drizzle",
        57: "Dense Freezing Drizzle",
        61: "Slight Rain",
        63: "Moderate Rain",
        65: "Heavy Rain",
        66: "Light Freezing Rain",
        67: "Heavy Freezing Rain",
        71: "Slight Snow",
        73: "Moderate Snow",
        75: "Heavy Snow",
        77: "Snow Grains",
        80: "Slight Rain Showers",
        81: "Moderate Rain Showers",
        82: "Violent Rain Showers",
        85: "Slight Snow Showers",
        86: "Heavy Snow Showers",
        95: "Thunderstorm",
        96: "Thunderstorm with Slight Hail",
        99: "Thunderstorm with Heavy Hail",
    };
    const wmoCodeLongDescriptions = {
        0: "Clear sky with no cloud cover",
        1: "Mainly clear with minimal cloud cover",
        2: "Partly cloudy with scattered clouds",
        3: "Overcast with complete cloud cover",
        45: "Fog reducing visibility",
        48: "Depositing rime fog with ice formation",
        51: "Light drizzle with fine precipitation",
        53: "Moderate drizzle with steady light rain",
        55: "Dense drizzle with continuous light rain",
        56: "Light freezing drizzle, ice possible",
        57: "Dense freezing drizzle, hazardous conditions",
        61: "Slight rain with light precipitation",
        63: "Moderate rain with steady precipitation",
        65: "Heavy rain with intense precipitation",
        66: "Light freezing rain, ice accumulation possible",
        67: "Heavy freezing rain, hazardous ice conditions",
        71: "Slight snowfall with light accumulation",
        73: "Moderate snowfall with steady accumulation",
        75: "Heavy snowfall with significant accumulation",
        77: "Snow grains, fine ice particles falling",
        80: "Slight rain showers, brief light rain",
        81: "Moderate rain showers, intermittent rain",
        82: "Violent rain showers, intense downpours",
        85: "Slight snow showers, brief light snow",
        86: "Heavy snow showers, intense snowfall",
        95: "Thunderstorm with lightning and thunder",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail, dangerous conditions",
    };
    // Get icon name from WMO code
    const getWeatherIcon = (wmoCode, isDay) => {
        if (wmoCode === undefined)
            return undefined;
        const dayNight = isDay === true || isDay === 1 ? "day" : "night";
        return `wmo_${wmoCode}_${dayNight}.svg`;
    };
    const getWeatherDescription = (wmoCode, fallback) => {
        if (wmoCode === undefined)
            return fallback;
        return wmoCodeDescriptions[wmoCode] || fallback;
    };
    const getWeatherLongDescription = (wmoCode, fallback) => {
        if (wmoCode === undefined)
            return fallback;
        return wmoCodeLongDescriptions[wmoCode] || fallback;
    };
    // Configuration schema
    plugin.schema = {
        type: "object",
        required: [],
        properties: {
            apiKey: {
                type: "string",
                title: "API Key (Optional)",
                description: "Open-Meteo API key for commercial use. Leave empty for free non-commercial use.",
            },
            forecastInterval: {
                type: "number",
                title: "Forecast Update Interval (minutes)",
                description: "How often to fetch new forecast data",
                default: 60,
                minimum: 15,
                maximum: 1440,
            },
            altitude: {
                type: "number",
                title: "Default Altitude (meters)",
                description: "Default altitude for elevation correction",
                default: 2,
                minimum: 0,
                maximum: 10000,
            },
            enablePositionSubscription: {
                type: "boolean",
                title: "Enable Position Subscription",
                description: "Subscribe to navigation.position updates for automatic forecast updates",
                default: true,
            },
            maxForecastHours: {
                type: "number",
                title: "Max Forecast Hours",
                description: "Maximum number of hourly forecasts to retrieve (1-384)",
                default: 72,
                minimum: 1,
                maximum: 384,
            },
            maxForecastDays: {
                type: "number",
                title: "Max Forecast Days",
                description: "Maximum number of daily forecasts to retrieve (1-16)",
                default: 7,
                minimum: 1,
                maximum: 16,
            },
            enableHourlyWeather: {
                type: "boolean",
                title: "Enable Hourly Weather",
                description: "Fetch hourly weather forecasts",
                default: true,
            },
            enableDailyWeather: {
                type: "boolean",
                title: "Enable Daily Weather",
                description: "Fetch daily weather forecasts",
                default: true,
            },
            enableMarineHourly: {
                type: "boolean",
                title: "Enable Marine Hourly",
                description: "Fetch hourly marine forecasts (waves, currents, sea temperature)",
                default: true,
            },
            enableMarineDaily: {
                type: "boolean",
                title: "Enable Marine Daily",
                description: "Fetch daily marine forecasts",
                default: true,
            },
            enableCurrentConditions: {
                type: "boolean",
                title: "Enable Current Conditions",
                description: "Fetch current weather conditions",
                default: true,
            },
            enableAutoMovingForecast: {
                type: "boolean",
                title: "Enable Auto Moving Forecast",
                description: "Automatically engage moving forecast mode when vessel speed exceeds threshold",
                default: false,
            },
            movingSpeedThreshold: {
                type: "number",
                title: "Moving Speed Threshold (knots)",
                description: "Minimum speed in knots to automatically engage moving forecast mode",
                default: 1.0,
                minimum: 0.1,
                maximum: 10.0,
            },
        },
    };
    // Utility functions
    const degToRad = (degrees) => degrees * (Math.PI / 180);
    const celsiusToKelvin = (celsius) => celsius + 273.15;
    const hPaToPA = (hPa) => hPa * 100;
    const mmToM = (mm) => mm / 1000;
    const cmToM = (cm) => cm / 100;
    const kmToM = (km) => km * 1000;
    const kmhToMs = (kmh) => kmh / 3.6;
    const percentToRatio = (percent) => percent / 100;
    // Build Open-Meteo Weather API URL
    const buildWeatherUrl = (position, config) => {
        const baseUrl = config.apiKey
            ? `https://customer-api.open-meteo.com/v1/forecast`
            : `https://api.open-meteo.com/v1/forecast`;
        const params = new URLSearchParams({
            latitude: position.latitude.toString(),
            longitude: position.longitude.toString(),
            timezone: "UTC",
            forecast_days: Math.min(config.maxForecastDays, 16).toString(),
        });
        if (config.apiKey) {
            params.append("apikey", config.apiKey);
        }
        // Hourly weather variables
        if (config.enableHourlyWeather) {
            const hourlyVars = [
                "temperature_2m",
                "relative_humidity_2m",
                "dew_point_2m",
                "apparent_temperature",
                "precipitation_probability",
                "precipitation",
                "rain",
                "showers",
                "snowfall",
                "weather_code",
                "pressure_msl",
                "surface_pressure",
                "cloud_cover",
                "cloud_cover_low",
                "cloud_cover_mid",
                "cloud_cover_high",
                "visibility",
                "wind_speed_10m",
                "wind_direction_10m",
                "wind_gusts_10m",
                "uv_index",
                "is_day",
                "sunshine_duration",
                "cape",
                "shortwave_radiation",
                "direct_radiation",
                "diffuse_radiation",
                "direct_normal_irradiance",
            ];
            params.append("hourly", hourlyVars.join(","));
        }
        // Daily weather variables
        if (config.enableDailyWeather) {
            const dailyVars = [
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "apparent_temperature_max",
                "apparent_temperature_min",
                "sunrise",
                "sunset",
                "daylight_duration",
                "sunshine_duration",
                "uv_index_max",
                "precipitation_sum",
                "rain_sum",
                "showers_sum",
                "snowfall_sum",
                "precipitation_hours",
                "precipitation_probability_max",
                "wind_speed_10m_max",
                "wind_gusts_10m_max",
                "wind_direction_10m_dominant",
                "shortwave_radiation_sum",
            ];
            params.append("daily", dailyVars.join(","));
        }
        // Current conditions
        if (config.enableCurrentConditions) {
            const currentVars = [
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "is_day",
                "precipitation",
                "rain",
                "showers",
                "snowfall",
                "weather_code",
                "cloud_cover",
                "pressure_msl",
                "surface_pressure",
                "wind_speed_10m",
                "wind_direction_10m",
                "wind_gusts_10m",
            ];
            params.append("current", currentVars.join(","));
        }
        // Request wind speed in m/s for SignalK compatibility
        params.append("wind_speed_unit", "ms");
        return `${baseUrl}?${params.toString()}`;
    };
    // Build Open-Meteo Marine API URL
    const buildMarineUrl = (position, config) => {
        const baseUrl = config.apiKey
            ? `https://customer-marine-api.open-meteo.com/v1/marine`
            : `https://marine-api.open-meteo.com/v1/marine`;
        const params = new URLSearchParams({
            latitude: position.latitude.toString(),
            longitude: position.longitude.toString(),
            timezone: "UTC",
            forecast_days: Math.min(config.maxForecastDays, 8).toString(), // Marine API max is 8 days
        });
        if (config.apiKey) {
            params.append("apikey", config.apiKey);
        }
        // Hourly marine variables
        if (config.enableMarineHourly) {
            const hourlyVars = [
                "wave_height",
                "wave_direction",
                "wave_period",
                "wind_wave_height",
                "wind_wave_direction",
                "wind_wave_period",
                "wind_wave_peak_period",
                "swell_wave_height",
                "swell_wave_direction",
                "swell_wave_period",
                "swell_wave_peak_period",
                "ocean_current_velocity",
                "ocean_current_direction",
                "sea_surface_temperature",
            ];
            params.append("hourly", hourlyVars.join(","));
        }
        // Daily marine variables
        if (config.enableMarineDaily) {
            const dailyVars = [
                "wave_height_max",
                "wave_direction_dominant",
                "wave_period_max",
                "wind_wave_height_max",
                "wind_wave_direction_dominant",
                "wind_wave_period_max",
                "wind_wave_peak_period_max",
                "swell_wave_height_max",
                "swell_wave_direction_dominant",
                "swell_wave_period_max",
                "swell_wave_peak_period_max",
            ];
            params.append("daily", dailyVars.join(","));
        }
        return `${baseUrl}?${params.toString()}`;
    };
    // Fetch weather data from Open-Meteo
    const fetchWeatherData = async (position, config) => {
        const url = buildWeatherUrl(position, config);
        app.debug(`Fetching weather from: ${url}`);
        try {
            const response = await (0, node_fetch_1.default)(url);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            return (await response.json());
        }
        catch (error) {
            app.error(`Failed to fetch weather data: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    // Fetch marine data from Open-Meteo
    const fetchMarineData = async (position, config) => {
        const url = buildMarineUrl(position, config);
        app.debug(`Fetching marine data from: ${url}`);
        try {
            const response = await (0, node_fetch_1.default)(url);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            return (await response.json());
        }
        catch (error) {
            app.error(`Failed to fetch marine data: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    };
    // Get source label for SignalK
    const getSourceLabel = (dataType) => {
        return `open-meteo.${dataType}`;
    };
    // Get parameter metadata for SignalK
    const getParameterMetadata = (parameterName) => {
        const metadataMap = {
            // Temperature parameters (SignalK compliant - Kelvin)
            temperature_2m: {
                units: "K",
                displayName: "Temperature",
                description: "Air temperature at 2m height",
            },
            apparent_temperature: {
                units: "K",
                displayName: "Feels Like Temperature",
                description: "Apparent temperature considering wind and humidity",
            },
            dew_point_2m: {
                units: "K",
                displayName: "Dew Point",
                description: "Dew point temperature at 2m height",
            },
            sea_surface_temperature: {
                units: "K",
                displayName: "Sea Surface Temperature",
                description: "Sea surface temperature",
            },
            // Wind parameters (SignalK compliant - m/s, radians)
            wind_speed_10m: {
                units: "m/s",
                displayName: "Wind Speed",
                description: "Wind speed at 10m height",
            },
            wind_gusts_10m: {
                units: "m/s",
                displayName: "Wind Gusts",
                description: "Wind gust speed at 10m height",
            },
            wind_direction_10m: {
                units: "rad",
                displayName: "Wind Direction",
                description: "Wind direction at 10m height",
            },
            // Pressure parameters (SignalK compliant - Pascal)
            pressure_msl: {
                units: "Pa",
                displayName: "Sea Level Pressure",
                description: "Atmospheric pressure at mean sea level",
            },
            surface_pressure: {
                units: "Pa",
                displayName: "Surface Pressure",
                description: "Atmospheric pressure at surface",
            },
            // Humidity (SignalK compliant - ratio 0-1)
            relative_humidity_2m: {
                units: "ratio",
                displayName: "Relative Humidity",
                description: "Relative humidity at 2m height (0-1)",
            },
            // Cloud cover (SignalK compliant - ratio 0-1)
            cloud_cover: {
                units: "ratio",
                displayName: "Cloud Cover",
                description: "Total cloud cover (0-1)",
            },
            cloud_cover_low: {
                units: "ratio",
                displayName: "Low Cloud Cover",
                description: "Low altitude cloud cover (0-1)",
            },
            cloud_cover_mid: {
                units: "ratio",
                displayName: "Mid Cloud Cover",
                description: "Mid altitude cloud cover (0-1)",
            },
            cloud_cover_high: {
                units: "ratio",
                displayName: "High Cloud Cover",
                description: "High altitude cloud cover (0-1)",
            },
            // Precipitation (SignalK compliant - meters)
            precipitation: {
                units: "m",
                displayName: "Precipitation",
                description: "Precipitation amount",
            },
            rain: {
                units: "m",
                displayName: "Rain",
                description: "Rain amount",
            },
            snowfall: {
                units: "m",
                displayName: "Snowfall",
                description: "Snowfall amount",
            },
            precipitation_probability: {
                units: "ratio",
                displayName: "Precipitation Probability",
                description: "Probability of precipitation (0-1)",
            },
            // Visibility (SignalK compliant - meters)
            visibility: {
                units: "m",
                displayName: "Visibility",
                description: "Horizontal visibility",
            },
            // Wave parameters (meters, seconds, radians)
            wave_height: {
                units: "m",
                displayName: "Wave Height",
                description: "Significant wave height",
            },
            wave_period: {
                units: "s",
                displayName: "Wave Period",
                description: "Wave period",
            },
            wave_direction: {
                units: "rad",
                displayName: "Wave Direction",
                description: "Wave direction",
            },
            wind_wave_height: {
                units: "m",
                displayName: "Wind Wave Height",
                description: "Wind-generated wave height",
            },
            wind_wave_period: {
                units: "s",
                displayName: "Wind Wave Period",
                description: "Wind-generated wave period",
            },
            wind_wave_direction: {
                units: "rad",
                displayName: "Wind Wave Direction",
                description: "Wind-generated wave direction",
            },
            swell_wave_height: {
                units: "m",
                displayName: "Swell Height",
                description: "Swell wave height",
            },
            swell_wave_period: {
                units: "s",
                displayName: "Swell Period",
                description: "Swell wave period",
            },
            swell_wave_direction: {
                units: "rad",
                displayName: "Swell Direction",
                description: "Swell wave direction",
            },
            // Ocean currents
            ocean_current_velocity: {
                units: "m/s",
                displayName: "Current Speed",
                description: "Ocean current velocity",
            },
            ocean_current_direction: {
                units: "rad",
                displayName: "Current Direction",
                description: "Ocean current direction",
            },
            // Solar radiation
            shortwave_radiation: {
                units: "W/m2",
                displayName: "Solar Radiation",
                description: "Shortwave solar radiation",
            },
            direct_radiation: {
                units: "W/m2",
                displayName: "Direct Radiation",
                description: "Direct solar radiation",
            },
            diffuse_radiation: {
                units: "W/m2",
                displayName: "Diffuse Radiation",
                description: "Diffuse solar radiation",
            },
            direct_normal_irradiance: {
                units: "W/m2",
                displayName: "Direct Normal Irradiance",
                description: "Direct normal solar irradiance",
            },
            // Other
            uv_index: {
                displayName: "UV Index",
                description: "UV index",
            },
            weather_code: {
                displayName: "Weather Code",
                description: "WMO weather interpretation code",
            },
            is_day: {
                displayName: "Is Day",
                description: "Whether it is day (1) or night (0)",
            },
            sunshine_duration: {
                units: "s",
                displayName: "Sunshine Duration",
                description: "Duration of sunshine",
            },
            cape: {
                units: "J/kg",
                displayName: "CAPE",
                description: "Convective Available Potential Energy",
            },
        };
        if (metadataMap[parameterName]) {
            return metadataMap[parameterName];
        }
        // Fallback for unknown parameters
        let units = "";
        let description = `${parameterName} forecast parameter`;
        if (parameterName.includes("temperature")) {
            units = "K";
            description = "Temperature forecast";
        }
        else if (parameterName.includes("speed") || parameterName.includes("velocity")) {
            units = "m/s";
            description = "Speed forecast";
        }
        else if (parameterName.includes("pressure")) {
            units = "Pa";
            description = "Pressure forecast";
        }
        else if (parameterName.includes("humidity")) {
            units = "ratio";
            description = "Humidity forecast (0-1)";
        }
        else if (parameterName.includes("precipitation") && !parameterName.includes("probability") && !parameterName.includes("hours")) {
            units = "m";
            description = "Precipitation forecast";
        }
        else if (parameterName.includes("probability")) {
            units = "ratio";
            description = "Probability forecast (0-1)";
        }
        else if (parameterName.includes("direction")) {
            units = "rad";
            description = "Direction forecast";
        }
        else if (parameterName.includes("visibility")) {
            units = "m";
            description = "Visibility forecast";
        }
        else if (parameterName.includes("height")) {
            units = "m";
            description = "Height forecast";
        }
        else if (parameterName.includes("period")) {
            units = "s";
            description = "Period forecast";
        }
        return {
            units,
            displayName: parameterName,
            description,
        };
    };
    // Process hourly weather forecast
    const processHourlyWeatherForecast = (data, maxHours) => {
        const forecasts = [];
        const hourly = data.hourly;
        if (!hourly || !hourly.time)
            return forecasts;
        const now = new Date();
        const startIndex = hourly.time.findIndex((t) => new Date(t) >= now);
        if (startIndex === -1)
            return forecasts;
        const count = Math.min(maxHours, hourly.time.length - startIndex);
        for (let i = 0; i < count; i++) {
            const dataIndex = startIndex + i;
            const forecast = {
                timestamp: hourly.time[dataIndex],
                relativeHour: i,
            };
            // Process each field with unit conversions
            Object.entries(hourly).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[dataIndex];
                if (value === undefined || value === null)
                    return;
                // Apply unit conversions
                if (field.includes("temperature") || field === "dew_point_2m" || field === "apparent_temperature") {
                    forecast[field] = celsiusToKelvin(value);
                }
                else if (field.includes("direction")) {
                    forecast[field] = degToRad(value);
                }
                else if (field === "precipitation" || field === "rain" || field === "showers") {
                    forecast[field] = mmToM(value);
                }
                else if (field === "snowfall") {
                    forecast[field] = cmToM(value); // Snowfall is in cm
                }
                else if (field.includes("pressure")) {
                    forecast[field] = hPaToPA(value);
                }
                else if (field.includes("humidity") || field.includes("cloud_cover") || field === "precipitation_probability") {
                    forecast[field] = percentToRatio(value);
                }
                else if (field === "visibility") {
                    // Visibility is already in meters from Open-Meteo
                    forecast[field] = value;
                }
                else {
                    forecast[field] = value;
                }
            });
            forecasts.push(forecast);
        }
        return forecasts;
    };
    // Process daily weather forecast
    const processDailyWeatherForecast = (data, maxDays) => {
        const forecasts = [];
        const daily = data.daily;
        if (!daily || !daily.time)
            return forecasts;
        const count = Math.min(maxDays, daily.time.length);
        for (let i = 0; i < count; i++) {
            const forecast = {
                date: daily.time[i],
                dayIndex: i,
            };
            // Process each field with unit conversions
            Object.entries(daily).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[i];
                if (value === undefined || value === null)
                    return;
                // Apply unit conversions
                if (field.includes("temperature")) {
                    forecast[field] = celsiusToKelvin(value);
                }
                else if (field.includes("direction")) {
                    forecast[field] = degToRad(value);
                }
                else if (field === "precipitation_sum" || field === "rain_sum" || field === "showers_sum") {
                    forecast[field] = mmToM(value);
                }
                else if (field === "snowfall_sum") {
                    forecast[field] = cmToM(value);
                }
                else if (field === "precipitation_probability_max") {
                    forecast[field] = percentToRatio(value);
                }
                else {
                    forecast[field] = value;
                }
            });
            forecasts.push(forecast);
        }
        return forecasts;
    };
    // Process hourly marine forecast
    const processHourlyMarineForecast = (data, maxHours) => {
        const forecasts = [];
        const hourly = data.hourly;
        if (!hourly || !hourly.time)
            return forecasts;
        const now = new Date();
        const startIndex = hourly.time.findIndex((t) => new Date(t) >= now);
        if (startIndex === -1)
            return forecasts;
        const count = Math.min(maxHours, hourly.time.length - startIndex);
        for (let i = 0; i < count; i++) {
            const dataIndex = startIndex + i;
            const forecast = {
                timestamp: hourly.time[dataIndex],
                relativeHour: i,
            };
            // Process each field with unit conversions
            Object.entries(hourly).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[dataIndex];
                if (value === undefined || value === null)
                    return;
                // Apply unit conversions
                if (field === "sea_surface_temperature") {
                    forecast[field] = celsiusToKelvin(value);
                }
                else if (field.includes("direction")) {
                    forecast[field] = degToRad(value);
                }
                else if (field === "ocean_current_velocity") {
                    forecast[field] = kmhToMs(value); // Current velocity is in km/h
                }
                else {
                    // Wave heights, periods are already in meters/seconds
                    forecast[field] = value;
                }
            });
            forecasts.push(forecast);
        }
        return forecasts;
    };
    // Process daily marine forecast
    const processDailyMarineForecast = (data, maxDays) => {
        const forecasts = [];
        const daily = data.daily;
        if (!daily || !daily.time)
            return forecasts;
        const count = Math.min(maxDays, daily.time.length);
        for (let i = 0; i < count; i++) {
            const forecast = {
                date: daily.time[i],
                dayIndex: i,
            };
            // Process each field with unit conversions
            Object.entries(daily).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[i];
                if (value === undefined || value === null)
                    return;
                // Apply unit conversions
                if (field.includes("direction")) {
                    forecast[field] = degToRad(value);
                }
                else {
                    forecast[field] = value;
                }
            });
            forecasts.push(forecast);
        }
        return forecasts;
    };
    // Publish hourly forecasts for a single package (weather or marine)
    const publishHourlyPackage = async (forecasts, packageType) => {
        const sourceLabel = getSourceLabel(`hourly-${packageType}`);
        for (let index = 0; index < forecasts.length; index++) {
            const forecast = forecasts[index];
            const values = [];
            const meta = [];
            Object.entries(forecast).forEach(([key, value]) => {
                if (key === "timestamp" || key === "relativeHour")
                    return;
                const path = `environment.outside.openmeteo.forecast.hourly.${key}.${index}`;
                const metadata = getParameterMetadata(key);
                values.push({ path, value });
                meta.push({ path, value: metadata });
            });
            if (values.length === 0)
                continue;
            const delta = {
                context: "vessels.self",
                updates: [
                    {
                        $source: sourceLabel,
                        timestamp: forecast.timestamp || new Date().toISOString(),
                        values,
                        meta,
                    },
                ],
            };
            app.handleMessage(plugin.id, delta);
            // Yield to event loop every 10 messages to prevent blocking
            if (index % 10 === 9) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        }
        app.debug(`Published ${forecasts.length} hourly ${packageType} forecasts`);
    };
    // Publish daily forecasts for a single package (weather or marine)
    const publishDailyPackage = (forecasts, packageType) => {
        const sourceLabel = getSourceLabel(`daily-${packageType}`);
        forecasts.forEach((forecast, index) => {
            const values = [];
            const meta = [];
            Object.entries(forecast).forEach(([key, value]) => {
                if (key === "date" || key === "dayIndex")
                    return;
                const path = `environment.outside.openmeteo.forecast.daily.${key}.${index}`;
                const metadata = getParameterMetadata(key);
                values.push({ path, value });
                meta.push({ path, value: metadata });
            });
            if (values.length === 0)
                return;
            const delta = {
                context: "vessels.self",
                updates: [
                    {
                        $source: sourceLabel,
                        timestamp: new Date().toISOString(),
                        values,
                        meta,
                    },
                ],
            };
            app.handleMessage(plugin.id, delta);
        });
        app.debug(`Published ${forecasts.length} daily ${packageType} forecasts`);
    };
    // Fetch and publish all forecasts
    const fetchAndPublishForecasts = async (config) => {
        if (!state.currentPosition) {
            app.debug("No position available, skipping forecast fetch");
            return;
        }
        const position = state.currentPosition;
        // Fetch weather data
        const weatherData = await fetchWeatherData(position, config);
        // Fetch marine data
        const marineData = config.enableMarineHourly || config.enableMarineDaily
            ? await fetchMarineData(position, config)
            : null;
        if (!weatherData && !marineData) {
            app.error("Failed to fetch any forecast data");
            return;
        }
        // Process and publish hourly forecasts - separate packages like meteoblue
        if (config.enableHourlyWeather && weatherData) {
            const hourlyWeather = processHourlyWeatherForecast(weatherData, config.maxForecastHours);
            if (hourlyWeather.length > 0) {
                await publishHourlyPackage(hourlyWeather, "weather");
            }
        }
        if (config.enableMarineHourly && marineData) {
            const hourlyMarine = processHourlyMarineForecast(marineData, config.maxForecastHours);
            if (hourlyMarine.length > 0) {
                await publishHourlyPackage(hourlyMarine, "marine");
            }
        }
        // Process and publish daily forecasts - separate packages like meteoblue
        if (config.enableDailyWeather && weatherData) {
            const dailyWeather = processDailyWeatherForecast(weatherData, config.maxForecastDays);
            if (dailyWeather.length > 0) {
                publishDailyPackage(dailyWeather, "weather");
            }
        }
        if (config.enableMarineDaily && marineData) {
            const dailyMarine = processDailyMarineForecast(marineData, config.maxForecastDays);
            if (dailyMarine.length > 0) {
                publishDailyPackage(dailyMarine, "marine");
            }
        }
        state.lastForecastUpdate = Date.now();
        app.setPluginStatus("Active - Forecasts updated");
    };
    // Weather API provider implementation
    const convertToWeatherAPIForecast = (forecastData, type) => {
        const isDaily = type === "daily";
        return {
            date: forecastData.timestamp || forecastData.date || new Date().toISOString(),
            type,
            description: getWeatherDescription(forecastData.weather_code, "Open-Meteo weather"),
            longDescription: getWeatherLongDescription(forecastData.weather_code, "Open-Meteo weather forecast"),
            icon: getWeatherIcon(forecastData.weather_code, forecastData.is_day),
            outside: {
                temperature: forecastData.temperature_2m,
                maxTemperature: forecastData.temperature_2m_max,
                minTemperature: forecastData.temperature_2m_min,
                feelsLikeTemperature: forecastData.apparent_temperature || forecastData.apparent_temperature_max,
                pressure: forecastData.pressure_msl,
                relativeHumidity: forecastData.relative_humidity_2m,
                uvIndex: forecastData.uv_index || forecastData.uv_index_max,
                cloudCover: forecastData.cloud_cover,
                precipitationVolume: forecastData.precipitation || forecastData.precipitation_sum,
                dewPointTemperature: forecastData.dew_point_2m,
                horizontalVisibility: forecastData.visibility,
                precipitationProbability: forecastData.precipitation_probability || forecastData.precipitation_probability_max,
                lowCloudCover: forecastData.cloud_cover_low,
                midCloudCover: forecastData.cloud_cover_mid,
                highCloudCover: forecastData.cloud_cover_high,
                solarRadiation: forecastData.shortwave_radiation || forecastData.shortwave_radiation_sum,
                directNormalIrradiance: forecastData.direct_normal_irradiance,
                diffuseHorizontalIrradiance: forecastData.diffuse_radiation,
            },
            water: {
                temperature: forecastData.sea_surface_temperature,
                waveSignificantHeight: forecastData.wave_height || forecastData.wave_height_max,
                wavePeriod: forecastData.wave_period || forecastData.wave_period_max,
                waveDirection: forecastData.wave_direction || forecastData.wave_direction_dominant,
                windWaveHeight: forecastData.wind_wave_height || forecastData.wind_wave_height_max,
                windWavePeriod: forecastData.wind_wave_period || forecastData.wind_wave_period_max,
                windWaveDirection: forecastData.wind_wave_direction || forecastData.wind_wave_direction_dominant,
                swellHeight: forecastData.swell_wave_height || forecastData.swell_wave_height_max,
                swellPeriod: forecastData.swell_wave_period || forecastData.swell_wave_period_max,
                swellDirection: forecastData.swell_wave_direction || forecastData.swell_wave_direction_dominant,
                surfaceCurrentSpeed: forecastData.ocean_current_velocity,
                surfaceCurrentDirection: forecastData.ocean_current_direction,
                swellPeakPeriod: forecastData.swell_wave_peak_period || forecastData.swell_wave_peak_period_max,
                windWavePeakPeriod: forecastData.wind_wave_peak_period || forecastData.wind_wave_peak_period_max,
            },
            wind: {
                speedTrue: forecastData.wind_speed_10m || forecastData.wind_speed_10m_max,
                directionTrue: forecastData.wind_direction_10m || forecastData.wind_direction_10m_dominant,
                gust: forecastData.wind_gusts_10m || forecastData.wind_gusts_10m_max,
            },
            sun: {
                sunrise: forecastData.sunrise,
                sunset: forecastData.sunset,
                sunshineDuration: forecastData.sunshine_duration,
                isDaylight: forecastData.is_day === 1,
            },
        };
    };
    // Get hourly forecasts from SignalK tree
    const getHourlyForecasts = (maxCount) => {
        const forecasts = [];
        try {
            // Read forecast data from SignalK tree
            let forecastCount = 0;
            for (let i = 0; i < maxCount + 10; i++) {
                const temp = app.getSelfPath(`environment.outside.openmeteo.forecast.hourly.temperature_2m.${i}`);
                if (temp && temp.value !== undefined) {
                    forecastCount = i + 1;
                }
                else {
                    break;
                }
            }
            const actualCount = Math.min(forecastCount, maxCount);
            for (let i = 0; i < actualCount; i++) {
                const forecastData = {};
                const fields = [
                    "temperature_2m",
                    "relative_humidity_2m",
                    "dew_point_2m",
                    "apparent_temperature",
                    "precipitation_probability",
                    "precipitation",
                    "weather_code",
                    "pressure_msl",
                    "cloud_cover",
                    "cloud_cover_low",
                    "cloud_cover_mid",
                    "cloud_cover_high",
                    "visibility",
                    "wind_speed_10m",
                    "wind_direction_10m",
                    "wind_gusts_10m",
                    "uv_index",
                    "is_day",
                    "sunshine_duration",
                    "shortwave_radiation",
                    "direct_radiation",
                    "diffuse_radiation",
                    "direct_normal_irradiance",
                    "wave_height",
                    "wave_direction",
                    "wave_period",
                    "wind_wave_height",
                    "wind_wave_direction",
                    "wind_wave_period",
                    "swell_wave_height",
                    "swell_wave_direction",
                    "swell_wave_period",
                    "ocean_current_velocity",
                    "ocean_current_direction",
                    "sea_surface_temperature",
                ];
                fields.forEach((field) => {
                    const data = app.getSelfPath(`environment.outside.openmeteo.forecast.hourly.${field}.${i}`);
                    if (data && data.value !== undefined) {
                        forecastData[field] = data.value;
                    }
                });
                if (Object.keys(forecastData).length > 0) {
                    const date = new Date();
                    date.setHours(date.getHours() + i);
                    forecastData.timestamp = date.toISOString();
                    forecasts.push(convertToWeatherAPIForecast(forecastData, "point"));
                }
            }
        }
        catch (error) {
            app.error(`Error reading hourly forecasts: ${error instanceof Error ? error.message : String(error)}`);
        }
        return forecasts;
    };
    // Get daily forecasts from SignalK tree
    const getDailyForecasts = (maxCount) => {
        const forecasts = [];
        try {
            let forecastCount = 0;
            for (let i = 0; i < maxCount + 2; i++) {
                const temp = app.getSelfPath(`environment.outside.openmeteo.forecast.daily.temperature_2m_max.${i}`);
                if (temp && temp.value !== undefined) {
                    forecastCount = i + 1;
                }
                else {
                    break;
                }
            }
            const actualCount = Math.min(forecastCount, maxCount);
            for (let i = 0; i < actualCount; i++) {
                const forecastData = {};
                const fields = [
                    "weather_code",
                    "temperature_2m_max",
                    "temperature_2m_min",
                    "apparent_temperature_max",
                    "apparent_temperature_min",
                    "sunrise",
                    "sunset",
                    "sunshine_duration",
                    "uv_index_max",
                    "precipitation_sum",
                    "precipitation_probability_max",
                    "wind_speed_10m_max",
                    "wind_gusts_10m_max",
                    "wind_direction_10m_dominant",
                    "wave_height_max",
                    "wave_direction_dominant",
                    "wave_period_max",
                    "swell_wave_height_max",
                    "swell_wave_direction_dominant",
                    "swell_wave_period_max",
                ];
                fields.forEach((field) => {
                    const data = app.getSelfPath(`environment.outside.openmeteo.forecast.daily.${field}.${i}`);
                    if (data && data.value !== undefined) {
                        forecastData[field] = data.value;
                    }
                });
                if (Object.keys(forecastData).length > 0) {
                    const date = new Date();
                    date.setDate(date.getDate() + i);
                    forecastData.date = date.toISOString().split("T")[0];
                    forecasts.push(convertToWeatherAPIForecast(forecastData, "daily"));
                }
            }
        }
        catch (error) {
            app.error(`Error reading daily forecasts: ${error instanceof Error ? error.message : String(error)}`);
        }
        return forecasts;
    };
    // Weather API provider
    const weatherProvider = {
        name: "signalk-open-meteo",
        methods: {
            pluginId: plugin.id,
            getObservations: async (position, options) => {
                // Return current conditions as observation
                const forecasts = getHourlyForecasts(1);
                if (forecasts.length > 0) {
                    forecasts[0].type = "observation";
                }
                return forecasts;
            },
            getForecasts: async (position, type, options) => {
                const maxCount = (options === null || options === void 0 ? void 0 : options.maxCount) || (type === "daily" ? 7 : 72);
                if (type === "daily") {
                    return getDailyForecasts(maxCount);
                }
                else {
                    return getHourlyForecasts(maxCount);
                }
            },
            getWarnings: async (position) => {
                // Open-Meteo doesn't provide weather warnings
                return [];
            },
        },
    };
    // Setup position subscription
    const setupPositionSubscription = (config) => {
        if (!config.enablePositionSubscription) {
            app.debug("Position subscription disabled");
            return;
        }
        app.debug("Setting up position subscription");
        const subscription = {
            context: "vessels.self",
            subscribe: [
                { path: "navigation.position", period: 60000 },
                { path: "navigation.courseOverGroundTrue", period: 60000 },
                { path: "navigation.speedOverGround", period: 60000 },
            ],
        };
        app.subscriptionmanager.subscribe(subscription, state.navigationSubscriptions, (err) => {
            app.error(`Navigation subscription error: ${err}`);
        }, (delta) => {
            var _a;
            (_a = delta.updates) === null || _a === void 0 ? void 0 : _a.forEach((update) => {
                var _a;
                (_a = update.values) === null || _a === void 0 ? void 0 : _a.forEach((v) => {
                    if (v.path === "navigation.position" && v.value) {
                        const pos = v.value;
                        if (pos.latitude && pos.longitude) {
                            const newPosition = {
                                latitude: pos.latitude,
                                longitude: pos.longitude,
                                timestamp: new Date(),
                            };
                            if (!state.currentPosition) {
                                state.currentPosition = newPosition;
                                app.debug(`Initial position: ${pos.latitude}, ${pos.longitude}`);
                                // Trigger initial forecast fetch
                                if (state.currentConfig) {
                                    fetchAndPublishForecasts(state.currentConfig);
                                }
                            }
                            else {
                                state.currentPosition = newPosition;
                            }
                        }
                    }
                    else if (v.path === "navigation.courseOverGroundTrue" && v.value !== null) {
                        state.currentHeading = v.value;
                    }
                    else if (v.path === "navigation.speedOverGround" && v.value !== null) {
                        state.currentSOG = v.value;
                    }
                });
            });
        });
    };
    // Plugin start
    plugin.start = (options) => {
        const config = {
            apiKey: options.apiKey || "",
            forecastInterval: options.forecastInterval || 60,
            altitude: options.altitude || 2,
            enablePositionSubscription: options.enablePositionSubscription !== false,
            maxForecastHours: options.maxForecastHours || 72,
            maxForecastDays: options.maxForecastDays || 7,
            enableHourlyWeather: options.enableHourlyWeather !== false,
            enableDailyWeather: options.enableDailyWeather !== false,
            enableMarineHourly: options.enableMarineHourly !== false,
            enableMarineDaily: options.enableMarineDaily !== false,
            enableCurrentConditions: options.enableCurrentConditions !== false,
            enableAutoMovingForecast: options.enableAutoMovingForecast || false,
            movingSpeedThreshold: options.movingSpeedThreshold || 1.0,
        };
        state.currentConfig = config;
        app.debug("Starting Open-Meteo plugin");
        app.setPluginStatus("Initializing...");
        // Register as Weather API provider
        try {
            app.registerWeatherProvider(weatherProvider);
            app.debug("Successfully registered as Weather API provider");
        }
        catch (error) {
            app.error(`Failed to register Weather API provider: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Setup position subscription
        setupPositionSubscription(config);
        // Setup forecast interval
        const intervalMs = config.forecastInterval * 60 * 1000;
        state.forecastInterval = setInterval(() => {
            if (state.forecastEnabled && state.currentPosition) {
                fetchAndPublishForecasts(config);
            }
        }, intervalMs);
        // Initial fetch if position is available
        setTimeout(() => {
            if (state.currentPosition) {
                fetchAndPublishForecasts(config);
            }
            else {
                app.debug("No position available yet, waiting for position subscription");
                app.setPluginStatus("Waiting for position...");
            }
        }, 1000);
    };
    // Plugin stop
    plugin.stop = () => {
        app.debug("Stopping Open-Meteo plugin");
        // Clear forecast interval
        if (state.forecastInterval) {
            clearInterval(state.forecastInterval);
            state.forecastInterval = null;
        }
        // Unsubscribe from navigation
        state.navigationSubscriptions.forEach((unsub) => {
            try {
                unsub();
            }
            catch (e) {
                // Ignore unsubscribe errors
            }
        });
        state.navigationSubscriptions = [];
        // Reset state
        state.currentPosition = null;
        state.currentHeading = null;
        state.currentSOG = null;
        state.lastForecastUpdate = 0;
        state.movingForecastEngaged = false;
        app.setPluginStatus("Stopped");
    };
    return plugin;
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUFBLDREQUErQjtBQWtCL0IsaUJBQVMsVUFBVSxHQUFlO0lBQ2hDLE1BQU0sTUFBTSxHQUFrQjtRQUM1QixFQUFFLEVBQUUsb0JBQW9CO1FBQ3hCLElBQUksRUFBRSw0QkFBNEI7UUFDbEMsV0FBVyxFQUFFLHFFQUFxRTtRQUNsRixNQUFNLEVBQUUsRUFBRTtRQUNWLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRSxDQUFDO1FBQ2YsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFFLENBQUM7S0FDZixDQUFDO0lBRUYsTUFBTSxLQUFLLEdBQWdCO1FBQ3pCLGdCQUFnQixFQUFFLElBQUk7UUFDdEIsdUJBQXVCLEVBQUUsRUFBRTtRQUMzQixhQUFhLEVBQUUsU0FBUztRQUN4QixlQUFlLEVBQUUsSUFBSTtRQUNyQixjQUFjLEVBQUUsSUFBSTtRQUNwQixVQUFVLEVBQUUsSUFBSTtRQUNoQixrQkFBa0IsRUFBRSxDQUFDO1FBQ3JCLGVBQWUsRUFBRSxJQUFJO1FBQ3JCLHFCQUFxQixFQUFFLEtBQUs7S0FDN0IsQ0FBQztJQUVGLHdEQUF3RDtJQUN4RCxrREFBa0Q7SUFDbEQsTUFBTSxtQkFBbUIsR0FBMkI7UUFDbEQsQ0FBQyxFQUFFLE9BQU87UUFDVixDQUFDLEVBQUUsY0FBYztRQUNqQixDQUFDLEVBQUUsZUFBZTtRQUNsQixDQUFDLEVBQUUsVUFBVTtRQUNiLEVBQUUsRUFBRSxLQUFLO1FBQ1QsRUFBRSxFQUFFLHFCQUFxQjtRQUN6QixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVBQUUsa0JBQWtCO1FBQ3RCLEVBQUUsRUFBRSxlQUFlO1FBQ25CLEVBQUUsRUFBRSx3QkFBd0I7UUFDNUIsRUFBRSxFQUFFLHdCQUF3QjtRQUM1QixFQUFFLEVBQUUsYUFBYTtRQUNqQixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVB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Q0FBQztJQUVGLGNBQWM7SUFDZCxNQUFNLENBQUMsSUFBSSxHQUFHLEdBQUcsRUFBRTtRQUNqQixHQUFHLENBQUMsS0FBSyxDQUFDLDRCQUE0QixDQUFDLENBQUM7UUFFeEMsMEJBQTBCO1FBQzFCLElBQUksS0FBSyxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDM0IsYUFBYSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1lBQ3RDLEtBQUssQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUM7UUFDaEMsQ0FBQztRQUVELDhCQUE4QjtRQUM5QixLQUFLLENBQUMsdUJBQXVCLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDOUMsSUFBSSxDQUFDO2dCQUNILEtBQUssRUFBRSxDQUFDO1lBQ1YsQ0FBQztZQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ1gsNEJBQTRCO1lBQzlCLENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUNILEtBQUssQ0FBQyx1QkFBdUIsR0FBRyxFQUFFLENBQUM7UUFFbkMsY0FBYztRQUNkLEtBQUssQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFDO1FBQzdCLEtBQUssQ0FBQyxjQUFjLEdBQUcsSUFBSSxDQUFDO1FBQzVCLEtBQUssQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDO1FBQ3hCLEtBQUssQ0FBQyxrQkFBa0IsR0FBRyxDQUFDLENBQUM7UUFDN0IsS0FBSyxDQUFDLHFCQUFxQixHQUFHLEtBQUssQ0FBQztRQUVwQyxHQUFHLENBQUMsZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ2pDLENBQUMsQ0FBQztJQUVGLE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBmZXRjaCBmcm9tIFwibm9kZS1mZXRjaFwiO1xuaW1wb3J0IHtcbiAgU2lnbmFsS0FwcCxcbiAgU2lnbmFsS1BsdWdpbixcbiAgUGx1Z2luQ29uZmlnLFxuICBQbHVnaW5TdGF0ZSxcbiAgUG9zaXRpb24sXG4gIE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSxcbiAgT3Blbk1ldGVvTWFyaW5lUmVzcG9uc2UsXG4gIFNpZ25hbEtEZWx0YSxcbiAgU3Vic2NyaXB0aW9uUmVxdWVzdCxcbiAgV2VhdGhlclByb3ZpZGVyLFxuICBXZWF0aGVyRGF0YSxcbiAgV2VhdGhlcldhcm5pbmcsXG4gIFdlYXRoZXJSZXFQYXJhbXMsXG4gIFdlYXRoZXJGb3JlY2FzdFR5cGUsXG59IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCA9IGZ1bmN0aW9uIChhcHA6IFNpZ25hbEtBcHApOiBTaWduYWxLUGx1Z2luIHtcbiAgY29uc3QgcGx1Z2luOiBTaWduYWxLUGx1Z2luID0ge1xuICAgIGlkOiBcInNpZ25hbGstb3Blbi1tZXRlb1wiLFxuICAgIG5hbWU6IFwiU2lnbmFsSyBPcGVuLU1ldGVvIFdlYXRoZXJcIixcbiAgICBkZXNjcmlwdGlvbjogXCJQb3NpdGlvbi1iYXNlZCB3ZWF0aGVyIGFuZCBtYXJpbmUgZm9yZWNhc3QgZGF0YSBmcm9tIE9wZW4tTWV0ZW8gQVBJXCIsXG4gICAgc2NoZW1hOiB7fSxcbiAgICBzdGFydDogKCkgPT4ge30sXG4gICAgc3RvcDogKCkgPT4ge30sXG4gIH07XG5cbiAgY29uc3Qgc3RhdGU6IFBsdWdpblN0YXRlID0ge1xuICAgIGZvcmVjYXN0SW50ZXJ2YWw6IG51bGwsXG4gICAgbmF2aWdhdGlvblN1YnNjcmlwdGlvbnM6IFtdLFxuICAgIGN1cnJlbnRDb25maWc6IHVuZGVmaW5lZCxcbiAgICBjdXJyZW50UG9zaXRpb246IG51bGwsXG4gICAgY3VycmVudEhlYWRpbmc6IG51bGwsXG4gICAgY3VycmVudFNPRzogbnVsbCxcbiAgICBsYXN0Rm9yZWNhc3RVcGRhdGU6IDAsXG4gICAgZm9yZWNhc3RFbmFibGVkOiB0cnVlLFxuICAgIG1vdmluZ0ZvcmVjYXN0RW5nYWdlZDogZmFsc2UsXG4gIH07XG5cbiAgLy8gV01PIFdlYXRoZXIgaW50ZXJwcmV0YXRpb24gY29kZXMgKHVzZWQgYnkgT3Blbi1NZXRlbylcbiAgLy8gaHR0cHM6Ly9vcGVuLW1ldGVvLmNvbS9lbi9kb2NzI3dlYXRoZXJ2YXJpYWJsZXNcbiAgY29uc3Qgd21vQ29kZURlc2NyaXB0aW9uczogUmVjb3JkPG51bWJlciwgc3RyaW5nPiA9IHtcbiAgICAwOiBcIkNsZWFyXCIsXG4gICAgMTogXCJNb3N0bHkgQ2xlYXJcIixcbiAgICAyOiBcIlBhcnRseSBDbG91ZHlcIixcbiAgICAzOiBcIk92ZXJjYXN0XCIsXG4gICAgNDU6IFwiRm9nXCIsXG4gICAgNDg6IFwiRGVwb3NpdGluZyBSaW1lIEZvZ1wiLFxuICAgIDUxOiBcIkxpZ2h0IERyaXp6bGVcIixcbiAgICA1MzogXCJNb2RlcmF0ZSBEcml6emxlXCIsXG4gICAgNTU6IFwiRGVuc2UgRHJpenpsZVwiLFxuICAgIDU2OiBcIkxpZ2h0IEZyZWV6aW5nIERyaXp6bGVcIixcbiAgICA1NzogXCJEZW5zZSBGcmVlemluZyBEcml6emxlXCIsXG4gICAgNjE6IFwiU2xpZ2h0IFJhaW5cIixcbiAgICA2MzogXCJNb2RlcmF0ZSBSYWluXCIsXG4gICAgNjU6IFwiSGVhdnkgUmFpblwiLFxuICAgIDY2OiBcIkxpZ2h0IEZyZWV6aW5nIFJhaW5cIixcbiAgICA2NzogXCJIZWF2eSBGcmVlemluZyBSYWluXCIsXG4gICAgNzE6IFwiU2xpZ2h0IFNub3dcIixcbiAgICA3MzogXCJNb2RlcmF0ZSBTbm93XCIsXG4gICAgNzU6IFwiSGVhdnkgU25vd1wiLFxuICAgIDc3OiBcIlNub3cgR3JhaW5zXCIsXG4gICAgODA6IFwiU2xpZ2h0IFJhaW4gU2hvd2Vyc1wiLFxuICAgIDgxOiBcIk1vZGVyYXRlIFJhaW4gU2hvd2Vyc1wiLFxuICAgIDgyOiBcIlZpb2xlbnQgUmFpbiBTaG93ZXJzXCIsXG4gICAgODU6IFwiU2xpZ2h0IFNub3cgU2hvd2Vyc1wiLFxuICAgIDg2OiBcIkhlYXZ5IFNub3cgU2hvd2Vyc1wiLFxuICAgIDk1OiBcIlRodW5kZXJzdG9ybVwiLFxuICAgIDk2OiBcIlRodW5kZXJzdG9ybSB3aXRoIFNsaWdodCBIYWlsXCIsXG4gICAgOTk6IFwiVGh1bmRlcnN0b3JtIHdpdGggSGVhdnkgSGFpbFwiLFxuICB9O1xuXG4gIGNvbnN0IHdtb0NvZGVMb25nRGVzY3JpcHRpb25zOiBSZWNvcmQ8bnVtYmVyLCBzdHJpbmc+ID0ge1xuICAgIDA6IFwiQ2xlYXIgc2t5IHdpdGggbm8gY2xvdWQgY292ZXJcIixcbiAgICAxOiBcIk1haW5seSBjbGVhciB3aXRoIG1pbmltYWwgY2xvdWQgY292ZXJcIixcbiAgICAyOiBcIlBhcnRseSBjbG91ZHkgd2l0aCBzY2F0dGVyZWQgY2xvdWRzXCIsXG4gICAgMzogXCJPdmVyY2FzdCB3aXRoIGNvbXBsZXRlIGNsb3VkIGNvdmVyXCIsXG4gICAgNDU6IFwiRm9nIHJlZHVjaW5nIHZpc2liaWxpdHlcIixcbiAgICA0ODogXCJEZXBvc2l0aW5nIHJpbWUgZm9nIHdpdGggaWNlIGZvcm1hdGlvblwiLFxuICAgIDUxOiBcIkxpZ2h0IGRyaXp6bGUgd2l0aCBmaW5lIHByZWNpcGl0YXRpb25cIixcbiAgICA1MzogXCJNb2RlcmF0ZSBkcml6emxlIHdpdGggc3RlYWR5IGxpZ2h0IHJhaW5cIixcbiAgICA1NTogXCJEZW5zZSBkcml6emxlIHdpdGggY29udGludW91cyBsaWdodCByYWluXCIsXG4gICAgNTY6IFwiTGlnaHQgZnJlZXppbmcgZHJpenpsZSwgaWNlIHBvc3NpYmxlXCIsXG4gICAgNTc6IFwiRGVuc2UgZnJlZXppbmcgZHJpenpsZSwgaGF6YXJkb3VzIGNvbmRpdGlvbnNcIixcbiAgICA2MTogXCJTbGlnaHQgcmFpbiB3aXRoIGxpZ2h0IHByZWNpcGl0YXRpb25cIixcbiAgICA2MzogXCJNb2RlcmF0ZSByYWluIHdpdGggc3RlYWR5IHByZWNpcGl0YXRpb25cIixcbiAgICA2NTogXCJIZWF2eSByYWluIHdpdGggaW50ZW5zZSBwcmVjaXBpdGF0aW9uXCIsXG4gICAgNjY6IFwiTGlnaHQgZnJlZXppbmcgcmFpbiwgaWNlIGFjY3VtdWxhdGlvbiBwb3NzaWJsZVwiLFxuICAgIDY3OiBcIkhlYXZ5IGZyZWV6aW5nIHJhaW4sIGhhemFyZG91cyBpY2UgY29uZGl0aW9uc1wiLFxuICAgIDcxOiBcIlNsaWdodCBzbm93ZmFsbCB3aXRoIGxpZ2h0IGFjY3VtdWxhdGlvblwiLFxuICAgIDczOiBcIk1vZGVyYXRlIHNub3dmYWxsIHdpdGggc3RlYWR5IGFjY3VtdWxhdGlvblwiLFxuICAgIDc1OiBcIkhlYXZ5IHNub3dmYWxsIHdpdGggc2lnbmlmaWNhbnQgYWNjdW11bGF0aW9uXCIsXG4gICAgNzc6IFwiU25vdyBncmFpbnMsIGZpbmUgaWNlIHBhcnRpY2xlcyBmYWxsaW5nXCIsXG4gICAgODA6IFwiU2xpZ2h0IHJhaW4gc2hvd2VycywgYnJpZWYgbGlnaHQgcmFpblwiLFxuICAgIDgxOiBcIk1vZGVyYXRlIHJhaW4gc2hvd2VycywgaW50ZXJtaXR0ZW50IHJhaW5cIixcbiAgICA4MjogXCJWaW9sZW50IHJhaW4gc2hvd2VycywgaW50ZW5zZSBkb3ducG91cnNcIixcbiAgICA4NTogXCJTbGlnaHQgc25vdyBzaG93ZXJzLCBicmllZiBsaWdodCBzbm93XCIsXG4gICAgODY6IFwiSGVhdnkgc25vdyBzaG93ZXJzLCBpbnRlbnNlIHNub3dmYWxsXCIsXG4gICAgOTU6IFwiVGh1bmRlcnN0b3JtIHdpdGggbGlnaHRuaW5nIGFuZCB0aHVuZGVyXCIsXG4gICAgOTY6IFwiVGh1bmRlcnN0b3JtIHdpdGggc2xpZ2h0IGhhaWxcIixcbiAgICA5OTogXCJUaHVuZGVyc3Rvcm0gd2l0aCBoZWF2eSBoYWlsLCBkYW5nZXJvdXMgY29uZGl0aW9uc1wiLFxuICB9O1xuXG4gIC8vIEdldCBpY29uIG5hbWUgZnJvbSBXTU8gY29kZVxuICBjb25zdCBnZXRXZWF0aGVySWNvbiA9IChcbiAgICB3bW9Db2RlOiBudW1iZXIgfCB1bmRlZmluZWQsXG4gICAgaXNEYXk6IGJvb2xlYW4gfCBudW1iZXIgfCB1bmRlZmluZWQsXG4gICk6IHN0cmluZyB8IHVuZGVmaW5lZCA9PiB7XG4gICAgaWYgKHdtb0NvZGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBkYXlOaWdodCA9IGlzRGF5ID09PSB0cnVlIHx8IGlzRGF5ID09PSAxID8gXCJkYXlcIiA6IFwibmlnaHRcIjtcbiAgICByZXR1cm4gYHdtb18ke3dtb0NvZGV9XyR7ZGF5TmlnaHR9LnN2Z2A7XG4gIH07XG5cbiAgY29uc3QgZ2V0V2VhdGhlckRlc2NyaXB0aW9uID0gKFxuICAgIHdtb0NvZGU6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBmYWxsYmFjazogc3RyaW5nLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGlmICh3bW9Db2RlID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxsYmFjaztcbiAgICByZXR1cm4gd21vQ29kZURlc2NyaXB0aW9uc1t3bW9Db2RlXSB8fCBmYWxsYmFjaztcbiAgfTtcblxuICBjb25zdCBnZXRXZWF0aGVyTG9uZ0Rlc2NyaXB0aW9uID0gKFxuICAgIHdtb0NvZGU6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBmYWxsYmFjazogc3RyaW5nLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGlmICh3bW9Db2RlID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxsYmFjaztcbiAgICByZXR1cm4gd21vQ29kZUxvbmdEZXNjcmlwdGlvbnNbd21vQ29kZV0gfHwgZmFsbGJhY2s7XG4gIH07XG5cbiAgLy8gQ29uZmlndXJhdGlvbiBzY2hlbWFcbiAgcGx1Z2luLnNjaGVtYSA9IHtcbiAgICB0eXBlOiBcIm9iamVjdFwiLFxuICAgIHJlcXVpcmVkOiBbXSxcbiAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICBhcGlLZXk6IHtcbiAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgdGl0bGU6IFwiQVBJIEtleSAoT3B0aW9uYWwpXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAgIFwiT3Blbi1NZXRlbyBBUEkga2V5IGZvciBjb21tZXJjaWFsIHVzZS4gTGVhdmUgZW1wdHkgZm9yIGZyZWUgbm9uLWNvbW1lcmNpYWwgdXNlLlwiLFxuICAgICAgfSxcbiAgICAgIGZvcmVjYXN0SW50ZXJ2YWw6IHtcbiAgICAgICAgdHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgdGl0bGU6IFwiRm9yZWNhc3QgVXBkYXRlIEludGVydmFsIChtaW51dGVzKVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJIb3cgb2Z0ZW4gdG8gZmV0Y2ggbmV3IGZvcmVjYXN0IGRhdGFcIixcbiAgICAgICAgZGVmYXVsdDogNjAsXG4gICAgICAgIG1pbmltdW06IDE1LFxuICAgICAgICBtYXhpbXVtOiAxNDQwLFxuICAgICAgfSxcbiAgICAgIGFsdGl0dWRlOiB7XG4gICAgICAgIHR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgIHRpdGxlOiBcIkRlZmF1bHQgQWx0aXR1ZGUgKG1ldGVycylcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGVmYXVsdCBhbHRpdHVkZSBmb3IgZWxldmF0aW9uIGNvcnJlY3Rpb25cIixcbiAgICAgICAgZGVmYXVsdDogMixcbiAgICAgICAgbWluaW11bTogMCxcbiAgICAgICAgbWF4aW11bTogMTAwMDAsXG4gICAgICB9LFxuICAgICAgZW5hYmxlUG9zaXRpb25TdWJzY3JpcHRpb246IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBQb3NpdGlvbiBTdWJzY3JpcHRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgXCJTdWJzY3JpYmUgdG8gbmF2aWdhdGlvbi5wb3NpdGlvbiB1cGRhdGVzIGZvciBhdXRvbWF0aWMgZm9yZWNhc3QgdXBkYXRlc1wiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIG1heEZvcmVjYXN0SG91cnM6IHtcbiAgICAgICAgdHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgdGl0bGU6IFwiTWF4IEZvcmVjYXN0IEhvdXJzXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gbnVtYmVyIG9mIGhvdXJseSBmb3JlY2FzdHMgdG8gcmV0cmlldmUgKDEtMzg0KVwiLFxuICAgICAgICBkZWZhdWx0OiA3MixcbiAgICAgICAgbWluaW11bTogMSxcbiAgICAgICAgbWF4aW11bTogMzg0LFxuICAgICAgfSxcbiAgICAgIG1heEZvcmVjYXN0RGF5czoge1xuICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICB0aXRsZTogXCJNYXggRm9yZWNhc3QgRGF5c1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIG51bWJlciBvZiBkYWlseSBmb3JlY2FzdHMgdG8gcmV0cmlldmUgKDEtMTYpXCIsXG4gICAgICAgIGRlZmF1bHQ6IDcsXG4gICAgICAgIG1pbmltdW06IDEsXG4gICAgICAgIG1heGltdW06IDE2LFxuICAgICAgfSxcbiAgICAgIGVuYWJsZUhvdXJseVdlYXRoZXI6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBIb3VybHkgV2VhdGhlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJGZXRjaCBob3VybHkgd2VhdGhlciBmb3JlY2FzdHNcIixcbiAgICAgICAgZGVmYXVsdDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBlbmFibGVEYWlseVdlYXRoZXI6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBEYWlseSBXZWF0aGVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoIGRhaWx5IHdlYXRoZXIgZm9yZWNhc3RzXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlTWFyaW5lSG91cmx5OiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgTWFyaW5lIEhvdXJseVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJGZXRjaCBob3VybHkgbWFyaW5lIGZvcmVjYXN0cyAod2F2ZXMsIGN1cnJlbnRzLCBzZWEgdGVtcGVyYXR1cmUpXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlTWFyaW5lRGFpbHk6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBNYXJpbmUgRGFpbHlcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRmV0Y2ggZGFpbHkgbWFyaW5lIGZvcmVjYXN0c1wiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZUN1cnJlbnRDb25kaXRpb25zOiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgQ3VycmVudCBDb25kaXRpb25zXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoIGN1cnJlbnQgd2VhdGhlciBjb25kaXRpb25zXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlQXV0b01vdmluZ0ZvcmVjYXN0OiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgQXV0byBNb3ZpbmcgRm9yZWNhc3RcIixcbiAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgXCJBdXRvbWF0aWNhbGx5IGVuZ2FnZSBtb3ZpbmcgZm9yZWNhc3QgbW9kZSB3aGVuIHZlc3NlbCBzcGVlZCBleGNlZWRzIHRocmVzaG9sZFwiLFxuICAgICAgICBkZWZhdWx0OiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBtb3ZpbmdTcGVlZFRocmVzaG9sZDoge1xuICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICB0aXRsZTogXCJNb3ZpbmcgU3BlZWQgVGhyZXNob2xkIChrbm90cylcIixcbiAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgXCJNaW5pbXVtIHNwZWVkIGluIGtub3RzIHRvIGF1dG9tYXRpY2FsbHkgZW5nYWdlIG1vdmluZyBmb3JlY2FzdCBtb2RlXCIsXG4gICAgICAgIGRlZmF1bHQ6IDEuMCxcbiAgICAgICAgbWluaW11bTogMC4xLFxuICAgICAgICBtYXhpbXVtOiAxMC4wLFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xuXG4gIC8vIFV0aWxpdHkgZnVuY3Rpb25zXG4gIGNvbnN0IGRlZ1RvUmFkID0gKGRlZ3JlZXM6IG51bWJlcik6IG51bWJlciA9PiBkZWdyZWVzICogKE1hdGguUEkgLyAxODApO1xuICBjb25zdCBjZWxzaXVzVG9LZWx2aW4gPSAoY2Vsc2l1czogbnVtYmVyKTogbnVtYmVyID0+IGNlbHNpdXMgKyAyNzMuMTU7XG4gIGNvbnN0IGhQYVRvUEEgPSAoaFBhOiBudW1iZXIpOiBudW1iZXIgPT4gaFBhICogMTAwO1xuICBjb25zdCBtbVRvTSA9IChtbTogbnVtYmVyKTogbnVtYmVyID0+IG1tIC8gMTAwMDtcbiAgY29uc3QgY21Ub00gPSAoY206IG51bWJlcik6IG51bWJlciA9PiBjbSAvIDEwMDtcbiAgY29uc3Qga21Ub00gPSAoa206IG51bWJlcik6IG51bWJlciA9PiBrbSAqIDEwMDA7XG4gIGNvbnN0IGttaFRvTXMgPSAoa21oOiBudW1iZXIpOiBudW1iZXIgPT4ga21oIC8gMy42O1xuICBjb25zdCBwZXJjZW50VG9SYXRpbyA9IChwZXJjZW50OiBudW1iZXIpOiBudW1iZXIgPT4gcGVyY2VudCAvIDEwMDtcblxuICAvLyBCdWlsZCBPcGVuLU1ldGVvIFdlYXRoZXIgQVBJIFVSTFxuICBjb25zdCBidWlsZFdlYXRoZXJVcmwgPSAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGNvbnN0IGJhc2VVcmwgPSBjb25maWcuYXBpS2V5XG4gICAgICA/IGBodHRwczovL2N1c3RvbWVyLWFwaS5vcGVuLW1ldGVvLmNvbS92MS9mb3JlY2FzdGBcbiAgICAgIDogYGh0dHBzOi8vYXBpLm9wZW4tbWV0ZW8uY29tL3YxL2ZvcmVjYXN0YDtcblxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgbGF0aXR1ZGU6IHBvc2l0aW9uLmxhdGl0dWRlLnRvU3RyaW5nKCksXG4gICAgICBsb25naXR1ZGU6IHBvc2l0aW9uLmxvbmdpdHVkZS50b1N0cmluZygpLFxuICAgICAgdGltZXpvbmU6IFwiVVRDXCIsXG4gICAgICBmb3JlY2FzdF9kYXlzOiBNYXRoLm1pbihjb25maWcubWF4Rm9yZWNhc3REYXlzLCAxNikudG9TdHJpbmcoKSxcbiAgICB9KTtcblxuICAgIGlmIChjb25maWcuYXBpS2V5KSB7XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiYXBpa2V5XCIsIGNvbmZpZy5hcGlLZXkpO1xuICAgIH1cblxuICAgIC8vIEhvdXJseSB3ZWF0aGVyIHZhcmlhYmxlc1xuICAgIGlmIChjb25maWcuZW5hYmxlSG91cmx5V2VhdGhlcikge1xuICAgICAgY29uc3QgaG91cmx5VmFycyA9IFtcbiAgICAgICAgXCJ0ZW1wZXJhdHVyZV8ybVwiLFxuICAgICAgICBcInJlbGF0aXZlX2h1bWlkaXR5XzJtXCIsXG4gICAgICAgIFwiZGV3X3BvaW50XzJtXCIsXG4gICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVcIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5XCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvblwiLFxuICAgICAgICBcInJhaW5cIixcbiAgICAgICAgXCJzaG93ZXJzXCIsXG4gICAgICAgIFwic25vd2ZhbGxcIixcbiAgICAgICAgXCJ3ZWF0aGVyX2NvZGVcIixcbiAgICAgICAgXCJwcmVzc3VyZV9tc2xcIixcbiAgICAgICAgXCJzdXJmYWNlX3ByZXNzdXJlXCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJcIixcbiAgICAgICAgXCJjbG91ZF9jb3Zlcl9sb3dcIixcbiAgICAgICAgXCJjbG91ZF9jb3Zlcl9taWRcIixcbiAgICAgICAgXCJjbG91ZF9jb3Zlcl9oaWdoXCIsXG4gICAgICAgIFwidmlzaWJpbGl0eVwiLFxuICAgICAgICBcIndpbmRfc3BlZWRfMTBtXCIsXG4gICAgICAgIFwid2luZF9kaXJlY3Rpb25fMTBtXCIsXG4gICAgICAgIFwid2luZF9ndXN0c18xMG1cIixcbiAgICAgICAgXCJ1dl9pbmRleFwiLFxuICAgICAgICBcImlzX2RheVwiLFxuICAgICAgICBcInN1bnNoaW5lX2R1cmF0aW9uXCIsXG4gICAgICAgIFwiY2FwZVwiLFxuICAgICAgICBcInNob3J0d2F2ZV9yYWRpYXRpb25cIixcbiAgICAgICAgXCJkaXJlY3RfcmFkaWF0aW9uXCIsXG4gICAgICAgIFwiZGlmZnVzZV9yYWRpYXRpb25cIixcbiAgICAgICAgXCJkaXJlY3Rfbm9ybWFsX2lycmFkaWFuY2VcIixcbiAgICAgIF07XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiaG91cmx5XCIsIGhvdXJseVZhcnMuam9pbihcIixcIikpO1xuICAgIH1cblxuICAgIC8vIERhaWx5IHdlYXRoZXIgdmFyaWFibGVzXG4gICAgaWYgKGNvbmZpZy5lbmFibGVEYWlseVdlYXRoZXIpIHtcbiAgICAgIGNvbnN0IGRhaWx5VmFycyA9IFtcbiAgICAgICAgXCJ3ZWF0aGVyX2NvZGVcIixcbiAgICAgICAgXCJ0ZW1wZXJhdHVyZV8ybV9tYXhcIixcbiAgICAgICAgXCJ0ZW1wZXJhdHVyZV8ybV9taW5cIixcbiAgICAgICAgXCJhcHBhcmVudF90ZW1wZXJhdHVyZV9tYXhcIixcbiAgICAgICAgXCJhcHBhcmVudF90ZW1wZXJhdHVyZV9taW5cIixcbiAgICAgICAgXCJzdW5yaXNlXCIsXG4gICAgICAgIFwic3Vuc2V0XCIsXG4gICAgICAgIFwiZGF5bGlnaHRfZHVyYXRpb25cIixcbiAgICAgICAgXCJzdW5zaGluZV9kdXJhdGlvblwiLFxuICAgICAgICBcInV2X2luZGV4X21heFwiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25fc3VtXCIsXG4gICAgICAgIFwicmFpbl9zdW1cIixcbiAgICAgICAgXCJzaG93ZXJzX3N1bVwiLFxuICAgICAgICBcInNub3dmYWxsX3N1bVwiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25faG91cnNcIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5X21heFwiLFxuICAgICAgICBcIndpbmRfc3BlZWRfMTBtX21heFwiLFxuICAgICAgICBcIndpbmRfZ3VzdHNfMTBtX21heFwiLFxuICAgICAgICBcIndpbmRfZGlyZWN0aW9uXzEwbV9kb21pbmFudFwiLFxuICAgICAgICBcInNob3J0d2F2ZV9yYWRpYXRpb25fc3VtXCIsXG4gICAgICBdO1xuICAgICAgcGFyYW1zLmFwcGVuZChcImRhaWx5XCIsIGRhaWx5VmFycy5qb2luKFwiLFwiKSk7XG4gICAgfVxuXG4gICAgLy8gQ3VycmVudCBjb25kaXRpb25zXG4gICAgaWYgKGNvbmZpZy5lbmFibGVDdXJyZW50Q29uZGl0aW9ucykge1xuICAgICAgY29uc3QgY3VycmVudFZhcnMgPSBbXG4gICAgICAgIFwidGVtcGVyYXR1cmVfMm1cIixcbiAgICAgICAgXCJyZWxhdGl2ZV9odW1pZGl0eV8ybVwiLFxuICAgICAgICBcImFwcGFyZW50X3RlbXBlcmF0dXJlXCIsXG4gICAgICAgIFwiaXNfZGF5XCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvblwiLFxuICAgICAgICBcInJhaW5cIixcbiAgICAgICAgXCJzaG93ZXJzXCIsXG4gICAgICAgIFwic25vd2ZhbGxcIixcbiAgICAgICAgXCJ3ZWF0aGVyX2NvZGVcIixcbiAgICAgICAgXCJjbG91ZF9jb3ZlclwiLFxuICAgICAgICBcInByZXNzdXJlX21zbFwiLFxuICAgICAgICBcInN1cmZhY2VfcHJlc3N1cmVcIixcbiAgICAgICAgXCJ3aW5kX3NwZWVkXzEwbVwiLFxuICAgICAgICBcIndpbmRfZGlyZWN0aW9uXzEwbVwiLFxuICAgICAgICBcIndpbmRfZ3VzdHNfMTBtXCIsXG4gICAgICBdO1xuICAgICAgcGFyYW1zLmFwcGVuZChcImN1cnJlbnRcIiwgY3VycmVudFZhcnMuam9pbihcIixcIikpO1xuICAgIH1cblxuICAgIC8vIFJlcXVlc3Qgd2luZCBzcGVlZCBpbiBtL3MgZm9yIFNpZ25hbEsgY29tcGF0aWJpbGl0eVxuICAgIHBhcmFtcy5hcHBlbmQoXCJ3aW5kX3NwZWVkX3VuaXRcIiwgXCJtc1wiKTtcblxuICAgIHJldHVybiBgJHtiYXNlVXJsfT8ke3BhcmFtcy50b1N0cmluZygpfWA7XG4gIH07XG5cbiAgLy8gQnVpbGQgT3Blbi1NZXRlbyBNYXJpbmUgQVBJIFVSTFxuICBjb25zdCBidWlsZE1hcmluZVVybCA9IChcbiAgICBwb3NpdGlvbjogUG9zaXRpb24sXG4gICAgY29uZmlnOiBQbHVnaW5Db25maWcsXG4gICk6IHN0cmluZyA9PiB7XG4gICAgY29uc3QgYmFzZVVybCA9IGNvbmZpZy5hcGlLZXlcbiAgICAgID8gYGh0dHBzOi8vY3VzdG9tZXItbWFyaW5lLWFwaS5vcGVuLW1ldGVvLmNvbS92MS9tYXJpbmVgXG4gICAgICA6IGBodHRwczovL21hcmluZS1hcGkub3Blbi1tZXRlby5jb20vdjEvbWFyaW5lYDtcblxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgbGF0aXR1ZGU6IHBvc2l0aW9uLmxhdGl0dWRlLnRvU3RyaW5nKCksXG4gICAgICBsb25naXR1ZGU6IHBvc2l0aW9uLmxvbmdpdHVkZS50b1N0cmluZygpLFxuICAgICAgdGltZXpvbmU6IFwiVVRDXCIsXG4gICAgICBmb3JlY2FzdF9kYXlzOiBNYXRoLm1pbihjb25maWcubWF4Rm9yZWNhc3REYXlzLCA4KS50b1N0cmluZygpLCAvLyBNYXJpbmUgQVBJIG1heCBpcyA4IGRheXNcbiAgICB9KTtcblxuICAgIGlmIChjb25maWcuYXBpS2V5KSB7XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiYXBpa2V5XCIsIGNvbmZpZy5hcGlLZXkpO1xuICAgIH1cblxuICAgIC8vIEhvdXJseSBtYXJpbmUgdmFyaWFibGVzXG4gICAgaWYgKGNvbmZpZy5lbmFibGVNYXJpbmVIb3VybHkpIHtcbiAgICAgIGNvbnN0IGhvdXJseVZhcnMgPSBbXG4gICAgICAgIFwid2F2ZV9oZWlnaHRcIixcbiAgICAgICAgXCJ3YXZlX2RpcmVjdGlvblwiLFxuICAgICAgICBcIndhdmVfcGVyaW9kXCIsXG4gICAgICAgIFwid2luZF93YXZlX2hlaWdodFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9kaXJlY3Rpb25cIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfcGVyaW9kXCIsXG4gICAgICAgIFwid2luZF93YXZlX3BlYWtfcGVyaW9kXCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9oZWlnaHRcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX2RpcmVjdGlvblwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfcGVyaW9kXCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9wZWFrX3BlcmlvZFwiLFxuICAgICAgICBcIm9jZWFuX2N1cnJlbnRfdmVsb2NpdHlcIixcbiAgICAgICAgXCJvY2Vhbl9jdXJyZW50X2RpcmVjdGlvblwiLFxuICAgICAgICBcInNlYV9zdXJmYWNlX3RlbXBlcmF0dXJlXCIsXG4gICAgICBdO1xuICAgICAgcGFyYW1zLmFwcGVuZChcImhvdXJseVwiLCBob3VybHlWYXJzLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICAvLyBEYWlseSBtYXJpbmUgdmFyaWFibGVzXG4gICAgaWYgKGNvbmZpZy5lbmFibGVNYXJpbmVEYWlseSkge1xuICAgICAgY29uc3QgZGFpbHlWYXJzID0gW1xuICAgICAgICBcIndhdmVfaGVpZ2h0X21heFwiLFxuICAgICAgICBcIndhdmVfZGlyZWN0aW9uX2RvbWluYW50XCIsXG4gICAgICAgIFwid2F2ZV9wZXJpb2RfbWF4XCIsXG4gICAgICAgIFwid2luZF93YXZlX2hlaWdodF9tYXhcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfZGlyZWN0aW9uX2RvbWluYW50XCIsXG4gICAgICAgIFwid2luZF93YXZlX3BlcmlvZF9tYXhcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfcGVha19wZXJpb2RfbWF4XCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9oZWlnaHRfbWF4XCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9kaXJlY3Rpb25fZG9taW5hbnRcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX3BlcmlvZF9tYXhcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX3BlYWtfcGVyaW9kX21heFwiLFxuICAgICAgXTtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJkYWlseVwiLCBkYWlseVZhcnMuam9pbihcIixcIikpO1xuICAgIH1cblxuICAgIHJldHVybiBgJHtiYXNlVXJsfT8ke3BhcmFtcy50b1N0cmluZygpfWA7XG4gIH07XG5cbiAgLy8gRmV0Y2ggd2VhdGhlciBkYXRhIGZyb20gT3Blbi1NZXRlb1xuICBjb25zdCBmZXRjaFdlYXRoZXJEYXRhID0gYXN5bmMgKFxuICAgIHBvc2l0aW9uOiBQb3NpdGlvbixcbiAgICBjb25maWc6IFBsdWdpbkNvbmZpZyxcbiAgKTogUHJvbWlzZTxPcGVuTWV0ZW9XZWF0aGVyUmVzcG9uc2UgfCBudWxsPiA9PiB7XG4gICAgY29uc3QgdXJsID0gYnVpbGRXZWF0aGVyVXJsKHBvc2l0aW9uLCBjb25maWcpO1xuICAgIGFwcC5kZWJ1ZyhgRmV0Y2hpbmcgd2VhdGhlciBmcm9tOiAke3VybH1gKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCk7XG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfTogJHtlcnJvclRleHR9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgT3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBGYWlsZWQgdG8gZmV0Y2ggd2VhdGhlciBkYXRhOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfTtcblxuICAvLyBGZXRjaCBtYXJpbmUgZGF0YSBmcm9tIE9wZW4tTWV0ZW9cbiAgY29uc3QgZmV0Y2hNYXJpbmVEYXRhID0gYXN5bmMgKFxuICAgIHBvc2l0aW9uOiBQb3NpdGlvbixcbiAgICBjb25maWc6IFBsdWdpbkNvbmZpZyxcbiAgKTogUHJvbWlzZTxPcGVuTWV0ZW9NYXJpbmVSZXNwb25zZSB8IG51bGw+ID0+IHtcbiAgICBjb25zdCB1cmwgPSBidWlsZE1hcmluZVVybChwb3NpdGlvbiwgY29uZmlnKTtcbiAgICBhcHAuZGVidWcoYEZldGNoaW5nIG1hcmluZSBkYXRhIGZyb206ICR7dXJsfWApO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsKTtcbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgICAgY29uc3QgZXJyb3JUZXh0ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke2Vycm9yVGV4dH1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyBPcGVuTWV0ZW9NYXJpbmVSZXNwb25zZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXBwLmVycm9yKFxuICAgICAgICBgRmFpbGVkIHRvIGZldGNoIG1hcmluZSBkYXRhOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfTtcblxuICAvLyBHZXQgc291cmNlIGxhYmVsIGZvciBTaWduYWxLXG4gIGNvbnN0IGdldFNvdXJjZUxhYmVsID0gKGRhdGFUeXBlOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICAgIHJldHVybiBgb3Blbi1tZXRlby4ke2RhdGFUeXBlfWA7XG4gIH07XG5cbiAgLy8gR2V0IHBhcmFtZXRlciBtZXRhZGF0YSBmb3IgU2lnbmFsS1xuICBjb25zdCBnZXRQYXJhbWV0ZXJNZXRhZGF0YSA9IChwYXJhbWV0ZXJOYW1lOiBzdHJpbmcpOiBhbnkgPT4ge1xuICAgIGNvbnN0IG1ldGFkYXRhTWFwOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgLy8gVGVtcGVyYXR1cmUgcGFyYW1ldGVycyAoU2lnbmFsSyBjb21wbGlhbnQgLSBLZWx2aW4pXG4gICAgICB0ZW1wZXJhdHVyZV8ybToge1xuICAgICAgICB1bml0czogXCJLXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlRlbXBlcmF0dXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkFpciB0ZW1wZXJhdHVyZSBhdCAybSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBhcHBhcmVudF90ZW1wZXJhdHVyZToge1xuICAgICAgICB1bml0czogXCJLXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkZlZWxzIExpa2UgVGVtcGVyYXR1cmVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiQXBwYXJlbnQgdGVtcGVyYXR1cmUgY29uc2lkZXJpbmcgd2luZCBhbmQgaHVtaWRpdHlcIixcbiAgICAgIH0sXG4gICAgICBkZXdfcG9pbnRfMm06IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEZXcgUG9pbnRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGV3IHBvaW50IHRlbXBlcmF0dXJlIGF0IDJtIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHNlYV9zdXJmYWNlX3RlbXBlcmF0dXJlOiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU2VhIFN1cmZhY2UgVGVtcGVyYXR1cmVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU2VhIHN1cmZhY2UgdGVtcGVyYXR1cmVcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFdpbmQgcGFyYW1ldGVycyAoU2lnbmFsSyBjb21wbGlhbnQgLSBtL3MsIHJhZGlhbnMpXG4gICAgICB3aW5kX3NwZWVkXzEwbToge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBTcGVlZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kIHNwZWVkIGF0IDEwbSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kX2d1c3RzXzEwbToge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBHdXN0c1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kIGd1c3Qgc3BlZWQgYXQgMTBtIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmRfZGlyZWN0aW9uXzEwbToge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZCBkaXJlY3Rpb24gYXQgMTBtIGhlaWdodFwiLFxuICAgICAgfSxcblxuICAgICAgLy8gUHJlc3N1cmUgcGFyYW1ldGVycyAoU2lnbmFsSyBjb21wbGlhbnQgLSBQYXNjYWwpXG4gICAgICBwcmVzc3VyZV9tc2w6IHtcbiAgICAgICAgdW5pdHM6IFwiUGFcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU2VhIExldmVsIFByZXNzdXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkF0bW9zcGhlcmljIHByZXNzdXJlIGF0IG1lYW4gc2VhIGxldmVsXCIsXG4gICAgICB9LFxuICAgICAgc3VyZmFjZV9wcmVzc3VyZToge1xuICAgICAgICB1bml0czogXCJQYVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTdXJmYWNlIFByZXNzdXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkF0bW9zcGhlcmljIHByZXNzdXJlIGF0IHN1cmZhY2VcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIEh1bWlkaXR5IChTaWduYWxLIGNvbXBsaWFudCAtIHJhdGlvIDAtMSlcbiAgICAgIHJlbGF0aXZlX2h1bWlkaXR5XzJtOiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlJlbGF0aXZlIEh1bWlkaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlJlbGF0aXZlIGh1bWlkaXR5IGF0IDJtIGhlaWdodCAoMC0xKVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gQ2xvdWQgY292ZXIgKFNpZ25hbEsgY29tcGxpYW50IC0gcmF0aW8gMC0xKVxuICAgICAgY2xvdWRfY292ZXI6IHtcbiAgICAgICAgdW5pdHM6IFwicmF0aW9cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ2xvdWQgQ292ZXJcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVG90YWwgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBjbG91ZF9jb3Zlcl9sb3c6IHtcbiAgICAgICAgdW5pdHM6IFwicmF0aW9cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTG93IENsb3VkIENvdmVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkxvdyBhbHRpdHVkZSBjbG91ZCBjb3ZlciAoMC0xKVwiLFxuICAgICAgfSxcbiAgICAgIGNsb3VkX2NvdmVyX21pZDoge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNaWQgQ2xvdWQgQ292ZXJcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWlkIGFsdGl0dWRlIGNsb3VkIGNvdmVyICgwLTEpXCIsXG4gICAgICB9LFxuICAgICAgY2xvdWRfY292ZXJfaGlnaDoge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJIaWdoIENsb3VkIENvdmVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkhpZ2ggYWx0aXR1ZGUgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFByZWNpcGl0YXRpb24gKFNpZ25hbEsgY29tcGxpYW50IC0gbWV0ZXJzKVxuICAgICAgcHJlY2lwaXRhdGlvbjoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlByZWNpcGl0YXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiUHJlY2lwaXRhdGlvbiBhbW91bnRcIixcbiAgICAgIH0sXG4gICAgICByYWluOiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiUmFpblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJSYWluIGFtb3VudFwiLFxuICAgICAgfSxcbiAgICAgIHNub3dmYWxsOiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU25vd2ZhbGxcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU25vd2ZhbGwgYW1vdW50XCIsXG4gICAgICB9LFxuICAgICAgcHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eToge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJQcmVjaXBpdGF0aW9uIFByb2JhYmlsaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlByb2JhYmlsaXR5IG9mIHByZWNpcGl0YXRpb24gKDAtMSlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFZpc2liaWxpdHkgKFNpZ25hbEsgY29tcGxpYW50IC0gbWV0ZXJzKVxuICAgICAgdmlzaWJpbGl0eToge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlZpc2liaWxpdHlcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiSG9yaXpvbnRhbCB2aXNpYmlsaXR5XCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBXYXZlIHBhcmFtZXRlcnMgKG1ldGVycywgc2Vjb25kcywgcmFkaWFucylcbiAgICAgIHdhdmVfaGVpZ2h0OiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2F2ZSBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU2lnbmlmaWNhbnQgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3YXZlX3BlcmlvZDoge1xuICAgICAgICB1bml0czogXCJzXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldhdmUgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldhdmUgcGVyaW9kXCIsXG4gICAgICB9LFxuICAgICAgd2F2ZV9kaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldhdmUgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldhdmUgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuICAgICAgd2luZF93YXZlX2hlaWdodDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgV2F2ZSBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZC1nZW5lcmF0ZWQgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kX3dhdmVfcGVyaW9kOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBXYXZlIFBlcmlvZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kLWdlbmVyYXRlZCB3YXZlIHBlcmlvZFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmRfd2F2ZV9kaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgV2F2ZSBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZC1nZW5lcmF0ZWQgd2F2ZSBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG4gICAgICBzd2VsbF93YXZlX2hlaWdodDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIEhlaWdodFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTd2VsbCB3YXZlIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsX3dhdmVfcGVyaW9kOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU3dlbGwgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlN3ZWxsIHdhdmUgcGVyaW9kXCIsXG4gICAgICB9LFxuICAgICAgc3dlbGxfd2F2ZV9kaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTd2VsbCB3YXZlIGRpcmVjdGlvblwiLFxuICAgICAgfSxcblxuICAgICAgLy8gT2NlYW4gY3VycmVudHNcbiAgICAgIG9jZWFuX2N1cnJlbnRfdmVsb2NpdHk6IHtcbiAgICAgICAgdW5pdHM6IFwibS9zXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkN1cnJlbnQgU3BlZWRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiT2NlYW4gY3VycmVudCB2ZWxvY2l0eVwiLFxuICAgICAgfSxcbiAgICAgIG9jZWFuX2N1cnJlbnRfZGlyZWN0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInJhZFwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJDdXJyZW50IERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJPY2VhbiBjdXJyZW50IGRpcmVjdGlvblwiLFxuICAgICAgfSxcblxuICAgICAgLy8gU29sYXIgcmFkaWF0aW9uXG4gICAgICBzaG9ydHdhdmVfcmFkaWF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcIlcvbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU29sYXIgUmFkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlNob3J0d2F2ZSBzb2xhciByYWRpYXRpb25cIixcbiAgICAgIH0sXG4gICAgICBkaXJlY3RfcmFkaWF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcIlcvbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGlyZWN0IFJhZGlhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEaXJlY3Qgc29sYXIgcmFkaWF0aW9uXCIsXG4gICAgICB9LFxuICAgICAgZGlmZnVzZV9yYWRpYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwiVy9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEaWZmdXNlIFJhZGlhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEaWZmdXNlIHNvbGFyIHJhZGlhdGlvblwiLFxuICAgICAgfSxcbiAgICAgIGRpcmVjdF9ub3JtYWxfaXJyYWRpYW5jZToge1xuICAgICAgICB1bml0czogXCJXL20yXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRpcmVjdCBOb3JtYWwgSXJyYWRpYW5jZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEaXJlY3Qgbm9ybWFsIHNvbGFyIGlycmFkaWFuY2VcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIE90aGVyXG4gICAgICB1dl9pbmRleDoge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJVViBJbmRleFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJVViBpbmRleFwiLFxuICAgICAgfSxcbiAgICAgIHdlYXRoZXJfY29kZToge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJXZWF0aGVyIENvZGVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV01PIHdlYXRoZXIgaW50ZXJwcmV0YXRpb24gY29kZVwiLFxuICAgICAgfSxcbiAgICAgIGlzX2RheToge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJJcyBEYXlcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2hldGhlciBpdCBpcyBkYXkgKDEpIG9yIG5pZ2h0ICgwKVwiLFxuICAgICAgfSxcbiAgICAgIHN1bnNoaW5lX2R1cmF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU3Vuc2hpbmUgRHVyYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRHVyYXRpb24gb2Ygc3Vuc2hpbmVcIixcbiAgICAgIH0sXG4gICAgICBjYXBlOiB7XG4gICAgICAgIHVuaXRzOiBcIkova2dcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ0FQRVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJDb252ZWN0aXZlIEF2YWlsYWJsZSBQb3RlbnRpYWwgRW5lcmd5XCIsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBpZiAobWV0YWRhdGFNYXBbcGFyYW1ldGVyTmFtZV0pIHtcbiAgICAgIHJldHVybiBtZXRhZGF0YU1hcFtwYXJhbWV0ZXJOYW1lXTtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjayBmb3IgdW5rbm93biBwYXJhbWV0ZXJzXG4gICAgbGV0IHVuaXRzID0gXCJcIjtcbiAgICBsZXQgZGVzY3JpcHRpb24gPSBgJHtwYXJhbWV0ZXJOYW1lfSBmb3JlY2FzdCBwYXJhbWV0ZXJgO1xuXG4gICAgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJ0ZW1wZXJhdHVyZVwiKSkge1xuICAgICAgdW5pdHMgPSBcIktcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJUZW1wZXJhdHVyZSBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInNwZWVkXCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJ2ZWxvY2l0eVwiKSkge1xuICAgICAgdW5pdHMgPSBcIm0vc1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlNwZWVkIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwicHJlc3N1cmVcIikpIHtcbiAgICAgIHVuaXRzID0gXCJQYVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlByZXNzdXJlIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiaHVtaWRpdHlcIikpIHtcbiAgICAgIHVuaXRzID0gXCJyYXRpb1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIkh1bWlkaXR5IGZvcmVjYXN0ICgwLTEpXCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwicHJlY2lwaXRhdGlvblwiKSAmJiAhcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInByb2JhYmlsaXR5XCIpICYmICFwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiaG91cnNcIikpIHtcbiAgICAgIHVuaXRzID0gXCJtXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiUHJlY2lwaXRhdGlvbiBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInByb2JhYmlsaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwicmF0aW9cIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJQcm9iYWJpbGl0eSBmb3JlY2FzdCAoMC0xKVwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgdW5pdHMgPSBcInJhZFwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIkRpcmVjdGlvbiBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInZpc2liaWxpdHlcIikpIHtcbiAgICAgIHVuaXRzID0gXCJtXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiVmlzaWJpbGl0eSBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcImhlaWdodFwiKSkge1xuICAgICAgdW5pdHMgPSBcIm1cIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJIZWlnaHQgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJwZXJpb2RcIikpIHtcbiAgICAgIHVuaXRzID0gXCJzXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiUGVyaW9kIGZvcmVjYXN0XCI7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHVuaXRzLFxuICAgICAgZGlzcGxheU5hbWU6IHBhcmFtZXRlck5hbWUsXG4gICAgICBkZXNjcmlwdGlvbixcbiAgICB9O1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgaG91cmx5IHdlYXRoZXIgZm9yZWNhc3RcbiAgY29uc3QgcHJvY2Vzc0hvdXJseVdlYXRoZXJGb3JlY2FzdCA9IChcbiAgICBkYXRhOiBPcGVuTWV0ZW9XZWF0aGVyUmVzcG9uc2UsXG4gICAgbWF4SG91cnM6IG51bWJlcixcbiAgKTogUmVjb3JkPHN0cmluZywgYW55PltdID0+IHtcbiAgICBjb25zdCBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuICAgIGNvbnN0IGhvdXJseSA9IGRhdGEuaG91cmx5O1xuICAgIGlmICghaG91cmx5IHx8ICFob3VybHkudGltZSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IGhvdXJseS50aW1lLmZpbmRJbmRleChcbiAgICAgICh0KSA9PiBuZXcgRGF0ZSh0KSA+PSBub3csXG4gICAgKTtcbiAgICBpZiAoc3RhcnRJbmRleCA9PT0gLTEpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKG1heEhvdXJzLCBob3VybHkudGltZS5sZW5ndGggLSBzdGFydEluZGV4KTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgY29uc3QgZGF0YUluZGV4ID0gc3RhcnRJbmRleCArIGk7XG4gICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBob3VybHkudGltZVtkYXRhSW5kZXhdLFxuICAgICAgICByZWxhdGl2ZUhvdXI6IGksXG4gICAgICB9O1xuXG4gICAgICAvLyBQcm9jZXNzIGVhY2ggZmllbGQgd2l0aCB1bml0IGNvbnZlcnNpb25zXG4gICAgICBPYmplY3QuZW50cmllcyhob3VybHkpLmZvckVhY2goKFtmaWVsZCwgdmFsdWVzXSkgPT4ge1xuICAgICAgICBpZiAoZmllbGQgPT09IFwidGltZVwiIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykpIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB2YWx1ZXNbZGF0YUluZGV4XTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybjtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZC5pbmNsdWRlcyhcInRlbXBlcmF0dXJlXCIpIHx8IGZpZWxkID09PSBcImRld19wb2ludF8ybVwiIHx8IGZpZWxkID09PSBcImFwcGFyZW50X3RlbXBlcmF0dXJlXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSBjZWxzaXVzVG9LZWx2aW4odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W2ZpZWxkXSA9IGRlZ1RvUmFkKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwicHJlY2lwaXRhdGlvblwiIHx8IGZpZWxkID09PSBcInJhaW5cIiB8fCBmaWVsZCA9PT0gXCJzaG93ZXJzXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSBtbVRvTSh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInNub3dmYWxsXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSBjbVRvTSh2YWx1ZSBhcyBudW1iZXIpOyAvLyBTbm93ZmFsbCBpcyBpbiBjbVxuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLmluY2x1ZGVzKFwicHJlc3N1cmVcIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSBoUGFUb1BBKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQuaW5jbHVkZXMoXCJodW1pZGl0eVwiKSB8fCBmaWVsZC5pbmNsdWRlcyhcImNsb3VkX2NvdmVyXCIpIHx8IGZpZWxkID09PSBcInByZWNpcGl0YXRpb25fcHJvYmFiaWxpdHlcIikge1xuICAgICAgICAgIGZvcmVjYXN0W2ZpZWxkXSA9IHBlcmNlbnRUb1JhdGlvKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwidmlzaWJpbGl0eVwiKSB7XG4gICAgICAgICAgLy8gVmlzaWJpbGl0eSBpcyBhbHJlYWR5IGluIG1ldGVycyBmcm9tIE9wZW4tTWV0ZW9cbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgZGFpbHkgd2VhdGhlciBmb3JlY2FzdFxuICBjb25zdCBwcm9jZXNzRGFpbHlXZWF0aGVyRm9yZWNhc3QgPSAoXG4gICAgZGF0YTogT3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlLFxuICAgIG1heERheXM6IG51bWJlcixcbiAgKTogUmVjb3JkPHN0cmluZywgYW55PltdID0+IHtcbiAgICBjb25zdCBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuICAgIGNvbnN0IGRhaWx5ID0gZGF0YS5kYWlseTtcbiAgICBpZiAoIWRhaWx5IHx8ICFkYWlseS50aW1lKSByZXR1cm4gZm9yZWNhc3RzO1xuXG4gICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihtYXhEYXlzLCBkYWlseS50aW1lLmxlbmd0aCk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgIGNvbnN0IGZvcmVjYXN0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgICBkYXRlOiBkYWlseS50aW1lW2ldLFxuICAgICAgICBkYXlJbmRleDogaSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFByb2Nlc3MgZWFjaCBmaWVsZCB3aXRoIHVuaXQgY29udmVyc2lvbnNcbiAgICAgIE9iamVjdC5lbnRyaWVzKGRhaWx5KS5mb3JFYWNoKChbZmllbGQsIHZhbHVlc10pID0+IHtcbiAgICAgICAgaWYgKGZpZWxkID09PSBcInRpbWVcIiB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZXMpKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVzW2ldO1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gICAgICAgIC8vIEFwcGx5IHVuaXQgY29udmVyc2lvbnNcbiAgICAgICAgaWYgKGZpZWxkLmluY2x1ZGVzKFwidGVtcGVyYXR1cmVcIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSBjZWxzaXVzVG9LZWx2aW4odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W2ZpZWxkXSA9IGRlZ1RvUmFkKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwicHJlY2lwaXRhdGlvbl9zdW1cIiB8fCBmaWVsZCA9PT0gXCJyYWluX3N1bVwiIHx8IGZpZWxkID09PSBcInNob3dlcnNfc3VtXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSBtbVRvTSh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInNub3dmYWxsX3N1bVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbZmllbGRdID0gY21Ub00odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gXCJwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5X21heFwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbZmllbGRdID0gcGVyY2VudFRvUmF0aW8odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgaG91cmx5IG1hcmluZSBmb3JlY2FzdFxuICBjb25zdCBwcm9jZXNzSG91cmx5TWFyaW5lRm9yZWNhc3QgPSAoXG4gICAgZGF0YTogT3Blbk1ldGVvTWFyaW5lUmVzcG9uc2UsXG4gICAgbWF4SG91cnM6IG51bWJlcixcbiAgKTogUmVjb3JkPHN0cmluZywgYW55PltdID0+IHtcbiAgICBjb25zdCBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuICAgIGNvbnN0IGhvdXJseSA9IGRhdGEuaG91cmx5O1xuICAgIGlmICghaG91cmx5IHx8ICFob3VybHkudGltZSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IGhvdXJseS50aW1lLmZpbmRJbmRleChcbiAgICAgICh0KSA9PiBuZXcgRGF0ZSh0KSA+PSBub3csXG4gICAgKTtcbiAgICBpZiAoc3RhcnRJbmRleCA9PT0gLTEpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKG1heEhvdXJzLCBob3VybHkudGltZS5sZW5ndGggLSBzdGFydEluZGV4KTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgY29uc3QgZGF0YUluZGV4ID0gc3RhcnRJbmRleCArIGk7XG4gICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBob3VybHkudGltZVtkYXRhSW5kZXhdLFxuICAgICAgICByZWxhdGl2ZUhvdXI6IGksXG4gICAgICB9O1xuXG4gICAgICAvLyBQcm9jZXNzIGVhY2ggZmllbGQgd2l0aCB1bml0IGNvbnZlcnNpb25zXG4gICAgICBPYmplY3QuZW50cmllcyhob3VybHkpLmZvckVhY2goKFtmaWVsZCwgdmFsdWVzXSkgPT4ge1xuICAgICAgICBpZiAoZmllbGQgPT09IFwidGltZVwiIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykpIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB2YWx1ZXNbZGF0YUluZGV4XTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybjtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJzZWFfc3VyZmFjZV90ZW1wZXJhdHVyZVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbZmllbGRdID0gY2Vsc2l1c1RvS2VsdmluKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQuaW5jbHVkZXMoXCJkaXJlY3Rpb25cIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFtmaWVsZF0gPSBkZWdUb1JhZCh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcIm9jZWFuX2N1cnJlbnRfdmVsb2NpdHlcIikge1xuICAgICAgICAgIGZvcmVjYXN0W2ZpZWxkXSA9IGttaFRvTXModmFsdWUgYXMgbnVtYmVyKTsgLy8gQ3VycmVudCB2ZWxvY2l0eSBpcyBpbiBrbS9oXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gV2F2ZSBoZWlnaHRzLCBwZXJpb2RzIGFyZSBhbHJlYWR5IGluIG1ldGVycy9zZWNvbmRzXG4gICAgICAgICAgZm9yZWNhc3RbZmllbGRdID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBmb3JlY2FzdHMucHVzaChmb3JlY2FzdCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcmVjYXN0cztcbiAgfTtcblxuICAvLyBQcm9jZXNzIGRhaWx5IG1hcmluZSBmb3JlY2FzdFxuICBjb25zdCBwcm9jZXNzRGFpbHlNYXJpbmVGb3JlY2FzdCA9IChcbiAgICBkYXRhOiBPcGVuTWV0ZW9NYXJpbmVSZXNwb25zZSxcbiAgICBtYXhEYXlzOiBudW1iZXIsXG4gICk6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9PiB7XG4gICAgY29uc3QgZm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPSBbXTtcbiAgICBjb25zdCBkYWlseSA9IGRhdGEuZGFpbHk7XG4gICAgaWYgKCFkYWlseSB8fCAhZGFpbHkudGltZSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IGNvdW50ID0gTWF0aC5taW4obWF4RGF5cywgZGFpbHkudGltZS5sZW5ndGgpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgZGF0ZTogZGFpbHkudGltZVtpXSxcbiAgICAgICAgZGF5SW5kZXg6IGksXG4gICAgICB9O1xuXG4gICAgICAvLyBQcm9jZXNzIGVhY2ggZmllbGQgd2l0aCB1bml0IGNvbnZlcnNpb25zXG4gICAgICBPYmplY3QuZW50cmllcyhkYWlseSkuZm9yRWFjaCgoW2ZpZWxkLCB2YWx1ZXNdKSA9PiB7XG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJ0aW1lXCIgfHwgIUFycmF5LmlzQXJyYXkodmFsdWVzKSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHZhbHVlc1tpXTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybjtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W2ZpZWxkXSA9IGRlZ1RvUmFkKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZm9yZWNhc3RbZmllbGRdID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBmb3JlY2FzdHMucHVzaChmb3JlY2FzdCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcmVjYXN0cztcbiAgfTtcblxuICAvLyBQdWJsaXNoIGhvdXJseSBmb3JlY2FzdHMgZm9yIGEgc2luZ2xlIHBhY2thZ2UgKHdlYXRoZXIgb3IgbWFyaW5lKVxuICBjb25zdCBwdWJsaXNoSG91cmx5UGFja2FnZSA9IGFzeW5jIChcbiAgICBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSxcbiAgICBwYWNrYWdlVHlwZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgICBjb25zdCBzb3VyY2VMYWJlbCA9IGdldFNvdXJjZUxhYmVsKGBob3VybHktJHtwYWNrYWdlVHlwZX1gKTtcblxuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBmb3JlY2FzdHMubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICBjb25zdCBmb3JlY2FzdCA9IGZvcmVjYXN0c1tpbmRleF07XG4gICAgICBjb25zdCB2YWx1ZXM6IHsgcGF0aDogc3RyaW5nOyB2YWx1ZTogYW55IH1bXSA9IFtdO1xuICAgICAgY29uc3QgbWV0YTogeyBwYXRoOiBzdHJpbmc7IHZhbHVlOiBhbnkgfVtdID0gW107XG5cbiAgICAgIE9iamVjdC5lbnRyaWVzKGZvcmVjYXN0KS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCJ0aW1lc3RhbXBcIiB8fCBrZXkgPT09IFwicmVsYXRpdmVIb3VyXCIpIHJldHVybjtcbiAgICAgICAgY29uc3QgcGF0aCA9IGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5ob3VybHkuJHtrZXl9LiR7aW5kZXh9YDtcbiAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBnZXRQYXJhbWV0ZXJNZXRhZGF0YShrZXkpO1xuICAgICAgICB2YWx1ZXMucHVzaCh7IHBhdGgsIHZhbHVlIH0pO1xuICAgICAgICBtZXRhLnB1c2goeyBwYXRoLCB2YWx1ZTogbWV0YWRhdGEgfSk7XG4gICAgICB9KTtcblxuICAgICAgaWYgKHZhbHVlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBkZWx0YTogU2lnbmFsS0RlbHRhID0ge1xuICAgICAgICBjb250ZXh0OiBcInZlc3NlbHMuc2VsZlwiLFxuICAgICAgICB1cGRhdGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgJHNvdXJjZTogc291cmNlTGFiZWwsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IGZvcmVjYXN0LnRpbWVzdGFtcCB8fCBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICB2YWx1ZXMsXG4gICAgICAgICAgICBtZXRhLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9O1xuXG4gICAgICBhcHAuaGFuZGxlTWVzc2FnZShwbHVnaW4uaWQsIGRlbHRhKTtcblxuICAgICAgLy8gWWllbGQgdG8gZXZlbnQgbG9vcCBldmVyeSAxMCBtZXNzYWdlcyB0byBwcmV2ZW50IGJsb2NraW5nXG4gICAgICBpZiAoaW5kZXggJSAxMCA9PT0gOSkge1xuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0SW1tZWRpYXRlKHJlc29sdmUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhcHAuZGVidWcoYFB1Ymxpc2hlZCAke2ZvcmVjYXN0cy5sZW5ndGh9IGhvdXJseSAke3BhY2thZ2VUeXBlfSBmb3JlY2FzdHNgKTtcbiAgfTtcblxuICAvLyBQdWJsaXNoIGRhaWx5IGZvcmVjYXN0cyBmb3IgYSBzaW5nbGUgcGFja2FnZSAod2VhdGhlciBvciBtYXJpbmUpXG4gIGNvbnN0IHB1Ymxpc2hEYWlseVBhY2thZ2UgPSAoXG4gICAgZm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10sXG4gICAgcGFja2FnZVR5cGU6IHN0cmluZyxcbiAgKTogdm9pZCA9PiB7XG4gICAgY29uc3Qgc291cmNlTGFiZWwgPSBnZXRTb3VyY2VMYWJlbChgZGFpbHktJHtwYWNrYWdlVHlwZX1gKTtcblxuICAgIGZvcmVjYXN0cy5mb3JFYWNoKChmb3JlY2FzdCwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlczogeyBwYXRoOiBzdHJpbmc7IHZhbHVlOiBhbnkgfVtdID0gW107XG4gICAgICBjb25zdCBtZXRhOiB7IHBhdGg6IHN0cmluZzsgdmFsdWU6IGFueSB9W10gPSBbXTtcblxuICAgICAgT2JqZWN0LmVudHJpZXMoZm9yZWNhc3QpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcImRhdGVcIiB8fCBrZXkgPT09IFwiZGF5SW5kZXhcIikgcmV0dXJuO1xuICAgICAgICBjb25zdCBwYXRoID0gYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmRhaWx5LiR7a2V5fS4ke2luZGV4fWA7XG4gICAgICAgIGNvbnN0IG1ldGFkYXRhID0gZ2V0UGFyYW1ldGVyTWV0YWRhdGEoa2V5KTtcbiAgICAgICAgdmFsdWVzLnB1c2goeyBwYXRoLCB2YWx1ZSB9KTtcbiAgICAgICAgbWV0YS5wdXNoKHsgcGF0aCwgdmFsdWU6IG1ldGFkYXRhIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGlmICh2YWx1ZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGRlbHRhOiBTaWduYWxLRGVsdGEgPSB7XG4gICAgICAgIGNvbnRleHQ6IFwidmVzc2Vscy5zZWxmXCIsXG4gICAgICAgIHVwZGF0ZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAkc291cmNlOiBzb3VyY2VMYWJlbCxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgdmFsdWVzLFxuICAgICAgICAgICAgbWV0YSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfTtcblxuICAgICAgYXBwLmhhbmRsZU1lc3NhZ2UocGx1Z2luLmlkLCBkZWx0YSk7XG4gICAgfSk7XG5cbiAgICBhcHAuZGVidWcoYFB1Ymxpc2hlZCAke2ZvcmVjYXN0cy5sZW5ndGh9IGRhaWx5ICR7cGFja2FnZVR5cGV9IGZvcmVjYXN0c2ApO1xuICB9O1xuXG4gIC8vIEZldGNoIGFuZCBwdWJsaXNoIGFsbCBmb3JlY2FzdHNcbiAgY29uc3QgZmV0Y2hBbmRQdWJsaXNoRm9yZWNhc3RzID0gYXN5bmMgKGNvbmZpZzogUGx1Z2luQ29uZmlnKSA9PiB7XG4gICAgaWYgKCFzdGF0ZS5jdXJyZW50UG9zaXRpb24pIHtcbiAgICAgIGFwcC5kZWJ1ZyhcIk5vIHBvc2l0aW9uIGF2YWlsYWJsZSwgc2tpcHBpbmcgZm9yZWNhc3QgZmV0Y2hcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcG9zaXRpb24gPSBzdGF0ZS5jdXJyZW50UG9zaXRpb247XG5cbiAgICAvLyBGZXRjaCB3ZWF0aGVyIGRhdGFcbiAgICBjb25zdCB3ZWF0aGVyRGF0YSA9IGF3YWl0IGZldGNoV2VhdGhlckRhdGEocG9zaXRpb24sIGNvbmZpZyk7XG5cbiAgICAvLyBGZXRjaCBtYXJpbmUgZGF0YVxuICAgIGNvbnN0IG1hcmluZURhdGEgPSBjb25maWcuZW5hYmxlTWFyaW5lSG91cmx5IHx8IGNvbmZpZy5lbmFibGVNYXJpbmVEYWlseVxuICAgICAgPyBhd2FpdCBmZXRjaE1hcmluZURhdGEocG9zaXRpb24sIGNvbmZpZylcbiAgICAgIDogbnVsbDtcblxuICAgIGlmICghd2VhdGhlckRhdGEgJiYgIW1hcmluZURhdGEpIHtcbiAgICAgIGFwcC5lcnJvcihcIkZhaWxlZCB0byBmZXRjaCBhbnkgZm9yZWNhc3QgZGF0YVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGFuZCBwdWJsaXNoIGhvdXJseSBmb3JlY2FzdHMgLSBzZXBhcmF0ZSBwYWNrYWdlcyBsaWtlIG1ldGVvYmx1ZVxuICAgIGlmIChjb25maWcuZW5hYmxlSG91cmx5V2VhdGhlciAmJiB3ZWF0aGVyRGF0YSkge1xuICAgICAgY29uc3QgaG91cmx5V2VhdGhlciA9IHByb2Nlc3NIb3VybHlXZWF0aGVyRm9yZWNhc3Qod2VhdGhlckRhdGEsIGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzKTtcbiAgICAgIGlmIChob3VybHlXZWF0aGVyLmxlbmd0aCA+IDApIHtcbiAgICAgICAgYXdhaXQgcHVibGlzaEhvdXJseVBhY2thZ2UoaG91cmx5V2VhdGhlciwgXCJ3ZWF0aGVyXCIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb25maWcuZW5hYmxlTWFyaW5lSG91cmx5ICYmIG1hcmluZURhdGEpIHtcbiAgICAgIGNvbnN0IGhvdXJseU1hcmluZSA9IHByb2Nlc3NIb3VybHlNYXJpbmVGb3JlY2FzdChtYXJpbmVEYXRhLCBjb25maWcubWF4Rm9yZWNhc3RIb3Vycyk7XG4gICAgICBpZiAoaG91cmx5TWFyaW5lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgYXdhaXQgcHVibGlzaEhvdXJseVBhY2thZ2UoaG91cmx5TWFyaW5lLCBcIm1hcmluZVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGFuZCBwdWJsaXNoIGRhaWx5IGZvcmVjYXN0cyAtIHNlcGFyYXRlIHBhY2thZ2VzIGxpa2UgbWV0ZW9ibHVlXG4gICAgaWYgKGNvbmZpZy5lbmFibGVEYWlseVdlYXRoZXIgJiYgd2VhdGhlckRhdGEpIHtcbiAgICAgIGNvbnN0IGRhaWx5V2VhdGhlciA9IHByb2Nlc3NEYWlseVdlYXRoZXJGb3JlY2FzdCh3ZWF0aGVyRGF0YSwgY29uZmlnLm1heEZvcmVjYXN0RGF5cyk7XG4gICAgICBpZiAoZGFpbHlXZWF0aGVyLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcHVibGlzaERhaWx5UGFja2FnZShkYWlseVdlYXRoZXIsIFwid2VhdGhlclwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZURhaWx5ICYmIG1hcmluZURhdGEpIHtcbiAgICAgIGNvbnN0IGRhaWx5TWFyaW5lID0gcHJvY2Vzc0RhaWx5TWFyaW5lRm9yZWNhc3QobWFyaW5lRGF0YSwgY29uZmlnLm1heEZvcmVjYXN0RGF5cyk7XG4gICAgICBpZiAoZGFpbHlNYXJpbmUubGVuZ3RoID4gMCkge1xuICAgICAgICBwdWJsaXNoRGFpbHlQYWNrYWdlKGRhaWx5TWFyaW5lLCBcIm1hcmluZVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0ZS5sYXN0Rm9yZWNhc3RVcGRhdGUgPSBEYXRlLm5vdygpO1xuICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJBY3RpdmUgLSBGb3JlY2FzdHMgdXBkYXRlZFwiKTtcbiAgfTtcblxuICAvLyBXZWF0aGVyIEFQSSBwcm92aWRlciBpbXBsZW1lbnRhdGlvblxuICBjb25zdCBjb252ZXJ0VG9XZWF0aGVyQVBJRm9yZWNhc3QgPSAoXG4gICAgZm9yZWNhc3REYXRhOiBhbnksXG4gICAgdHlwZTogV2VhdGhlckZvcmVjYXN0VHlwZSxcbiAgKTogV2VhdGhlckRhdGEgPT4ge1xuICAgIGNvbnN0IGlzRGFpbHkgPSB0eXBlID09PSBcImRhaWx5XCI7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZTogZm9yZWNhc3REYXRhLnRpbWVzdGFtcCB8fCBmb3JlY2FzdERhdGEuZGF0ZSB8fCBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB0eXBlLFxuICAgICAgZGVzY3JpcHRpb246IGdldFdlYXRoZXJEZXNjcmlwdGlvbihcbiAgICAgICAgZm9yZWNhc3REYXRhLndlYXRoZXJfY29kZSxcbiAgICAgICAgXCJPcGVuLU1ldGVvIHdlYXRoZXJcIixcbiAgICAgICksXG4gICAgICBsb25nRGVzY3JpcHRpb246IGdldFdlYXRoZXJMb25nRGVzY3JpcHRpb24oXG4gICAgICAgIGZvcmVjYXN0RGF0YS53ZWF0aGVyX2NvZGUsXG4gICAgICAgIFwiT3Blbi1NZXRlbyB3ZWF0aGVyIGZvcmVjYXN0XCIsXG4gICAgICApLFxuICAgICAgaWNvbjogZ2V0V2VhdGhlckljb24oZm9yZWNhc3REYXRhLndlYXRoZXJfY29kZSwgZm9yZWNhc3REYXRhLmlzX2RheSksXG4gICAgICBvdXRzaWRlOiB7XG4gICAgICAgIHRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEudGVtcGVyYXR1cmVfMm0sXG4gICAgICAgIG1heFRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEudGVtcGVyYXR1cmVfMm1fbWF4LFxuICAgICAgICBtaW5UZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLnRlbXBlcmF0dXJlXzJtX21pbixcbiAgICAgICAgZmVlbHNMaWtlVGVtcGVyYXR1cmU6IGZvcmVjYXN0RGF0YS5hcHBhcmVudF90ZW1wZXJhdHVyZSB8fCBmb3JlY2FzdERhdGEuYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWF4LFxuICAgICAgICBwcmVzc3VyZTogZm9yZWNhc3REYXRhLnByZXNzdXJlX21zbCxcbiAgICAgICAgcmVsYXRpdmVIdW1pZGl0eTogZm9yZWNhc3REYXRhLnJlbGF0aXZlX2h1bWlkaXR5XzJtLFxuICAgICAgICB1dkluZGV4OiBmb3JlY2FzdERhdGEudXZfaW5kZXggfHwgZm9yZWNhc3REYXRhLnV2X2luZGV4X21heCxcbiAgICAgICAgY2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLmNsb3VkX2NvdmVyLFxuICAgICAgICBwcmVjaXBpdGF0aW9uVm9sdW1lOiBmb3JlY2FzdERhdGEucHJlY2lwaXRhdGlvbiB8fCBmb3JlY2FzdERhdGEucHJlY2lwaXRhdGlvbl9zdW0sXG4gICAgICAgIGRld1BvaW50VGVtcGVyYXR1cmU6IGZvcmVjYXN0RGF0YS5kZXdfcG9pbnRfMm0sXG4gICAgICAgIGhvcml6b250YWxWaXNpYmlsaXR5OiBmb3JlY2FzdERhdGEudmlzaWJpbGl0eSxcbiAgICAgICAgcHJlY2lwaXRhdGlvblByb2JhYmlsaXR5OiBmb3JlY2FzdERhdGEucHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eSB8fCBmb3JlY2FzdERhdGEucHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eV9tYXgsXG4gICAgICAgIGxvd0Nsb3VkQ292ZXI6IGZvcmVjYXN0RGF0YS5jbG91ZF9jb3Zlcl9sb3csXG4gICAgICAgIG1pZENsb3VkQ292ZXI6IGZvcmVjYXN0RGF0YS5jbG91ZF9jb3Zlcl9taWQsXG4gICAgICAgIGhpZ2hDbG91ZENvdmVyOiBmb3JlY2FzdERhdGEuY2xvdWRfY292ZXJfaGlnaCxcbiAgICAgICAgc29sYXJSYWRpYXRpb246IGZvcmVjYXN0RGF0YS5zaG9ydHdhdmVfcmFkaWF0aW9uIHx8IGZvcmVjYXN0RGF0YS5zaG9ydHdhdmVfcmFkaWF0aW9uX3N1bSxcbiAgICAgICAgZGlyZWN0Tm9ybWFsSXJyYWRpYW5jZTogZm9yZWNhc3REYXRhLmRpcmVjdF9ub3JtYWxfaXJyYWRpYW5jZSxcbiAgICAgICAgZGlmZnVzZUhvcml6b250YWxJcnJhZGlhbmNlOiBmb3JlY2FzdERhdGEuZGlmZnVzZV9yYWRpYXRpb24sXG4gICAgICB9LFxuICAgICAgd2F0ZXI6IHtcbiAgICAgICAgdGVtcGVyYXR1cmU6IGZvcmVjYXN0RGF0YS5zZWFfc3VyZmFjZV90ZW1wZXJhdHVyZSxcbiAgICAgICAgd2F2ZVNpZ25pZmljYW50SGVpZ2h0OiBmb3JlY2FzdERhdGEud2F2ZV9oZWlnaHQgfHwgZm9yZWNhc3REYXRhLndhdmVfaGVpZ2h0X21heCxcbiAgICAgICAgd2F2ZVBlcmlvZDogZm9yZWNhc3REYXRhLndhdmVfcGVyaW9kIHx8IGZvcmVjYXN0RGF0YS53YXZlX3BlcmlvZF9tYXgsXG4gICAgICAgIHdhdmVEaXJlY3Rpb246IGZvcmVjYXN0RGF0YS53YXZlX2RpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEud2F2ZV9kaXJlY3Rpb25fZG9taW5hbnQsXG4gICAgICAgIHdpbmRXYXZlSGVpZ2h0OiBmb3JlY2FzdERhdGEud2luZF93YXZlX2hlaWdodCB8fCBmb3JlY2FzdERhdGEud2luZF93YXZlX2hlaWdodF9tYXgsXG4gICAgICAgIHdpbmRXYXZlUGVyaW9kOiBmb3JlY2FzdERhdGEud2luZF93YXZlX3BlcmlvZCB8fCBmb3JlY2FzdERhdGEud2luZF93YXZlX3BlcmlvZF9tYXgsXG4gICAgICAgIHdpbmRXYXZlRGlyZWN0aW9uOiBmb3JlY2FzdERhdGEud2luZF93YXZlX2RpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEud2luZF93YXZlX2RpcmVjdGlvbl9kb21pbmFudCxcbiAgICAgICAgc3dlbGxIZWlnaHQ6IGZvcmVjYXN0RGF0YS5zd2VsbF93YXZlX2hlaWdodCB8fCBmb3JlY2FzdERhdGEuc3dlbGxfd2F2ZV9oZWlnaHRfbWF4LFxuICAgICAgICBzd2VsbFBlcmlvZDogZm9yZWNhc3REYXRhLnN3ZWxsX3dhdmVfcGVyaW9kIHx8IGZvcmVjYXN0RGF0YS5zd2VsbF93YXZlX3BlcmlvZF9tYXgsXG4gICAgICAgIHN3ZWxsRGlyZWN0aW9uOiBmb3JlY2FzdERhdGEuc3dlbGxfd2F2ZV9kaXJlY3Rpb24gfHwgZm9yZWNhc3REYXRhLnN3ZWxsX3dhdmVfZGlyZWN0aW9uX2RvbWluYW50LFxuICAgICAgICBzdXJmYWNlQ3VycmVudFNwZWVkOiBmb3JlY2FzdERhdGEub2NlYW5fY3VycmVudF92ZWxvY2l0eSxcbiAgICAgICAgc3VyZmFjZUN1cnJlbnREaXJlY3Rpb246IGZvcmVjYXN0RGF0YS5vY2Vhbl9jdXJyZW50X2RpcmVjdGlvbixcbiAgICAgICAgc3dlbGxQZWFrUGVyaW9kOiBmb3JlY2FzdERhdGEuc3dlbGxfd2F2ZV9wZWFrX3BlcmlvZCB8fCBmb3JlY2FzdERhdGEuc3dlbGxfd2F2ZV9wZWFrX3BlcmlvZF9tYXgsXG4gICAgICAgIHdpbmRXYXZlUGVha1BlcmlvZDogZm9yZWNhc3REYXRhLndpbmRfd2F2ZV9wZWFrX3BlcmlvZCB8fCBmb3JlY2FzdERhdGEud2luZF93YXZlX3BlYWtfcGVyaW9kX21heCxcbiAgICAgIH0sXG4gICAgICB3aW5kOiB7XG4gICAgICAgIHNwZWVkVHJ1ZTogZm9yZWNhc3REYXRhLndpbmRfc3BlZWRfMTBtIHx8IGZvcmVjYXN0RGF0YS53aW5kX3NwZWVkXzEwbV9tYXgsXG4gICAgICAgIGRpcmVjdGlvblRydWU6IGZvcmVjYXN0RGF0YS53aW5kX2RpcmVjdGlvbl8xMG0gfHwgZm9yZWNhc3REYXRhLndpbmRfZGlyZWN0aW9uXzEwbV9kb21pbmFudCxcbiAgICAgICAgZ3VzdDogZm9yZWNhc3REYXRhLndpbmRfZ3VzdHNfMTBtIHx8IGZvcmVjYXN0RGF0YS53aW5kX2d1c3RzXzEwbV9tYXgsXG4gICAgICB9LFxuICAgICAgc3VuOiB7XG4gICAgICAgIHN1bnJpc2U6IGZvcmVjYXN0RGF0YS5zdW5yaXNlLFxuICAgICAgICBzdW5zZXQ6IGZvcmVjYXN0RGF0YS5zdW5zZXQsXG4gICAgICAgIHN1bnNoaW5lRHVyYXRpb246IGZvcmVjYXN0RGF0YS5zdW5zaGluZV9kdXJhdGlvbixcbiAgICAgICAgaXNEYXlsaWdodDogZm9yZWNhc3REYXRhLmlzX2RheSA9PT0gMSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfTtcblxuICAvLyBHZXQgaG91cmx5IGZvcmVjYXN0cyBmcm9tIFNpZ25hbEsgdHJlZVxuICBjb25zdCBnZXRIb3VybHlGb3JlY2FzdHMgPSAobWF4Q291bnQ6IG51bWJlcik6IFdlYXRoZXJEYXRhW10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogV2VhdGhlckRhdGFbXSA9IFtdO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFJlYWQgZm9yZWNhc3QgZGF0YSBmcm9tIFNpZ25hbEsgdHJlZVxuICAgICAgbGV0IGZvcmVjYXN0Q291bnQgPSAwO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYXhDb3VudCArIDEwOyBpKyspIHtcbiAgICAgICAgY29uc3QgdGVtcCA9IGFwcC5nZXRTZWxmUGF0aChcbiAgICAgICAgICBgZW52aXJvbm1lbnQub3V0c2lkZS5vcGVubWV0ZW8uZm9yZWNhc3QuaG91cmx5LnRlbXBlcmF0dXJlXzJtLiR7aX1gLFxuICAgICAgICApO1xuICAgICAgICBpZiAodGVtcCAmJiB0ZW1wLnZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBmb3JlY2FzdENvdW50ID0gaSArIDE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgYWN0dWFsQ291bnQgPSBNYXRoLm1pbihmb3JlY2FzdENvdW50LCBtYXhDb3VudCk7XG5cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYWN0dWFsQ291bnQ7IGkrKykge1xuICAgICAgICBjb25zdCBmb3JlY2FzdERhdGE6IGFueSA9IHt9O1xuICAgICAgICBjb25zdCBmaWVsZHMgPSBbXG4gICAgICAgICAgXCJ0ZW1wZXJhdHVyZV8ybVwiLFxuICAgICAgICAgIFwicmVsYXRpdmVfaHVtaWRpdHlfMm1cIixcbiAgICAgICAgICBcImRld19wb2ludF8ybVwiLFxuICAgICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVcIixcbiAgICAgICAgICBcInByZWNpcGl0YXRpb25fcHJvYmFiaWxpdHlcIixcbiAgICAgICAgICBcInByZWNpcGl0YXRpb25cIixcbiAgICAgICAgICBcIndlYXRoZXJfY29kZVwiLFxuICAgICAgICAgIFwicHJlc3N1cmVfbXNsXCIsXG4gICAgICAgICAgXCJjbG91ZF9jb3ZlclwiLFxuICAgICAgICAgIFwiY2xvdWRfY292ZXJfbG93XCIsXG4gICAgICAgICAgXCJjbG91ZF9jb3Zlcl9taWRcIixcbiAgICAgICAgICBcImNsb3VkX2NvdmVyX2hpZ2hcIixcbiAgICAgICAgICBcInZpc2liaWxpdHlcIixcbiAgICAgICAgICBcIndpbmRfc3BlZWRfMTBtXCIsXG4gICAgICAgICAgXCJ3aW5kX2RpcmVjdGlvbl8xMG1cIixcbiAgICAgICAgICBcIndpbmRfZ3VzdHNfMTBtXCIsXG4gICAgICAgICAgXCJ1dl9pbmRleFwiLFxuICAgICAgICAgIFwiaXNfZGF5XCIsXG4gICAgICAgICAgXCJzdW5zaGluZV9kdXJhdGlvblwiLFxuICAgICAgICAgIFwic2hvcnR3YXZlX3JhZGlhdGlvblwiLFxuICAgICAgICAgIFwiZGlyZWN0X3JhZGlhdGlvblwiLFxuICAgICAgICAgIFwiZGlmZnVzZV9yYWRpYXRpb25cIixcbiAgICAgICAgICBcImRpcmVjdF9ub3JtYWxfaXJyYWRpYW5jZVwiLFxuICAgICAgICAgIFwid2F2ZV9oZWlnaHRcIixcbiAgICAgICAgICBcIndhdmVfZGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJ3YXZlX3BlcmlvZFwiLFxuICAgICAgICAgIFwid2luZF93YXZlX2hlaWdodFwiLFxuICAgICAgICAgIFwid2luZF93YXZlX2RpcmVjdGlvblwiLFxuICAgICAgICAgIFwid2luZF93YXZlX3BlcmlvZFwiLFxuICAgICAgICAgIFwic3dlbGxfd2F2ZV9oZWlnaHRcIixcbiAgICAgICAgICBcInN3ZWxsX3dhdmVfZGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJzd2VsbF93YXZlX3BlcmlvZFwiLFxuICAgICAgICAgIFwib2NlYW5fY3VycmVudF92ZWxvY2l0eVwiLFxuICAgICAgICAgIFwib2NlYW5fY3VycmVudF9kaXJlY3Rpb25cIixcbiAgICAgICAgICBcInNlYV9zdXJmYWNlX3RlbXBlcmF0dXJlXCIsXG4gICAgICAgIF07XG5cbiAgICAgICAgZmllbGRzLmZvckVhY2goKGZpZWxkKSA9PiB7XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGFwcC5nZXRTZWxmUGF0aChcbiAgICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5ob3VybHkuJHtmaWVsZH0uJHtpfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoZGF0YSAmJiBkYXRhLnZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZvcmVjYXN0RGF0YVtmaWVsZF0gPSBkYXRhLnZhbHVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGZvcmVjYXN0RGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgIGRhdGUuc2V0SG91cnMoZGF0ZS5nZXRIb3VycygpICsgaSk7XG4gICAgICAgICAgZm9yZWNhc3REYXRhLnRpbWVzdGFtcCA9IGRhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICBmb3JlY2FzdHMucHVzaChjb252ZXJ0VG9XZWF0aGVyQVBJRm9yZWNhc3QoZm9yZWNhc3REYXRhLCBcInBvaW50XCIpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBFcnJvciByZWFkaW5nIGhvdXJseSBmb3JlY2FzdHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gR2V0IGRhaWx5IGZvcmVjYXN0cyBmcm9tIFNpZ25hbEsgdHJlZVxuICBjb25zdCBnZXREYWlseUZvcmVjYXN0cyA9IChtYXhDb3VudDogbnVtYmVyKTogV2VhdGhlckRhdGFbXSA9PiB7XG4gICAgY29uc3QgZm9yZWNhc3RzOiBXZWF0aGVyRGF0YVtdID0gW107XG5cbiAgICB0cnkge1xuICAgICAgbGV0IGZvcmVjYXN0Q291bnQgPSAwO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYXhDb3VudCArIDI7IGkrKykge1xuICAgICAgICBjb25zdCB0ZW1wID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5kYWlseS50ZW1wZXJhdHVyZV8ybV9tYXguJHtpfWAsXG4gICAgICAgICk7XG4gICAgICAgIGlmICh0ZW1wICYmIHRlbXAudmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGZvcmVjYXN0Q291bnQgPSBpICsgMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3R1YWxDb3VudCA9IE1hdGgubWluKGZvcmVjYXN0Q291bnQsIG1heENvdW50KTtcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhY3R1YWxDb3VudDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGZvcmVjYXN0RGF0YTogYW55ID0ge307XG4gICAgICAgIGNvbnN0IGZpZWxkcyA9IFtcbiAgICAgICAgICBcIndlYXRoZXJfY29kZVwiLFxuICAgICAgICAgIFwidGVtcGVyYXR1cmVfMm1fbWF4XCIsXG4gICAgICAgICAgXCJ0ZW1wZXJhdHVyZV8ybV9taW5cIixcbiAgICAgICAgICBcImFwcGFyZW50X3RlbXBlcmF0dXJlX21heFwiLFxuICAgICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWluXCIsXG4gICAgICAgICAgXCJzdW5yaXNlXCIsXG4gICAgICAgICAgXCJzdW5zZXRcIixcbiAgICAgICAgICBcInN1bnNoaW5lX2R1cmF0aW9uXCIsXG4gICAgICAgICAgXCJ1dl9pbmRleF9tYXhcIixcbiAgICAgICAgICBcInByZWNpcGl0YXRpb25fc3VtXCIsXG4gICAgICAgICAgXCJwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5X21heFwiLFxuICAgICAgICAgIFwid2luZF9zcGVlZF8xMG1fbWF4XCIsXG4gICAgICAgICAgXCJ3aW5kX2d1c3RzXzEwbV9tYXhcIixcbiAgICAgICAgICBcIndpbmRfZGlyZWN0aW9uXzEwbV9kb21pbmFudFwiLFxuICAgICAgICAgIFwid2F2ZV9oZWlnaHRfbWF4XCIsXG4gICAgICAgICAgXCJ3YXZlX2RpcmVjdGlvbl9kb21pbmFudFwiLFxuICAgICAgICAgIFwid2F2ZV9wZXJpb2RfbWF4XCIsXG4gICAgICAgICAgXCJzd2VsbF93YXZlX2hlaWdodF9tYXhcIixcbiAgICAgICAgICBcInN3ZWxsX3dhdmVfZGlyZWN0aW9uX2RvbWluYW50XCIsXG4gICAgICAgICAgXCJzd2VsbF93YXZlX3BlcmlvZF9tYXhcIixcbiAgICAgICAgXTtcblxuICAgICAgICBmaWVsZHMuZm9yRWFjaCgoZmllbGQpID0+IHtcbiAgICAgICAgICBjb25zdCBkYXRhID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgICAgYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmRhaWx5LiR7ZmllbGR9LiR7aX1gLFxuICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKGRhdGEgJiYgZGF0YS52YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3JlY2FzdERhdGFbZmllbGRdID0gZGF0YS52YWx1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChPYmplY3Qua2V5cyhmb3JlY2FzdERhdGEpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKTtcbiAgICAgICAgICBkYXRlLnNldERhdGUoZGF0ZS5nZXREYXRlKCkgKyBpKTtcbiAgICAgICAgICBmb3JlY2FzdERhdGEuZGF0ZSA9IGRhdGUudG9JU09TdHJpbmcoKS5zcGxpdChcIlRcIilbMF07XG4gICAgICAgICAgZm9yZWNhc3RzLnB1c2goY29udmVydFRvV2VhdGhlckFQSUZvcmVjYXN0KGZvcmVjYXN0RGF0YSwgXCJkYWlseVwiKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXBwLmVycm9yKFxuICAgICAgICBgRXJyb3IgcmVhZGluZyBkYWlseSBmb3JlY2FzdHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gV2VhdGhlciBBUEkgcHJvdmlkZXJcbiAgY29uc3Qgd2VhdGhlclByb3ZpZGVyOiBXZWF0aGVyUHJvdmlkZXIgPSB7XG4gICAgbmFtZTogXCJzaWduYWxrLW9wZW4tbWV0ZW9cIixcbiAgICBtZXRob2RzOiB7XG4gICAgICBwbHVnaW5JZDogcGx1Z2luLmlkLFxuICAgICAgZ2V0T2JzZXJ2YXRpb25zOiBhc3luYyAoXG4gICAgICAgIHBvc2l0aW9uOiBQb3NpdGlvbixcbiAgICAgICAgb3B0aW9ucz86IFdlYXRoZXJSZXFQYXJhbXMsXG4gICAgICApOiBQcm9taXNlPFdlYXRoZXJEYXRhW10+ID0+IHtcbiAgICAgICAgLy8gUmV0dXJuIGN1cnJlbnQgY29uZGl0aW9ucyBhcyBvYnNlcnZhdGlvblxuICAgICAgICBjb25zdCBmb3JlY2FzdHMgPSBnZXRIb3VybHlGb3JlY2FzdHMoMSk7XG4gICAgICAgIGlmIChmb3JlY2FzdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGZvcmVjYXN0c1swXS50eXBlID0gXCJvYnNlcnZhdGlvblwiO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmb3JlY2FzdHM7XG4gICAgICB9LFxuICAgICAgZ2V0Rm9yZWNhc3RzOiBhc3luYyAoXG4gICAgICAgIHBvc2l0aW9uOiBQb3NpdGlvbixcbiAgICAgICAgdHlwZTogV2VhdGhlckZvcmVjYXN0VHlwZSxcbiAgICAgICAgb3B0aW9ucz86IFdlYXRoZXJSZXFQYXJhbXMsXG4gICAgICApOiBQcm9taXNlPFdlYXRoZXJEYXRhW10+ID0+IHtcbiAgICAgICAgY29uc3QgbWF4Q291bnQgPSBvcHRpb25zPy5tYXhDb3VudCB8fCAodHlwZSA9PT0gXCJkYWlseVwiID8gNyA6IDcyKTtcblxuICAgICAgICBpZiAodHlwZSA9PT0gXCJkYWlseVwiKSB7XG4gICAgICAgICAgcmV0dXJuIGdldERhaWx5Rm9yZWNhc3RzKG1heENvdW50KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gZ2V0SG91cmx5Rm9yZWNhc3RzKG1heENvdW50KTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIGdldFdhcm5pbmdzOiBhc3luYyAocG9zaXRpb246IFBvc2l0aW9uKTogUHJvbWlzZTxXZWF0aGVyV2FybmluZ1tdPiA9PiB7XG4gICAgICAgIC8vIE9wZW4tTWV0ZW8gZG9lc24ndCBwcm92aWRlIHdlYXRoZXIgd2FybmluZ3NcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfSxcbiAgICB9LFxuICB9O1xuXG4gIC8vIFNldHVwIHBvc2l0aW9uIHN1YnNjcmlwdGlvblxuICBjb25zdCBzZXR1cFBvc2l0aW9uU3Vic2NyaXB0aW9uID0gKGNvbmZpZzogUGx1Z2luQ29uZmlnKSA9PiB7XG4gICAgaWYgKCFjb25maWcuZW5hYmxlUG9zaXRpb25TdWJzY3JpcHRpb24pIHtcbiAgICAgIGFwcC5kZWJ1ZyhcIlBvc2l0aW9uIHN1YnNjcmlwdGlvbiBkaXNhYmxlZFwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhcHAuZGVidWcoXCJTZXR0aW5nIHVwIHBvc2l0aW9uIHN1YnNjcmlwdGlvblwiKTtcblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbjogU3Vic2NyaXB0aW9uUmVxdWVzdCA9IHtcbiAgICAgIGNvbnRleHQ6IFwidmVzc2Vscy5zZWxmXCIsXG4gICAgICBzdWJzY3JpYmU6IFtcbiAgICAgICAgeyBwYXRoOiBcIm5hdmlnYXRpb24ucG9zaXRpb25cIiwgcGVyaW9kOiA2MDAwMCB9LFxuICAgICAgICB7IHBhdGg6IFwibmF2aWdhdGlvbi5jb3Vyc2VPdmVyR3JvdW5kVHJ1ZVwiLCBwZXJpb2Q6IDYwMDAwIH0sXG4gICAgICAgIHsgcGF0aDogXCJuYXZpZ2F0aW9uLnNwZWVkT3Zlckdyb3VuZFwiLCBwZXJpb2Q6IDYwMDAwIH0sXG4gICAgICBdLFxuICAgIH07XG5cbiAgICBhcHAuc3Vic2NyaXB0aW9ubWFuYWdlci5zdWJzY3JpYmUoXG4gICAgICBzdWJzY3JpcHRpb24sXG4gICAgICBzdGF0ZS5uYXZpZ2F0aW9uU3Vic2NyaXB0aW9ucyxcbiAgICAgIChlcnIpID0+IHtcbiAgICAgICAgYXBwLmVycm9yKGBOYXZpZ2F0aW9uIHN1YnNjcmlwdGlvbiBlcnJvcjogJHtlcnJ9YCk7XG4gICAgICB9LFxuICAgICAgKGRlbHRhKSA9PiB7XG4gICAgICAgIGRlbHRhLnVwZGF0ZXM/LmZvckVhY2goKHVwZGF0ZSkgPT4ge1xuICAgICAgICAgIHVwZGF0ZS52YWx1ZXM/LmZvckVhY2goKHYpID0+IHtcbiAgICAgICAgICAgIGlmICh2LnBhdGggPT09IFwibmF2aWdhdGlvbi5wb3NpdGlvblwiICYmIHYudmFsdWUpIHtcbiAgICAgICAgICAgICAgY29uc3QgcG9zID0gdi52YWx1ZSBhcyB7IGxhdGl0dWRlOiBudW1iZXI7IGxvbmdpdHVkZTogbnVtYmVyIH07XG4gICAgICAgICAgICAgIGlmIChwb3MubGF0aXR1ZGUgJiYgcG9zLmxvbmdpdHVkZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG5ld1Bvc2l0aW9uOiBQb3NpdGlvbiA9IHtcbiAgICAgICAgICAgICAgICAgIGxhdGl0dWRlOiBwb3MubGF0aXR1ZGUsXG4gICAgICAgICAgICAgICAgICBsb25naXR1ZGU6IHBvcy5sb25naXR1ZGUsXG4gICAgICAgICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCksXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIGlmICghc3RhdGUuY3VycmVudFBvc2l0aW9uKSB7XG4gICAgICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50UG9zaXRpb24gPSBuZXdQb3NpdGlvbjtcbiAgICAgICAgICAgICAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgICAgICAgICAgICAgYEluaXRpYWwgcG9zaXRpb246ICR7cG9zLmxhdGl0dWRlfSwgJHtwb3MubG9uZ2l0dWRlfWAsXG4gICAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgICAgLy8gVHJpZ2dlciBpbml0aWFsIGZvcmVjYXN0IGZldGNoXG4gICAgICAgICAgICAgICAgICBpZiAoc3RhdGUuY3VycmVudENvbmZpZykge1xuICAgICAgICAgICAgICAgICAgICBmZXRjaEFuZFB1Ymxpc2hGb3JlY2FzdHMoc3RhdGUuY3VycmVudENvbmZpZyk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRQb3NpdGlvbiA9IG5ld1Bvc2l0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmICh2LnBhdGggPT09IFwibmF2aWdhdGlvbi5jb3Vyc2VPdmVyR3JvdW5kVHJ1ZVwiICYmIHYudmFsdWUgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgc3RhdGUuY3VycmVudEhlYWRpbmcgPSB2LnZhbHVlIGFzIG51bWJlcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodi5wYXRoID09PSBcIm5hdmlnYXRpb24uc3BlZWRPdmVyR3JvdW5kXCIgJiYgdi52YWx1ZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50U09HID0gdi52YWx1ZSBhcyBudW1iZXI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSxcbiAgICApO1xuICB9O1xuXG4gIC8vIFBsdWdpbiBzdGFydFxuICBwbHVnaW4uc3RhcnQgPSAob3B0aW9uczogUGFydGlhbDxQbHVnaW5Db25maWc+KSA9PiB7XG4gICAgY29uc3QgY29uZmlnOiBQbHVnaW5Db25maWcgPSB7XG4gICAgICBhcGlLZXk6IG9wdGlvbnMuYXBpS2V5IHx8IFwiXCIsXG4gICAgICBmb3JlY2FzdEludGVydmFsOiBvcHRpb25zLmZvcmVjYXN0SW50ZXJ2YWwgfHwgNjAsXG4gICAgICBhbHRpdHVkZTogb3B0aW9ucy5hbHRpdHVkZSB8fCAyLFxuICAgICAgZW5hYmxlUG9zaXRpb25TdWJzY3JpcHRpb246IG9wdGlvbnMuZW5hYmxlUG9zaXRpb25TdWJzY3JpcHRpb24gIT09IGZhbHNlLFxuICAgICAgbWF4Rm9yZWNhc3RIb3Vyczogb3B0aW9ucy5tYXhGb3JlY2FzdEhvdXJzIHx8IDcyLFxuICAgICAgbWF4Rm9yZWNhc3REYXlzOiBvcHRpb25zLm1heEZvcmVjYXN0RGF5cyB8fCA3LFxuICAgICAgZW5hYmxlSG91cmx5V2VhdGhlcjogb3B0aW9ucy5lbmFibGVIb3VybHlXZWF0aGVyICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZURhaWx5V2VhdGhlcjogb3B0aW9ucy5lbmFibGVEYWlseVdlYXRoZXIgIT09IGZhbHNlLFxuICAgICAgZW5hYmxlTWFyaW5lSG91cmx5OiBvcHRpb25zLmVuYWJsZU1hcmluZUhvdXJseSAhPT0gZmFsc2UsXG4gICAgICBlbmFibGVNYXJpbmVEYWlseTogb3B0aW9ucy5lbmFibGVNYXJpbmVEYWlseSAhPT0gZmFsc2UsXG4gICAgICBlbmFibGVDdXJyZW50Q29uZGl0aW9uczogb3B0aW9ucy5lbmFibGVDdXJyZW50Q29uZGl0aW9ucyAhPT0gZmFsc2UsXG4gICAgICBlbmFibGVBdXRvTW92aW5nRm9yZWNhc3Q6IG9wdGlvbnMuZW5hYmxlQXV0b01vdmluZ0ZvcmVjYXN0IHx8IGZhbHNlLFxuICAgICAgbW92aW5nU3BlZWRUaHJlc2hvbGQ6IG9wdGlvbnMubW92aW5nU3BlZWRUaHJlc2hvbGQgfHwgMS4wLFxuICAgIH07XG5cbiAgICBzdGF0ZS5jdXJyZW50Q29uZmlnID0gY29uZmlnO1xuXG4gICAgYXBwLmRlYnVnKFwiU3RhcnRpbmcgT3Blbi1NZXRlbyBwbHVnaW5cIik7XG4gICAgYXBwLnNldFBsdWdpblN0YXR1cyhcIkluaXRpYWxpemluZy4uLlwiKTtcblxuICAgIC8vIFJlZ2lzdGVyIGFzIFdlYXRoZXIgQVBJIHByb3ZpZGVyXG4gICAgdHJ5IHtcbiAgICAgIGFwcC5yZWdpc3RlcldlYXRoZXJQcm92aWRlcih3ZWF0aGVyUHJvdmlkZXIpO1xuICAgICAgYXBwLmRlYnVnKFwiU3VjY2Vzc2Z1bGx5IHJlZ2lzdGVyZWQgYXMgV2VhdGhlciBBUEkgcHJvdmlkZXJcIik7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGFwcC5lcnJvcihcbiAgICAgICAgYEZhaWxlZCB0byByZWdpc3RlciBXZWF0aGVyIEFQSSBwcm92aWRlcjogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gU2V0dXAgcG9zaXRpb24gc3Vic2NyaXB0aW9uXG4gICAgc2V0dXBQb3NpdGlvblN1YnNjcmlwdGlvbihjb25maWcpO1xuXG4gICAgLy8gU2V0dXAgZm9yZWNhc3QgaW50ZXJ2YWxcbiAgICBjb25zdCBpbnRlcnZhbE1zID0gY29uZmlnLmZvcmVjYXN0SW50ZXJ2YWwgKiA2MCAqIDEwMDA7XG4gICAgc3RhdGUuZm9yZWNhc3RJbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgIGlmIChzdGF0ZS5mb3JlY2FzdEVuYWJsZWQgJiYgc3RhdGUuY3VycmVudFBvc2l0aW9uKSB7XG4gICAgICAgIGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhjb25maWcpO1xuICAgICAgfVxuICAgIH0sIGludGVydmFsTXMpO1xuXG4gICAgLy8gSW5pdGlhbCBmZXRjaCBpZiBwb3NpdGlvbiBpcyBhdmFpbGFibGVcbiAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIGlmIChzdGF0ZS5jdXJyZW50UG9zaXRpb24pIHtcbiAgICAgICAgZmV0Y2hBbmRQdWJsaXNoRm9yZWNhc3RzKGNvbmZpZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhcHAuZGVidWcoXCJObyBwb3NpdGlvbiBhdmFpbGFibGUgeWV0LCB3YWl0aW5nIGZvciBwb3NpdGlvbiBzdWJzY3JpcHRpb25cIik7XG4gICAgICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJXYWl0aW5nIGZvciBwb3NpdGlvbi4uLlwiKTtcbiAgICAgIH1cbiAgICB9LCAxMDAwKTtcbiAgfTtcblxuICAvLyBQbHVnaW4gc3RvcFxuICBwbHVnaW4uc3RvcCA9ICgpID0+IHtcbiAgICBhcHAuZGVidWcoXCJTdG9wcGluZyBPcGVuLU1ldGVvIHBsdWdpblwiKTtcblxuICAgIC8vIENsZWFyIGZvcmVjYXN0IGludGVydmFsXG4gICAgaWYgKHN0YXRlLmZvcmVjYXN0SW50ZXJ2YWwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwoc3RhdGUuZm9yZWNhc3RJbnRlcnZhbCk7XG4gICAgICBzdGF0ZS5mb3JlY2FzdEludGVydmFsID0gbnVsbDtcbiAgICB9XG5cbiAgICAvLyBVbnN1YnNjcmliZSBmcm9tIG5hdmlnYXRpb25cbiAgICBzdGF0ZS5uYXZpZ2F0aW9uU3Vic2NyaXB0aW9ucy5mb3JFYWNoKCh1bnN1YikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdW5zdWIoKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgLy8gSWdub3JlIHVuc3Vic2NyaWJlIGVycm9yc1xuICAgICAgfVxuICAgIH0pO1xuICAgIHN0YXRlLm5hdmlnYXRpb25TdWJzY3JpcHRpb25zID0gW107XG5cbiAgICAvLyBSZXNldCBzdGF0ZVxuICAgIHN0YXRlLmN1cnJlbnRQb3NpdGlvbiA9IG51bGw7XG4gICAgc3RhdGUuY3VycmVudEhlYWRpbmcgPSBudWxsO1xuICAgIHN0YXRlLmN1cnJlbnRTT0cgPSBudWxsO1xuICAgIHN0YXRlLmxhc3RGb3JlY2FzdFVwZGF0ZSA9IDA7XG4gICAgc3RhdGUubW92aW5nRm9yZWNhc3RFbmdhZ2VkID0gZmFsc2U7XG5cbiAgICBhcHAuc2V0UGx1Z2luU3RhdHVzKFwiU3RvcHBlZFwiKTtcbiAgfTtcblxuICByZXR1cm4gcGx1Z2luO1xufTtcbiJdfQ==