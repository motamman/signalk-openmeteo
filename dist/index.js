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
    // isDay: true/1 = day, false/0 = night, undefined = default to day (for daily forecasts)
    const getWeatherIcon = (wmoCode, isDay) => {
        if (wmoCode === undefined)
            return undefined;
        // Default to day if isDay is undefined (e.g., daily forecasts don't have is_day field)
        const dayNight = isDay === false || isDay === 0 ? "night" : "day";
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
    const radToDeg = (radians) => radians * (180 / Math.PI);
    const celsiusToKelvin = (celsius) => celsius + 273.15;
    const hPaToPA = (hPa) => hPa * 100;
    const mmToM = (mm) => mm / 1000;
    const cmToM = (cm) => cm / 100;
    const kmToM = (km) => km * 1000;
    const kmhToMs = (kmh) => kmh / 3.6;
    const percentToRatio = (percent) => percent / 100;
    // Field name translation: Open-Meteo API names → SignalK-aligned names (following signalk-weatherflow convention)
    const fieldNameMap = {
        // Temperature fields
        temperature_2m: "airTemperature",
        apparent_temperature: "feelsLike",
        dew_point_2m: "dewPoint",
        temperature_2m_max: "airTempHigh",
        temperature_2m_min: "airTempLow",
        apparent_temperature_max: "feelsLikeHigh",
        apparent_temperature_min: "feelsLikeLow",
        sea_surface_temperature: "seaSurfaceTemperature",
        // Wind fields
        wind_speed_10m: "windAvg",
        wind_direction_10m: "windDirection",
        wind_gusts_10m: "windGust",
        wind_speed_10m_max: "windAvgMax",
        wind_gusts_10m_max: "windGustMax",
        wind_direction_10m_dominant: "windDirectionDominant",
        // Pressure fields
        pressure_msl: "seaLevelPressure",
        surface_pressure: "stationPressure",
        // Humidity fields
        relative_humidity_2m: "relativeHumidity",
        // Precipitation fields
        precipitation: "precip",
        precipitation_probability: "precipProbability",
        precipitation_sum: "precipSum",
        precipitation_probability_max: "precipProbabilityMax",
        precipitation_hours: "precipHours",
        rain: "rain",
        rain_sum: "rainSum",
        showers: "showers",
        showers_sum: "showersSum",
        snowfall: "snowfall",
        snowfall_sum: "snowfallSum",
        // Cloud cover fields
        cloud_cover: "cloudCover",
        cloud_cover_low: "lowCloudCover",
        cloud_cover_mid: "midCloudCover",
        cloud_cover_high: "highCloudCover",
        // Solar/UV fields
        uv_index: "uvIndex",
        uv_index_max: "uvIndexMax",
        shortwave_radiation: "solarRadiation",
        shortwave_radiation_sum: "solarRadiationSum",
        direct_radiation: "directRadiation",
        diffuse_radiation: "diffuseRadiation",
        direct_normal_irradiance: "irradianceDirectNormal",
        sunshine_duration: "sunshineDuration",
        daylight_duration: "daylightDuration",
        // Marine/Wave fields
        wave_height: "significantWaveHeight",
        wave_height_max: "significantWaveHeightMax",
        wave_direction: "meanWaveDirection",
        wave_direction_dominant: "meanWaveDirectionDominant",
        wave_period: "meanWavePeriod",
        wave_period_max: "meanWavePeriodMax",
        wind_wave_height: "windWaveHeight",
        wind_wave_height_max: "windWaveHeightMax",
        wind_wave_direction: "windWaveDirection",
        wind_wave_direction_dominant: "windWaveDirectionDominant",
        wind_wave_period: "windWavePeriod",
        wind_wave_period_max: "windWavePeriodMax",
        wind_wave_peak_period: "windWavePeakPeriod",
        wind_wave_peak_period_max: "windWavePeakPeriodMax",
        swell_wave_height: "swellSignificantHeight",
        swell_wave_height_max: "swellSignificantHeightMax",
        swell_wave_direction: "swellMeanDirection",
        swell_wave_direction_dominant: "swellMeanDirectionDominant",
        swell_wave_period: "swellMeanPeriod",
        swell_wave_period_max: "swellMeanPeriodMax",
        swell_wave_peak_period: "swellPeakPeriod",
        swell_wave_peak_period_max: "swellPeakPeriodMax",
        ocean_current_velocity: "currentVelocity",
        ocean_current_direction: "currentDirection",
        // Other fields
        visibility: "visibility",
        is_day: "isDaylight",
        weather_code: "weatherCode",
        cape: "cape",
        sunrise: "sunrise",
        sunset: "sunset",
    };
    // Translate Open-Meteo field name to SignalK-aligned name
    const translateFieldName = (openMeteoName) => {
        return fieldNameMap[openMeteoName] || openMeteoName;
    };
    // Reverse lookup: SignalK name to Open-Meteo name (for reading back from SignalK)
    const reverseFieldNameMap = Object.entries(fieldNameMap).reduce((acc, [openMeteo, signalk]) => {
        acc[signalk] = openMeteo;
        return acc;
    }, {});
    // Calculate future position based on current heading and speed
    const calculateFuturePosition = (currentPos, headingRad, sogMps, hoursAhead) => {
        const distanceMeters = sogMps * hoursAhead * 3600;
        const earthRadius = 6371000;
        const lat1 = degToRad(currentPos.latitude);
        const lon1 = degToRad(currentPos.longitude);
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceMeters / earthRadius) +
            Math.cos(lat1) *
                Math.sin(distanceMeters / earthRadius) *
                Math.cos(headingRad));
        const lon2 = lon1 +
            Math.atan2(Math.sin(headingRad) *
                Math.sin(distanceMeters / earthRadius) *
                Math.cos(lat1), Math.cos(distanceMeters / earthRadius) -
                Math.sin(lat1) * Math.sin(lat2));
        return {
            latitude: radToDeg(lat2),
            longitude: radToDeg(lon2),
            timestamp: new Date(Date.now() + hoursAhead * 3600000),
        };
    };
    // Check if vessel is moving above threshold
    const isVesselMoving = (sogMps, thresholdKnots = 1.0) => {
        const thresholdMps = thresholdKnots * 0.514444;
        return sogMps > thresholdMps;
    };
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
    // Get source label for SignalK (following weatherflow/meteo pattern)
    const getSourceLabel = (packageType) => {
        return `openmeteo-${packageType}-api`;
    };
    // Get parameter metadata for SignalK (using SignalK-aligned field names)
    const getParameterMetadata = (parameterName) => {
        const metadataMap = {
            // Temperature parameters (SignalK compliant - Kelvin)
            airTemperature: {
                units: "K",
                displayName: "Temperature",
                description: "Air temperature at 2m height",
            },
            feelsLike: {
                units: "K",
                displayName: "Feels Like Temperature",
                description: "Apparent temperature considering wind and humidity",
            },
            dewPoint: {
                units: "K",
                displayName: "Dew Point",
                description: "Dew point temperature at 2m height",
            },
            seaSurfaceTemperature: {
                units: "K",
                displayName: "Sea Surface Temperature",
                description: "Sea surface temperature",
            },
            airTempHigh: {
                units: "K",
                displayName: "High Temperature",
                description: "Maximum air temperature",
            },
            airTempLow: {
                units: "K",
                displayName: "Low Temperature",
                description: "Minimum air temperature",
            },
            feelsLikeHigh: {
                units: "K",
                displayName: "Feels Like High",
                description: "Maximum apparent temperature",
            },
            feelsLikeLow: {
                units: "K",
                displayName: "Feels Like Low",
                description: "Minimum apparent temperature",
            },
            // Wind parameters (SignalK compliant - m/s, radians)
            windAvg: {
                units: "m/s",
                displayName: "Wind Speed",
                description: "Wind speed at 10m height",
            },
            windGust: {
                units: "m/s",
                displayName: "Wind Gusts",
                description: "Wind gust speed at 10m height",
            },
            windDirection: {
                units: "rad",
                displayName: "Wind Direction",
                description: "Wind direction at 10m height",
            },
            windAvgMax: {
                units: "m/s",
                displayName: "Max Wind Speed",
                description: "Maximum wind speed",
            },
            windGustMax: {
                units: "m/s",
                displayName: "Max Wind Gusts",
                description: "Maximum wind gust speed",
            },
            windDirectionDominant: {
                units: "rad",
                displayName: "Dominant Wind Direction",
                description: "Dominant wind direction",
            },
            // Pressure parameters (SignalK compliant - Pascal)
            seaLevelPressure: {
                units: "Pa",
                displayName: "Sea Level Pressure",
                description: "Atmospheric pressure at mean sea level",
            },
            stationPressure: {
                units: "Pa",
                displayName: "Surface Pressure",
                description: "Atmospheric pressure at surface",
            },
            // Humidity (SignalK compliant - ratio 0-1)
            relativeHumidity: {
                units: "ratio",
                displayName: "Relative Humidity",
                description: "Relative humidity at 2m height (0-1)",
            },
            // Cloud cover (SignalK compliant - ratio 0-1)
            cloudCover: {
                units: "ratio",
                displayName: "Cloud Cover",
                description: "Total cloud cover (0-1)",
            },
            lowCloudCover: {
                units: "ratio",
                displayName: "Low Cloud Cover",
                description: "Low altitude cloud cover (0-1)",
            },
            midCloudCover: {
                units: "ratio",
                displayName: "Mid Cloud Cover",
                description: "Mid altitude cloud cover (0-1)",
            },
            highCloudCover: {
                units: "ratio",
                displayName: "High Cloud Cover",
                description: "High altitude cloud cover (0-1)",
            },
            // Precipitation (SignalK compliant - meters)
            precip: {
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
            precipProbability: {
                units: "ratio",
                displayName: "Precipitation Probability",
                description: "Probability of precipitation (0-1)",
            },
            precipSum: {
                units: "m",
                displayName: "Precipitation Sum",
                description: "Total precipitation amount",
            },
            precipProbabilityMax: {
                units: "ratio",
                displayName: "Max Precipitation Probability",
                description: "Maximum probability of precipitation (0-1)",
            },
            // Visibility (SignalK compliant - meters)
            visibility: {
                units: "m",
                displayName: "Visibility",
                description: "Horizontal visibility",
            },
            // Wave parameters (meters, seconds, radians)
            significantWaveHeight: {
                units: "m",
                displayName: "Wave Height",
                description: "Significant wave height",
            },
            significantWaveHeightMax: {
                units: "m",
                displayName: "Max Wave Height",
                description: "Maximum significant wave height",
            },
            meanWavePeriod: {
                units: "s",
                displayName: "Wave Period",
                description: "Mean wave period",
            },
            meanWavePeriodMax: {
                units: "s",
                displayName: "Max Wave Period",
                description: "Maximum wave period",
            },
            meanWaveDirection: {
                units: "rad",
                displayName: "Wave Direction",
                description: "Mean wave direction",
            },
            meanWaveDirectionDominant: {
                units: "rad",
                displayName: "Dominant Wave Direction",
                description: "Dominant wave direction",
            },
            windWaveHeight: {
                units: "m",
                displayName: "Wind Wave Height",
                description: "Wind-generated wave height",
            },
            windWaveHeightMax: {
                units: "m",
                displayName: "Max Wind Wave Height",
                description: "Maximum wind-generated wave height",
            },
            windWavePeriod: {
                units: "s",
                displayName: "Wind Wave Period",
                description: "Wind-generated wave period",
            },
            windWaveDirection: {
                units: "rad",
                displayName: "Wind Wave Direction",
                description: "Wind-generated wave direction",
            },
            windWaveDirectionDominant: {
                units: "rad",
                displayName: "Dominant Wind Wave Direction",
                description: "Dominant wind-generated wave direction",
            },
            windWavePeakPeriod: {
                units: "s",
                displayName: "Wind Wave Peak Period",
                description: "Peak period of wind-generated waves",
            },
            swellSignificantHeight: {
                units: "m",
                displayName: "Swell Height",
                description: "Swell wave height",
            },
            swellSignificantHeightMax: {
                units: "m",
                displayName: "Max Swell Height",
                description: "Maximum swell wave height",
            },
            swellMeanPeriod: {
                units: "s",
                displayName: "Swell Period",
                description: "Swell wave period",
            },
            swellMeanPeriodMax: {
                units: "s",
                displayName: "Max Swell Period",
                description: "Maximum swell wave period",
            },
            swellMeanDirection: {
                units: "rad",
                displayName: "Swell Direction",
                description: "Swell wave direction",
            },
            swellMeanDirectionDominant: {
                units: "rad",
                displayName: "Dominant Swell Direction",
                description: "Dominant swell wave direction",
            },
            swellPeakPeriod: {
                units: "s",
                displayName: "Swell Peak Period",
                description: "Peak period of swell waves",
            },
            // Ocean currents
            currentVelocity: {
                units: "m/s",
                displayName: "Current Speed",
                description: "Ocean current velocity",
            },
            currentDirection: {
                units: "rad",
                displayName: "Current Direction",
                description: "Ocean current direction",
            },
            // Solar radiation
            solarRadiation: {
                units: "W/m2",
                displayName: "Solar Radiation",
                description: "Shortwave solar radiation",
            },
            solarRadiationSum: {
                units: "J/m2",
                displayName: "Total Solar Radiation",
                description: "Total shortwave solar radiation",
            },
            directRadiation: {
                units: "W/m2",
                displayName: "Direct Radiation",
                description: "Direct solar radiation",
            },
            diffuseRadiation: {
                units: "W/m2",
                displayName: "Diffuse Radiation",
                description: "Diffuse solar radiation",
            },
            irradianceDirectNormal: {
                units: "W/m2",
                displayName: "Direct Normal Irradiance",
                description: "Direct normal solar irradiance",
            },
            // Other
            uvIndex: {
                displayName: "UV Index",
                description: "UV index",
            },
            uvIndexMax: {
                displayName: "Max UV Index",
                description: "Maximum UV index",
            },
            weatherCode: {
                displayName: "Weather Code",
                description: "WMO weather interpretation code",
            },
            isDaylight: {
                displayName: "Is Daylight",
                description: "Whether it is day (1) or night (0)",
            },
            sunshineDuration: {
                units: "s",
                displayName: "Sunshine Duration",
                description: "Duration of sunshine",
            },
            daylightDuration: {
                units: "s",
                displayName: "Daylight Duration",
                description: "Duration of daylight",
            },
            cape: {
                units: "J/kg",
                displayName: "CAPE",
                description: "Convective Available Potential Energy",
            },
            sunrise: {
                displayName: "Sunrise",
                description: "Sunrise time",
            },
            sunset: {
                displayName: "Sunset",
                description: "Sunset time",
            },
        };
        if (metadataMap[parameterName]) {
            return metadataMap[parameterName];
        }
        // Fallback for unknown parameters
        let units = "";
        let description = `${parameterName} forecast parameter`;
        if (parameterName.includes("Temp") || parameterName.includes("temperature")) {
            units = "K";
            description = "Temperature forecast";
        }
        else if (parameterName.includes("wind") && (parameterName.includes("Avg") || parameterName.includes("Gust"))) {
            units = "m/s";
            description = "Wind speed forecast";
        }
        else if (parameterName.includes("Velocity") || parameterName.includes("velocity")) {
            units = "m/s";
            description = "Speed forecast";
        }
        else if (parameterName.includes("Pressure") || parameterName.includes("pressure")) {
            units = "Pa";
            description = "Pressure forecast";
        }
        else if (parameterName.includes("Humidity") || parameterName.includes("humidity")) {
            units = "ratio";
            description = "Humidity forecast (0-1)";
        }
        else if (parameterName.includes("precip") && !parameterName.includes("Probability")) {
            units = "m";
            description = "Precipitation forecast";
        }
        else if (parameterName.includes("Probability") || parameterName.includes("Cover")) {
            units = "ratio";
            description = "Ratio forecast (0-1)";
        }
        else if (parameterName.includes("Direction") || parameterName.includes("direction")) {
            units = "rad";
            description = "Direction forecast";
        }
        else if (parameterName.includes("visibility") || parameterName.includes("Visibility")) {
            units = "m";
            description = "Visibility forecast";
        }
        else if (parameterName.includes("Height") || parameterName.includes("height")) {
            units = "m";
            description = "Height forecast";
        }
        else if (parameterName.includes("Period") || parameterName.includes("period")) {
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
            // Process each field with unit conversions and translate field names
            Object.entries(hourly).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[dataIndex];
                if (value === undefined || value === null)
                    return;
                // Translate field name to SignalK-aligned name
                const translatedField = translateFieldName(field);
                // Apply unit conversions
                if (field.includes("temperature") || field === "dew_point_2m" || field === "apparent_temperature") {
                    forecast[translatedField] = celsiusToKelvin(value);
                }
                else if (field.includes("direction")) {
                    forecast[translatedField] = degToRad(value);
                }
                else if (field === "precipitation" || field === "rain" || field === "showers") {
                    forecast[translatedField] = mmToM(value);
                }
                else if (field === "snowfall") {
                    forecast[translatedField] = cmToM(value); // Snowfall is in cm
                }
                else if (field.includes("pressure")) {
                    forecast[translatedField] = hPaToPA(value);
                }
                else if (field.includes("humidity") || field.includes("cloud_cover") || field === "precipitation_probability") {
                    forecast[translatedField] = percentToRatio(value);
                }
                else if (field === "visibility") {
                    // Visibility is already in meters from Open-Meteo
                    forecast[translatedField] = value;
                }
                else {
                    forecast[translatedField] = value;
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
            // Process each field with unit conversions and translate field names
            Object.entries(daily).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[i];
                if (value === undefined || value === null)
                    return;
                // Translate field name to SignalK-aligned name
                const translatedField = translateFieldName(field);
                // Apply unit conversions
                if (field.includes("temperature")) {
                    forecast[translatedField] = celsiusToKelvin(value);
                }
                else if (field.includes("direction")) {
                    forecast[translatedField] = degToRad(value);
                }
                else if (field === "precipitation_sum" || field === "rain_sum" || field === "showers_sum") {
                    forecast[translatedField] = mmToM(value);
                }
                else if (field === "snowfall_sum") {
                    forecast[translatedField] = cmToM(value);
                }
                else if (field === "precipitation_probability_max") {
                    forecast[translatedField] = percentToRatio(value);
                }
                else {
                    forecast[translatedField] = value;
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
            // Process each field with unit conversions and translate field names
            Object.entries(hourly).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[dataIndex];
                if (value === undefined || value === null)
                    return;
                // Translate field name to SignalK-aligned name
                const translatedField = translateFieldName(field);
                // Apply unit conversions
                if (field === "sea_surface_temperature") {
                    forecast[translatedField] = celsiusToKelvin(value);
                }
                else if (field.includes("direction")) {
                    forecast[translatedField] = degToRad(value);
                }
                else if (field === "ocean_current_velocity") {
                    forecast[translatedField] = kmhToMs(value); // Current velocity is in km/h
                }
                else {
                    // Wave heights, periods are already in meters/seconds
                    forecast[translatedField] = value;
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
            // Process each field with unit conversions and translate field names
            Object.entries(daily).forEach(([field, values]) => {
                if (field === "time" || !Array.isArray(values))
                    return;
                const value = values[i];
                if (value === undefined || value === null)
                    return;
                // Translate field name to SignalK-aligned name
                const translatedField = translateFieldName(field);
                // Apply unit conversions
                if (field.includes("direction")) {
                    forecast[translatedField] = degToRad(value);
                }
                else {
                    forecast[translatedField] = value;
                }
            });
            forecasts.push(forecast);
        }
        return forecasts;
    };
    // Publish hourly forecasts for a single package (weather or marine) - batched into one delta
    const publishHourlyPackage = (forecasts, packageType) => {
        const sourceLabel = getSourceLabel(`hourly-${packageType}`);
        const allValues = [];
        const allMeta = [];
        // Collect all values from all hours into single arrays
        forecasts.forEach((forecast, index) => {
            Object.entries(forecast).forEach(([key, value]) => {
                if (key === "timestamp" || key === "relativeHour")
                    return;
                const path = `environment.outside.openmeteo.forecast.hourly.${key}.${index}`;
                const metadata = getParameterMetadata(key);
                allValues.push({ path, value });
                allMeta.push({ path, value: metadata });
            });
        });
        if (allValues.length === 0)
            return;
        // Send all values in one delta message
        const delta = {
            context: "vessels.self",
            updates: [
                {
                    $source: sourceLabel,
                    timestamp: new Date().toISOString(),
                    values: allValues,
                    meta: allMeta,
                },
            ],
        };
        app.handleMessage(plugin.id, delta);
        app.debug(`Published ${forecasts.length} hourly ${packageType} forecasts (${allValues.length} values in 1 message)`);
    };
    // Publish daily forecasts for a single package (weather or marine) - batched into one delta
    const publishDailyPackage = (forecasts, packageType) => {
        const sourceLabel = getSourceLabel(`daily-${packageType}`);
        const allValues = [];
        const allMeta = [];
        // Collect all values from all days into single arrays
        forecasts.forEach((forecast, index) => {
            Object.entries(forecast).forEach(([key, value]) => {
                if (key === "date" || key === "dayIndex")
                    return;
                const path = `environment.outside.openmeteo.forecast.daily.${key}.${index}`;
                const metadata = getParameterMetadata(key);
                allValues.push({ path, value });
                allMeta.push({ path, value: metadata });
            });
        });
        if (allValues.length === 0)
            return;
        // Send all values in one delta message
        const delta = {
            context: "vessels.self",
            updates: [
                {
                    $source: sourceLabel,
                    timestamp: new Date().toISOString(),
                    values: allValues,
                    meta: allMeta,
                },
            ],
        };
        app.handleMessage(plugin.id, delta);
        app.debug(`Published ${forecasts.length} daily ${packageType} forecasts (${allValues.length} values in 1 message)`);
    };
    // Fetch forecasts for a moving vessel (position-specific forecasts along predicted route)
    const fetchForecastForMovingVessel = async (config) => {
        var _a, _b;
        if (!state.currentPosition ||
            !state.currentHeading ||
            !state.currentSOG ||
            !isVesselMoving(state.currentSOG, config.movingSpeedThreshold) ||
            !state.movingForecastEngaged) {
            app.debug("Vessel not moving, missing navigation data, or moving forecast not engaged, falling back to stationary forecast");
            return fetchAndPublishForecasts(config);
        }
        app.debug(`Vessel moving at ${(state.currentSOG * 1.943844).toFixed(1)} knots (threshold: ${config.movingSpeedThreshold} knots), heading ${radToDeg(state.currentHeading).toFixed(1)}°`);
        app.debug(`Fetching position-specific forecasts for ${config.maxForecastHours} hours`);
        // Capture validated state for use in helper functions
        const currentPosition = state.currentPosition;
        const currentHeading = state.currentHeading;
        const currentSOG = state.currentSOG;
        const now = new Date();
        const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
        // Helper function to fetch forecast for a single hour
        const fetchHourForecast = async (hour) => {
            const predictedPos = calculateFuturePosition(currentPosition, currentHeading, currentSOG, hour);
            const targetTime = new Date(currentHour.getTime() + hour * 3600000);
            app.debug(`Hour ${hour}: Fetching weather for position ${predictedPos.latitude.toFixed(6)}, ${predictedPos.longitude.toFixed(6)}`);
            try {
                const weatherData = await fetchWeatherData(predictedPos, config);
                const marineData = config.enableMarineHourly || config.enableMarineDaily
                    ? await fetchMarineData(predictedPos, config)
                    : null;
                return { hour, predictedPos, targetTime, weatherData, marineData };
            }
            catch (err) {
                app.debug(`Hour ${hour}: Fetch failed - ${err}`);
                return null;
            }
        };
        try {
            // Fetch forecasts in parallel batches (5 concurrent requests)
            const BATCH_SIZE = 5;
            const BATCH_DELAY_MS = 200;
            const allResults = [];
            app.debug(`Fetching ${config.maxForecastHours} hourly forecasts in batches of ${BATCH_SIZE}`);
            for (let batchStart = 0; batchStart < config.maxForecastHours; batchStart += BATCH_SIZE) {
                const batchEnd = Math.min(batchStart + BATCH_SIZE, config.maxForecastHours);
                const batchHours = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i);
                app.debug(`Fetching batch: hours ${batchStart}-${batchEnd - 1}`);
                const batchResults = await Promise.all(batchHours.map((hour) => fetchHourForecast(hour)));
                batchResults.forEach((result) => {
                    if (result) {
                        allResults.push(result);
                    }
                });
                if (batchEnd < config.maxForecastHours) {
                    await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
                }
            }
            // Process and publish weather hourly forecasts
            if (config.enableHourlyWeather) {
                const hourlyWeatherForecasts = [];
                allResults.forEach((result) => {
                    var _a;
                    if ((_a = result.weatherData) === null || _a === void 0 ? void 0 : _a.hourly) {
                        const hourlyData = result.weatherData.hourly;
                        const targetHour = result.targetTime.getHours();
                        // Find matching hour in the response
                        const times = hourlyData.time || [];
                        for (let i = 0; i < times.length; i++) {
                            const forecastTime = new Date(times[i]);
                            if (forecastTime.getFullYear() === result.targetTime.getFullYear() &&
                                forecastTime.getMonth() === result.targetTime.getMonth() &&
                                forecastTime.getDate() === result.targetTime.getDate() &&
                                forecastTime.getHours() === targetHour) {
                                const forecast = {
                                    timestamp: forecastTime.toISOString(),
                                    predictedLatitude: result.predictedPos.latitude,
                                    predictedLongitude: result.predictedPos.longitude,
                                    vesselMoving: true,
                                };
                                // Extract all hourly fields for this time index
                                Object.keys(hourlyData).forEach((key) => {
                                    if (key !== "time") {
                                        const values = hourlyData[key];
                                        if (Array.isArray(values)) {
                                            forecast[key] = values[i];
                                        }
                                    }
                                });
                                hourlyWeatherForecasts.push(forecast);
                                break;
                            }
                        }
                    }
                });
                if (hourlyWeatherForecasts.length > 0) {
                    publishHourlyPackage(hourlyWeatherForecasts, "weather");
                    app.debug(`Published ${hourlyWeatherForecasts.length} position-specific weather forecasts`);
                }
            }
            // Process and publish marine hourly forecasts
            if (config.enableMarineHourly) {
                const hourlyMarineForecasts = [];
                allResults.forEach((result) => {
                    var _a;
                    if ((_a = result.marineData) === null || _a === void 0 ? void 0 : _a.hourly) {
                        const hourlyData = result.marineData.hourly;
                        const targetHour = result.targetTime.getHours();
                        const times = hourlyData.time || [];
                        for (let i = 0; i < times.length; i++) {
                            const forecastTime = new Date(times[i]);
                            if (forecastTime.getFullYear() === result.targetTime.getFullYear() &&
                                forecastTime.getMonth() === result.targetTime.getMonth() &&
                                forecastTime.getDate() === result.targetTime.getDate() &&
                                forecastTime.getHours() === targetHour) {
                                const forecast = {
                                    timestamp: forecastTime.toISOString(),
                                    predictedLatitude: result.predictedPos.latitude,
                                    predictedLongitude: result.predictedPos.longitude,
                                    vesselMoving: true,
                                };
                                Object.keys(hourlyData).forEach((key) => {
                                    if (key !== "time") {
                                        const values = hourlyData[key];
                                        if (Array.isArray(values)) {
                                            forecast[key] = values[i];
                                        }
                                    }
                                });
                                hourlyMarineForecasts.push(forecast);
                                break;
                            }
                        }
                    }
                });
                if (hourlyMarineForecasts.length > 0) {
                    publishHourlyPackage(hourlyMarineForecasts, "marine");
                    app.debug(`Published ${hourlyMarineForecasts.length} position-specific marine forecasts`);
                }
            }
            // Daily forecasts still use current position
            if (config.enableDailyWeather && ((_a = allResults[0]) === null || _a === void 0 ? void 0 : _a.weatherData)) {
                const dailyWeather = processDailyWeatherForecast(allResults[0].weatherData, config.maxForecastDays);
                if (dailyWeather.length > 0) {
                    publishDailyPackage(dailyWeather, "weather");
                }
            }
            if (config.enableMarineDaily && ((_b = allResults[0]) === null || _b === void 0 ? void 0 : _b.marineData)) {
                const dailyMarine = processDailyMarineForecast(allResults[0].marineData, config.maxForecastDays);
                if (dailyMarine.length > 0) {
                    publishDailyPackage(dailyMarine, "marine");
                }
            }
            state.lastForecastUpdate = Date.now();
            app.setPluginStatus("Active - Moving vessel forecasts updated");
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            app.error(`Failed to fetch position-specific forecasts: ${errorMsg}`);
            app.debug("Falling back to stationary forecast");
            return fetchAndPublishForecasts(config);
        }
    };
    // Fetch and publish all forecasts
    const fetchAndPublishForecasts = async (config) => {
        if (!state.currentPosition) {
            app.debug("No position available, skipping forecast fetch");
            return;
        }
        const position = state.currentPosition;
        // Fetch weather and marine data in parallel
        const needsMarine = config.enableMarineHourly || config.enableMarineDaily;
        const [weatherData, marineData] = await Promise.all([
            fetchWeatherData(position, config),
            needsMarine ? fetchMarineData(position, config) : Promise.resolve(null),
        ]);
        if (!weatherData && !marineData) {
            app.error("Failed to fetch any forecast data");
            return;
        }
        // Process and publish hourly forecasts - separate packages like meteoblue
        if (config.enableHourlyWeather && weatherData) {
            const hourlyWeather = processHourlyWeatherForecast(weatherData, config.maxForecastHours);
            if (hourlyWeather.length > 0) {
                publishHourlyPackage(hourlyWeather, "weather");
            }
        }
        if (config.enableMarineHourly && marineData) {
            const hourlyMarine = processHourlyMarineForecast(marineData, config.maxForecastHours);
            if (hourlyMarine.length > 0) {
                publishHourlyPackage(hourlyMarine, "marine");
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
    // Weather API provider implementation (using SignalK-aligned field names)
    const convertToWeatherAPIForecast = (forecastData, type) => {
        return {
            date: forecastData.timestamp || forecastData.date || new Date().toISOString(),
            type,
            description: getWeatherDescription(forecastData.weatherCode, "Open-Meteo weather"),
            longDescription: getWeatherLongDescription(forecastData.weatherCode, "Open-Meteo weather forecast"),
            icon: getWeatherIcon(forecastData.weatherCode, forecastData.isDaylight),
            outside: {
                temperature: forecastData.airTemperature,
                maxTemperature: forecastData.airTempHigh,
                minTemperature: forecastData.airTempLow,
                feelsLikeTemperature: forecastData.feelsLike || forecastData.feelsLikeHigh,
                pressure: forecastData.seaLevelPressure,
                relativeHumidity: forecastData.relativeHumidity,
                uvIndex: forecastData.uvIndex || forecastData.uvIndexMax,
                cloudCover: forecastData.cloudCover,
                precipitationVolume: forecastData.precip || forecastData.precipSum,
                dewPointTemperature: forecastData.dewPoint,
                horizontalVisibility: forecastData.visibility,
                precipitationProbability: forecastData.precipProbability || forecastData.precipProbabilityMax,
                lowCloudCover: forecastData.lowCloudCover,
                midCloudCover: forecastData.midCloudCover,
                highCloudCover: forecastData.highCloudCover,
                solarRadiation: forecastData.solarRadiation || forecastData.solarRadiationSum,
                directNormalIrradiance: forecastData.irradianceDirectNormal,
                diffuseHorizontalIrradiance: forecastData.diffuseRadiation,
            },
            water: {
                temperature: forecastData.seaSurfaceTemperature,
                waveSignificantHeight: forecastData.significantWaveHeight || forecastData.significantWaveHeightMax,
                wavePeriod: forecastData.meanWavePeriod || forecastData.meanWavePeriodMax,
                waveDirection: forecastData.meanWaveDirection || forecastData.meanWaveDirectionDominant,
                windWaveHeight: forecastData.windWaveHeight || forecastData.windWaveHeightMax,
                windWavePeriod: forecastData.windWavePeriod || forecastData.windWavePeriodMax,
                windWaveDirection: forecastData.windWaveDirection || forecastData.windWaveDirectionDominant,
                swellHeight: forecastData.swellSignificantHeight || forecastData.swellSignificantHeightMax,
                swellPeriod: forecastData.swellMeanPeriod || forecastData.swellMeanPeriodMax,
                swellDirection: forecastData.swellMeanDirection || forecastData.swellMeanDirectionDominant,
                surfaceCurrentSpeed: forecastData.currentVelocity,
                surfaceCurrentDirection: forecastData.currentDirection,
                swellPeakPeriod: forecastData.swellPeakPeriod || forecastData.swellPeakPeriodMax,
                windWavePeakPeriod: forecastData.windWavePeakPeriod || forecastData.windWavePeakPeriodMax,
            },
            wind: {
                speedTrue: forecastData.windAvg || forecastData.windAvgMax,
                directionTrue: forecastData.windDirection || forecastData.windDirectionDominant,
                gust: forecastData.windGust || forecastData.windGustMax,
            },
            sun: {
                sunrise: forecastData.sunrise,
                sunset: forecastData.sunset,
                sunshineDuration: forecastData.sunshineDuration,
                // isDaylight: true if 1/true, false if 0/false, undefined if not present (daily forecasts)
                isDaylight: forecastData.isDaylight !== undefined
                    ? forecastData.isDaylight === 1 || forecastData.isDaylight === true
                    : undefined,
            },
        };
    };
    // Get hourly forecasts from SignalK tree (using SignalK-aligned field names)
    const getHourlyForecasts = (maxCount) => {
        const forecasts = [];
        try {
            // Read forecast data from SignalK tree using translated field names
            let forecastCount = 0;
            for (let i = 0; i < maxCount + 10; i++) {
                const temp = app.getSelfPath(`environment.outside.openmeteo.forecast.hourly.airTemperature.${i}`);
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
                // Use SignalK-aligned field names (translated names)
                const fields = [
                    "airTemperature",
                    "relativeHumidity",
                    "dewPoint",
                    "feelsLike",
                    "precipProbability",
                    "precip",
                    "weatherCode",
                    "seaLevelPressure",
                    "cloudCover",
                    "lowCloudCover",
                    "midCloudCover",
                    "highCloudCover",
                    "visibility",
                    "windAvg",
                    "windDirection",
                    "windGust",
                    "uvIndex",
                    "isDaylight",
                    "sunshineDuration",
                    "solarRadiation",
                    "directRadiation",
                    "diffuseRadiation",
                    "irradianceDirectNormal",
                    "significantWaveHeight",
                    "meanWaveDirection",
                    "meanWavePeriod",
                    "windWaveHeight",
                    "windWaveDirection",
                    "windWavePeriod",
                    "swellSignificantHeight",
                    "swellMeanDirection",
                    "swellMeanPeriod",
                    "currentVelocity",
                    "currentDirection",
                    "seaSurfaceTemperature",
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
    // Get daily forecasts from SignalK tree (using SignalK-aligned field names)
    const getDailyForecasts = (maxCount) => {
        const forecasts = [];
        try {
            let forecastCount = 0;
            for (let i = 0; i < maxCount + 2; i++) {
                const temp = app.getSelfPath(`environment.outside.openmeteo.forecast.daily.airTempHigh.${i}`);
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
                // Use SignalK-aligned field names (translated names)
                const fields = [
                    "weatherCode",
                    "airTempHigh",
                    "airTempLow",
                    "feelsLikeHigh",
                    "feelsLikeLow",
                    "sunrise",
                    "sunset",
                    "sunshineDuration",
                    "uvIndexMax",
                    "precipSum",
                    "precipProbabilityMax",
                    "windAvgMax",
                    "windGustMax",
                    "windDirectionDominant",
                    "significantWaveHeightMax",
                    "meanWaveDirectionDominant",
                    "meanWavePeriodMax",
                    "swellSignificantHeightMax",
                    "swellMeanDirectionDominant",
                    "swellMeanPeriodMax",
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
                    var _a;
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
                                // Trigger initial forecast fetch (use moving vessel if appropriate)
                                if (state.currentConfig) {
                                    if (state.currentSOG &&
                                        isVesselMoving(state.currentSOG, state.currentConfig.movingSpeedThreshold) &&
                                        state.movingForecastEngaged) {
                                        fetchForecastForMovingVessel(state.currentConfig);
                                    }
                                    else {
                                        fetchAndPublishForecasts(state.currentConfig);
                                    }
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
                        // Auto-engage moving forecast if enabled and speed exceeds threshold
                        if (((_a = state.currentConfig) === null || _a === void 0 ? void 0 : _a.enableAutoMovingForecast) &&
                            isVesselMoving(state.currentSOG, state.currentConfig.movingSpeedThreshold) &&
                            !state.movingForecastEngaged) {
                            state.movingForecastEngaged = true;
                            app.debug(`Auto-enabled moving forecast due to vessel movement exceeding ${state.currentConfig.movingSpeedThreshold} knots`);
                        }
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
        // Helper to determine which fetch function to use
        const doForecastFetch = async () => {
            if (state.currentSOG &&
                isVesselMoving(state.currentSOG, config.movingSpeedThreshold) &&
                state.movingForecastEngaged) {
                app.debug("Using position-specific forecasting for moving vessel");
                await fetchForecastForMovingVessel(config);
            }
            else {
                app.debug("Using standard forecasting for stationary vessel");
                await fetchAndPublishForecasts(config);
            }
        };
        // Setup forecast interval
        const intervalMs = config.forecastInterval * 60 * 1000;
        state.forecastInterval = setInterval(async () => {
            if (state.forecastEnabled && state.currentPosition) {
                await doForecastFetch();
            }
        }, intervalMs);
        // Initial fetch if position is available
        setTimeout(async () => {
            if (state.currentPosition) {
                await doForecastFetch();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUFBLDREQUErQjtBQWtCL0IsaUJBQVMsVUFBVSxHQUFlO0lBQ2hDLE1BQU0sTUFBTSxHQUFrQjtRQUM1QixFQUFFLEVBQUUsb0JBQW9CO1FBQ3hCLElBQUksRUFBRSw0QkFBNEI7UUFDbEMsV0FBVyxFQUFFLHFFQUFxRTtRQUNsRixNQUFNLEVBQUUsRUFBRTtRQUNWLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRSxDQUFDO1FBQ2YsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFFLENBQUM7S0FDZixDQUFDO0lBRUYsTUFBTSxLQUFLLEdBQWdCO1FBQ3pCLGdCQUFnQixFQUFFLElBQUk7UUFDdEIsdUJBQXVCLEVBQUUsRUFBRTtRQUMzQixhQUFhLEVBQUUsU0FBUztRQUN4QixlQUFlLEVBQUUsSUFBSTtRQUNyQixjQUFjLEVBQUUsSUFBSTtRQUNwQixVQUFVLEVBQUUsSUFBSTtRQUNoQixrQkFBa0IsRUFBRSxDQUFDO1FBQ3JCLGVBQWUsRUFBRSxJQUFJO1FBQ3JCLHFCQUFxQixFQUFFLEtBQUs7S0FDN0IsQ0FBQztJQUVGLHdEQUF3RDtJQUN4RCxrREFBa0Q7SUFDbEQsTUFBTSxtQkFBbUIsR0FBMkI7UUFDbEQsQ0FBQyxFQUFFLE9BQU87UUFDVixDQUFDLEVBQUUsY0FBYztRQUNqQixDQUFDLEVBQUUsZUFBZTtRQUNsQixDQUFDLEVBQUUsVUFBVTtRQUNiLEVBQUUsRUFBRSxLQUFLO1FBQ1QsRUFBRSxFQUFFLHFCQUFxQjtRQUN6QixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVBQUUsa0JBQWtCO1FBQ3RCLEVBQUUsRUFBRSxlQUFlO1FBQ25CLEVBQUUsRUFBRSx3QkFBd0I7UUFDNUIsRUFBRSxFQUFFLHdCQUF3QjtRQUM1QixFQUFFLEVBQUUsYUFBYTtRQUNqQixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVBQUUsWUFBWTtRQUNoQixFQUFFLEVBQUUscUJBQXFCO1FBQ3pCLEVBQUUsRUFBRSxxQkFBcUI7UUFDekIsRUFBRSxFQUFFLGFBQWE7UUFDakIsRUFBRSxFQUFFLGVBQWU7UUFDbkIsRUFBRSxFQUFFLFlBQVk7UUFDaEIsRUFBRSxFQUFFLGFBQWE7UUFDakIsRUFBRSxFQUFFLHFCQUFxQjtRQUN6QixFQUFFLEVBQUUsdUJBQXVCO1FBQzNCLEVBQUUsRUFBRSxzQkFBc0I7UUFDMUIsRUFBRSxFQUFFLHFCQUFxQjtRQUN6QixFQUFFLEVBQUUsb0JBQW9CO1FBQ3hCLEVBQUUsRUFBRSxjQUFjO1FBQ2xCLEVBQUUsRUFBRSwrQkFBK0I7UUFDbkMsRUFBRSxFQUFFLDhCQUE4QjtLQUNuQyxDQUFDO0lBRUYsTUFBTSx1QkFBdUIsR0FBMkI7UUFDdEQsQ0FBQyxFQUFFLCtCQUErQjtRQUNsQyxDQUFDLEVBQUUsdUNBQXVDO1FBQzFDLENBQUMsRUFBRSxxQ0FBcUM7UUFDeEMsQ0FBQyxFQUFFLG9DQUFvQztRQUN2QyxFQUFFLEVBQUUseUJBQXlCO1FBQzdCLEVBQUUsRUFBRSx3Q0FBd0M7UUFDNUMsRUFBRSxFQUFFLHVDQUF1QztRQUMzQyxFQUFFLEVBQUUseUNBQXlDO1FBQzdDLEVBQUUsRUFBRSwwQ0FBMEM7UUFDOUMsRUFBRSxFQUFFLHNDQUFzQztRQUMxQyxFQUFFLEVBQUUsOENBQThDO1FBQ2xELEVBQUUsRUFBRSxzQ0FBc0M7UUFDMUMsRUFBRSxFQUFFLHlDQUF5QztRQUM3QyxFQUFFLEVBQUUsdUNBQXVDO1FBQzNDLEVBQUUsRUFBRSxnREFBZ0Q7UUFDcEQsRUFBRSxFQUFFLCtDQUErQztRQUNuRCxFQUFFLEVBQUUseUNBQXlDO1FBQzdDLEVBQUUsRUFBRSw0Q0FBNEM7UUFDaEQsRUFBRSxFQUFFLDhDQUE4QztRQUNsRCxFQUFFLEVBQUUseUNBQXlDO1FBQzdDLEVBQUUsRUFBRSx1Q0FBdUM7UUFDM0MsRUFBRSxFQUFFLDBDQUEwQztRQUM5QyxFQUFFLEVBQUUseUNBQXlDO1FBQzdDLEVBQUUsRUFBRSx1Q0FBdUM7UUFDM0MsRUFBRSxFQUFFLHNDQUFzQztRQUMxQyxFQUFFLEVBQUUseUNBQXlDO1FBQzdDLEVBQUUsRUFBRSwrQkFBK0I7UUFDbkMsRUFBRSxFQUFFLG9EQUFvRDtLQUN6RCxDQUFDO0lBRUYsOEJBQThCO0lBQzlCLHlGQUF5RjtJQUN6RixNQUFNLGNBQWMsR0FBRyxDQUNyQixPQUEyQixFQUMzQixLQUFtQyxFQUNmLEVBQUU7UUFDdEIsSUFBSSxPQUFPLEtBQUssU0FBUztZQUFFLE9BQU8sU0FBUyxDQUFDO1FBQzVDLHVGQUF1RjtRQUN2RixNQUFNLFFBQVEsR0FBRyxLQUFLLEtBQUssS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBQ2xFLE9BQU8sT0FBTyxPQUFPLElBQUksUUFBUSxNQUFNLENBQUM7SUFDMUMsQ0FBQyxDQUFDO0lBRUYsTUFBTSxxQkFBcUIsR0FBRyxDQUM1QixPQUEyQixFQUMzQixRQUFnQixFQUNSLEVBQUU7UUFDVixJQUFJLE9BQU8sS0FBSyxTQUFTO1lBQUUsT0FBTyxRQUFRLENBQUM7UUFDM0MsT0FBTyxtQkFBbUIsQ0FBQyxPQUFPLENBQUMsSUFBSSxRQUFRLENBQUM7SUFDbEQsQ0FBQyxDQUFDO0lBRUYsTUFBTSx5QkFBeUIsR0FBRyxDQUNoQyxPQUEyQixFQUMzQixRQUFnQixFQUNSLEVBQUU7UUFDVixJQUFJLE9BQU8sS0FBSyxTQUFTO1lBQUUsT0FBTyxRQUFRLENBQUM7UUFDM0MsT0FBTyx1QkFBdUIsQ0FBQyxPQUFPLENBQUMsSUFBSSxRQUFRLENBQUM7SUFDdEQsQ0FBQyxDQUFDO0lBRUYsdUJBQXVCO0lBQ3ZCLE1BQU0sQ0FBQyxNQUFNLEdBQUc7UUFDZCxJQUFJLEVBQUUsUUFBUTtRQUNkLFFBQVEsRUFBRSxFQUFFO1FBQ1osVUFBVSxFQUFFO1lBQ1YsTUFBTSxFQUFFO2dCQUNOLElBQUksRUFBRSxRQUFRO2dCQUNkLEtBQUssRUFBRSxvQkFBb0I7Z0JBQzNCLFdBQVcsRUFDVCxpRkFBaUY7YUFDcEY7WUFDRCxnQkFBZ0IsRUFBRTtnQkFDaEIsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsS0FBSyxFQUFFLG9DQUFvQztnQkFDM0MsV0FBVyxFQUFFLHNDQUFzQztnQkFDbkQsT0FBTyxFQUFFLEVBQUU7Z0JBQ1gsT0FBTyxFQUFFLEVBQUU7Z0JBQ1gsT0FBTyxFQUFFLElBQUk7YUFDZDtZQUNELFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUUsUUFBUTtnQkFDZCxLQUFLLEVBQUUsMkJBQTJCO2dCQUNsQyxXQUFXLEVBQUUsMkNBQTJDO2dCQUN4RCxPQUFPLEVBQUUsQ0FBQztnQkFDVixPQUFPLEVBQUUsQ0FBQztnQkFDVixPQUFPLEVBQUUsS0FBSzthQUNmO1lBQ0QsMEJBQTBCLEVBQUU7Z0JBQzFCLElBQUksRUFBRSxTQUFTO2dCQUNmLEtBQUssRUFBRSw4QkFBOEI7Z0JBQ3JDLFdBQVcsRUFDVCx5RUFBeUU7Z0JBQzNFLE9BQU8sRUFBRSxJQUFJO2FBQ2Q7WUFDRCxnQkFBZ0IsRUFBRTtnQkFDaEIsSUFBSSxFQUFFLFFBQVE7Z0JBQ2QsS0FBSyxFQUFFLG9CQUFvQjtnQkFDM0IsV0FBVyxFQUFFLHdEQUF3RDtnQkFDckUsT0FBTyxFQUFFLEVBQUU7Z0JBQ1gsT0FBTyxFQUFFLENBQUM7Z0JBQ1YsT0FBTyxFQUFFLEdBQUc7YUFDYjtZQUNELGVBQWUsRUFBRTtnQkFDZixJQUFJLEVBQUUsUUFBUTtnQkFDZCxLQUFLLEVBQUUsbUJBQW1CO2dCQUMxQixXQUFXLEVBQUUsc0RBQXNEO2dCQUNuRSxPQUFPLEVBQUUsQ0FBQztnQkFDVixPQUFPLEVBQUUsQ0FBQztnQkFDVixPQUFPLEVBQUUsRUFBRTthQUNaO1lBQ0QsbUJBQW1CLEVBQUU7Z0JBQ25CLElBQUksRUFBRSxTQUFTO2dCQUNmLEtBQUssRUFBRSx1QkFBdUI7Z0JBQzlCLFdBQVcsRUFBRSxnQ0FBZ0M7Z0JBQzdDLE9BQU8sRUFBRSxJQUFJO2FBQ2Q7WUFDRCxrQkFBa0IsRUFBRTtnQkFDbEIsSUFBSSxFQUFFLFNBQVM7Z0JBQ2YsS0FBSyxFQUFFLHNCQUFzQjtnQkFDN0IsV0FBVyxFQUFFLCtCQUErQjtnQkFDNUMsT0FBTyxFQUFFLElBQUk7YUFDZDtZQUNELGtCQUFrQixFQUFFO2dCQUNsQixJQUFJLEVBQUUsU0FBUztnQkFDZixLQUFLLEVBQUUsc0JBQXNCO2dCQUM3QixXQUFXLEVBQUUsa0VBQWtFO2dCQUMvRSxPQUFPLEVBQUUsSUFBSTthQUNkO1lBQ0QsaUJBQWlCLEVBQUU7Z0JBQ2pCLElBQUksRUFBRSxTQUFTO2dCQUNmLEtBQUssRUFBRSxxQkFBcUI7Z0JBQzVCLFdBQVcsRUFBRSw4QkFBOEI7Z0JBQzNDLE9BQU8sRUFBRSxJQUFJO2FBQ2Q7WUFDRCx1QkFBdUIsRUFBRTtnQkFDdkIsSUFBSSxFQUFFLFNBQVM7Z0JBQ2YsS0FBSyxFQUFFLDJCQUEyQjtnQkFDbEMsV0FBVyxFQUFFLGtDQUFrQztnQkFDL0MsT0FBTyxFQUFFLElBQUk7YUFDZDtZQUNELHdCQUF3QixFQUFFO2dCQUN4QixJQUFJLEVBQUUsU0FBUztnQkFDZixLQUFLLEVBQUUsNkJBQTZCO2dCQUNwQyxXQUFXLEVBQ1QsK0VBQStFO2dCQUNqRixPQUFPLEVBQUUsS0FBSzthQUNmO1lBQ0Qsb0JBQW9CLEVBQUU7Z0JBQ3BCLElBQUksRUFBRSxRQUFRO2dCQUNkLEtBQUssRUFBRSxnQ0FBZ0M7Z0JBQ3ZDLFdBQVcsRUFDVCxxRUFBcUU7Z0JBQ3ZFLE9BQU8sRUFBRSxHQUFHO2dCQUNaLE9BQU8sRUFBRSxHQUFHO2dCQUNaLE9BQU8sRUFBRSxJQUFJO2FBQ2Q7U0FDRjtLQUNGLENBQUM7SUFFRixvQkFBb0I7SUFDcEIsTUFBTSxRQUFRLEdBQUcsQ0FBQyxPQUFlLEVBQVUsRUFBRSxDQUFDLE9BQU8sR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEdBQUcsR0FBRyxDQUFDLENBQUM7SUFDeEUsTUFBTSxRQUFRLEdBQUcsQ0FBQyxPQUFlLEVBQVUsRUFBRSxDQUFDLE9BQU8sR0FBRyxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDeEUsTUFBTSxlQUFlLEdBQUcsQ0FBQyxPQUFlLEVBQVUsRUFBRSxDQUFDLE9BQU8sR0FBRyxNQUFNLENBQUM7SUFDdEUsTUFBTSxPQUFPLEdBQUcsQ0FBQyxHQUFXLEVBQVUsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUM7SUFDbkQsTUFBTSxLQUFLLEdBQUcsQ0FBQyxFQUFVLEVBQVUsRUFBRSxDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUM7SUFDaEQsTUFBTSxLQUFLLEdBQUcsQ0FBQyxFQUFVLEVBQVUsRUFBRSxDQUFDLEVBQUUsR0FBRyxHQUFHLENBQUM7SUFDL0MsTUFBTSxLQUFLLEdBQUcsQ0FBQyxFQUFVLEVBQVUsRUFBRSxDQUFDLEVBQUUsR0FBRyxJQUFJLENBQUM7SUFDaEQsTUFBTSxPQUFPLEdBQUcsQ0FBQyxHQUFXLEVBQVUsRUFBRSxDQUFDLEdBQUcsR0FBRyxHQUFHLENBQUM7SUFDbkQsTUFBTSxjQUFjLEdBQUcsQ0FBQyxPQUFlLEVBQVUsRUFBRSxDQUFDLE9BQU8sR0FBRyxHQUFHLENBQUM7SUFFbEUsa0hBQWtIO0lBQ2xILE1BQU0sWUFBWSxHQUEyQjtRQUMzQyxxQkFBcUI7UUFDckIsY0FBYyxFQUFFLGdCQUFnQjtRQUNoQyxvQkFBb0IsRUFBRSxXQUFXO1FBQ2pDLFlBQVksRUFBRSxVQUFVO1FBQ3hCLGtCQUFrQixFQUFFLGFBQWE7UUFDakMsa0JBQWtCLEVBQUUsWUFBWTtRQUNoQyx3QkFBd0IsRUFBRSxlQUFlO1FBQ3pDLHdCQUF3QixFQUFFLGNBQWM7UUFDeEMsdUJBQXVCLEVBQUUsdUJBQXVCO1FBRWhELGNBQWM7UUFDZCxjQUFjLEVBQUUsU0FBUztRQUN6QixrQkFBa0IsRUFBRSxlQUFlO1FBQ25DLGNBQWMsRUFBRSxVQUFVO1FBQzFCLGtCQUFrQixFQUFFLFlBQVk7UUFDaEMsa0JBQWtCLEVBQUUsYUFBYTtRQUNqQywyQkFBMkIsRUFBRSx1QkFBdUI7UUFFcEQsa0JBQWtCO1FBQ2xCLFlBQVksRUFBRSxrQkFBa0I7UUFDaEMsZ0JBQWdCLEVBQUUsaUJBQWlCO1FBRW5DLGtCQUFrQjtRQUNsQixvQkFBb0IsRUFBRSxrQkFBa0I7UUFFeEMsdUJBQXVCO1FBQ3ZCLGFBQWEsRUFBRSxRQUFRO1FBQ3ZCLHlCQUF5QixFQUFFLG1CQUFtQjtRQUM5QyxpQkFBaUIsRUFBRSxXQUFXO1FBQzlCLDZCQUE2QixFQUFFLHNCQUFzQjtRQUNyRCxtQkFBbUIsRUFBRSxhQUFhO1FBQ2xDLElBQUksRUFBRSxNQUFNO1FBQ1osUUFBUSxFQUFFLFNBQVM7UUFDbkIsT0FBTyxFQUFFLFNBQVM7UUFDbEIsV0FBVyxFQUFFLFlBQVk7UUFDekIsUUFBUSxFQUFFLFVBQVU7UUFDcEIsWUFBWSxFQUFFLGFBQWE7UUFFM0IscUJBQXFCO1FBQ3JCLFdBQVcsRUFBRSxZQUFZO1FBQ3pCLGVBQWUsRUFBRSxlQUFlO1FBQ2hDLGVBQWUsRUFBRSxlQUFlO1FBQ2hDLGdCQUFnQixFQUFFLGdCQUFnQjtRQUVsQyxrQkFBa0I7UUFDbEIsUUFBUSxFQUFFLFNBQVM7UUFDbkIsWUFBWSxFQUFFLFlBQVk7UUFDMUIsbUJBQW1CLEVBQUUsZ0JBQWdCO1FBQ3JDLHVCQUF1QixFQUFFLG1CQUFtQjtRQUM1QyxnQkFBZ0IsRUFBRSxpQkFBaUI7UUFDbkMsaUJBQWlCLEVBQUUsa0JBQWtCO1FBQ3JDLHdCQUF3QixFQUFFLHdCQUF3QjtRQUNsRCxpQkFBaUIsRUFBRSxrQkFBa0I7UUFDckMsaUJBQWlCLEVBQUUsa0JBQWtCO1FBRXJDLHFCQUFxQjtRQUNyQixXQUFXLEVBQUUsdUJBQXVCO1FBQ3BDLGVBQWUsRUFBRSwwQkFBMEI7UUFDM0MsY0FBYyxFQUFFLG1CQUFtQjtRQUNuQyx1QkFBdUIsRUFBRSwyQkFBMkI7UUFDcEQsV0FBVyxFQUFFLGdCQUFnQjtRQUM3QixlQUFlLEVBQUUsbUJBQW1CO1FBQ3BDLGdCQUFnQixFQUFFLGdCQUFnQjtRQUNsQyxvQkFBb0IsRUFBRSxtQkFBbUI7UUFDekMsbUJBQW1CLEVBQUUsbUJBQW1CO1FBQ3hDLDRCQUE0QixFQUFFLDJCQUEyQjtRQUN6RCxnQkFBZ0IsRUFBRSxnQkFBZ0I7UUFDbEMsb0JBQW9CLEVBQUUsbUJBQW1CO1FBQ3pDLHFCQUFxQixFQUFFLG9CQUFvQjtRQUMzQyx5QkFBeUIsRUFBRSx1QkFBdUI7UUFDbEQsaUJBQWlCLEVBQUUsd0JBQXdCO1FBQzNDLHFCQUFxQixFQUFFLDJCQUEyQjtRQUNsRCxvQkFBb0IsRUFBRSxvQkFBb0I7UUFDMUMsNkJBQTZCLEVBQUUsNEJBQTRCO1FBQzNELGlCQUFpQixFQUFFLGlCQUFpQjtRQUNwQyxxQkFBcUIsRUFBRSxvQkFBb0I7UUFDM0Msc0JBQXNCLEVBQUUsaUJBQWlCO1FBQ3pDLDBCQUEwQixFQUFFLG9CQUFvQjtRQUNoRCxzQkFBc0IsRUFBRSxpQkFBaUI7UUFDekMsdUJBQXVCLEVBQUUsa0JBQWtCO1FBRTNDLGVBQWU7UUFDZixVQUFVLEVBQUUsWUFBWTtRQUN4QixNQUFNLEVBQUUsWUFBWTtRQUNwQixZQUFZLEVBQUUsYUFBYTtRQUMzQixJQUFJLEVBQUUsTUFBTTtRQUNaLE9BQU8sRUFBRSxTQUFTO1FBQ2xCLE1BQU0sRUFBRSxRQUFRO0tBQ2pCLENBQUM7SUFFRiwwREFBMEQ7SUFDMUQsTUFBTSxrQkFBa0IsR0FBRyxDQUFDLGFBQXFCLEVBQVUsRUFBRTtRQUMzRCxPQUFPLFlBQVksQ0FBQyxhQUFhLENBQUMsSUFBSSxhQUFhLENBQUM7SUFDdEQsQ0FBQyxDQUFDO0lBRUYsa0ZBQWtGO0lBQ2xGLE1BQU0sbUJBQW1CLEdBQTJCLE1BQU0sQ0FBQyxPQUFPLENBQ2hFLFlBQVksQ0FDYixDQUFDLE1BQU0sQ0FDTixDQUFDLEdBQUcsRUFBRSxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsRUFBRSxFQUFFO1FBQzVCLEdBQUcsQ0FBQyxPQUFPLENBQUMsR0FBRyxTQUFTLENBQUM7UUFDekIsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDLEVBQ0QsRUFBNEIsQ0FDN0IsQ0FBQztJQUVGLCtEQUErRDtJQUMvRCxNQUFNLHVCQUF1QixHQUFHLENBQzlCLFVBQW9CLEVBQ3BCLFVBQWtCLEVBQ2xCLE1BQWMsRUFDZCxVQUFrQixFQUNSLEVBQUU7UUFDWixNQUFNLGNBQWMsR0FBRyxNQUFNLEdBQUcsVUFBVSxHQUFHLElBQUksQ0FBQztRQUNsRCxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUM7UUFFNUIsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMzQyxNQUFNLElBQUksR0FBRyxRQUFRLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRTVDLE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQ3BCLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxjQUFjLEdBQUcsV0FBVyxDQUFDO1lBQ3JELElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDO2dCQUNaLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxHQUFHLFdBQVcsQ0FBQztnQkFDdEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FDekIsQ0FBQztRQUVGLE1BQU0sSUFBSSxHQUNSLElBQUk7WUFDSixJQUFJLENBQUMsS0FBSyxDQUNSLElBQUksQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO2dCQUNsQixJQUFJLENBQUMsR0FBRyxDQUFDLGNBQWMsR0FBRyxXQUFXLENBQUM7Z0JBQ3RDLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQ2hCLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxHQUFHLFdBQVcsQ0FBQztnQkFDcEMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUNsQyxDQUFDO1FBRUosT0FBTztZQUNMLFFBQVEsRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDO1lBQ3hCLFNBQVMsRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDO1lBQ3pCLFNBQVMsRUFBRSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsVUFBVSxHQUFHLE9BQU8sQ0FBQztTQUN2RCxDQUFDO0lBQ0osQ0FBQyxDQUFDO0lBRUYsNENBQTRDO0lBQzVDLE1BQU0sY0FBYyxHQUFHLENBQ3JCLE1BQWMsRUFDZCxpQkFBeUIsR0FBRyxFQUNuQixFQUFFO1FBQ1gsTUFBTSxZQUFZLEdBQUcsY0FBYyxHQUFHLFFBQVEsQ0FBQztRQUMvQyxPQUFPLE1BQU0sR0FBRyxZQUFZLENBQUM7SUFDL0IsQ0FBQyxDQUFDO0lBRUYsbUNBQW1DO0lBQ25DLE1BQU0sZUFBZSxHQUFHLENBQ3RCLFFBQWtCLEVBQ2xCLE1BQW9CLEVBQ1osRUFBRTtRQUNWLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxNQUFNO1lBQzNCLENBQUMsQ0FBQyxpREFBaUQ7WUFDbkQsQ0FBQyxDQUFDLHdDQUF3QyxDQUFDO1FBRTdDLE1BQU0sTUFBTSxHQUFHLElBQUksZUFBZSxDQUFDO1lBQ2pDLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRTtZQUN0QyxTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUU7WUFDeEMsUUFBUSxFQUFFLEtBQUs7WUFDZixhQUFhLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLEVBQUUsQ0FBQyxDQUFDLFFBQVEsRUFBRTtTQUMvRCxDQUFDLENBQUM7UUFFSCxJQUFJLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNsQixNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDekMsQ0FBQztRQUVELDJCQUEyQjtRQUMzQixJQUFJLE1BQU0sQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQy9CLE1BQU0sVUFBVSxHQUFHO2dCQUNqQixnQkFBZ0I7Z0JBQ2hCLHNCQUFzQjtnQkFDdEIsY0FBYztnQkFDZCxzQkFBc0I7Z0JBQ3RCLDJCQUEyQjtnQkFDM0IsZUFBZTtnQkFDZixNQUFNO2dCQUNOLFNBQVM7Z0JBQ1QsVUFBVTtnQkFDVixjQUFjO2dCQUNkLGNBQWM7Z0JBQ2Qsa0JBQWtCO2dCQUNsQixhQUFhO2dCQUNiLGlCQUFpQjtnQkFDakIsaUJBQWlCO2dCQUNqQixrQkFBa0I7Z0JBQ2xCLFlBQVk7Z0JBQ1osZ0JBQWdCO2dCQUNoQixvQkFBb0I7Z0JBQ3BCLGdCQUFnQjtnQkFDaEIsVUFBVTtnQkFDVixRQUFRO2dCQUNSLG1CQUFtQjtnQkFDbkIsTUFBTTtnQkFDTixxQkFBcUI7Z0JBQ3JCLGtCQUFrQjtnQkFDbEIsbUJBQW1CO2dCQUNuQiwwQkFBMEI7YUFDM0IsQ0FBQztZQUNGLE1BQU0sQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNoRCxDQUFDO1FBRUQsMEJBQTBCO1FBQzFCLElBQUksTUFBTSxDQUFDLGtCQUFrQixFQUFFLENBQUM7WUFDOUIsTUFBTSxTQUFTLEdBQUc7Z0JBQ2hCLGNBQWM7Z0JBQ2Qsb0JBQW9CO2dCQUNwQixvQkFBb0I7Z0JBQ3BCLDBCQUEwQjtnQkFDMUIsMEJBQTBCO2dCQUMxQixTQUFTO2dCQUNULFFBQVE7Z0JBQ1IsbUJBQW1CO2dCQUNuQixtQkFBbUI7Z0JBQ25CLGNBQWM7Z0JBQ2QsbUJBQW1CO2dCQUNuQixVQUFVO2dCQUNWLGFBQWE7Z0JBQ2IsY0FBYztnQkFDZCxxQkFBcUI7Z0JBQ3JCLCtCQUErQjtnQkFDL0Isb0JBQW9CO2dCQUNwQixvQkFBb0I7Z0JBQ3BCLDZCQUE2QjtnQkFDN0IseUJBQXlCO2FBQzFCLENBQUM7WUFDRixNQUFNLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDOUMsQ0FBQztRQUVELHFCQUFxQjtRQUNyQixJQUFJLE1BQU0sQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO1lBQ25DLE1BQU0sV0FBVyxHQUFHO2dCQUNsQixnQkFBZ0I7Z0JBQ2hCLHNCQUFzQjtnQkFDdEIsc0JBQXNCO2dCQUN0QixRQUFRO2dCQUNSLGVBQWU7Z0JBQ2YsTUFBTTtnQkFDTixTQUFTO2dCQUNULFVBQVU7Z0JBQ1YsY0FBYztnQkFDZCxhQUFhO2dCQUNiLGNBQWM7Z0JBQ2Qsa0JBQWtCO2dCQUNsQixnQkFBZ0I7Z0JBQ2hCLG9CQUFvQjtnQkFDcEIsZ0JBQWdCO2FBQ2pCLENBQUM7WUFDRixNQUFNLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxXQUFXLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEQsQ0FBQztRQUVELHNEQUFzRDtRQUN0RCxNQUFNLENBQUMsTUFBTSxDQUFDLGlCQUFpQixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRXZDLE9BQU8sR0FBRyxPQUFPLElBQUksTUFBTSxDQUFDLFFBQVEsRUFBRSxFQUFFLENBQUM7SUFDM0MsQ0FBQyxDQUFDO0lBRUYsa0NBQWtDO0lBQ2xDLE1BQU0sY0FBYyxHQUFHLENBQ3JCLFFBQWtCLEVBQ2xCLE1BQW9CLEVBQ1osRUFBRTtRQUNWLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxNQUFNO1lBQzNCLENBQUMsQ0FBQyxzREFBc0Q7WUFDeEQsQ0FBQyxDQUFDLDZDQUE2QyxDQUFDO1FBRWxELE1BQU0sTUFBTSxHQUFHLElBQUksZUFBZSxDQUFDO1lBQ2pDLFFBQVEsRUFBRSxRQUFRLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRTtZQUN0QyxTQUFTLEVBQUUsUUFBUSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUU7WUFDeEMsUUFBUSxFQUFFLEtBQUs7WUFDZixhQUFhLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsZUFBZSxFQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFFLDJCQUEyQjtTQUMzRixDQUFDLENBQUM7UUFFSCxJQUFJLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNsQixNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDekMsQ0FBQztRQUVELDBCQUEwQjtRQUMxQixJQUFJLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQzlCLE1BQU0sVUFBVSxHQUFHO2dCQUNqQixhQUFhO2dCQUNiLGdCQUFnQjtnQkFDaEIsYUFBYTtnQkFDYixrQkFBa0I7Z0JBQ2xCLHFCQUFxQjtnQkFDckIsa0JBQWtCO2dCQUNsQix1QkFBdUI7Z0JBQ3ZCLG1CQUFtQjtnQkFDbkIsc0JBQXNCO2dCQUN0QixtQkFBbUI7Z0JBQ25CLHdCQUF3QjtnQkFDeEIsd0JBQXdCO2dCQUN4Qix5QkFBeUI7Z0JBQ3pCLHlCQUF5QjthQUMxQixDQUFDO1lBQ0YsTUFBTSxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ2hELENBQUM7UUFFRCx5QkFBeUI7UUFDekIsSUFBSSxNQUFNLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUM3QixNQUFNLFNBQVMsR0FBRztnQkFDaEIsaUJBQWlCO2dCQUNqQix5QkFBeUI7Z0JBQ3pCLGlCQUFpQjtnQkFDakIsc0JBQXNCO2dCQUN0Qiw4QkFBOEI7Z0JBQzlCLHNCQUFzQjtnQkFDdEIsMkJBQTJCO2dCQUMzQix1QkFBdUI7Z0JBQ3ZCLCtCQUErQjtnQkFDL0IsdUJBQXVCO2dCQUN2Qiw0QkFBNEI7YUFDN0IsQ0FBQztZQUNGLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLFNBQVMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUM5QyxDQUFDO1FBRUQsT0FBTyxHQUFHLE9BQU8sSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQztJQUMzQyxDQUFDLENBQUM7SUFFRixxQ0FBcUM7SUFDckMsTUFBTSxnQkFBZ0IsR0FBRyxLQUFLLEVBQzVCLFFBQWtCLEVBQ2xCLE1BQW9CLEVBQ3NCLEVBQUU7UUFDNUMsTUFBTSxHQUFHLEdBQUcsZUFBZSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUM5QyxHQUFHLENBQUMsS0FBSyxDQUFDLDBCQUEwQixHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBRTNDLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBQSxvQkFBSyxFQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2xDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sU0FBUyxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUN4QyxNQUFNLElBQUksS0FBSyxDQUFDLFFBQVEsUUFBUSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBQzNELENBQUM7WUFDRCxPQUFPLENBQUMsTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLENBQTZCLENBQUM7UUFDN0QsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixHQUFHLENBQUMsS0FBSyxDQUNQLGlDQUFpQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FDMUYsQ0FBQztZQUNGLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUMsQ0FBQztJQUVGLG9DQUFvQztJQUNwQyxNQUFNLGVBQWUsR0FBRyxLQUFLLEVBQzNCLFFBQWtCLEVBQ2xCLE1BQW9CLEVBQ3FCLEVBQUU7UUFDM0MsTUFBTSxHQUFHLEdBQUcsY0FBYyxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUM3QyxHQUFHLENBQUMsS0FBSyxDQUFDLDhCQUE4QixHQUFHLEVBQUUsQ0FBQyxDQUFDO1FBRS9DLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBQSxvQkFBSyxFQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ2xDLElBQUksQ0FBQyxRQUFRLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sU0FBUyxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUN4QyxNQUFNLElBQUksS0FBSyxDQUFDLFFBQVEsUUFBUSxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBQzNELENBQUM7WUFDRCxPQUFPLENBQUMsTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLENBQTRCLENBQUM7UUFDNUQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixHQUFHLENBQUMsS0FBSyxDQUNQLGdDQUFnQyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FDekYsQ0FBQztZQUNGLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUMsQ0FBQztJQUVGLHFFQUFxRTtJQUNyRSxNQUFNLGNBQWMsR0FBRyxDQUFDLFdBQW1CLEVBQVUsRUFBRTtRQUNyRCxPQUFPLGFBQWEsV0FBVyxNQUFNLENBQUM7SUFDeEMsQ0FBQyxDQUFDO0lBRUYseUVBQXlFO0lBQ3pFLE1BQU0sb0JBQW9CLEdBQUcsQ0FBQyxhQUFxQixFQUFPLEVBQUU7UUFDMUQsTUFBTSxXQUFXLEdBQXdCO1lBQ3ZDLHNEQUFzRDtZQUN0RCxjQUFjLEVBQUU7Z0JBQ2QsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLGFBQWE7Z0JBQzFCLFdBQVcsRUFBRSw4QkFBOEI7YUFDNUM7WUFDRCxTQUFTLEVBQUU7Z0JBQ1QsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLHdCQUF3QjtnQkFDckMsV0FBVyxFQUFFLG9EQUFvRDthQUNsRTtZQUNELFFBQVEsRUFBRTtnQkFDUixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsV0FBVztnQkFDeEIsV0FBVyxFQUFFLG9DQUFvQzthQUNsRDtZQUNELHFCQUFxQixFQUFFO2dCQUNyQixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUseUJBQXlCO2dCQUN0QyxXQUFXLEVBQUUseUJBQXlCO2FBQ3ZDO1lBQ0QsV0FBVyxFQUFFO2dCQUNYLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxrQkFBa0I7Z0JBQy9CLFdBQVcsRUFBRSx5QkFBeUI7YUFDdkM7WUFDRCxVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLGlCQUFpQjtnQkFDOUIsV0FBVyxFQUFFLHlCQUF5QjthQUN2QztZQUNELGFBQWEsRUFBRTtnQkFDYixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsaUJBQWlCO2dCQUM5QixXQUFXLEVBQUUsOEJBQThCO2FBQzVDO1lBQ0QsWUFBWSxFQUFFO2dCQUNaLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxnQkFBZ0I7Z0JBQzdCLFdBQVcsRUFBRSw4QkFBOEI7YUFDNUM7WUFFRCxxREFBcUQ7WUFDckQsT0FBTyxFQUFFO2dCQUNQLEtBQUssRUFBRSxLQUFLO2dCQUNaLFdBQVcsRUFBRSxZQUFZO2dCQUN6QixXQUFXLEVBQUUsMEJBQTBCO2FBQ3hDO1lBQ0QsUUFBUSxFQUFFO2dCQUNSLEtBQUssRUFBRSxLQUFLO2dCQUNaLFdBQVcsRUFBRSxZQUFZO2dCQUN6QixXQUFXLEVBQUUsK0JBQStCO2FBQzdDO1lBQ0QsYUFBYSxFQUFFO2dCQUNiLEtBQUssRUFBRSxLQUFLO2dCQUNaLFdBQVcsRUFBRSxnQkFBZ0I7Z0JBQzdCLFdBQVcsRUFBRSw4QkFBOEI7YUFDNUM7WUFDRCxVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFLEtBQUs7Z0JBQ1osV0FBVyxFQUFFLGdCQUFnQjtnQkFDN0IsV0FBVyxFQUFFLG9CQUFvQjthQUNsQztZQUNELFdBQVcsRUFBRTtnQkFDWCxLQUFLLEVBQUUsS0FBSztnQkFDWixXQUFXLEVBQUUsZ0JBQWdCO2dCQUM3QixXQUFXLEVBQUUseUJBQXlCO2FBQ3ZDO1lBQ0QscUJBQXFCLEVBQUU7Z0JBQ3JCLEtBQUssRUFBRSxLQUFLO2dCQUNaLFdBQVcsRUFBRSx5QkFBeUI7Z0JBQ3RDLFdBQVcsRUFBRSx5QkFBeUI7YUFDdkM7WUFFRCxtREFBbUQ7WUFDbkQsZ0JBQWdCLEVBQUU7Z0JBQ2hCLEtBQUssRUFBRSxJQUFJO2dCQUNYLFdBQVcsRUFBRSxvQkFBb0I7Z0JBQ2pDLFdBQVcsRUFBRSx3Q0FBd0M7YUFDdEQ7WUFDRCxlQUFlLEVBQUU7Z0JBQ2YsS0FBSyxFQUFFLElBQUk7Z0JBQ1gsV0FBVyxFQUFFLGtCQUFrQjtnQkFDL0IsV0FBVyxFQUFFLGlDQUFpQzthQUMvQztZQUVELDJDQUEyQztZQUMzQyxnQkFBZ0IsRUFBRTtnQkFDaEIsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsV0FBVyxFQUFFLG1CQUFtQjtnQkFDaEMsV0FBVyxFQUFFLHNDQUFzQzthQUNwRDtZQUVELDhDQUE4QztZQUM5QyxVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsV0FBVyxFQUFFLGFBQWE7Z0JBQzFCLFdBQVcsRUFBRSx5QkFBeUI7YUFDdkM7WUFDRCxhQUFhLEVBQUU7Z0JBQ2IsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsV0FBVyxFQUFFLGlCQUFpQjtnQkFDOUIsV0FBVyxFQUFFLGdDQUFnQzthQUM5QztZQUNELGFBQWEsRUFBRTtnQkFDYixLQUFLLEVBQUUsT0FBTztnQkFDZCxXQUFXLEVBQUUsaUJBQWlCO2dCQUM5QixXQUFXLEVBQUUsZ0NBQWdDO2FBQzlDO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLEtBQUssRUFBRSxPQUFPO2dCQUNkLFdBQVcsRUFBRSxrQkFBa0I7Z0JBQy9CLFdBQVcsRUFBRSxpQ0FBaUM7YUFDL0M7WUFFRCw2Q0FBNkM7WUFDN0MsTUFBTSxFQUFFO2dCQUNOLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxlQUFlO2dCQUM1QixXQUFXLEVBQUUsc0JBQXNCO2FBQ3BDO1lBQ0QsSUFBSSxFQUFFO2dCQUNKLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxNQUFNO2dCQUNuQixXQUFXLEVBQUUsYUFBYTthQUMzQjtZQUNELFFBQVEsRUFBRTtnQkFDUixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsVUFBVTtnQkFDdkIsV0FBVyxFQUFFLGlCQUFpQjthQUMvQjtZQUNELGlCQUFpQixFQUFFO2dCQUNqQixLQUFLLEVBQUUsT0FBTztnQkFDZCxXQUFXLEVBQUUsMkJBQTJCO2dCQUN4QyxXQUFXLEVBQUUsb0NBQW9DO2FBQ2xEO1lBQ0QsU0FBUyxFQUFFO2dCQUNULEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxtQkFBbUI7Z0JBQ2hDLFdBQVcsRUFBRSw0QkFBNEI7YUFDMUM7WUFDRCxvQkFBb0IsRUFBRTtnQkFDcEIsS0FBSyxFQUFFLE9BQU87Z0JBQ2QsV0FBVyxFQUFFLCtCQUErQjtnQkFDNUMsV0FBVyxFQUFFLDRDQUE0QzthQUMxRDtZQUVELDBDQUEwQztZQUMxQyxVQUFVLEVBQUU7Z0JBQ1YsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLFlBQVk7Z0JBQ3pCLFdBQVcsRUFBRSx1QkFBdUI7YUFDckM7WUFFRCw2Q0FBNkM7WUFDN0MscUJBQXFCLEVBQUU7Z0JBQ3JCLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxhQUFhO2dCQUMxQixXQUFXLEVBQUUseUJBQXlCO2FBQ3ZDO1lBQ0Qsd0JBQXdCLEVBQUU7Z0JBQ3hCLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxpQkFBaUI7Z0JBQzlCLFdBQVcsRUFBRSxpQ0FBaUM7YUFDL0M7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLGFBQWE7Z0JBQzFCLFdBQVcsRUFBRSxrQkFBa0I7YUFDaEM7WUFDRCxpQkFBaUIsRUFBRTtnQkFDakIsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLGlCQUFpQjtnQkFDOUIsV0FBVyxFQUFFLHFCQUFxQjthQUNuQztZQUNELGlCQUFpQixFQUFFO2dCQUNqQixLQUFLLEVBQUUsS0FBSztnQkFDWixXQUFXLEVBQUUsZ0JBQWdCO2dCQUM3QixXQUFXLEVBQUUscUJBQXFCO2FBQ25DO1lBQ0QseUJBQXlCLEVBQUU7Z0JBQ3pCLEtBQUssRUFBRSxLQUFLO2dCQUNaLFdBQVcsRUFBRSx5QkFBeUI7Z0JBQ3RDLFdBQVcsRUFBRSx5QkFBeUI7YUFDdkM7WUFDRCxjQUFjLEVBQUU7Z0JBQ2QsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLGtCQUFrQjtnQkFDL0IsV0FBVyxFQUFFLDRCQUE0QjthQUMxQztZQUNELGlCQUFpQixFQUFFO2dCQUNqQixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsc0JBQXNCO2dCQUNuQyxXQUFXLEVBQUUsb0NBQW9DO2FBQ2xEO1lBQ0QsY0FBYyxFQUFFO2dCQUNkLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxrQkFBa0I7Z0JBQy9CLFdBQVcsRUFBRSw0QkFBNEI7YUFDMUM7WUFDRCxpQkFBaUIsRUFBRTtnQkFDakIsS0FBSyxFQUFFLEtBQUs7Z0JBQ1osV0FBVyxFQUFFLHFCQUFxQjtnQkFDbEMsV0FBVyxFQUFFLCtCQUErQjthQUM3QztZQUNELHlCQUF5QixFQUFFO2dCQUN6QixLQUFLLEVBQUUsS0FBSztnQkFDWixXQUFXLEVBQUUsOEJBQThCO2dCQUMzQyxXQUFXLEVBQUUsd0NBQXdDO2FBQ3REO1lBQ0Qsa0JBQWtCLEVBQUU7Z0JBQ2xCLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSx1QkFBdUI7Z0JBQ3BDLFdBQVcsRUFBRSxxQ0FBcUM7YUFDbkQ7WUFDRCxzQkFBc0IsRUFBRTtnQkFDdEIsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLGNBQWM7Z0JBQzNCLFdBQVcsRUFBRSxtQkFBbUI7YUFDakM7WUFDRCx5QkFBeUIsRUFBRTtnQkFDekIsS0FBSyxFQUFFLEdBQUc7Z0JBQ1YsV0FBVyxFQUFFLGtCQUFrQjtnQkFDL0IsV0FBVyxFQUFFLDJCQUEyQjthQUN6QztZQUNELGVBQWUsRUFBRTtnQkFDZixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsY0FBYztnQkFDM0IsV0FBVyxFQUFFLG1CQUFtQjthQUNqQztZQUNELGtCQUFrQixFQUFFO2dCQUNsQixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsa0JBQWtCO2dCQUMvQixXQUFXLEVBQUUsMkJBQTJCO2FBQ3pDO1lBQ0Qsa0JBQWtCLEVBQUU7Z0JBQ2xCLEtBQUssRUFBRSxLQUFLO2dCQUNaLFdBQVcsRUFBRSxpQkFBaUI7Z0JBQzlCLFdBQVcsRUFBRSxzQkFBc0I7YUFDcEM7WUFDRCwwQkFBMEIsRUFBRTtnQkFDMUIsS0FBSyxFQUFFLEtBQUs7Z0JBQ1osV0FBVyxFQUFFLDBCQUEwQjtnQkFDdkMsV0FBVyxFQUFFLCtCQUErQjthQUM3QztZQUNELGVBQWUsRUFBRTtnQkFDZixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsbUJBQW1CO2dCQUNoQyxXQUFXLEVBQUUsNEJBQTRCO2FBQzFDO1lBRUQsaUJBQWlCO1lBQ2pCLGVBQWUsRUFBRTtnQkFDZixLQUFLLEVBQUUsS0FBSztnQkFDWixXQUFXLEVBQUUsZUFBZTtnQkFDNUIsV0FBVyxFQUFFLHdCQUF3QjthQUN0QztZQUNELGdCQUFnQixFQUFFO2dCQUNoQixLQUFLLEVBQUUsS0FBSztnQkFDWixXQUFXLEVBQUUsbUJBQW1CO2dCQUNoQyxXQUFXLEVBQUUseUJBQXlCO2FBQ3ZDO1lBRUQsa0JBQWtCO1lBQ2xCLGNBQWMsRUFBRTtnQkFDZCxLQUFLLEVBQUUsTUFBTTtnQkFDYixXQUFXLEVBQUUsaUJBQWlCO2dCQUM5QixXQUFXLEVBQUUsMkJBQTJCO2FBQ3pDO1lBQ0QsaUJBQWlCLEVBQUU7Z0JBQ2pCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFdBQVcsRUFBRSx1QkFBdUI7Z0JBQ3BDLFdBQVcsRUFBRSxpQ0FBaUM7YUFDL0M7WUFDRCxlQUFlLEVBQUU7Z0JBQ2YsS0FBSyxFQUFFLE1BQU07Z0JBQ2IsV0FBVyxFQUFFLGtCQUFrQjtnQkFDL0IsV0FBVyxFQUFFLHdCQUF3QjthQUN0QztZQUNELGdCQUFnQixFQUFFO2dCQUNoQixLQUFLLEVBQUUsTUFBTTtnQkFDYixXQUFXLEVBQUUsbUJBQW1CO2dCQUNoQyxXQUFXLEVBQUUseUJBQXlCO2FBQ3ZDO1lBQ0Qsc0JBQXNCLEVBQUU7Z0JBQ3RCLEtBQUssRUFBRSxNQUFNO2dCQUNiLFdBQVcsRUFBRSwwQkFBMEI7Z0JBQ3ZDLFdBQVcsRUFBRSxnQ0FBZ0M7YUFDOUM7WUFFRCxRQUFRO1lBQ1IsT0FBTyxFQUFFO2dCQUNQLFdBQVcsRUFBRSxVQUFVO2dCQUN2QixXQUFXLEVBQUUsVUFBVTthQUN4QjtZQUNELFVBQVUsRUFBRTtnQkFDVixXQUFXLEVBQUUsY0FBYztnQkFDM0IsV0FBVyxFQUFFLGtCQUFrQjthQUNoQztZQUNELFdBQVcsRUFBRTtnQkFDWCxXQUFXLEVBQUUsY0FBYztnQkFDM0IsV0FBVyxFQUFFLGlDQUFpQzthQUMvQztZQUNELFVBQVUsRUFBRTtnQkFDVixXQUFXLEVBQUUsYUFBYTtnQkFDMUIsV0FBVyxFQUFFLG9DQUFvQzthQUNsRDtZQUNELGdCQUFnQixFQUFFO2dCQUNoQixLQUFLLEVBQUUsR0FBRztnQkFDVixXQUFXLEVBQUUsbUJBQW1CO2dCQUNoQyxXQUFXLEVBQUUsc0JBQXNCO2FBQ3BDO1lBQ0QsZ0JBQWdCLEVBQUU7Z0JBQ2hCLEtBQUssRUFBRSxHQUFHO2dCQUNWLFdBQVcsRUFBRSxtQkFBbUI7Z0JBQ2hDLFdBQVcsRUFBRSxzQkFBc0I7YUFDcEM7WUFDRCxJQUFJLEVBQUU7Z0JBQ0osS0FBSyxFQUFFLE1BQU07Z0JBQ2IsV0FBVyxFQUFFLE1BQU07Z0JBQ25CLFdBQVcsRUFBRSx1Q0FBdUM7YUFDckQ7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsV0FBVyxFQUFFLFNBQVM7Z0JBQ3RCLFdBQVcsRUFBRSxjQUFjO2FBQzVCO1lBQ0QsTUFBTSxFQUFFO2dCQUNOLFdBQVcsRUFBRSxRQUFRO2dCQUNyQixXQUFXLEVBQUUsYUFBYTthQUMzQjtTQUNGLENBQUM7UUFFRixJQUFJLFdBQVcsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQy9CLE9BQU8sV0FBVyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ3BDLENBQUM7UUFFRCxrQ0FBa0M7UUFDbEMsSUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDO1FBQ2YsSUFBSSxXQUFXLEdBQUcsR0FBRyxhQUFhLHFCQUFxQixDQUFDO1FBRXhELElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDNUUsS0FBSyxHQUFHLEdBQUcsQ0FBQztZQUNaLFdBQVcsR0FBRyxzQkFBc0IsQ0FBQztRQUN2QyxDQUFDO2FBQU0sSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUMvRyxLQUFLLEdBQUcsS0FBSyxDQUFDO1lBQ2QsV0FBVyxHQUFHLHFCQUFxQixDQUFDO1FBQ3RDLENBQUM7YUFBTSxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO1lBQ3BGLEtBQUssR0FBRyxLQUFLLENBQUM7WUFDZCxXQUFXLEdBQUcsZ0JBQWdCLENBQUM7UUFDakMsQ0FBQzthQUFNLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7WUFDcEYsS0FBSyxHQUFHLElBQUksQ0FBQztZQUNiLFdBQVcsR0FBRyxtQkFBbUIsQ0FBQztRQUNwQyxDQUFDO2FBQU0sSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUNwRixLQUFLLEdBQUcsT0FBTyxDQUFDO1lBQ2hCLFdBQVcsR0FBRyx5QkFBeUIsQ0FBQztRQUMxQyxDQUFDO2FBQU0sSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1lBQ3RGLEtBQUssR0FBRyxHQUFHLENBQUM7WUFDWixXQUFXLEdBQUcsd0JBQXdCLENBQUM7UUFDekMsQ0FBQzthQUFNLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDcEYsS0FBSyxHQUFHLE9BQU8sQ0FBQztZQUNoQixXQUFXLEdBQUcsc0JBQXNCLENBQUM7UUFDdkMsQ0FBQzthQUFNLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDdEYsS0FBSyxHQUFHLEtBQUssQ0FBQztZQUNkLFdBQVcsR0FBRyxvQkFBb0IsQ0FBQztRQUNyQyxDQUFDO2FBQU0sSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQztZQUN4RixLQUFLLEdBQUcsR0FBRyxDQUFDO1lBQ1osV0FBVyxHQUFHLHFCQUFxQixDQUFDO1FBQ3RDLENBQUM7YUFBTSxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQ2hGLEtBQUssR0FBRyxHQUFHLENBQUM7WUFDWixXQUFXLEdBQUcsaUJBQWlCLENBQUM7UUFDbEMsQ0FBQzthQUFNLElBQUksYUFBYSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDaEYsS0FBSyxHQUFHLEdBQUcsQ0FBQztZQUNaLFdBQVcsR0FBRyxpQkFBaUIsQ0FBQztRQUNsQyxDQUFDO1FBRUQsT0FBTztZQUNMLEtBQUs7WUFDTCxXQUFXLEVBQUUsYUFBYTtZQUMxQixXQUFXO1NBQ1osQ0FBQztJQUNKLENBQUMsQ0FBQztJQUVGLGtDQUFrQztJQUNsQyxNQUFNLDRCQUE0QixHQUFHLENBQ25DLElBQThCLEVBQzlCLFFBQWdCLEVBQ08sRUFBRTtRQUN6QixNQUFNLFNBQVMsR0FBMEIsRUFBRSxDQUFDO1FBQzVDLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7UUFDM0IsSUFBSSxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJO1lBQUUsT0FBTyxTQUFTLENBQUM7UUFFOUMsTUFBTSxHQUFHLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUN2QixNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FDdEMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUcsQ0FDMUIsQ0FBQztRQUNGLElBQUksVUFBVSxLQUFLLENBQUMsQ0FBQztZQUFFLE9BQU8sU0FBUyxDQUFDO1FBRXhDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLFVBQVUsQ0FBQyxDQUFDO1FBRWxFLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUMvQixNQUFNLFNBQVMsR0FBRyxVQUFVLEdBQUcsQ0FBQyxDQUFDO1lBQ2pDLE1BQU0sUUFBUSxHQUF3QjtnQkFDcEMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO2dCQUNqQyxZQUFZLEVBQUUsQ0FBQzthQUNoQixDQUFDO1lBRUYscUVBQXFFO1lBQ3JFLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUUsRUFBRTtnQkFDakQsSUFBSSxLQUFLLEtBQUssTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUM7b0JBQUUsT0FBTztnQkFDdkQsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUNoQyxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksS0FBSyxLQUFLLElBQUk7b0JBQUUsT0FBTztnQkFFbEQsK0NBQStDO2dCQUMvQyxNQUFNLGVBQWUsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFFbEQseUJBQXlCO2dCQUN6QixJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksS0FBSyxLQUFLLGNBQWMsSUFBSSxLQUFLLEtBQUssc0JBQXNCLEVBQUUsQ0FBQztvQkFDbEcsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLGVBQWUsQ0FBQyxLQUFlLENBQUMsQ0FBQztnQkFDL0QsQ0FBQztxQkFBTSxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztvQkFDdkMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxLQUFlLENBQUMsQ0FBQztnQkFDeEQsQ0FBQztxQkFBTSxJQUFJLEtBQUssS0FBSyxlQUFlLElBQUksS0FBSyxLQUFLLE1BQU0sSUFBSSxLQUFLLEtBQUssU0FBUyxFQUFFLENBQUM7b0JBQ2hGLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBZSxDQUFDLENBQUM7Z0JBQ3JELENBQUM7cUJBQU0sSUFBSSxLQUFLLEtBQUssVUFBVSxFQUFFLENBQUM7b0JBQ2hDLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxLQUFLLENBQUMsS0FBZSxDQUFDLENBQUMsQ0FBQyxvQkFBb0I7Z0JBQzFFLENBQUM7cUJBQU0sSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7b0JBQ3RDLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxPQUFPLENBQUMsS0FBZSxDQUFDLENBQUM7Z0JBQ3ZELENBQUM7cUJBQU0sSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLElBQUksS0FBSyxLQUFLLDJCQUEyQixFQUFFLENBQUM7b0JBQ2hILFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxjQUFjLENBQUMsS0FBZSxDQUFDLENBQUM7Z0JBQzlELENBQUM7cUJBQU0sSUFBSSxLQUFLLEtBQUssWUFBWSxFQUFFLENBQUM7b0JBQ2xDLGtEQUFrRDtvQkFDbEQsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEtBQUssQ0FBQztnQkFDcEMsQ0FBQztxQkFBTSxDQUFDO29CQUNOLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxLQUFLLENBQUM7Z0JBQ3BDLENBQUM7WUFDSCxDQUFDLENBQUMsQ0FBQztZQUVILFNBQVMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDM0IsQ0FBQztRQUVELE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUMsQ0FBQztJQUVGLGlDQUFpQztJQUNqQyxNQUFNLDJCQUEyQixHQUFHLENBQ2xDLElBQThCLEVBQzlCLE9BQWUsRUFDUSxFQUFFO1FBQ3pCLE1BQU0sU0FBUyxHQUEwQixFQUFFLENBQUM7UUFDNUMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUN6QixJQUFJLENBQUMsS0FBSyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUk7WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUU1QyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRW5ELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUMvQixNQUFNLFFBQVEsR0FBd0I7Z0JBQ3BDLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztnQkFDbkIsUUFBUSxFQUFFLENBQUM7YUFDWixDQUFDO1lBRUYscUVBQXFFO1lBQ3JFLE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLEVBQUUsRUFBRTtnQkFDaEQsSUFBSSxLQUFLLEtBQUssTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUM7b0JBQUUsT0FBTztnQkFDdkQsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUN4QixJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksS0FBSyxLQUFLLElBQUk7b0JBQUUsT0FBTztnQkFFbEQsK0NBQStDO2dCQUMvQyxNQUFNLGVBQWUsR0FBRyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFFbEQseUJBQXlCO2dCQUN6QixJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztvQkFDbEMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLGVBQWUsQ0FBQyxLQUFlLENBQUMsQ0FBQztnQkFDL0QsQ0FBQztxQkFBTSxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztvQkFDdkMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxLQUFlLENBQUMsQ0FBQztnQkFDeEQsQ0FBQztxQkFBTSxJQUFJLEtBQUssS0FBSyxtQkFBbUIsSUFBSSxLQUFLLEtBQUssVUFBVSxJQUFJLEtBQUssS0FBSyxhQUFhLEVBQUUsQ0FBQztvQkFDNUYsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxLQUFlLENBQUMsQ0FBQztnQkFDckQsQ0FBQztxQkFBTSxJQUFJLEtBQUssS0FBSyxjQUFjLEVBQUUsQ0FBQztvQkFDcEMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxLQUFlLENBQUMsQ0FBQztnQkFDckQsQ0FBQztxQkFBTSxJQUFJLEtBQUssS0FBSywrQkFBK0IsRUFBRSxDQUFDO29CQUNyRCxRQUFRLENBQUMsZUFBZSxDQUFDLEdBQUcsY0FBYyxDQUFDLEtBQWUsQ0FBQyxDQUFDO2dCQUM5RCxDQUFDO3FCQUFNLENBQUM7b0JBQ04sUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEtBQUssQ0FBQztnQkFDcEMsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBRUgsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMzQixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQyxDQUFDO0lBRUYsaUNBQWlDO0lBQ2pDLE1BQU0sMkJBQTJCLEdBQUcsQ0FDbEMsSUFBNkIsRUFDN0IsUUFBZ0IsRUFDTyxFQUFFO1FBQ3pCLE1BQU0sU0FBUyxHQUEwQixFQUFFLENBQUM7UUFDNUMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLE1BQU0sQ0FBQztRQUMzQixJQUFJLENBQUMsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUk7WUFBRSxPQUFPLFNBQVMsQ0FBQztRQUU5QyxNQUFNLEdBQUcsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3ZCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUN0QyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUMxQixDQUFDO1FBQ0YsSUFBSSxVQUFVLEtBQUssQ0FBQyxDQUFDO1lBQUUsT0FBTyxTQUFTLENBQUM7UUFFeEMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsVUFBVSxDQUFDLENBQUM7UUFFbEUsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQy9CLE1BQU0sU0FBUyxHQUFHLFVBQVUsR0FBRyxDQUFDLENBQUM7WUFDakMsTUFBTSxRQUFRLEdBQXdCO2dCQUNwQyxTQUFTLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ2pDLFlBQVksRUFBRSxDQUFDO2FBQ2hCLENBQUM7WUFFRixxRUFBcUU7WUFDckUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsRUFBRSxFQUFFO2dCQUNqRCxJQUFJLEtBQUssS0FBSyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztvQkFBRSxPQUFPO2dCQUN2RCxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQ2hDLElBQUksS0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUssSUFBSTtvQkFBRSxPQUFPO2dCQUVsRCwrQ0FBK0M7Z0JBQy9DLE1BQU0sZUFBZSxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUVsRCx5QkFBeUI7Z0JBQ3pCLElBQUksS0FBSyxLQUFLLHlCQUF5QixFQUFFLENBQUM7b0JBQ3hDLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxlQUFlLENBQUMsS0FBZSxDQUFDLENBQUM7Z0JBQy9ELENBQUM7cUJBQU0sSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7b0JBQ3ZDLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxRQUFRLENBQUMsS0FBZSxDQUFDLENBQUM7Z0JBQ3hELENBQUM7cUJBQU0sSUFBSSxLQUFLLEtBQUssd0JBQXdCLEVBQUUsQ0FBQztvQkFDOUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxLQUFlLENBQUMsQ0FBQyxDQUFDLDhCQUE4QjtnQkFDdEYsQ0FBQztxQkFBTSxDQUFDO29CQUNOLHNEQUFzRDtvQkFDdEQsUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEtBQUssQ0FBQztnQkFDcEMsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBRUgsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMzQixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQyxDQUFDO0lBRUYsZ0NBQWdDO0lBQ2hDLE1BQU0sMEJBQTBCLEdBQUcsQ0FDakMsSUFBNkIsRUFDN0IsT0FBZSxFQUNRLEVBQUU7UUFDekIsTUFBTSxTQUFTLEdBQTBCLEVBQUUsQ0FBQztRQUM1QyxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBQ3pCLElBQUksQ0FBQyxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSTtZQUFFLE9BQU8sU0FBUyxDQUFDO1FBRTVDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFbkQsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQy9CLE1BQU0sUUFBUSxHQUF3QjtnQkFDcEMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO2dCQUNuQixRQUFRLEVBQUUsQ0FBQzthQUNaLENBQUM7WUFFRixxRUFBcUU7WUFDckUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsRUFBRSxFQUFFO2dCQUNoRCxJQUFJLEtBQUssS0FBSyxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztvQkFBRSxPQUFPO2dCQUN2RCxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3hCLElBQUksS0FBSyxLQUFLLFNBQVMsSUFBSSxLQUFLLEtBQUssSUFBSTtvQkFBRSxPQUFPO2dCQUVsRCwrQ0FBK0M7Z0JBQy9DLE1BQU0sZUFBZSxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUVsRCx5QkFBeUI7Z0JBQ3pCLElBQUksS0FBSyxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDO29CQUNoQyxRQUFRLENBQUMsZUFBZSxDQUFDLEdBQUcsUUFBUSxDQUFDLEtBQWUsQ0FBQyxDQUFDO2dCQUN4RCxDQUFDO3FCQUFNLENBQUM7b0JBQ04sUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLEtBQUssQ0FBQztnQkFDcEMsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBRUgsU0FBUyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUMzQixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQyxDQUFDO0lBRUYsNkZBQTZGO0lBQzdGLE1BQU0sb0JBQW9CLEdBQUcsQ0FDM0IsU0FBZ0MsRUFDaEMsV0FBbUIsRUFDYixFQUFFO1FBQ1IsTUFBTSxXQUFXLEdBQUcsY0FBYyxDQUFDLFVBQVUsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUM1RCxNQUFNLFNBQVMsR0FBbUMsRUFBRSxDQUFDO1FBQ3JELE1BQU0sT0FBTyxHQUFtQyxFQUFFLENBQUM7UUFFbkQsdURBQXVEO1FBQ3ZELFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxFQUFFLEVBQUU7WUFDcEMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxFQUFFO2dCQUNoRCxJQUFJLEdBQUcsS0FBSyxXQUFXLElBQUksR0FBRyxLQUFLLGNBQWM7b0JBQUUsT0FBTztnQkFDMUQsTUFBTSxJQUFJLEdBQUcsaURBQWlELEdBQUcsSUFBSSxLQUFLLEVBQUUsQ0FBQztnQkFDN0UsTUFBTSxRQUFRLEdBQUcsb0JBQW9CLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQzNDLFNBQVMsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztnQkFDaEMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztZQUMxQyxDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxTQUFTLENBQUMsTUFBTSxLQUFLLENBQUM7WUFBRSxPQUFPO1FBRW5DLHVDQUF1QztRQUN2QyxNQUFNLEtBQUssR0FBaUI7WUFDMUIsT0FBTyxFQUFFLGNBQWM7WUFDdkIsT0FBTyxFQUFFO2dCQUNQO29CQUNFLE9BQU8sRUFBRSxXQUFXO29CQUNwQixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7b0JBQ25DLE1BQU0sRUFBRSxTQUFTO29CQUNqQixJQUFJLEVBQUUsT0FBTztpQkFDZDthQUNGO1NBQ0YsQ0FBQztRQUVGLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNwQyxHQUFHLENBQUMsS0FBSyxDQUFDLGFBQWEsU0FBUyxDQUFDLE1BQU0sV0FBVyxXQUFXLGVBQWUsU0FBUyxDQUFDLE1BQU0sdUJBQXVCLENBQUMsQ0FBQztJQUN2SCxDQUFDLENBQUM7SUFFRiw0RkFBNEY7SUFDNUYsTUFBTSxtQkFBbUIsR0FBRyxDQUMxQixTQUFnQyxFQUNoQyxXQUFtQixFQUNiLEVBQUU7UUFDUixNQUFNLFdBQVcsR0FBRyxjQUFjLENBQUMsU0FBUyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQzNELE1BQU0sU0FBUyxHQUFtQyxFQUFFLENBQUM7UUFDckQsTUFBTSxPQUFPLEdBQW1DLEVBQUUsQ0FBQztRQUVuRCxzREFBc0Q7UUFDdEQsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUNwQyxNQUFNLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxFQUFFLEVBQUU7Z0JBQ2hELElBQUksR0FBRyxLQUFLLE1BQU0sSUFBSSxHQUFHLEtBQUssVUFBVTtvQkFBRSxPQUFPO2dCQUNqRCxNQUFNLElBQUksR0FBRyxnREFBZ0QsR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUM1RSxNQUFNLFFBQVEsR0FBRyxvQkFBb0IsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDM0MsU0FBUyxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO2dCQUNoQyxPQUFPLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDO1lBQzFDLENBQUMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQztZQUFFLE9BQU87UUFFbkMsdUNBQXVDO1FBQ3ZDLE1BQU0sS0FBSyxHQUFpQjtZQUMxQixPQUFPLEVBQUUsY0FBYztZQUN2QixPQUFPLEVBQUU7Z0JBQ1A7b0JBQ0UsT0FBTyxFQUFFLFdBQVc7b0JBQ3BCLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtvQkFDbkMsTUFBTSxFQUFFLFNBQVM7b0JBQ2pCLElBQUksRUFBRSxPQUFPO2lCQUNkO2FBQ0Y7U0FDRixDQUFDO1FBRUYsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3BDLEdBQUcsQ0FBQyxLQUFLLENBQUMsYUFBYSxTQUFTLENBQUMsTUFBTSxVQUFVLFdBQVcsZUFBZSxTQUFTLENBQUMsTUFBTSx1QkFBdUIsQ0FBQyxDQUFDO0lBQ3RILENBQUMsQ0FBQztJQUVGLDBGQUEwRjtJQUMxRixNQUFNLDRCQUE0QixHQUFHLEtBQUssRUFDeEMsTUFBb0IsRUFDTCxFQUFFOztRQUNqQixJQUNFLENBQUMsS0FBSyxDQUFDLGVBQWU7WUFDdEIsQ0FBQyxLQUFLLENBQUMsY0FBYztZQUNyQixDQUFDLEtBQUssQ0FBQyxVQUFVO1lBQ2pCLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLG9CQUFvQixDQUFDO1lBQzlELENBQUMsS0FBSyxDQUFDLHFCQUFxQixFQUM1QixDQUFDO1lBQ0QsR0FBRyxDQUFDLEtBQUssQ0FDUCxpSEFBaUgsQ0FDbEgsQ0FBQztZQUNGLE9BQU8sd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDMUMsQ0FBQztRQUVELEdBQUcsQ0FBQyxLQUFLLENBQ1Asb0JBQW9CLENBQUMsS0FBSyxDQUFDLFVBQVUsR0FBRyxRQUFRLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLHNCQUFzQixNQUFNLENBQUMsb0JBQW9CLG9CQUFvQixRQUFRLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUM5SyxDQUFDO1FBQ0YsR0FBRyxDQUFDLEtBQUssQ0FDUCw0Q0FBNEMsTUFBTSxDQUFDLGdCQUFnQixRQUFRLENBQzVFLENBQUM7UUFFRixzREFBc0Q7UUFDdEQsTUFBTSxlQUFlLEdBQUcsS0FBSyxDQUFDLGVBQWdCLENBQUM7UUFDL0MsTUFBTSxjQUFjLEdBQUcsS0FBSyxDQUFDLGNBQWUsQ0FBQztRQUM3QyxNQUFNLFVBQVUsR0FBRyxLQUFLLENBQUMsVUFBVyxDQUFDO1FBRXJDLE1BQU0sR0FBRyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7UUFDdkIsTUFBTSxXQUFXLEdBQUcsSUFBSSxJQUFJLENBQzFCLEdBQUcsQ0FBQyxXQUFXLEVBQUUsRUFDakIsR0FBRyxDQUFDLFFBQVEsRUFBRSxFQUNkLEdBQUcsQ0FBQyxPQUFPLEVBQUUsRUFDYixHQUFHLENBQUMsUUFBUSxFQUFFLEVBQ2QsQ0FBQyxFQUNELENBQUMsRUFDRCxDQUFDLENBQ0YsQ0FBQztRQUVGLHNEQUFzRDtRQUN0RCxNQUFNLGlCQUFpQixHQUFHLEtBQUssRUFBRSxJQUFZLEVBTW5DLEVBQUU7WUFDVixNQUFNLFlBQVksR0FBRyx1QkFBdUIsQ0FDMUMsZUFBZSxFQUNmLGNBQWMsRUFDZCxVQUFVLEVBQ1YsSUFBSSxDQUNMLENBQUM7WUFDRixNQUFNLFVBQVUsR0FBRyxJQUFJLElBQUksQ0FBQyxXQUFXLENBQUMsT0FBTyxFQUFFLEdBQUcsSUFBSSxHQUFHLE9BQU8sQ0FBQyxDQUFDO1lBRXBFLEdBQUcsQ0FBQyxLQUFLLENBQ1AsUUFBUSxJQUFJLG1DQUFtQyxZQUFZLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsS0FBSyxZQUFZLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUN4SCxDQUFDO1lBRUYsSUFBSSxDQUFDO2dCQUNILE1BQU0sV0FBVyxHQUFHLE1BQU0sZ0JBQWdCLENBQUMsWUFBWSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUNqRSxNQUFNLFVBQVUsR0FDZCxNQUFNLENBQUMsa0JBQWtCLElBQUksTUFBTSxDQUFDLGlCQUFpQjtvQkFDbkQsQ0FBQyxDQUFDLE1BQU0sZUFBZSxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUM7b0JBQzdDLENBQUMsQ0FBQyxJQUFJLENBQUM7Z0JBRVgsT0FBTyxFQUFFLElBQUksRUFBRSxZQUFZLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUUsQ0FBQztZQUNyRSxDQUFDO1lBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztnQkFDYixHQUFHLENBQUMsS0FBSyxDQUFDLFFBQVEsSUFBSSxvQkFBb0IsR0FBRyxFQUFFLENBQUMsQ0FBQztnQkFDakQsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1FBQ0gsQ0FBQyxDQUFDO1FBRUYsSUFBSSxDQUFDO1lBQ0gsOERBQThEO1lBQzlELE1BQU0sVUFBVSxHQUFHLENBQUMsQ0FBQztZQUNyQixNQUFNLGNBQWMsR0FBRyxHQUFHLENBQUM7WUFFM0IsTUFBTSxVQUFVLEdBTVgsRUFBRSxDQUFDO1lBRVIsR0FBRyxDQUFDLEtBQUssQ0FDUCxZQUFZLE1BQU0sQ0FBQyxnQkFBZ0IsbUNBQW1DLFVBQVUsRUFBRSxDQUNuRixDQUFDO1lBRUYsS0FDRSxJQUFJLFVBQVUsR0FBRyxDQUFDLEVBQ2xCLFVBQVUsR0FBRyxNQUFNLENBQUMsZ0JBQWdCLEVBQ3BDLFVBQVUsSUFBSSxVQUFVLEVBQ3hCLENBQUM7Z0JBQ0QsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FDdkIsVUFBVSxHQUFHLFVBQVUsRUFDdkIsTUFBTSxDQUFDLGdCQUFnQixDQUN4QixDQUFDO2dCQUNGLE1BQU0sVUFBVSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQzNCLEVBQUUsTUFBTSxFQUFFLFFBQVEsR0FBRyxVQUFVLEVBQUUsRUFDakMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxVQUFVLEdBQUcsQ0FBQyxDQUN6QixDQUFDO2dCQUVGLEdBQUcsQ0FBQyxLQUFLLENBQUMseUJBQXlCLFVBQVUsSUFBSSxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFFakUsTUFBTSxZQUFZLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUNwQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUNsRCxDQUFDO2dCQUVGLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTtvQkFDOUIsSUFBSSxNQUFNLEVBQUUsQ0FBQzt3QkFDWCxVQUFVLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUMxQixDQUFDO2dCQUNILENBQUMsQ0FBQyxDQUFDO2dCQUVILElBQUksUUFBUSxHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO29CQUN2QyxNQUFNLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3RFLENBQUM7WUFDSCxDQUFDO1lBRUQsK0NBQStDO1lBQy9DLElBQUksTUFBTSxDQUFDLG1CQUFtQixFQUFFLENBQUM7Z0JBQy9CLE1BQU0sc0JBQXNCLEdBQTBCLEVBQUUsQ0FBQztnQkFFekQsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sRUFBRSxFQUFFOztvQkFDNUIsSUFBSSxNQUFBLE1BQU0sQ0FBQyxXQUFXLDBDQUFFLE1BQU0sRUFBRSxDQUFDO3dCQUMvQixNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQzt3QkFDN0MsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUUsQ0FBQzt3QkFFaEQscUNBQXFDO3dCQUNyQyxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQzt3QkFDcEMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQzs0QkFDdEMsTUFBTSxZQUFZLEdBQUcsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7NEJBQ3hDLElBQ0UsWUFBWSxDQUFDLFdBQVcsRUFBRSxLQUFLLE1BQU0sQ0FBQyxVQUFVLENBQUMsV0FBVyxFQUFFO2dDQUM5RCxZQUFZLENBQUMsUUFBUSxFQUFFLEtBQUssTUFBTSxDQUFDLFVBQVUsQ0FBQyxRQUFRLEVBQUU7Z0NBQ3hELFlBQVksQ0FBQyxPQUFPLEVBQUUsS0FBSyxNQUFNLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRTtnQ0FDdEQsWUFBWSxDQUFDLFFBQVEsRUFBRSxLQUFLLFVBQVUsRUFDdEMsQ0FBQztnQ0FDRCxNQUFNLFFBQVEsR0FBd0I7b0NBQ3BDLFNBQVMsRUFBRSxZQUFZLENBQUMsV0FBVyxFQUFFO29DQUNyQyxpQkFBaUIsRUFBRSxNQUFNLENBQUMsWUFBWSxDQUFDLFFBQVE7b0NBQy9DLGtCQUFrQixFQUFFLE1BQU0sQ0FBQyxZQUFZLENBQUMsU0FBUztvQ0FDakQsWUFBWSxFQUFFLElBQUk7aUNBQ25CLENBQUM7Z0NBRUYsZ0RBQWdEO2dDQUNoRCxNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFO29DQUN0QyxJQUFJLEdBQUcsS0FBSyxNQUFNLEVBQUUsQ0FBQzt3Q0FDbkIsTUFBTSxNQUFNLEdBQUksVUFBa0MsQ0FBQyxHQUFHLENBQUMsQ0FBQzt3Q0FDeEQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7NENBQzFCLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7d0NBQzVCLENBQUM7b0NBQ0gsQ0FBQztnQ0FDSCxDQUFDLENBQUMsQ0FBQztnQ0FFSCxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7Z0NBQ3RDLE1BQU07NEJBQ1IsQ0FBQzt3QkFDSCxDQUFDO29CQUNILENBQUM7Z0JBQ0gsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsSUFBSSxzQkFBc0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3RDLG9CQUFvQixDQUFDLHNCQUFzQixFQUFFLFNBQVMsQ0FBQyxDQUFDO29CQUN4RCxHQUFHLENBQUMsS0FBSyxDQUNQLGFBQWEsc0JBQXNCLENBQUMsTUFBTSxzQ0FBc0MsQ0FDakYsQ0FBQztnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUVELDhDQUE4QztZQUM5QyxJQUFJLE1BQU0sQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO2dCQUM5QixNQUFNLHFCQUFxQixHQUEwQixFQUFFLENBQUM7Z0JBRXhELFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTs7b0JBQzVCLElBQUksTUFBQSxNQUFNLENBQUMsVUFBVSwwQ0FBRSxNQUFNLEVBQUUsQ0FBQzt3QkFDOUIsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7d0JBQzVDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLENBQUM7d0JBRWhELE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO3dCQUNwQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDOzRCQUN0QyxNQUFNLFlBQVksR0FBRyxJQUFJLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzs0QkFDeEMsSUFDRSxZQUFZLENBQUMsV0FBVyxFQUFFLEtBQUssTUFBTSxDQUFDLFVBQVUsQ0FBQyxXQUFXLEVBQUU7Z0NBQzlELFlBQVksQ0FBQyxRQUFRLEVBQUUsS0FBSyxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRTtnQ0FDeEQsWUFBWSxDQUFDLE9BQU8sRUFBRSxLQUFLLE1BQU0sQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFO2dDQUN0RCxZQUFZLENBQUMsUUFBUSxFQUFFLEtBQUssVUFBVSxFQUN0QyxDQUFDO2dDQUNELE1BQU0sUUFBUSxHQUF3QjtvQ0FDcEMsU0FBUyxFQUFFLFlBQVksQ0FBQyxXQUFXLEVBQUU7b0NBQ3JDLGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxZQUFZLENBQUMsUUFBUTtvQ0FDL0Msa0JBQWtCLEVBQUUsTUFBTSxDQUFDLFlBQVksQ0FBQyxTQUFTO29DQUNqRCxZQUFZLEVBQUUsSUFBSTtpQ0FDbkIsQ0FBQztnQ0FFRixNQUFNLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFO29DQUN0QyxJQUFJLEdBQUcsS0FBSyxNQUFNLEVBQUUsQ0FBQzt3Q0FDbkIsTUFBTSxNQUFNLEdBQUksVUFBa0MsQ0FBQyxHQUFHLENBQUMsQ0FBQzt3Q0FDeEQsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7NENBQzFCLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7d0NBQzVCLENBQUM7b0NBQ0gsQ0FBQztnQ0FDSCxDQUFDLENBQUMsQ0FBQztnQ0FFSCxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7Z0NBQ3JDLE1BQU07NEJBQ1IsQ0FBQzt3QkFDSCxDQUFDO29CQUNILENBQUM7Z0JBQ0gsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsSUFBSSxxQkFBcUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3JDLG9CQUFvQixDQUFDLHFCQUFxQixFQUFFLFFBQVEsQ0FBQyxDQUFDO29CQUN0RCxHQUFHLENBQUMsS0FBSyxDQUNQLGFBQWEscUJBQXFCLENBQUMsTUFBTSxxQ0FBcUMsQ0FDL0UsQ0FBQztnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUVELDZDQUE2QztZQUM3QyxJQUFJLE1BQU0sQ0FBQyxrQkFBa0IsS0FBSSxNQUFBLFVBQVUsQ0FBQyxDQUFDLENBQUMsMENBQUUsV0FBVyxDQUFBLEVBQUUsQ0FBQztnQkFDNUQsTUFBTSxZQUFZLEdBQUcsMkJBQTJCLENBQzlDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQ3pCLE1BQU0sQ0FBQyxlQUFlLENBQ3ZCLENBQUM7Z0JBQ0YsSUFBSSxZQUFZLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO29CQUM1QixtQkFBbUIsQ0FBQyxZQUFZLEVBQUUsU0FBUyxDQUFDLENBQUM7Z0JBQy9DLENBQUM7WUFDSCxDQUFDO1lBRUQsSUFBSSxNQUFNLENBQUMsaUJBQWlCLEtBQUksTUFBQSxVQUFVLENBQUMsQ0FBQyxDQUFDLDBDQUFFLFVBQVUsQ0FBQSxFQUFFLENBQUM7Z0JBQzFELE1BQU0sV0FBVyxHQUFHLDBCQUEwQixDQUM1QyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUN4QixNQUFNLENBQUMsZUFBZSxDQUN2QixDQUFDO2dCQUNGLElBQUksV0FBVyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDM0IsbUJBQW1CLENBQUMsV0FBVyxFQUFFLFFBQVEsQ0FBQyxDQUFDO2dCQUM3QyxDQUFDO1lBQ0gsQ0FBQztZQUVELEtBQUssQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDdEMsR0FBRyxDQUFDLGVBQWUsQ0FBQywwQ0FBMEMsQ0FBQyxDQUFDO1FBQ2xFLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsTUFBTSxRQUFRLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3hFLEdBQUcsQ0FBQyxLQUFLLENBQUMsZ0RBQWdELFFBQVEsRUFBRSxDQUFDLENBQUM7WUFDdEUsR0FBRyxDQUFDLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxDQUFDO1lBQ2pELE9BQU8sd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDMUMsQ0FBQztJQUNILENBQUMsQ0FBQztJQUVGLGtDQUFrQztJQUNsQyxNQUFNLHdCQUF3QixHQUFHLEtBQUssRUFBRSxNQUFvQixFQUFFLEVBQUU7UUFDOUQsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUMzQixHQUFHLENBQUMsS0FBSyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7WUFDNUQsT0FBTztRQUNULENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsZUFBZSxDQUFDO1FBRXZDLDRDQUE0QztRQUM1QyxNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsa0JBQWtCLElBQUksTUFBTSxDQUFDLGlCQUFpQixDQUFDO1FBQzFFLE1BQU0sQ0FBQyxXQUFXLEVBQUUsVUFBVSxDQUFDLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDO1lBQ2xELGdCQUFnQixDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUM7WUFDbEMsV0FBVyxDQUFDLENBQUMsQ0FBQyxlQUFlLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQztTQUN4RSxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsV0FBVyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEMsR0FBRyxDQUFDLEtBQUssQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDO1lBQy9DLE9BQU87UUFDVCxDQUFDO1FBRUQsMEVBQTBFO1FBQzFFLElBQUksTUFBTSxDQUFDLG1CQUFtQixJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQzlDLE1BQU0sYUFBYSxHQUFHLDRCQUE0QixDQUFDLFdBQVcsRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUN6RixJQUFJLGFBQWEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzdCLG9CQUFvQixDQUFDLGFBQWEsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUNqRCxDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksTUFBTSxDQUFDLGtCQUFrQixJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQzVDLE1BQU0sWUFBWSxHQUFHLDJCQUEyQixDQUFDLFVBQVUsRUFBRSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUN0RixJQUFJLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzVCLG9CQUFvQixDQUFDLFlBQVksRUFBRSxRQUFRLENBQUMsQ0FBQztZQUMvQyxDQUFDO1FBQ0gsQ0FBQztRQUVELHlFQUF5RTtRQUN6RSxJQUFJLE1BQU0sQ0FBQyxrQkFBa0IsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUM3QyxNQUFNLFlBQVksR0FBRywyQkFBMkIsQ0FBQyxXQUFXLEVBQUUsTUFBTSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQ3RGLElBQUksWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDNUIsbUJBQW1CLENBQUMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQy9DLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxNQUFNLENBQUMsaUJBQWlCLElBQUksVUFBVSxFQUFFLENBQUM7WUFDM0MsTUFBTSxXQUFXLEdBQUcsMEJBQTBCLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxlQUFlLENBQUMsQ0FBQztZQUNuRixJQUFJLFdBQVcsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzNCLG1CQUFtQixDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQztZQUM3QyxDQUFDO1FBQ0gsQ0FBQztRQUVELEtBQUssQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDdEMsR0FBRyxDQUFDLGVBQWUsQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDO0lBQ3BELENBQUMsQ0FBQztJQUVGLDBFQUEwRTtJQUMxRSxNQUFNLDJCQUEyQixHQUFHLENBQ2xDLFlBQWlCLEVBQ2pCLElBQXlCLEVBQ1osRUFBRTtRQUNmLE9BQU87WUFDTCxJQUFJLEVBQUUsWUFBWSxDQUFDLFNBQVMsSUFBSSxZQUFZLENBQUMsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQzdFLElBQUk7WUFDSixXQUFXLEVBQUUscUJBQXFCLENBQ2hDLFlBQVksQ0FBQyxXQUFXLEVBQ3hCLG9CQUFvQixDQUNyQjtZQUNELGVBQWUsRUFBRSx5QkFBeUIsQ0FDeEMsWUFBWSxDQUFDLFdBQVcsRUFDeEIsNkJBQTZCLENBQzlCO1lBQ0QsSUFBSSxFQUFFLGNBQWMsQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFLFlBQVksQ0FBQyxVQUFVLENBQUM7WUFDdkUsT0FBTyxFQUFFO2dCQUNQLFdBQVcsRUFBRSxZQUFZLENBQUMsY0FBYztnQkFDeEMsY0FBYyxFQUFFLFlBQVksQ0FBQyxXQUFXO2dCQUN4QyxjQUFjLEVBQUUsWUFBWSxDQUFDLFVBQVU7Z0JBQ3ZDLG9CQUFvQixFQUFFLFlBQVksQ0FBQyxTQUFTLElBQUksWUFBWSxDQUFDLGFBQWE7Z0JBQzFFLFFBQVEsRUFBRSxZQUFZLENBQUMsZ0JBQWdCO2dCQUN2QyxnQkFBZ0IsRUFBRSxZQUFZLENBQUMsZ0JBQWdCO2dCQUMvQyxPQUFPLEVBQUUsWUFBWSxDQUFDLE9BQU8sSUFBSSxZQUFZLENBQUMsVUFBVTtnQkFDeEQsVUFBVSxFQUFFLFlBQVksQ0FBQyxVQUFVO2dCQUNuQyxtQkFBbUIsRUFBRSxZQUFZLENBQUMsTUFBTSxJQUFJLFlBQVksQ0FBQyxTQUFTO2dCQUNsRSxtQkFBbUIsRUFBRSxZQUFZLENBQUMsUUFBUTtnQkFDMUMsb0JBQW9CLEVBQUUsWUFBWSxDQUFDLFVBQVU7Z0JBQzdDLHdCQUF3QixFQUFFLFlBQVksQ0FBQyxpQkFBaUIsSUFBSSxZQUFZLENBQUMsb0JBQW9CO2dCQUM3RixhQUFhLEVBQUUsWUFBWSxDQUFDLGFBQWE7Z0JBQ3pDLGFBQWEsRUFBRSxZQUFZLENBQUMsYUFBYTtnQkFDekMsY0FBYyxFQUFFLFlBQVksQ0FBQyxjQUFjO2dCQUMzQyxjQUFjLEVBQUUsWUFBWSxDQUFDLGNBQWMsSUFBSSxZQUFZLENBQUMsaUJBQWlCO2dCQUM3RSxzQkFBc0IsRUFBRSxZQUFZLENBQUMsc0JBQXNCO2dCQUMzRCwyQkFBMkIsRUFBRSxZQUFZLENBQUMsZ0JBQWdCO2FBQzNEO1lBQ0QsS0FBSyxFQUFFO2dCQUNMLFdBQVcsRUFBRSxZQUFZLENBQUMscUJBQXFCO2dCQUMvQyxxQkFBcUIsRUFBRSxZQUFZLENBQUMscUJBQXFCLElBQUksWUFBWSxDQUFDLHdCQUF3QjtnQkFDbEcsVUFBVSxFQUFFLFlBQVksQ0FBQyxjQUFjLElBQUksWUFBWSxDQUFDLGlCQUFpQjtnQkFDekUsYUFBYSxFQUFFLFlBQVksQ0FBQyxpQkFBaUIsSUFBSSxZQUFZLENBQUMseUJBQXlCO2dCQUN2RixjQUFjLEVBQUUsWUFBWSxDQUFDLGNBQWMsSUFBSSxZQUFZLENBQUMsaUJBQWlCO2dCQUM3RSxjQUFjLEVBQUUsWUFBWSxDQUFDLGNBQWMsSUFBSSxZQUFZLENBQUMsaUJBQWlCO2dCQUM3RSxpQkFBaUIsRUFBRSxZQUFZLENBQUMsaUJBQWlCLElBQUksWUFBWSxDQUFDLHlCQUF5QjtnQkFDM0YsV0FBVyxFQUFFLFlBQVksQ0FBQyxzQkFBc0IsSUFBSSxZQUFZLENBQUMseUJBQXlCO2dCQUMxRixXQUFXLEVBQUUsWUFBWSxDQUFDLGVBQWUsSUFBSSxZQUFZLENBQUMsa0JBQWtCO2dCQUM1RSxjQUFjLEVBQUUsWUFBWSxDQUFDLGtCQUFrQixJQUFJLFlBQVksQ0FBQywwQkFBMEI7Z0JBQzFGLG1CQUFtQixFQUFFLFlBQVksQ0FBQyxlQUFlO2dCQUNqRCx1QkFBdUIsRUFBRSxZQUFZLENBQUMsZ0JBQWdCO2dCQUN0RCxlQUFlLEVBQUUsWUFBWSxDQUFDLGVBQWUsSUFBSSxZQUFZLENBQUMsa0JBQWtCO2dCQUNoRixrQkFBa0IsRUFBRSxZQUFZLENBQUMsa0JBQWtCLElBQUksWUFBWSxDQUFDLHFCQUFxQjthQUMxRjtZQUNELElBQUksRUFBRTtnQkFDSixTQUFTLEVBQUUsWUFBWSxDQUFDLE9BQU8sSUFBSSxZQUFZLENBQUMsVUFBVTtnQkFDMUQsYUFBYSxFQUFFLFlBQVksQ0FBQyxhQUFhLElBQUksWUFBWSxDQUFDLHFCQUFxQjtnQkFDL0UsSUFBSSxFQUFFLFlBQVksQ0FBQyxRQUFRLElBQUksWUFBWSxDQUFDLFdBQVc7YUFDeEQ7WUFDRCxHQUFHLEVBQUU7Z0JBQ0gsT0FBTyxFQUFFLFlBQVksQ0FBQyxPQUFPO2dCQUM3QixNQUFNLEVBQUUsWUFBWSxDQUFDLE1BQU07Z0JBQzNCLGdCQUFnQixFQUFFLFlBQVksQ0FBQyxnQkFBZ0I7Z0JBQy9DLDJGQUEyRjtnQkFDM0YsVUFBVSxFQUFFLFlBQVksQ0FBQyxVQUFVLEtBQUssU0FBUztvQkFDL0MsQ0FBQyxDQUFDLFlBQVksQ0FBQyxVQUFVLEtBQUssQ0FBQyxJQUFJLFlBQVksQ0FBQyxVQUFVLEtBQUssSUFBSTtvQkFDbkUsQ0FBQyxDQUFDLFNBQVM7YUFDZDtTQUNGLENBQUM7SUFDSixDQUFDLENBQUM7SUFFRiw2RUFBNkU7SUFDN0UsTUFBTSxrQkFBa0IsR0FBRyxDQUFDLFFBQWdCLEVBQWlCLEVBQUU7UUFDN0QsTUFBTSxTQUFTLEdBQWtCLEVBQUUsQ0FBQztRQUVwQyxJQUFJLENBQUM7WUFDSCxvRUFBb0U7WUFDcEUsSUFBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO1lBQ3RCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxRQUFRLEdBQUcsRUFBRSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQ3ZDLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxXQUFXLENBQzFCLGdFQUFnRSxDQUFDLEVBQUUsQ0FDcEUsQ0FBQztnQkFDRixJQUFJLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUNyQyxhQUFhLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDeEIsQ0FBQztxQkFBTSxDQUFDO29CQUNOLE1BQU07Z0JBQ1IsQ0FBQztZQUNILENBQUM7WUFFRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxRQUFRLENBQUMsQ0FBQztZQUV0RCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQ3JDLE1BQU0sWUFBWSxHQUFRLEVBQUUsQ0FBQztnQkFDN0IscURBQXFEO2dCQUNyRCxNQUFNLE1BQU0sR0FBRztvQkFDYixnQkFBZ0I7b0JBQ2hCLGtCQUFrQjtvQkFDbEIsVUFBVTtvQkFDVixXQUFXO29CQUNYLG1CQUFtQjtvQkFDbkIsUUFBUTtvQkFDUixhQUFhO29CQUNiLGtCQUFrQjtvQkFDbEIsWUFBWTtvQkFDWixlQUFlO29CQUNmLGVBQWU7b0JBQ2YsZ0JBQWdCO29CQUNoQixZQUFZO29CQUNaLFNBQVM7b0JBQ1QsZUFBZTtvQkFDZixVQUFVO29CQUNWLFNBQVM7b0JBQ1QsWUFBWTtvQkFDWixrQkFBa0I7b0JBQ2xCLGdCQUFnQjtvQkFDaEIsaUJBQWlCO29CQUNqQixrQkFBa0I7b0JBQ2xCLHdCQUF3QjtvQkFDeEIsdUJBQXVCO29CQUN2QixtQkFBbUI7b0JBQ25CLGdCQUFnQjtvQkFDaEIsZ0JBQWdCO29CQUNoQixtQkFBbUI7b0JBQ25CLGdCQUFnQjtvQkFDaEIsd0JBQXdCO29CQUN4QixvQkFBb0I7b0JBQ3BCLGlCQUFpQjtvQkFDakIsaUJBQWlCO29CQUNqQixrQkFBa0I7b0JBQ2xCLHVCQUF1QjtpQkFDeEIsQ0FBQztnQkFFRixNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7b0JBQ3ZCLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxXQUFXLENBQzFCLGlEQUFpRCxLQUFLLElBQUksQ0FBQyxFQUFFLENBQzlELENBQUM7b0JBQ0YsSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQzt3QkFDckMsWUFBWSxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7b0JBQ25DLENBQUM7Z0JBQ0gsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDekMsTUFBTSxJQUFJLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztvQkFDeEIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7b0JBQ25DLFlBQVksQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO29CQUM1QyxTQUFTLENBQUMsSUFBSSxDQUFDLDJCQUEyQixDQUFDLFlBQVksRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDO2dCQUNyRSxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsR0FBRyxDQUFDLEtBQUssQ0FDUCxtQ0FBbUMsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQzVGLENBQUM7UUFDSixDQUFDO1FBRUQsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQyxDQUFDO0lBRUYsNEVBQTRFO0lBQzVFLE1BQU0saUJBQWlCLEdBQUcsQ0FBQyxRQUFnQixFQUFpQixFQUFFO1FBQzVELE1BQU0sU0FBUyxHQUFrQixFQUFFLENBQUM7UUFFcEMsSUFBSSxDQUFDO1lBQ0gsSUFBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO1lBQ3RCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxRQUFRLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQ3RDLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxXQUFXLENBQzFCLDREQUE0RCxDQUFDLEVBQUUsQ0FDaEUsQ0FBQztnQkFDRixJQUFJLElBQUksSUFBSSxJQUFJLENBQUMsS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUNyQyxhQUFhLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDeEIsQ0FBQztxQkFBTSxDQUFDO29CQUNOLE1BQU07Z0JBQ1IsQ0FBQztZQUNILENBQUM7WUFFRCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxRQUFRLENBQUMsQ0FBQztZQUV0RCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQ3JDLE1BQU0sWUFBWSxHQUFRLEVBQUUsQ0FBQztnQkFDN0IscURBQXFEO2dCQUNyRCxNQUFNLE1BQU0sR0FBRztvQkFDYixhQUFhO29CQUNiLGFBQWE7b0JBQ2IsWUFBWTtvQkFDWixlQUFlO29CQUNmLGNBQWM7b0JBQ2QsU0FBUztvQkFDVCxRQUFRO29CQUNSLGtCQUFrQjtvQkFDbEIsWUFBWTtvQkFDWixXQUFXO29CQUNYLHNCQUFzQjtvQkFDdEIsWUFBWTtvQkFDWixhQUFhO29CQUNiLHVCQUF1QjtvQkFDdkIsMEJBQTBCO29CQUMxQiwyQkFBMkI7b0JBQzNCLG1CQUFtQjtvQkFDbkIsMkJBQTJCO29CQUMzQiw0QkFBNEI7b0JBQzVCLG9CQUFvQjtpQkFDckIsQ0FBQztnQkFFRixNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUU7b0JBQ3ZCLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxXQUFXLENBQzFCLGdEQUFnRCxLQUFLLElBQUksQ0FBQyxFQUFFLENBQzdELENBQUM7b0JBQ0YsSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQzt3QkFDckMsWUFBWSxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUM7b0JBQ25DLENBQUM7Z0JBQ0gsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztvQkFDekMsTUFBTSxJQUFJLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztvQkFDeEIsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7b0JBQ2pDLFlBQVksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDckQsU0FBUyxDQUFDLElBQUksQ0FBQywyQkFBMkIsQ0FBQyxZQUFZLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDckUsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLEdBQUcsQ0FBQyxLQUFLLENBQ1Asa0NBQWtDLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUMzRixDQUFDO1FBQ0osQ0FBQztRQUVELE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUMsQ0FBQztJQUVGLHVCQUF1QjtJQUN2QixNQUFNLGVBQWUsR0FBb0I7UUFDdkMsSUFBSSxFQUFFLG9CQUFvQjtRQUMxQixPQUFPLEVBQUU7WUFDUCxRQUFRLEVBQUUsTUFBTSxDQUFDLEVBQUU7WUFDbkIsZUFBZSxFQUFFLEtBQUssRUFDcEIsUUFBa0IsRUFDbEIsT0FBMEIsRUFDRixFQUFFO2dCQUMxQiwyQ0FBMkM7Z0JBQzNDLE1BQU0sU0FBUyxHQUFHLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUN4QyxJQUFJLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7b0JBQ3pCLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEdBQUcsYUFBYSxDQUFDO2dCQUNwQyxDQUFDO2dCQUNELE9BQU8sU0FBUyxDQUFDO1lBQ25CLENBQUM7WUFDRCxZQUFZLEVBQUUsS0FBSyxFQUNqQixRQUFrQixFQUNsQixJQUF5QixFQUN6QixPQUEwQixFQUNGLEVBQUU7Z0JBQzFCLE1BQU0sUUFBUSxHQUFHLENBQUEsT0FBTyxhQUFQLE9BQU8sdUJBQVAsT0FBTyxDQUFFLFFBQVEsS0FBSSxDQUFDLElBQUksS0FBSyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBRWxFLElBQUksSUFBSSxLQUFLLE9BQU8sRUFBRSxDQUFDO29CQUNyQixPQUFPLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUNyQyxDQUFDO3FCQUFNLENBQUM7b0JBQ04sT0FBTyxrQkFBa0IsQ0FBQyxRQUFRLENBQUMsQ0FBQztnQkFDdEMsQ0FBQztZQUNILENBQUM7WUFDRCxXQUFXLEVBQUUsS0FBSyxFQUFFLFFBQWtCLEVBQTZCLEVBQUU7Z0JBQ25FLDhDQUE4QztnQkFDOUMsT0FBTyxFQUFFLENBQUM7WUFDWixDQUFDO1NBQ0Y7S0FDRixDQUFDO0lBRUYsOEJBQThCO0lBQzlCLE1BQU0seUJBQXlCLEdBQUcsQ0FBQyxNQUFvQixFQUFFLEVBQUU7UUFDekQsSUFBSSxDQUFDLE1BQU0sQ0FBQywwQkFBMEIsRUFBRSxDQUFDO1lBQ3ZDLEdBQUcsQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztZQUM1QyxPQUFPO1FBQ1QsQ0FBQztRQUVELEdBQUcsQ0FBQyxLQUFLLENBQUMsa0NBQWtDLENBQUMsQ0FBQztRQUU5QyxNQUFNLFlBQVksR0FBd0I7WUFDeEMsT0FBTyxFQUFFLGNBQWM7WUFDdkIsU0FBUyxFQUFFO2dCQUNULEVBQUUsSUFBSSxFQUFFLHFCQUFxQixFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUU7Z0JBQzlDLEVBQUUsSUFBSSxFQUFFLGlDQUFpQyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUU7Z0JBQzFELEVBQUUsSUFBSSxFQUFFLDRCQUE0QixFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUU7YUFDdEQ7U0FDRixDQUFDO1FBRUYsR0FBRyxDQUFDLG1CQUFtQixDQUFDLFNBQVMsQ0FDL0IsWUFBWSxFQUNaLEtBQUssQ0FBQyx1QkFBdUIsRUFDN0IsQ0FBQyxHQUFHLEVBQUUsRUFBRTtZQUNOLEdBQUcsQ0FBQyxLQUFLLENBQUMsa0NBQWtDLEdBQUcsRUFBRSxDQUFDLENBQUM7UUFDckQsQ0FBQyxFQUNELENBQUMsS0FBSyxFQUFFLEVBQUU7O1lBQ1IsTUFBQSxLQUFLLENBQUMsT0FBTywwQ0FBRSxPQUFPLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTs7Z0JBQ2hDLE1BQUEsTUFBTSxDQUFDLE1BQU0sMENBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7O29CQUMzQixJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUsscUJBQXFCLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO3dCQUNoRCxNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUMsS0FBZ0QsQ0FBQzt3QkFDL0QsSUFBSSxHQUFHLENBQUMsUUFBUSxJQUFJLEdBQUcsQ0FBQyxTQUFTLEVBQUUsQ0FBQzs0QkFDbEMsTUFBTSxXQUFXLEdBQWE7Z0NBQzVCLFFBQVEsRUFBRSxHQUFHLENBQUMsUUFBUTtnQ0FDdEIsU0FBUyxFQUFFLEdBQUcsQ0FBQyxTQUFTO2dDQUN4QixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUU7NkJBQ3RCLENBQUM7NEJBRUYsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLEVBQUUsQ0FBQztnQ0FDM0IsS0FBSyxDQUFDLGVBQWUsR0FBRyxXQUFXLENBQUM7Z0NBQ3BDLEdBQUcsQ0FBQyxLQUFLLENBQ1AscUJBQXFCLEdBQUcsQ0FBQyxRQUFRLEtBQUssR0FBRyxDQUFDLFNBQVMsRUFBRSxDQUN0RCxDQUFDO2dDQUNGLG9FQUFvRTtnQ0FDcEUsSUFBSSxLQUFLLENBQUMsYUFBYSxFQUFFLENBQUM7b0NBQ3hCLElBQ0UsS0FBSyxDQUFDLFVBQVU7d0NBQ2hCLGNBQWMsQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLEtBQUssQ0FBQyxhQUFhLENBQUMsb0JBQW9CLENBQUM7d0NBQzFFLEtBQUssQ0FBQyxxQkFBcUIsRUFDM0IsQ0FBQzt3Q0FDRCw0QkFBNEIsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUM7b0NBQ3BELENBQUM7eUNBQU0sQ0FBQzt3Q0FDTix3QkFBd0IsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUM7b0NBQ2hELENBQUM7Z0NBQ0gsQ0FBQzs0QkFDSCxDQUFDO2lDQUFNLENBQUM7Z0NBQ04sS0FBSyxDQUFDLGVBQWUsR0FBRyxXQUFXLENBQUM7NEJBQ3RDLENBQUM7d0JBQ0gsQ0FBQztvQkFDSCxDQUFDO3lCQUFNLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxpQ0FBaUMsSUFBSSxDQUFDLENBQUMsS0FBSyxLQUFLLElBQUksRUFBRSxDQUFDO3dCQUM1RSxLQUFLLENBQUMsY0FBYyxHQUFHLENBQUMsQ0FBQyxLQUFlLENBQUM7b0JBQzNDLENBQUM7eUJBQU0sSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLDRCQUE0QixJQUFJLENBQUMsQ0FBQyxLQUFLLEtBQUssSUFBSSxFQUFFLENBQUM7d0JBQ3ZFLEtBQUssQ0FBQyxVQUFVLEdBQUcsQ0FBQyxDQUFDLEtBQWUsQ0FBQzt3QkFFckMscUVBQXFFO3dCQUNyRSxJQUNFLENBQUEsTUFBQSxLQUFLLENBQUMsYUFBYSwwQ0FBRSx3QkFBd0I7NEJBQzdDLGNBQWMsQ0FDWixLQUFLLENBQUMsVUFBVSxFQUNoQixLQUFLLENBQUMsYUFBYSxDQUFDLG9CQUFvQixDQUN6Qzs0QkFDRCxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsRUFDNUIsQ0FBQzs0QkFDRCxLQUFLLENBQUMscUJBQXFCLEdBQUcsSUFBSSxDQUFDOzRCQUNuQyxHQUFHLENBQUMsS0FBSyxDQUNQLGlFQUFpRSxLQUFLLENBQUMsYUFBYSxDQUFDLG9CQUFvQixRQUFRLENBQ2xILENBQUM7d0JBQ0osQ0FBQztvQkFDSCxDQUFDO2dCQUNILENBQUMsQ0FBQyxDQUFDO1lBQ0wsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQ0YsQ0FBQztJQUNKLENBQUMsQ0FBQztJQUVGLGVBQWU7SUFDZixNQUFNLENBQUMsS0FBSyxHQUFHLENBQUMsT0FBOEIsRUFBRSxFQUFFO1FBQ2hELE1BQU0sTUFBTSxHQUFpQjtZQUMzQixNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU0sSUFBSSxFQUFFO1lBQzVCLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFO1lBQ2hELFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUSxJQUFJLENBQUM7WUFDL0IsMEJBQTBCLEVBQUUsT0FBTyxDQUFDLDBCQUEwQixLQUFLLEtBQUs7WUFDeEUsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLGdCQUFnQixJQUFJLEVBQUU7WUFDaEQsZUFBZSxFQUFFLE9BQU8sQ0FBQyxlQUFlLElBQUksQ0FBQztZQUM3QyxtQkFBbUIsRUFBRSxPQUFPLENBQUMsbUJBQW1CLEtBQUssS0FBSztZQUMxRCxrQkFBa0IsRUFBRSxPQUFPLENBQUMsa0JBQWtCLEtBQUssS0FBSztZQUN4RCxrQkFBa0IsRUFBRSxPQUFPLENBQUMsa0JBQWtCLEtBQUssS0FBSztZQUN4RCxpQkFBaUIsRUFBRSxPQUFPLENBQUMsaUJBQWlCLEtBQUssS0FBSztZQUN0RCx1QkFBdUIsRUFBRSxPQUFPLENBQUMsdUJBQXVCLEtBQUssS0FBSztZQUNsRSx3QkFBd0IsRUFBRSxPQUFPLENBQUMsd0JBQXdCLElBQUksS0FBSztZQUNuRSxvQkFBb0IsRUFBRSxPQUFPLENBQUMsb0JBQW9CLElBQUksR0FBRztTQUMxRCxDQUFDO1FBRUYsS0FBSyxDQUFDLGFBQWEsR0FBRyxNQUFNLENBQUM7UUFFN0IsR0FBRyxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDO1FBQ3hDLEdBQUcsQ0FBQyxlQUFlLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUV2QyxtQ0FBbUM7UUFDbkMsSUFBSSxDQUFDO1lBQ0gsR0FBRyxDQUFDLHVCQUF1QixDQUFDLGVBQWUsQ0FBQyxDQUFDO1lBQzdDLEdBQUcsQ0FBQyxLQUFLLENBQUMsaURBQWlELENBQUMsQ0FBQztRQUMvRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLEdBQUcsQ0FBQyxLQUFLLENBQ1AsNENBQTRDLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUNyRyxDQUFDO1FBQ0osQ0FBQztRQUVELDhCQUE4QjtRQUM5Qix5QkFBeUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUVsQyxrREFBa0Q7UUFDbEQsTUFBTSxlQUFlLEdBQUcsS0FBSyxJQUFJLEVBQUU7WUFDakMsSUFDRSxLQUFLLENBQUMsVUFBVTtnQkFDaEIsY0FBYyxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLG9CQUFvQixDQUFDO2dCQUM3RCxLQUFLLENBQUMscUJBQXFCLEVBQzNCLENBQUM7Z0JBQ0QsR0FBRyxDQUFDLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFDO2dCQUNuRSxNQUFNLDRCQUE0QixDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQzdDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixHQUFHLENBQUMsS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7Z0JBQzlELE1BQU0sd0JBQXdCLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDekMsQ0FBQztRQUNILENBQUMsQ0FBQztRQUVGLDBCQUEwQjtRQUMxQixNQUFNLFVBQVUsR0FBRyxNQUFNLENBQUMsZ0JBQWdCLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQztRQUN2RCxLQUFLLENBQUMsZ0JBQWdCLEdBQUcsV0FBVyxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQzlDLElBQUksS0FBSyxDQUFDLGVBQWUsSUFBSSxLQUFLLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQ25ELE1BQU0sZUFBZSxFQUFFLENBQUM7WUFDMUIsQ0FBQztRQUNILENBQUMsRUFBRSxVQUFVLENBQUMsQ0FBQztRQUVmLHlDQUF5QztRQUN6QyxVQUFVLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDcEIsSUFBSSxLQUFLLENBQUMsZUFBZSxFQUFFLENBQUM7Z0JBQzFCLE1BQU0sZUFBZSxFQUFFLENBQUM7WUFDMUIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLEdBQUcsQ0FBQyxLQUFLLENBQUMsOERBQThELENBQUMsQ0FBQztnQkFDMUUsR0FBRyxDQUFDLGVBQWUsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO1lBQ2pELENBQUM7UUFDSCxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDWCxDQUFDLENBQUM7SUFFRixjQUFjO0lBQ2QsTUFBTSxDQUFDLElBQUksR0FBRyxHQUFHLEVBQUU7UUFDakIsR0FBRyxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDO1FBRXhDLDBCQUEwQjtRQUMxQixJQUFJLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQzNCLGFBQWEsQ0FBQyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztZQUN0QyxLQUFLLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDO1FBQ2hDLENBQUM7UUFFRCw4QkFBOEI7UUFDOUIsS0FBSyxDQUFDLHVCQUF1QixDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO1lBQzlDLElBQUksQ0FBQztnQkFDSCxLQUFLLEVBQUUsQ0FBQztZQUNWLENBQUM7WUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO2dCQUNYLDRCQUE0QjtZQUM5QixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7UUFDSCxLQUFLLENBQUMsdUJBQXVCLEdBQUcsRUFBRSxDQUFDO1FBRW5DLGNBQWM7UUFDZCxLQUFLLENBQUMsZUFBZSxHQUFHLElBQUksQ0FBQztRQUM3QixLQUFLLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQztRQUM1QixLQUFLLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQztRQUN4QixLQUFLLENBQUMsa0JBQWtCLEdBQUcsQ0FBQyxDQUFDO1FBQzdCLEtBQUssQ0FBQyxxQkFBcUIsR0FBRyxLQUFLLENBQUM7UUFFcEMsR0FBRyxDQUFDLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNqQyxDQUFDLENBQUM7SUFFRixPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgZmV0Y2ggZnJvbSBcIm5vZGUtZmV0Y2hcIjtcbmltcG9ydCB7XG4gIFNpZ25hbEtBcHAsXG4gIFNpZ25hbEtQbHVnaW4sXG4gIFBsdWdpbkNvbmZpZyxcbiAgUGx1Z2luU3RhdGUsXG4gIFBvc2l0aW9uLFxuICBPcGVuTWV0ZW9XZWF0aGVyUmVzcG9uc2UsXG4gIE9wZW5NZXRlb01hcmluZVJlc3BvbnNlLFxuICBTaWduYWxLRGVsdGEsXG4gIFN1YnNjcmlwdGlvblJlcXVlc3QsXG4gIFdlYXRoZXJQcm92aWRlcixcbiAgV2VhdGhlckRhdGEsXG4gIFdlYXRoZXJXYXJuaW5nLFxuICBXZWF0aGVyUmVxUGFyYW1zLFxuICBXZWF0aGVyRm9yZWNhc3RUeXBlLFxufSBmcm9tIFwiLi90eXBlc1wiO1xuXG5leHBvcnQgPSBmdW5jdGlvbiAoYXBwOiBTaWduYWxLQXBwKTogU2lnbmFsS1BsdWdpbiB7XG4gIGNvbnN0IHBsdWdpbjogU2lnbmFsS1BsdWdpbiA9IHtcbiAgICBpZDogXCJzaWduYWxrLW9wZW4tbWV0ZW9cIixcbiAgICBuYW1lOiBcIlNpZ25hbEsgT3Blbi1NZXRlbyBXZWF0aGVyXCIsXG4gICAgZGVzY3JpcHRpb246IFwiUG9zaXRpb24tYmFzZWQgd2VhdGhlciBhbmQgbWFyaW5lIGZvcmVjYXN0IGRhdGEgZnJvbSBPcGVuLU1ldGVvIEFQSVwiLFxuICAgIHNjaGVtYToge30sXG4gICAgc3RhcnQ6ICgpID0+IHt9LFxuICAgIHN0b3A6ICgpID0+IHt9LFxuICB9O1xuXG4gIGNvbnN0IHN0YXRlOiBQbHVnaW5TdGF0ZSA9IHtcbiAgICBmb3JlY2FzdEludGVydmFsOiBudWxsLFxuICAgIG5hdmlnYXRpb25TdWJzY3JpcHRpb25zOiBbXSxcbiAgICBjdXJyZW50Q29uZmlnOiB1bmRlZmluZWQsXG4gICAgY3VycmVudFBvc2l0aW9uOiBudWxsLFxuICAgIGN1cnJlbnRIZWFkaW5nOiBudWxsLFxuICAgIGN1cnJlbnRTT0c6IG51bGwsXG4gICAgbGFzdEZvcmVjYXN0VXBkYXRlOiAwLFxuICAgIGZvcmVjYXN0RW5hYmxlZDogdHJ1ZSxcbiAgICBtb3ZpbmdGb3JlY2FzdEVuZ2FnZWQ6IGZhbHNlLFxuICB9O1xuXG4gIC8vIFdNTyBXZWF0aGVyIGludGVycHJldGF0aW9uIGNvZGVzICh1c2VkIGJ5IE9wZW4tTWV0ZW8pXG4gIC8vIGh0dHBzOi8vb3Blbi1tZXRlby5jb20vZW4vZG9jcyN3ZWF0aGVydmFyaWFibGVzXG4gIGNvbnN0IHdtb0NvZGVEZXNjcmlwdGlvbnM6IFJlY29yZDxudW1iZXIsIHN0cmluZz4gPSB7XG4gICAgMDogXCJDbGVhclwiLFxuICAgIDE6IFwiTW9zdGx5IENsZWFyXCIsXG4gICAgMjogXCJQYXJ0bHkgQ2xvdWR5XCIsXG4gICAgMzogXCJPdmVyY2FzdFwiLFxuICAgIDQ1OiBcIkZvZ1wiLFxuICAgIDQ4OiBcIkRlcG9zaXRpbmcgUmltZSBGb2dcIixcbiAgICA1MTogXCJMaWdodCBEcml6emxlXCIsXG4gICAgNTM6IFwiTW9kZXJhdGUgRHJpenpsZVwiLFxuICAgIDU1OiBcIkRlbnNlIERyaXp6bGVcIixcbiAgICA1NjogXCJMaWdodCBGcmVlemluZyBEcml6emxlXCIsXG4gICAgNTc6IFwiRGVuc2UgRnJlZXppbmcgRHJpenpsZVwiLFxuICAgIDYxOiBcIlNsaWdodCBSYWluXCIsXG4gICAgNjM6IFwiTW9kZXJhdGUgUmFpblwiLFxuICAgIDY1OiBcIkhlYXZ5IFJhaW5cIixcbiAgICA2NjogXCJMaWdodCBGcmVlemluZyBSYWluXCIsXG4gICAgNjc6IFwiSGVhdnkgRnJlZXppbmcgUmFpblwiLFxuICAgIDcxOiBcIlNsaWdodCBTbm93XCIsXG4gICAgNzM6IFwiTW9kZXJhdGUgU25vd1wiLFxuICAgIDc1OiBcIkhlYXZ5IFNub3dcIixcbiAgICA3NzogXCJTbm93IEdyYWluc1wiLFxuICAgIDgwOiBcIlNsaWdodCBSYWluIFNob3dlcnNcIixcbiAgICA4MTogXCJNb2RlcmF0ZSBSYWluIFNob3dlcnNcIixcbiAgICA4MjogXCJWaW9sZW50IFJhaW4gU2hvd2Vyc1wiLFxuICAgIDg1OiBcIlNsaWdodCBTbm93IFNob3dlcnNcIixcbiAgICA4NjogXCJIZWF2eSBTbm93IFNob3dlcnNcIixcbiAgICA5NTogXCJUaHVuZGVyc3Rvcm1cIixcbiAgICA5NjogXCJUaHVuZGVyc3Rvcm0gd2l0aCBTbGlnaHQgSGFpbFwiLFxuICAgIDk5OiBcIlRodW5kZXJzdG9ybSB3aXRoIEhlYXZ5IEhhaWxcIixcbiAgfTtcblxuICBjb25zdCB3bW9Db2RlTG9uZ0Rlc2NyaXB0aW9uczogUmVjb3JkPG51bWJlciwgc3RyaW5nPiA9IHtcbiAgICAwOiBcIkNsZWFyIHNreSB3aXRoIG5vIGNsb3VkIGNvdmVyXCIsXG4gICAgMTogXCJNYWlubHkgY2xlYXIgd2l0aCBtaW5pbWFsIGNsb3VkIGNvdmVyXCIsXG4gICAgMjogXCJQYXJ0bHkgY2xvdWR5IHdpdGggc2NhdHRlcmVkIGNsb3Vkc1wiLFxuICAgIDM6IFwiT3ZlcmNhc3Qgd2l0aCBjb21wbGV0ZSBjbG91ZCBjb3ZlclwiLFxuICAgIDQ1OiBcIkZvZyByZWR1Y2luZyB2aXNpYmlsaXR5XCIsXG4gICAgNDg6IFwiRGVwb3NpdGluZyByaW1lIGZvZyB3aXRoIGljZSBmb3JtYXRpb25cIixcbiAgICA1MTogXCJMaWdodCBkcml6emxlIHdpdGggZmluZSBwcmVjaXBpdGF0aW9uXCIsXG4gICAgNTM6IFwiTW9kZXJhdGUgZHJpenpsZSB3aXRoIHN0ZWFkeSBsaWdodCByYWluXCIsXG4gICAgNTU6IFwiRGVuc2UgZHJpenpsZSB3aXRoIGNvbnRpbnVvdXMgbGlnaHQgcmFpblwiLFxuICAgIDU2OiBcIkxpZ2h0IGZyZWV6aW5nIGRyaXp6bGUsIGljZSBwb3NzaWJsZVwiLFxuICAgIDU3OiBcIkRlbnNlIGZyZWV6aW5nIGRyaXp6bGUsIGhhemFyZG91cyBjb25kaXRpb25zXCIsXG4gICAgNjE6IFwiU2xpZ2h0IHJhaW4gd2l0aCBsaWdodCBwcmVjaXBpdGF0aW9uXCIsXG4gICAgNjM6IFwiTW9kZXJhdGUgcmFpbiB3aXRoIHN0ZWFkeSBwcmVjaXBpdGF0aW9uXCIsXG4gICAgNjU6IFwiSGVhdnkgcmFpbiB3aXRoIGludGVuc2UgcHJlY2lwaXRhdGlvblwiLFxuICAgIDY2OiBcIkxpZ2h0IGZyZWV6aW5nIHJhaW4sIGljZSBhY2N1bXVsYXRpb24gcG9zc2libGVcIixcbiAgICA2NzogXCJIZWF2eSBmcmVlemluZyByYWluLCBoYXphcmRvdXMgaWNlIGNvbmRpdGlvbnNcIixcbiAgICA3MTogXCJTbGlnaHQgc25vd2ZhbGwgd2l0aCBsaWdodCBhY2N1bXVsYXRpb25cIixcbiAgICA3MzogXCJNb2RlcmF0ZSBzbm93ZmFsbCB3aXRoIHN0ZWFkeSBhY2N1bXVsYXRpb25cIixcbiAgICA3NTogXCJIZWF2eSBzbm93ZmFsbCB3aXRoIHNpZ25pZmljYW50IGFjY3VtdWxhdGlvblwiLFxuICAgIDc3OiBcIlNub3cgZ3JhaW5zLCBmaW5lIGljZSBwYXJ0aWNsZXMgZmFsbGluZ1wiLFxuICAgIDgwOiBcIlNsaWdodCByYWluIHNob3dlcnMsIGJyaWVmIGxpZ2h0IHJhaW5cIixcbiAgICA4MTogXCJNb2RlcmF0ZSByYWluIHNob3dlcnMsIGludGVybWl0dGVudCByYWluXCIsXG4gICAgODI6IFwiVmlvbGVudCByYWluIHNob3dlcnMsIGludGVuc2UgZG93bnBvdXJzXCIsXG4gICAgODU6IFwiU2xpZ2h0IHNub3cgc2hvd2VycywgYnJpZWYgbGlnaHQgc25vd1wiLFxuICAgIDg2OiBcIkhlYXZ5IHNub3cgc2hvd2VycywgaW50ZW5zZSBzbm93ZmFsbFwiLFxuICAgIDk1OiBcIlRodW5kZXJzdG9ybSB3aXRoIGxpZ2h0bmluZyBhbmQgdGh1bmRlclwiLFxuICAgIDk2OiBcIlRodW5kZXJzdG9ybSB3aXRoIHNsaWdodCBoYWlsXCIsXG4gICAgOTk6IFwiVGh1bmRlcnN0b3JtIHdpdGggaGVhdnkgaGFpbCwgZGFuZ2Vyb3VzIGNvbmRpdGlvbnNcIixcbiAgfTtcblxuICAvLyBHZXQgaWNvbiBuYW1lIGZyb20gV01PIGNvZGVcbiAgLy8gaXNEYXk6IHRydWUvMSA9IGRheSwgZmFsc2UvMCA9IG5pZ2h0LCB1bmRlZmluZWQgPSBkZWZhdWx0IHRvIGRheSAoZm9yIGRhaWx5IGZvcmVjYXN0cylcbiAgY29uc3QgZ2V0V2VhdGhlckljb24gPSAoXG4gICAgd21vQ29kZTogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICAgIGlzRGF5OiBib29sZWFuIHwgbnVtYmVyIHwgdW5kZWZpbmVkLFxuICApOiBzdHJpbmcgfCB1bmRlZmluZWQgPT4ge1xuICAgIGlmICh3bW9Db2RlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgLy8gRGVmYXVsdCB0byBkYXkgaWYgaXNEYXkgaXMgdW5kZWZpbmVkIChlLmcuLCBkYWlseSBmb3JlY2FzdHMgZG9uJ3QgaGF2ZSBpc19kYXkgZmllbGQpXG4gICAgY29uc3QgZGF5TmlnaHQgPSBpc0RheSA9PT0gZmFsc2UgfHwgaXNEYXkgPT09IDAgPyBcIm5pZ2h0XCIgOiBcImRheVwiO1xuICAgIHJldHVybiBgd21vXyR7d21vQ29kZX1fJHtkYXlOaWdodH0uc3ZnYDtcbiAgfTtcblxuICBjb25zdCBnZXRXZWF0aGVyRGVzY3JpcHRpb24gPSAoXG4gICAgd21vQ29kZTogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICAgIGZhbGxiYWNrOiBzdHJpbmcsXG4gICk6IHN0cmluZyA9PiB7XG4gICAgaWYgKHdtb0NvZGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbGxiYWNrO1xuICAgIHJldHVybiB3bW9Db2RlRGVzY3JpcHRpb25zW3dtb0NvZGVdIHx8IGZhbGxiYWNrO1xuICB9O1xuXG4gIGNvbnN0IGdldFdlYXRoZXJMb25nRGVzY3JpcHRpb24gPSAoXG4gICAgd21vQ29kZTogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICAgIGZhbGxiYWNrOiBzdHJpbmcsXG4gICk6IHN0cmluZyA9PiB7XG4gICAgaWYgKHdtb0NvZGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbGxiYWNrO1xuICAgIHJldHVybiB3bW9Db2RlTG9uZ0Rlc2NyaXB0aW9uc1t3bW9Db2RlXSB8fCBmYWxsYmFjaztcbiAgfTtcblxuICAvLyBDb25maWd1cmF0aW9uIHNjaGVtYVxuICBwbHVnaW4uc2NoZW1hID0ge1xuICAgIHR5cGU6IFwib2JqZWN0XCIsXG4gICAgcmVxdWlyZWQ6IFtdLFxuICAgIHByb3BlcnRpZXM6IHtcbiAgICAgIGFwaUtleToge1xuICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICB0aXRsZTogXCJBUEkgS2V5IChPcHRpb25hbClcIixcbiAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgXCJPcGVuLU1ldGVvIEFQSSBrZXkgZm9yIGNvbW1lcmNpYWwgdXNlLiBMZWF2ZSBlbXB0eSBmb3IgZnJlZSBub24tY29tbWVyY2lhbCB1c2UuXCIsXG4gICAgICB9LFxuICAgICAgZm9yZWNhc3RJbnRlcnZhbDoge1xuICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICB0aXRsZTogXCJGb3JlY2FzdCBVcGRhdGUgSW50ZXJ2YWwgKG1pbnV0ZXMpXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkhvdyBvZnRlbiB0byBmZXRjaCBuZXcgZm9yZWNhc3QgZGF0YVwiLFxuICAgICAgICBkZWZhdWx0OiA2MCxcbiAgICAgICAgbWluaW11bTogMTUsXG4gICAgICAgIG1heGltdW06IDE0NDAsXG4gICAgICB9LFxuICAgICAgYWx0aXR1ZGU6IHtcbiAgICAgICAgdHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgdGl0bGU6IFwiRGVmYXVsdCBBbHRpdHVkZSAobWV0ZXJzKVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEZWZhdWx0IGFsdGl0dWRlIGZvciBlbGV2YXRpb24gY29ycmVjdGlvblwiLFxuICAgICAgICBkZWZhdWx0OiAyLFxuICAgICAgICBtaW5pbXVtOiAwLFxuICAgICAgICBtYXhpbXVtOiAxMDAwMCxcbiAgICAgIH0sXG4gICAgICBlbmFibGVQb3NpdGlvblN1YnNjcmlwdGlvbjoge1xuICAgICAgICB0eXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgdGl0bGU6IFwiRW5hYmxlIFBvc2l0aW9uIFN1YnNjcmlwdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgICBcIlN1YnNjcmliZSB0byBuYXZpZ2F0aW9uLnBvc2l0aW9uIHVwZGF0ZXMgZm9yIGF1dG9tYXRpYyBmb3JlY2FzdCB1cGRhdGVzXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgbWF4Rm9yZWNhc3RIb3Vyczoge1xuICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICB0aXRsZTogXCJNYXggRm9yZWNhc3QgSG91cnNcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBudW1iZXIgb2YgaG91cmx5IGZvcmVjYXN0cyB0byByZXRyaWV2ZSAoMS0zODQpXCIsXG4gICAgICAgIGRlZmF1bHQ6IDcyLFxuICAgICAgICBtaW5pbXVtOiAxLFxuICAgICAgICBtYXhpbXVtOiAzODQsXG4gICAgICB9LFxuICAgICAgbWF4Rm9yZWNhc3REYXlzOiB7XG4gICAgICAgIHR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgIHRpdGxlOiBcIk1heCBGb3JlY2FzdCBEYXlzXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gbnVtYmVyIG9mIGRhaWx5IGZvcmVjYXN0cyB0byByZXRyaWV2ZSAoMS0xNilcIixcbiAgICAgICAgZGVmYXVsdDogNyxcbiAgICAgICAgbWluaW11bTogMSxcbiAgICAgICAgbWF4aW11bTogMTYsXG4gICAgICB9LFxuICAgICAgZW5hYmxlSG91cmx5V2VhdGhlcjoge1xuICAgICAgICB0eXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgdGl0bGU6IFwiRW5hYmxlIEhvdXJseSBXZWF0aGVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoIGhvdXJseSB3ZWF0aGVyIGZvcmVjYXN0c1wiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZURhaWx5V2VhdGhlcjoge1xuICAgICAgICB0eXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgdGl0bGU6IFwiRW5hYmxlIERhaWx5IFdlYXRoZXJcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRmV0Y2ggZGFpbHkgd2VhdGhlciBmb3JlY2FzdHNcIixcbiAgICAgICAgZGVmYXVsdDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBlbmFibGVNYXJpbmVIb3VybHk6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBNYXJpbmUgSG91cmx5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoIGhvdXJseSBtYXJpbmUgZm9yZWNhc3RzICh3YXZlcywgY3VycmVudHMsIHNlYSB0ZW1wZXJhdHVyZSlcIixcbiAgICAgICAgZGVmYXVsdDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBlbmFibGVNYXJpbmVEYWlseToge1xuICAgICAgICB0eXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgdGl0bGU6IFwiRW5hYmxlIE1hcmluZSBEYWlseVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJGZXRjaCBkYWlseSBtYXJpbmUgZm9yZWNhc3RzXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlQ3VycmVudENvbmRpdGlvbnM6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBDdXJyZW50IENvbmRpdGlvbnNcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRmV0Y2ggY3VycmVudCB3ZWF0aGVyIGNvbmRpdGlvbnNcIixcbiAgICAgICAgZGVmYXVsdDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBlbmFibGVBdXRvTW92aW5nRm9yZWNhc3Q6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBBdXRvIE1vdmluZyBGb3JlY2FzdFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgICBcIkF1dG9tYXRpY2FsbHkgZW5nYWdlIG1vdmluZyBmb3JlY2FzdCBtb2RlIHdoZW4gdmVzc2VsIHNwZWVkIGV4Y2VlZHMgdGhyZXNob2xkXCIsXG4gICAgICAgIGRlZmF1bHQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIG1vdmluZ1NwZWVkVGhyZXNob2xkOiB7XG4gICAgICAgIHR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgIHRpdGxlOiBcIk1vdmluZyBTcGVlZCBUaHJlc2hvbGQgKGtub3RzKVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgICBcIk1pbmltdW0gc3BlZWQgaW4ga25vdHMgdG8gYXV0b21hdGljYWxseSBlbmdhZ2UgbW92aW5nIGZvcmVjYXN0IG1vZGVcIixcbiAgICAgICAgZGVmYXVsdDogMS4wLFxuICAgICAgICBtaW5pbXVtOiAwLjEsXG4gICAgICAgIG1heGltdW06IDEwLjAsXG4gICAgICB9LFxuICAgIH0sXG4gIH07XG5cbiAgLy8gVXRpbGl0eSBmdW5jdGlvbnNcbiAgY29uc3QgZGVnVG9SYWQgPSAoZGVncmVlczogbnVtYmVyKTogbnVtYmVyID0+IGRlZ3JlZXMgKiAoTWF0aC5QSSAvIDE4MCk7XG4gIGNvbnN0IHJhZFRvRGVnID0gKHJhZGlhbnM6IG51bWJlcik6IG51bWJlciA9PiByYWRpYW5zICogKDE4MCAvIE1hdGguUEkpO1xuICBjb25zdCBjZWxzaXVzVG9LZWx2aW4gPSAoY2Vsc2l1czogbnVtYmVyKTogbnVtYmVyID0+IGNlbHNpdXMgKyAyNzMuMTU7XG4gIGNvbnN0IGhQYVRvUEEgPSAoaFBhOiBudW1iZXIpOiBudW1iZXIgPT4gaFBhICogMTAwO1xuICBjb25zdCBtbVRvTSA9IChtbTogbnVtYmVyKTogbnVtYmVyID0+IG1tIC8gMTAwMDtcbiAgY29uc3QgY21Ub00gPSAoY206IG51bWJlcik6IG51bWJlciA9PiBjbSAvIDEwMDtcbiAgY29uc3Qga21Ub00gPSAoa206IG51bWJlcik6IG51bWJlciA9PiBrbSAqIDEwMDA7XG4gIGNvbnN0IGttaFRvTXMgPSAoa21oOiBudW1iZXIpOiBudW1iZXIgPT4ga21oIC8gMy42O1xuICBjb25zdCBwZXJjZW50VG9SYXRpbyA9IChwZXJjZW50OiBudW1iZXIpOiBudW1iZXIgPT4gcGVyY2VudCAvIDEwMDtcblxuICAvLyBGaWVsZCBuYW1lIHRyYW5zbGF0aW9uOiBPcGVuLU1ldGVvIEFQSSBuYW1lcyDihpIgU2lnbmFsSy1hbGlnbmVkIG5hbWVzIChmb2xsb3dpbmcgc2lnbmFsay13ZWF0aGVyZmxvdyBjb252ZW50aW9uKVxuICBjb25zdCBmaWVsZE5hbWVNYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgLy8gVGVtcGVyYXR1cmUgZmllbGRzXG4gICAgdGVtcGVyYXR1cmVfMm06IFwiYWlyVGVtcGVyYXR1cmVcIixcbiAgICBhcHBhcmVudF90ZW1wZXJhdHVyZTogXCJmZWVsc0xpa2VcIixcbiAgICBkZXdfcG9pbnRfMm06IFwiZGV3UG9pbnRcIixcbiAgICB0ZW1wZXJhdHVyZV8ybV9tYXg6IFwiYWlyVGVtcEhpZ2hcIixcbiAgICB0ZW1wZXJhdHVyZV8ybV9taW46IFwiYWlyVGVtcExvd1wiLFxuICAgIGFwcGFyZW50X3RlbXBlcmF0dXJlX21heDogXCJmZWVsc0xpa2VIaWdoXCIsXG4gICAgYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWluOiBcImZlZWxzTGlrZUxvd1wiLFxuICAgIHNlYV9zdXJmYWNlX3RlbXBlcmF0dXJlOiBcInNlYVN1cmZhY2VUZW1wZXJhdHVyZVwiLFxuXG4gICAgLy8gV2luZCBmaWVsZHNcbiAgICB3aW5kX3NwZWVkXzEwbTogXCJ3aW5kQXZnXCIsXG4gICAgd2luZF9kaXJlY3Rpb25fMTBtOiBcIndpbmREaXJlY3Rpb25cIixcbiAgICB3aW5kX2d1c3RzXzEwbTogXCJ3aW5kR3VzdFwiLFxuICAgIHdpbmRfc3BlZWRfMTBtX21heDogXCJ3aW5kQXZnTWF4XCIsXG4gICAgd2luZF9ndXN0c18xMG1fbWF4OiBcIndpbmRHdXN0TWF4XCIsXG4gICAgd2luZF9kaXJlY3Rpb25fMTBtX2RvbWluYW50OiBcIndpbmREaXJlY3Rpb25Eb21pbmFudFwiLFxuXG4gICAgLy8gUHJlc3N1cmUgZmllbGRzXG4gICAgcHJlc3N1cmVfbXNsOiBcInNlYUxldmVsUHJlc3N1cmVcIixcbiAgICBzdXJmYWNlX3ByZXNzdXJlOiBcInN0YXRpb25QcmVzc3VyZVwiLFxuXG4gICAgLy8gSHVtaWRpdHkgZmllbGRzXG4gICAgcmVsYXRpdmVfaHVtaWRpdHlfMm06IFwicmVsYXRpdmVIdW1pZGl0eVwiLFxuXG4gICAgLy8gUHJlY2lwaXRhdGlvbiBmaWVsZHNcbiAgICBwcmVjaXBpdGF0aW9uOiBcInByZWNpcFwiLFxuICAgIHByZWNpcGl0YXRpb25fcHJvYmFiaWxpdHk6IFwicHJlY2lwUHJvYmFiaWxpdHlcIixcbiAgICBwcmVjaXBpdGF0aW9uX3N1bTogXCJwcmVjaXBTdW1cIixcbiAgICBwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5X21heDogXCJwcmVjaXBQcm9iYWJpbGl0eU1heFwiLFxuICAgIHByZWNpcGl0YXRpb25faG91cnM6IFwicHJlY2lwSG91cnNcIixcbiAgICByYWluOiBcInJhaW5cIixcbiAgICByYWluX3N1bTogXCJyYWluU3VtXCIsXG4gICAgc2hvd2VyczogXCJzaG93ZXJzXCIsXG4gICAgc2hvd2Vyc19zdW06IFwic2hvd2Vyc1N1bVwiLFxuICAgIHNub3dmYWxsOiBcInNub3dmYWxsXCIsXG4gICAgc25vd2ZhbGxfc3VtOiBcInNub3dmYWxsU3VtXCIsXG5cbiAgICAvLyBDbG91ZCBjb3ZlciBmaWVsZHNcbiAgICBjbG91ZF9jb3ZlcjogXCJjbG91ZENvdmVyXCIsXG4gICAgY2xvdWRfY292ZXJfbG93OiBcImxvd0Nsb3VkQ292ZXJcIixcbiAgICBjbG91ZF9jb3Zlcl9taWQ6IFwibWlkQ2xvdWRDb3ZlclwiLFxuICAgIGNsb3VkX2NvdmVyX2hpZ2g6IFwiaGlnaENsb3VkQ292ZXJcIixcblxuICAgIC8vIFNvbGFyL1VWIGZpZWxkc1xuICAgIHV2X2luZGV4OiBcInV2SW5kZXhcIixcbiAgICB1dl9pbmRleF9tYXg6IFwidXZJbmRleE1heFwiLFxuICAgIHNob3J0d2F2ZV9yYWRpYXRpb246IFwic29sYXJSYWRpYXRpb25cIixcbiAgICBzaG9ydHdhdmVfcmFkaWF0aW9uX3N1bTogXCJzb2xhclJhZGlhdGlvblN1bVwiLFxuICAgIGRpcmVjdF9yYWRpYXRpb246IFwiZGlyZWN0UmFkaWF0aW9uXCIsXG4gICAgZGlmZnVzZV9yYWRpYXRpb246IFwiZGlmZnVzZVJhZGlhdGlvblwiLFxuICAgIGRpcmVjdF9ub3JtYWxfaXJyYWRpYW5jZTogXCJpcnJhZGlhbmNlRGlyZWN0Tm9ybWFsXCIsXG4gICAgc3Vuc2hpbmVfZHVyYXRpb246IFwic3Vuc2hpbmVEdXJhdGlvblwiLFxuICAgIGRheWxpZ2h0X2R1cmF0aW9uOiBcImRheWxpZ2h0RHVyYXRpb25cIixcblxuICAgIC8vIE1hcmluZS9XYXZlIGZpZWxkc1xuICAgIHdhdmVfaGVpZ2h0OiBcInNpZ25pZmljYW50V2F2ZUhlaWdodFwiLFxuICAgIHdhdmVfaGVpZ2h0X21heDogXCJzaWduaWZpY2FudFdhdmVIZWlnaHRNYXhcIixcbiAgICB3YXZlX2RpcmVjdGlvbjogXCJtZWFuV2F2ZURpcmVjdGlvblwiLFxuICAgIHdhdmVfZGlyZWN0aW9uX2RvbWluYW50OiBcIm1lYW5XYXZlRGlyZWN0aW9uRG9taW5hbnRcIixcbiAgICB3YXZlX3BlcmlvZDogXCJtZWFuV2F2ZVBlcmlvZFwiLFxuICAgIHdhdmVfcGVyaW9kX21heDogXCJtZWFuV2F2ZVBlcmlvZE1heFwiLFxuICAgIHdpbmRfd2F2ZV9oZWlnaHQ6IFwid2luZFdhdmVIZWlnaHRcIixcbiAgICB3aW5kX3dhdmVfaGVpZ2h0X21heDogXCJ3aW5kV2F2ZUhlaWdodE1heFwiLFxuICAgIHdpbmRfd2F2ZV9kaXJlY3Rpb246IFwid2luZFdhdmVEaXJlY3Rpb25cIixcbiAgICB3aW5kX3dhdmVfZGlyZWN0aW9uX2RvbWluYW50OiBcIndpbmRXYXZlRGlyZWN0aW9uRG9taW5hbnRcIixcbiAgICB3aW5kX3dhdmVfcGVyaW9kOiBcIndpbmRXYXZlUGVyaW9kXCIsXG4gICAgd2luZF93YXZlX3BlcmlvZF9tYXg6IFwid2luZFdhdmVQZXJpb2RNYXhcIixcbiAgICB3aW5kX3dhdmVfcGVha19wZXJpb2Q6IFwid2luZFdhdmVQZWFrUGVyaW9kXCIsXG4gICAgd2luZF93YXZlX3BlYWtfcGVyaW9kX21heDogXCJ3aW5kV2F2ZVBlYWtQZXJpb2RNYXhcIixcbiAgICBzd2VsbF93YXZlX2hlaWdodDogXCJzd2VsbFNpZ25pZmljYW50SGVpZ2h0XCIsXG4gICAgc3dlbGxfd2F2ZV9oZWlnaHRfbWF4OiBcInN3ZWxsU2lnbmlmaWNhbnRIZWlnaHRNYXhcIixcbiAgICBzd2VsbF93YXZlX2RpcmVjdGlvbjogXCJzd2VsbE1lYW5EaXJlY3Rpb25cIixcbiAgICBzd2VsbF93YXZlX2RpcmVjdGlvbl9kb21pbmFudDogXCJzd2VsbE1lYW5EaXJlY3Rpb25Eb21pbmFudFwiLFxuICAgIHN3ZWxsX3dhdmVfcGVyaW9kOiBcInN3ZWxsTWVhblBlcmlvZFwiLFxuICAgIHN3ZWxsX3dhdmVfcGVyaW9kX21heDogXCJzd2VsbE1lYW5QZXJpb2RNYXhcIixcbiAgICBzd2VsbF93YXZlX3BlYWtfcGVyaW9kOiBcInN3ZWxsUGVha1BlcmlvZFwiLFxuICAgIHN3ZWxsX3dhdmVfcGVha19wZXJpb2RfbWF4OiBcInN3ZWxsUGVha1BlcmlvZE1heFwiLFxuICAgIG9jZWFuX2N1cnJlbnRfdmVsb2NpdHk6IFwiY3VycmVudFZlbG9jaXR5XCIsXG4gICAgb2NlYW5fY3VycmVudF9kaXJlY3Rpb246IFwiY3VycmVudERpcmVjdGlvblwiLFxuXG4gICAgLy8gT3RoZXIgZmllbGRzXG4gICAgdmlzaWJpbGl0eTogXCJ2aXNpYmlsaXR5XCIsXG4gICAgaXNfZGF5OiBcImlzRGF5bGlnaHRcIixcbiAgICB3ZWF0aGVyX2NvZGU6IFwid2VhdGhlckNvZGVcIixcbiAgICBjYXBlOiBcImNhcGVcIixcbiAgICBzdW5yaXNlOiBcInN1bnJpc2VcIixcbiAgICBzdW5zZXQ6IFwic3Vuc2V0XCIsXG4gIH07XG5cbiAgLy8gVHJhbnNsYXRlIE9wZW4tTWV0ZW8gZmllbGQgbmFtZSB0byBTaWduYWxLLWFsaWduZWQgbmFtZVxuICBjb25zdCB0cmFuc2xhdGVGaWVsZE5hbWUgPSAob3Blbk1ldGVvTmFtZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICByZXR1cm4gZmllbGROYW1lTWFwW29wZW5NZXRlb05hbWVdIHx8IG9wZW5NZXRlb05hbWU7XG4gIH07XG5cbiAgLy8gUmV2ZXJzZSBsb29rdXA6IFNpZ25hbEsgbmFtZSB0byBPcGVuLU1ldGVvIG5hbWUgKGZvciByZWFkaW5nIGJhY2sgZnJvbSBTaWduYWxLKVxuICBjb25zdCByZXZlcnNlRmllbGROYW1lTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0gT2JqZWN0LmVudHJpZXMoXG4gICAgZmllbGROYW1lTWFwLFxuICApLnJlZHVjZShcbiAgICAoYWNjLCBbb3Blbk1ldGVvLCBzaWduYWxrXSkgPT4ge1xuICAgICAgYWNjW3NpZ25hbGtdID0gb3Blbk1ldGVvO1xuICAgICAgcmV0dXJuIGFjYztcbiAgICB9LFxuICAgIHt9IGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICk7XG5cbiAgLy8gQ2FsY3VsYXRlIGZ1dHVyZSBwb3NpdGlvbiBiYXNlZCBvbiBjdXJyZW50IGhlYWRpbmcgYW5kIHNwZWVkXG4gIGNvbnN0IGNhbGN1bGF0ZUZ1dHVyZVBvc2l0aW9uID0gKFxuICAgIGN1cnJlbnRQb3M6IFBvc2l0aW9uLFxuICAgIGhlYWRpbmdSYWQ6IG51bWJlcixcbiAgICBzb2dNcHM6IG51bWJlcixcbiAgICBob3Vyc0FoZWFkOiBudW1iZXIsXG4gICk6IFBvc2l0aW9uID0+IHtcbiAgICBjb25zdCBkaXN0YW5jZU1ldGVycyA9IHNvZ01wcyAqIGhvdXJzQWhlYWQgKiAzNjAwO1xuICAgIGNvbnN0IGVhcnRoUmFkaXVzID0gNjM3MTAwMDtcblxuICAgIGNvbnN0IGxhdDEgPSBkZWdUb1JhZChjdXJyZW50UG9zLmxhdGl0dWRlKTtcbiAgICBjb25zdCBsb24xID0gZGVnVG9SYWQoY3VycmVudFBvcy5sb25naXR1ZGUpO1xuXG4gICAgY29uc3QgbGF0MiA9IE1hdGguYXNpbihcbiAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5jb3MoZGlzdGFuY2VNZXRlcnMgLyBlYXJ0aFJhZGl1cykgK1xuICAgICAgICBNYXRoLmNvcyhsYXQxKSAqXG4gICAgICAgICAgTWF0aC5zaW4oZGlzdGFuY2VNZXRlcnMgLyBlYXJ0aFJhZGl1cykgKlxuICAgICAgICAgIE1hdGguY29zKGhlYWRpbmdSYWQpLFxuICAgICk7XG5cbiAgICBjb25zdCBsb24yID1cbiAgICAgIGxvbjEgK1xuICAgICAgTWF0aC5hdGFuMihcbiAgICAgICAgTWF0aC5zaW4oaGVhZGluZ1JhZCkgKlxuICAgICAgICAgIE1hdGguc2luKGRpc3RhbmNlTWV0ZXJzIC8gZWFydGhSYWRpdXMpICpcbiAgICAgICAgICBNYXRoLmNvcyhsYXQxKSxcbiAgICAgICAgTWF0aC5jb3MoZGlzdGFuY2VNZXRlcnMgLyBlYXJ0aFJhZGl1cykgLVxuICAgICAgICAgIE1hdGguc2luKGxhdDEpICogTWF0aC5zaW4obGF0MiksXG4gICAgICApO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGxhdGl0dWRlOiByYWRUb0RlZyhsYXQyKSxcbiAgICAgIGxvbmdpdHVkZTogcmFkVG9EZWcobG9uMiksXG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKERhdGUubm93KCkgKyBob3Vyc0FoZWFkICogMzYwMDAwMCksXG4gICAgfTtcbiAgfTtcblxuICAvLyBDaGVjayBpZiB2ZXNzZWwgaXMgbW92aW5nIGFib3ZlIHRocmVzaG9sZFxuICBjb25zdCBpc1Zlc3NlbE1vdmluZyA9IChcbiAgICBzb2dNcHM6IG51bWJlcixcbiAgICB0aHJlc2hvbGRLbm90czogbnVtYmVyID0gMS4wLFxuICApOiBib29sZWFuID0+IHtcbiAgICBjb25zdCB0aHJlc2hvbGRNcHMgPSB0aHJlc2hvbGRLbm90cyAqIDAuNTE0NDQ0O1xuICAgIHJldHVybiBzb2dNcHMgPiB0aHJlc2hvbGRNcHM7XG4gIH07XG5cbiAgLy8gQnVpbGQgT3Blbi1NZXRlbyBXZWF0aGVyIEFQSSBVUkxcbiAgY29uc3QgYnVpbGRXZWF0aGVyVXJsID0gKFxuICAgIHBvc2l0aW9uOiBQb3NpdGlvbixcbiAgICBjb25maWc6IFBsdWdpbkNvbmZpZyxcbiAgKTogc3RyaW5nID0+IHtcbiAgICBjb25zdCBiYXNlVXJsID0gY29uZmlnLmFwaUtleVxuICAgICAgPyBgaHR0cHM6Ly9jdXN0b21lci1hcGkub3Blbi1tZXRlby5jb20vdjEvZm9yZWNhc3RgXG4gICAgICA6IGBodHRwczovL2FwaS5vcGVuLW1ldGVvLmNvbS92MS9mb3JlY2FzdGA7XG5cbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGxhdGl0dWRlOiBwb3NpdGlvbi5sYXRpdHVkZS50b1N0cmluZygpLFxuICAgICAgbG9uZ2l0dWRlOiBwb3NpdGlvbi5sb25naXR1ZGUudG9TdHJpbmcoKSxcbiAgICAgIHRpbWV6b25lOiBcIlVUQ1wiLFxuICAgICAgZm9yZWNhc3RfZGF5czogTWF0aC5taW4oY29uZmlnLm1heEZvcmVjYXN0RGF5cywgMTYpLnRvU3RyaW5nKCksXG4gICAgfSk7XG5cbiAgICBpZiAoY29uZmlnLmFwaUtleSkge1xuICAgICAgcGFyYW1zLmFwcGVuZChcImFwaWtleVwiLCBjb25maWcuYXBpS2V5KTtcbiAgICB9XG5cbiAgICAvLyBIb3VybHkgd2VhdGhlciB2YXJpYWJsZXNcbiAgICBpZiAoY29uZmlnLmVuYWJsZUhvdXJseVdlYXRoZXIpIHtcbiAgICAgIGNvbnN0IGhvdXJseVZhcnMgPSBbXG4gICAgICAgIFwidGVtcGVyYXR1cmVfMm1cIixcbiAgICAgICAgXCJyZWxhdGl2ZV9odW1pZGl0eV8ybVwiLFxuICAgICAgICBcImRld19wb2ludF8ybVwiLFxuICAgICAgICBcImFwcGFyZW50X3RlbXBlcmF0dXJlXCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eVwiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25cIixcbiAgICAgICAgXCJyYWluXCIsXG4gICAgICAgIFwic2hvd2Vyc1wiLFxuICAgICAgICBcInNub3dmYWxsXCIsXG4gICAgICAgIFwid2VhdGhlcl9jb2RlXCIsXG4gICAgICAgIFwicHJlc3N1cmVfbXNsXCIsXG4gICAgICAgIFwic3VyZmFjZV9wcmVzc3VyZVwiLFxuICAgICAgICBcImNsb3VkX2NvdmVyXCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJfbG93XCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJfbWlkXCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJfaGlnaFwiLFxuICAgICAgICBcInZpc2liaWxpdHlcIixcbiAgICAgICAgXCJ3aW5kX3NwZWVkXzEwbVwiLFxuICAgICAgICBcIndpbmRfZGlyZWN0aW9uXzEwbVwiLFxuICAgICAgICBcIndpbmRfZ3VzdHNfMTBtXCIsXG4gICAgICAgIFwidXZfaW5kZXhcIixcbiAgICAgICAgXCJpc19kYXlcIixcbiAgICAgICAgXCJzdW5zaGluZV9kdXJhdGlvblwiLFxuICAgICAgICBcImNhcGVcIixcbiAgICAgICAgXCJzaG9ydHdhdmVfcmFkaWF0aW9uXCIsXG4gICAgICAgIFwiZGlyZWN0X3JhZGlhdGlvblwiLFxuICAgICAgICBcImRpZmZ1c2VfcmFkaWF0aW9uXCIsXG4gICAgICAgIFwiZGlyZWN0X25vcm1hbF9pcnJhZGlhbmNlXCIsXG4gICAgICBdO1xuICAgICAgcGFyYW1zLmFwcGVuZChcImhvdXJseVwiLCBob3VybHlWYXJzLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICAvLyBEYWlseSB3ZWF0aGVyIHZhcmlhYmxlc1xuICAgIGlmIChjb25maWcuZW5hYmxlRGFpbHlXZWF0aGVyKSB7XG4gICAgICBjb25zdCBkYWlseVZhcnMgPSBbXG4gICAgICAgIFwid2VhdGhlcl9jb2RlXCIsXG4gICAgICAgIFwidGVtcGVyYXR1cmVfMm1fbWF4XCIsXG4gICAgICAgIFwidGVtcGVyYXR1cmVfMm1fbWluXCIsXG4gICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWF4XCIsXG4gICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWluXCIsXG4gICAgICAgIFwic3VucmlzZVwiLFxuICAgICAgICBcInN1bnNldFwiLFxuICAgICAgICBcImRheWxpZ2h0X2R1cmF0aW9uXCIsXG4gICAgICAgIFwic3Vuc2hpbmVfZHVyYXRpb25cIixcbiAgICAgICAgXCJ1dl9pbmRleF9tYXhcIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uX3N1bVwiLFxuICAgICAgICBcInJhaW5fc3VtXCIsXG4gICAgICAgIFwic2hvd2Vyc19zdW1cIixcbiAgICAgICAgXCJzbm93ZmFsbF9zdW1cIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uX2hvdXJzXCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eV9tYXhcIixcbiAgICAgICAgXCJ3aW5kX3NwZWVkXzEwbV9tYXhcIixcbiAgICAgICAgXCJ3aW5kX2d1c3RzXzEwbV9tYXhcIixcbiAgICAgICAgXCJ3aW5kX2RpcmVjdGlvbl8xMG1fZG9taW5hbnRcIixcbiAgICAgICAgXCJzaG9ydHdhdmVfcmFkaWF0aW9uX3N1bVwiLFxuICAgICAgXTtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJkYWlseVwiLCBkYWlseVZhcnMuam9pbihcIixcIikpO1xuICAgIH1cblxuICAgIC8vIEN1cnJlbnQgY29uZGl0aW9uc1xuICAgIGlmIChjb25maWcuZW5hYmxlQ3VycmVudENvbmRpdGlvbnMpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnRWYXJzID0gW1xuICAgICAgICBcInRlbXBlcmF0dXJlXzJtXCIsXG4gICAgICAgIFwicmVsYXRpdmVfaHVtaWRpdHlfMm1cIixcbiAgICAgICAgXCJhcHBhcmVudF90ZW1wZXJhdHVyZVwiLFxuICAgICAgICBcImlzX2RheVwiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25cIixcbiAgICAgICAgXCJyYWluXCIsXG4gICAgICAgIFwic2hvd2Vyc1wiLFxuICAgICAgICBcInNub3dmYWxsXCIsXG4gICAgICAgIFwid2VhdGhlcl9jb2RlXCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJcIixcbiAgICAgICAgXCJwcmVzc3VyZV9tc2xcIixcbiAgICAgICAgXCJzdXJmYWNlX3ByZXNzdXJlXCIsXG4gICAgICAgIFwid2luZF9zcGVlZF8xMG1cIixcbiAgICAgICAgXCJ3aW5kX2RpcmVjdGlvbl8xMG1cIixcbiAgICAgICAgXCJ3aW5kX2d1c3RzXzEwbVwiLFxuICAgICAgXTtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJjdXJyZW50XCIsIGN1cnJlbnRWYXJzLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICAvLyBSZXF1ZXN0IHdpbmQgc3BlZWQgaW4gbS9zIGZvciBTaWduYWxLIGNvbXBhdGliaWxpdHlcbiAgICBwYXJhbXMuYXBwZW5kKFwid2luZF9zcGVlZF91bml0XCIsIFwibXNcIik7XG5cbiAgICByZXR1cm4gYCR7YmFzZVVybH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gO1xuICB9O1xuXG4gIC8vIEJ1aWxkIE9wZW4tTWV0ZW8gTWFyaW5lIEFQSSBVUkxcbiAgY29uc3QgYnVpbGRNYXJpbmVVcmwgPSAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGNvbnN0IGJhc2VVcmwgPSBjb25maWcuYXBpS2V5XG4gICAgICA/IGBodHRwczovL2N1c3RvbWVyLW1hcmluZS1hcGkub3Blbi1tZXRlby5jb20vdjEvbWFyaW5lYFxuICAgICAgOiBgaHR0cHM6Ly9tYXJpbmUtYXBpLm9wZW4tbWV0ZW8uY29tL3YxL21hcmluZWA7XG5cbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGxhdGl0dWRlOiBwb3NpdGlvbi5sYXRpdHVkZS50b1N0cmluZygpLFxuICAgICAgbG9uZ2l0dWRlOiBwb3NpdGlvbi5sb25naXR1ZGUudG9TdHJpbmcoKSxcbiAgICAgIHRpbWV6b25lOiBcIlVUQ1wiLFxuICAgICAgZm9yZWNhc3RfZGF5czogTWF0aC5taW4oY29uZmlnLm1heEZvcmVjYXN0RGF5cywgOCkudG9TdHJpbmcoKSwgLy8gTWFyaW5lIEFQSSBtYXggaXMgOCBkYXlzXG4gICAgfSk7XG5cbiAgICBpZiAoY29uZmlnLmFwaUtleSkge1xuICAgICAgcGFyYW1zLmFwcGVuZChcImFwaWtleVwiLCBjb25maWcuYXBpS2V5KTtcbiAgICB9XG5cbiAgICAvLyBIb3VybHkgbWFyaW5lIHZhcmlhYmxlc1xuICAgIGlmIChjb25maWcuZW5hYmxlTWFyaW5lSG91cmx5KSB7XG4gICAgICBjb25zdCBob3VybHlWYXJzID0gW1xuICAgICAgICBcIndhdmVfaGVpZ2h0XCIsXG4gICAgICAgIFwid2F2ZV9kaXJlY3Rpb25cIixcbiAgICAgICAgXCJ3YXZlX3BlcmlvZFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9oZWlnaHRcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfZGlyZWN0aW9uXCIsXG4gICAgICAgIFwid2luZF93YXZlX3BlcmlvZFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9wZWFrX3BlcmlvZFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfaGVpZ2h0XCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9kaXJlY3Rpb25cIixcbiAgICAgICAgXCJzd2VsbF93YXZlX3BlcmlvZFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfcGVha19wZXJpb2RcIixcbiAgICAgICAgXCJvY2Vhbl9jdXJyZW50X3ZlbG9jaXR5XCIsXG4gICAgICAgIFwib2NlYW5fY3VycmVudF9kaXJlY3Rpb25cIixcbiAgICAgICAgXCJzZWFfc3VyZmFjZV90ZW1wZXJhdHVyZVwiLFxuICAgICAgXTtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJob3VybHlcIiwgaG91cmx5VmFycy5qb2luKFwiLFwiKSk7XG4gICAgfVxuXG4gICAgLy8gRGFpbHkgbWFyaW5lIHZhcmlhYmxlc1xuICAgIGlmIChjb25maWcuZW5hYmxlTWFyaW5lRGFpbHkpIHtcbiAgICAgIGNvbnN0IGRhaWx5VmFycyA9IFtcbiAgICAgICAgXCJ3YXZlX2hlaWdodF9tYXhcIixcbiAgICAgICAgXCJ3YXZlX2RpcmVjdGlvbl9kb21pbmFudFwiLFxuICAgICAgICBcIndhdmVfcGVyaW9kX21heFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9oZWlnaHRfbWF4XCIsXG4gICAgICAgIFwid2luZF93YXZlX2RpcmVjdGlvbl9kb21pbmFudFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9wZXJpb2RfbWF4XCIsXG4gICAgICAgIFwid2luZF93YXZlX3BlYWtfcGVyaW9kX21heFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfaGVpZ2h0X21heFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfZGlyZWN0aW9uX2RvbWluYW50XCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9wZXJpb2RfbWF4XCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9wZWFrX3BlcmlvZF9tYXhcIixcbiAgICAgIF07XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiZGFpbHlcIiwgZGFpbHlWYXJzLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYCR7YmFzZVVybH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gO1xuICB9O1xuXG4gIC8vIEZldGNoIHdlYXRoZXIgZGF0YSBmcm9tIE9wZW4tTWV0ZW9cbiAgY29uc3QgZmV0Y2hXZWF0aGVyRGF0YSA9IGFzeW5jIChcbiAgICBwb3NpdGlvbjogUG9zaXRpb24sXG4gICAgY29uZmlnOiBQbHVnaW5Db25maWcsXG4gICk6IFByb21pc2U8T3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlIHwgbnVsbD4gPT4ge1xuICAgIGNvbnN0IHVybCA9IGJ1aWxkV2VhdGhlclVybChwb3NpdGlvbiwgY29uZmlnKTtcbiAgICBhcHAuZGVidWcoYEZldGNoaW5nIHdlYXRoZXIgZnJvbTogJHt1cmx9YCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICBjb25zdCBlcnJvclRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7ZXJyb3JUZXh0fWApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXBwLmVycm9yKFxuICAgICAgICBgRmFpbGVkIHRvIGZldGNoIHdlYXRoZXIgZGF0YTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH07XG5cbiAgLy8gRmV0Y2ggbWFyaW5lIGRhdGEgZnJvbSBPcGVuLU1ldGVvXG4gIGNvbnN0IGZldGNoTWFyaW5lRGF0YSA9IGFzeW5jIChcbiAgICBwb3NpdGlvbjogUG9zaXRpb24sXG4gICAgY29uZmlnOiBQbHVnaW5Db25maWcsXG4gICk6IFByb21pc2U8T3Blbk1ldGVvTWFyaW5lUmVzcG9uc2UgfCBudWxsPiA9PiB7XG4gICAgY29uc3QgdXJsID0gYnVpbGRNYXJpbmVVcmwocG9zaXRpb24sIGNvbmZpZyk7XG4gICAgYXBwLmRlYnVnKGBGZXRjaGluZyBtYXJpbmUgZGF0YSBmcm9tOiAke3VybH1gKTtcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKHVybCk7XG4gICAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICAgIGNvbnN0IGVycm9yVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfTogJHtlcnJvclRleHR9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gKGF3YWl0IHJlc3BvbnNlLmpzb24oKSkgYXMgT3Blbk1ldGVvTWFyaW5lUmVzcG9uc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGFwcC5lcnJvcihcbiAgICAgICAgYEZhaWxlZCB0byBmZXRjaCBtYXJpbmUgZGF0YTogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH07XG5cbiAgLy8gR2V0IHNvdXJjZSBsYWJlbCBmb3IgU2lnbmFsSyAoZm9sbG93aW5nIHdlYXRoZXJmbG93L21ldGVvIHBhdHRlcm4pXG4gIGNvbnN0IGdldFNvdXJjZUxhYmVsID0gKHBhY2thZ2VUeXBlOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICAgIHJldHVybiBgb3Blbm1ldGVvLSR7cGFja2FnZVR5cGV9LWFwaWA7XG4gIH07XG5cbiAgLy8gR2V0IHBhcmFtZXRlciBtZXRhZGF0YSBmb3IgU2lnbmFsSyAodXNpbmcgU2lnbmFsSy1hbGlnbmVkIGZpZWxkIG5hbWVzKVxuICBjb25zdCBnZXRQYXJhbWV0ZXJNZXRhZGF0YSA9IChwYXJhbWV0ZXJOYW1lOiBzdHJpbmcpOiBhbnkgPT4ge1xuICAgIGNvbnN0IG1ldGFkYXRhTWFwOiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgLy8gVGVtcGVyYXR1cmUgcGFyYW1ldGVycyAoU2lnbmFsSyBjb21wbGlhbnQgLSBLZWx2aW4pXG4gICAgICBhaXJUZW1wZXJhdHVyZToge1xuICAgICAgICB1bml0czogXCJLXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlRlbXBlcmF0dXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkFpciB0ZW1wZXJhdHVyZSBhdCAybSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBmZWVsc0xpa2U6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJGZWVscyBMaWtlIFRlbXBlcmF0dXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkFwcGFyZW50IHRlbXBlcmF0dXJlIGNvbnNpZGVyaW5nIHdpbmQgYW5kIGh1bWlkaXR5XCIsXG4gICAgICB9LFxuICAgICAgZGV3UG9pbnQ6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEZXcgUG9pbnRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGV3IHBvaW50IHRlbXBlcmF0dXJlIGF0IDJtIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHNlYVN1cmZhY2VUZW1wZXJhdHVyZToge1xuICAgICAgICB1bml0czogXCJLXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlNlYSBTdXJmYWNlIFRlbXBlcmF0dXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlNlYSBzdXJmYWNlIHRlbXBlcmF0dXJlXCIsXG4gICAgICB9LFxuICAgICAgYWlyVGVtcEhpZ2g6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJIaWdoIFRlbXBlcmF0dXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gYWlyIHRlbXBlcmF0dXJlXCIsXG4gICAgICB9LFxuICAgICAgYWlyVGVtcExvdzoge1xuICAgICAgICB1bml0czogXCJLXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkxvdyBUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNaW5pbXVtIGFpciB0ZW1wZXJhdHVyZVwiLFxuICAgICAgfSxcbiAgICAgIGZlZWxzTGlrZUhpZ2g6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJGZWVscyBMaWtlIEhpZ2hcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBhcHBhcmVudCB0ZW1wZXJhdHVyZVwiLFxuICAgICAgfSxcbiAgICAgIGZlZWxzTGlrZUxvdzoge1xuICAgICAgICB1bml0czogXCJLXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkZlZWxzIExpa2UgTG93XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1pbmltdW0gYXBwYXJlbnQgdGVtcGVyYXR1cmVcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFdpbmQgcGFyYW1ldGVycyAoU2lnbmFsSyBjb21wbGlhbnQgLSBtL3MsIHJhZGlhbnMpXG4gICAgICB3aW5kQXZnOiB7XG4gICAgICAgIHVuaXRzOiBcIm0vc1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXaW5kIFNwZWVkXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQgc3BlZWQgYXQgMTBtIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmRHdXN0OiB7XG4gICAgICAgIHVuaXRzOiBcIm0vc1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXaW5kIEd1c3RzXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQgZ3VzdCBzcGVlZCBhdCAxMG0gaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgd2luZERpcmVjdGlvbjoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZCBkaXJlY3Rpb24gYXQgMTBtIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmRBdmdNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwibS9zXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBXaW5kIFNwZWVkXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gd2luZCBzcGVlZFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmRHdXN0TWF4OiB7XG4gICAgICAgIHVuaXRzOiBcIm0vc1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2luZCBHdXN0c1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIHdpbmQgZ3VzdCBzcGVlZFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmREaXJlY3Rpb25Eb21pbmFudDoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRG9taW5hbnQgV2luZCBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRG9taW5hbnQgd2luZCBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFByZXNzdXJlIHBhcmFtZXRlcnMgKFNpZ25hbEsgY29tcGxpYW50IC0gUGFzY2FsKVxuICAgICAgc2VhTGV2ZWxQcmVzc3VyZToge1xuICAgICAgICB1bml0czogXCJQYVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTZWEgTGV2ZWwgUHJlc3N1cmVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiQXRtb3NwaGVyaWMgcHJlc3N1cmUgYXQgbWVhbiBzZWEgbGV2ZWxcIixcbiAgICAgIH0sXG4gICAgICBzdGF0aW9uUHJlc3N1cmU6IHtcbiAgICAgICAgdW5pdHM6IFwiUGFcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU3VyZmFjZSBQcmVzc3VyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBdG1vc3BoZXJpYyBwcmVzc3VyZSBhdCBzdXJmYWNlXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBIdW1pZGl0eSAoU2lnbmFsSyBjb21wbGlhbnQgLSByYXRpbyAwLTEpXG4gICAgICByZWxhdGl2ZUh1bWlkaXR5OiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlJlbGF0aXZlIEh1bWlkaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlJlbGF0aXZlIGh1bWlkaXR5IGF0IDJtIGhlaWdodCAoMC0xKVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gQ2xvdWQgY292ZXIgKFNpZ25hbEsgY29tcGxpYW50IC0gcmF0aW8gMC0xKVxuICAgICAgY2xvdWRDb3Zlcjoge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJDbG91ZCBDb3ZlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJUb3RhbCBjbG91ZCBjb3ZlciAoMC0xKVwiLFxuICAgICAgfSxcbiAgICAgIGxvd0Nsb3VkQ292ZXI6IHtcbiAgICAgICAgdW5pdHM6IFwicmF0aW9cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTG93IENsb3VkIENvdmVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkxvdyBhbHRpdHVkZSBjbG91ZCBjb3ZlciAoMC0xKVwiLFxuICAgICAgfSxcbiAgICAgIG1pZENsb3VkQ292ZXI6IHtcbiAgICAgICAgdW5pdHM6IFwicmF0aW9cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTWlkIENsb3VkIENvdmVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1pZCBhbHRpdHVkZSBjbG91ZCBjb3ZlciAoMC0xKVwiLFxuICAgICAgfSxcbiAgICAgIGhpZ2hDbG91ZENvdmVyOiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkhpZ2ggQ2xvdWQgQ292ZXJcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiSGlnaCBhbHRpdHVkZSBjbG91ZCBjb3ZlciAoMC0xKVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gUHJlY2lwaXRhdGlvbiAoU2lnbmFsSyBjb21wbGlhbnQgLSBtZXRlcnMpXG4gICAgICBwcmVjaXA6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJQcmVjaXBpdGF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlByZWNpcGl0YXRpb24gYW1vdW50XCIsXG4gICAgICB9LFxuICAgICAgcmFpbjoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlJhaW5cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiUmFpbiBhbW91bnRcIixcbiAgICAgIH0sXG4gICAgICBzbm93ZmFsbDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlNub3dmYWxsXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlNub3dmYWxsIGFtb3VudFwiLFxuICAgICAgfSxcbiAgICAgIHByZWNpcFByb2JhYmlsaXR5OiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlByZWNpcGl0YXRpb24gUHJvYmFiaWxpdHlcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiUHJvYmFiaWxpdHkgb2YgcHJlY2lwaXRhdGlvbiAoMC0xKVwiLFxuICAgICAgfSxcbiAgICAgIHByZWNpcFN1bToge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlByZWNpcGl0YXRpb24gU3VtXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRvdGFsIHByZWNpcGl0YXRpb24gYW1vdW50XCIsXG4gICAgICB9LFxuICAgICAgcHJlY2lwUHJvYmFiaWxpdHlNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwicmF0aW9cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTWF4IFByZWNpcGl0YXRpb24gUHJvYmFiaWxpdHlcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBwcm9iYWJpbGl0eSBvZiBwcmVjaXBpdGF0aW9uICgwLTEpXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBWaXNpYmlsaXR5IChTaWduYWxLIGNvbXBsaWFudCAtIG1ldGVycylcbiAgICAgIHZpc2liaWxpdHk6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJWaXNpYmlsaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkhvcml6b250YWwgdmlzaWJpbGl0eVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gV2F2ZSBwYXJhbWV0ZXJzIChtZXRlcnMsIHNlY29uZHMsIHJhZGlhbnMpXG4gICAgICBzaWduaWZpY2FudFdhdmVIZWlnaHQ6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXYXZlIEhlaWdodFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTaWduaWZpY2FudCB3YXZlIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHNpZ25pZmljYW50V2F2ZUhlaWdodE1heDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBXYXZlIEhlaWdodFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIHNpZ25pZmljYW50IHdhdmUgaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgbWVhbldhdmVQZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXYXZlIFBlcmlvZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNZWFuIHdhdmUgcGVyaW9kXCIsXG4gICAgICB9LFxuICAgICAgbWVhbldhdmVQZXJpb2RNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2F2ZSBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSB3YXZlIHBlcmlvZFwiLFxuICAgICAgfSxcbiAgICAgIG1lYW5XYXZlRGlyZWN0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInJhZFwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXYXZlIERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNZWFuIHdhdmUgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuICAgICAgbWVhbldhdmVEaXJlY3Rpb25Eb21pbmFudDoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRG9taW5hbnQgV2F2ZSBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRG9taW5hbnQgd2F2ZSBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG4gICAgICB3aW5kV2F2ZUhlaWdodDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgV2F2ZSBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZC1nZW5lcmF0ZWQgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kV2F2ZUhlaWdodE1heDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBXaW5kIFdhdmUgSGVpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gd2luZC1nZW5lcmF0ZWQgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kV2F2ZVBlcmlvZDoge1xuICAgICAgICB1bml0czogXCJzXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgV2F2ZSBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZC1nZW5lcmF0ZWQgd2F2ZSBwZXJpb2RcIixcbiAgICAgIH0sXG4gICAgICB3aW5kV2F2ZURpcmVjdGlvbjoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBXYXZlIERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kLWdlbmVyYXRlZCB3YXZlIGRpcmVjdGlvblwiLFxuICAgICAgfSxcbiAgICAgIHdpbmRXYXZlRGlyZWN0aW9uRG9taW5hbnQ6IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRvbWluYW50IFdpbmQgV2F2ZSBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRG9taW5hbnQgd2luZC1nZW5lcmF0ZWQgd2F2ZSBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG4gICAgICB3aW5kV2F2ZVBlYWtQZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXaW5kIFdhdmUgUGVhayBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiUGVhayBwZXJpb2Qgb2Ygd2luZC1nZW5lcmF0ZWQgd2F2ZXNcIixcbiAgICAgIH0sXG4gICAgICBzd2VsbFNpZ25pZmljYW50SGVpZ2h0OiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU3dlbGwgSGVpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlN3ZWxsIHdhdmUgaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgc3dlbGxTaWduaWZpY2FudEhlaWdodE1heDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBTd2VsbCBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBzd2VsbCB3YXZlIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsTWVhblBlcmlvZDoge1xuICAgICAgICB1bml0czogXCJzXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIFBlcmlvZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTd2VsbCB3YXZlIHBlcmlvZFwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsTWVhblBlcmlvZE1heDoge1xuICAgICAgICB1bml0czogXCJzXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBTd2VsbCBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBzd2VsbCB3YXZlIHBlcmlvZFwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsTWVhbkRpcmVjdGlvbjoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU3dlbGwgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlN3ZWxsIHdhdmUgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuICAgICAgc3dlbGxNZWFuRGlyZWN0aW9uRG9taW5hbnQ6IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRvbWluYW50IFN3ZWxsIERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEb21pbmFudCBzd2VsbCB3YXZlIGRpcmVjdGlvblwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsUGVha1BlcmlvZDoge1xuICAgICAgICB1bml0czogXCJzXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIFBlYWsgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlBlYWsgcGVyaW9kIG9mIHN3ZWxsIHdhdmVzXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBPY2VhbiBjdXJyZW50c1xuICAgICAgY3VycmVudFZlbG9jaXR5OiB7XG4gICAgICAgIHVuaXRzOiBcIm0vc1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJDdXJyZW50IFNwZWVkXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk9jZWFuIGN1cnJlbnQgdmVsb2NpdHlcIixcbiAgICAgIH0sXG4gICAgICBjdXJyZW50RGlyZWN0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInJhZFwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJDdXJyZW50IERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJPY2VhbiBjdXJyZW50IGRpcmVjdGlvblwiLFxuICAgICAgfSxcblxuICAgICAgLy8gU29sYXIgcmFkaWF0aW9uXG4gICAgICBzb2xhclJhZGlhdGlvbjoge1xuICAgICAgICB1bml0czogXCJXL20yXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlNvbGFyIFJhZGlhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTaG9ydHdhdmUgc29sYXIgcmFkaWF0aW9uXCIsXG4gICAgICB9LFxuICAgICAgc29sYXJSYWRpYXRpb25TdW06IHtcbiAgICAgICAgdW5pdHM6IFwiSi9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJUb3RhbCBTb2xhciBSYWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVG90YWwgc2hvcnR3YXZlIHNvbGFyIHJhZGlhdGlvblwiLFxuICAgICAgfSxcbiAgICAgIGRpcmVjdFJhZGlhdGlvbjoge1xuICAgICAgICB1bml0czogXCJXL20yXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRpcmVjdCBSYWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGlyZWN0IHNvbGFyIHJhZGlhdGlvblwiLFxuICAgICAgfSxcbiAgICAgIGRpZmZ1c2VSYWRpYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwiVy9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEaWZmdXNlIFJhZGlhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEaWZmdXNlIHNvbGFyIHJhZGlhdGlvblwiLFxuICAgICAgfSxcbiAgICAgIGlycmFkaWFuY2VEaXJlY3ROb3JtYWw6IHtcbiAgICAgICAgdW5pdHM6IFwiVy9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEaXJlY3QgTm9ybWFsIElycmFkaWFuY2VcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGlyZWN0IG5vcm1hbCBzb2xhciBpcnJhZGlhbmNlXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBPdGhlclxuICAgICAgdXZJbmRleDoge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJVViBJbmRleFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJVViBpbmRleFwiLFxuICAgICAgfSxcbiAgICAgIHV2SW5kZXhNYXg6IHtcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTWF4IFVWIEluZGV4XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gVVYgaW5kZXhcIixcbiAgICAgIH0sXG4gICAgICB3ZWF0aGVyQ29kZToge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJXZWF0aGVyIENvZGVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV01PIHdlYXRoZXIgaW50ZXJwcmV0YXRpb24gY29kZVwiLFxuICAgICAgfSxcbiAgICAgIGlzRGF5bGlnaHQ6IHtcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiSXMgRGF5bGlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2hldGhlciBpdCBpcyBkYXkgKDEpIG9yIG5pZ2h0ICgwKVwiLFxuICAgICAgfSxcbiAgICAgIHN1bnNoaW5lRHVyYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTdW5zaGluZSBEdXJhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEdXJhdGlvbiBvZiBzdW5zaGluZVwiLFxuICAgICAgfSxcbiAgICAgIGRheWxpZ2h0RHVyYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEYXlsaWdodCBEdXJhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJEdXJhdGlvbiBvZiBkYXlsaWdodFwiLFxuICAgICAgfSxcbiAgICAgIGNhcGU6IHtcbiAgICAgICAgdW5pdHM6IFwiSi9rZ1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJDQVBFXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkNvbnZlY3RpdmUgQXZhaWxhYmxlIFBvdGVudGlhbCBFbmVyZ3lcIixcbiAgICAgIH0sXG4gICAgICBzdW5yaXNlOiB7XG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN1bnJpc2VcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU3VucmlzZSB0aW1lXCIsXG4gICAgICB9LFxuICAgICAgc3Vuc2V0OiB7XG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN1bnNldFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTdW5zZXQgdGltZVwiLFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgaWYgKG1ldGFkYXRhTWFwW3BhcmFtZXRlck5hbWVdKSB7XG4gICAgICByZXR1cm4gbWV0YWRhdGFNYXBbcGFyYW1ldGVyTmFtZV07XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2sgZm9yIHVua25vd24gcGFyYW1ldGVyc1xuICAgIGxldCB1bml0cyA9IFwiXCI7XG4gICAgbGV0IGRlc2NyaXB0aW9uID0gYCR7cGFyYW1ldGVyTmFtZX0gZm9yZWNhc3QgcGFyYW1ldGVyYDtcblxuICAgIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiVGVtcFwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwidGVtcGVyYXR1cmVcIikpIHtcbiAgICAgIHVuaXRzID0gXCJLXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiVGVtcGVyYXR1cmUgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJ3aW5kXCIpICYmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiQXZnXCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJHdXN0XCIpKSkge1xuICAgICAgdW5pdHMgPSBcIm0vc1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIldpbmQgc3BlZWQgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJWZWxvY2l0eVwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwidmVsb2NpdHlcIikpIHtcbiAgICAgIHVuaXRzID0gXCJtL3NcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJTcGVlZCBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlByZXNzdXJlXCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJwcmVzc3VyZVwiKSkge1xuICAgICAgdW5pdHMgPSBcIlBhXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiUHJlc3N1cmUgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJIdW1pZGl0eVwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiaHVtaWRpdHlcIikpIHtcbiAgICAgIHVuaXRzID0gXCJyYXRpb1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIkh1bWlkaXR5IGZvcmVjYXN0ICgwLTEpXCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwicHJlY2lwXCIpICYmICFwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiUHJvYmFiaWxpdHlcIikpIHtcbiAgICAgIHVuaXRzID0gXCJtXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiUHJlY2lwaXRhdGlvbiBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlByb2JhYmlsaXR5XCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJDb3ZlclwiKSkge1xuICAgICAgdW5pdHMgPSBcInJhdGlvXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiUmF0aW8gZm9yZWNhc3QgKDAtMSlcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJEaXJlY3Rpb25cIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgdW5pdHMgPSBcInJhZFwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIkRpcmVjdGlvbiBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInZpc2liaWxpdHlcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlZpc2liaWxpdHlcIikpIHtcbiAgICAgIHVuaXRzID0gXCJtXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiVmlzaWJpbGl0eSBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIkhlaWdodFwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiaGVpZ2h0XCIpKSB7XG4gICAgICB1bml0cyA9IFwibVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIkhlaWdodCBmb3JlY2FzdFwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlBlcmlvZFwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwicGVyaW9kXCIpKSB7XG4gICAgICB1bml0cyA9IFwic1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlBlcmlvZCBmb3JlY2FzdFwiO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICB1bml0cyxcbiAgICAgIGRpc3BsYXlOYW1lOiBwYXJhbWV0ZXJOYW1lLFxuICAgICAgZGVzY3JpcHRpb24sXG4gICAgfTtcbiAgfTtcblxuICAvLyBQcm9jZXNzIGhvdXJseSB3ZWF0aGVyIGZvcmVjYXN0XG4gIGNvbnN0IHByb2Nlc3NIb3VybHlXZWF0aGVyRm9yZWNhc3QgPSAoXG4gICAgZGF0YTogT3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlLFxuICAgIG1heEhvdXJzOiBudW1iZXIsXG4gICk6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9PiB7XG4gICAgY29uc3QgZm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPSBbXTtcbiAgICBjb25zdCBob3VybHkgPSBkYXRhLmhvdXJseTtcbiAgICBpZiAoIWhvdXJseSB8fCAhaG91cmx5LnRpbWUpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGNvbnN0IHN0YXJ0SW5kZXggPSBob3VybHkudGltZS5maW5kSW5kZXgoXG4gICAgICAodCkgPT4gbmV3IERhdGUodCkgPj0gbm93LFxuICAgICk7XG4gICAgaWYgKHN0YXJ0SW5kZXggPT09IC0xKSByZXR1cm4gZm9yZWNhc3RzO1xuXG4gICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihtYXhIb3VycywgaG91cmx5LnRpbWUubGVuZ3RoIC0gc3RhcnRJbmRleCk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgIGNvbnN0IGRhdGFJbmRleCA9IHN0YXJ0SW5kZXggKyBpO1xuICAgICAgY29uc3QgZm9yZWNhc3Q6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgIHRpbWVzdGFtcDogaG91cmx5LnRpbWVbZGF0YUluZGV4XSxcbiAgICAgICAgcmVsYXRpdmVIb3VyOiBpLFxuICAgICAgfTtcblxuICAgICAgLy8gUHJvY2VzcyBlYWNoIGZpZWxkIHdpdGggdW5pdCBjb252ZXJzaW9ucyBhbmQgdHJhbnNsYXRlIGZpZWxkIG5hbWVzXG4gICAgICBPYmplY3QuZW50cmllcyhob3VybHkpLmZvckVhY2goKFtmaWVsZCwgdmFsdWVzXSkgPT4ge1xuICAgICAgICBpZiAoZmllbGQgPT09IFwidGltZVwiIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykpIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB2YWx1ZXNbZGF0YUluZGV4XTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybjtcblxuICAgICAgICAvLyBUcmFuc2xhdGUgZmllbGQgbmFtZSB0byBTaWduYWxLLWFsaWduZWQgbmFtZVxuICAgICAgICBjb25zdCB0cmFuc2xhdGVkRmllbGQgPSB0cmFuc2xhdGVGaWVsZE5hbWUoZmllbGQpO1xuXG4gICAgICAgIC8vIEFwcGx5IHVuaXQgY29udmVyc2lvbnNcbiAgICAgICAgaWYgKGZpZWxkLmluY2x1ZGVzKFwidGVtcGVyYXR1cmVcIikgfHwgZmllbGQgPT09IFwiZGV3X3BvaW50XzJtXCIgfHwgZmllbGQgPT09IFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBjZWxzaXVzVG9LZWx2aW4odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBkZWdUb1JhZCh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInByZWNpcGl0YXRpb25cIiB8fCBmaWVsZCA9PT0gXCJyYWluXCIgfHwgZmllbGQgPT09IFwic2hvd2Vyc1wiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IG1tVG9NKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwic25vd2ZhbGxcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBjbVRvTSh2YWx1ZSBhcyBudW1iZXIpOyAvLyBTbm93ZmFsbCBpcyBpbiBjbVxuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLmluY2x1ZGVzKFwicHJlc3N1cmVcIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gaFBhVG9QQSh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLmluY2x1ZGVzKFwiaHVtaWRpdHlcIikgfHwgZmllbGQuaW5jbHVkZXMoXCJjbG91ZF9jb3ZlclwiKSB8fCBmaWVsZCA9PT0gXCJwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5XCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gcGVyY2VudFRvUmF0aW8odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gXCJ2aXNpYmlsaXR5XCIpIHtcbiAgICAgICAgICAvLyBWaXNpYmlsaXR5IGlzIGFscmVhZHkgaW4gbWV0ZXJzIGZyb20gT3Blbi1NZXRlb1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBmb3JlY2FzdHMucHVzaChmb3JlY2FzdCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcmVjYXN0cztcbiAgfTtcblxuICAvLyBQcm9jZXNzIGRhaWx5IHdlYXRoZXIgZm9yZWNhc3RcbiAgY29uc3QgcHJvY2Vzc0RhaWx5V2VhdGhlckZvcmVjYXN0ID0gKFxuICAgIGRhdGE6IE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSxcbiAgICBtYXhEYXlzOiBudW1iZXIsXG4gICk6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9PiB7XG4gICAgY29uc3QgZm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPSBbXTtcbiAgICBjb25zdCBkYWlseSA9IGRhdGEuZGFpbHk7XG4gICAgaWYgKCFkYWlseSB8fCAhZGFpbHkudGltZSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IGNvdW50ID0gTWF0aC5taW4obWF4RGF5cywgZGFpbHkudGltZS5sZW5ndGgpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgZGF0ZTogZGFpbHkudGltZVtpXSxcbiAgICAgICAgZGF5SW5kZXg6IGksXG4gICAgICB9O1xuXG4gICAgICAvLyBQcm9jZXNzIGVhY2ggZmllbGQgd2l0aCB1bml0IGNvbnZlcnNpb25zIGFuZCB0cmFuc2xhdGUgZmllbGQgbmFtZXNcbiAgICAgIE9iamVjdC5lbnRyaWVzKGRhaWx5KS5mb3JFYWNoKChbZmllbGQsIHZhbHVlc10pID0+IHtcbiAgICAgICAgaWYgKGZpZWxkID09PSBcInRpbWVcIiB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZXMpKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVzW2ldO1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gICAgICAgIC8vIFRyYW5zbGF0ZSBmaWVsZCBuYW1lIHRvIFNpZ25hbEstYWxpZ25lZCBuYW1lXG4gICAgICAgIGNvbnN0IHRyYW5zbGF0ZWRGaWVsZCA9IHRyYW5zbGF0ZUZpZWxkTmFtZShmaWVsZCk7XG5cbiAgICAgICAgLy8gQXBwbHkgdW5pdCBjb252ZXJzaW9uc1xuICAgICAgICBpZiAoZmllbGQuaW5jbHVkZXMoXCJ0ZW1wZXJhdHVyZVwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBjZWxzaXVzVG9LZWx2aW4odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBkZWdUb1JhZCh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInByZWNpcGl0YXRpb25fc3VtXCIgfHwgZmllbGQgPT09IFwicmFpbl9zdW1cIiB8fCBmaWVsZCA9PT0gXCJzaG93ZXJzX3N1bVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IG1tVG9NKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwic25vd2ZhbGxfc3VtXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gY21Ub00odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gXCJwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5X21heFwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHBlcmNlbnRUb1JhdGlvKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZm9yZWNhc3RzLnB1c2goZm9yZWNhc3QpO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBob3VybHkgbWFyaW5lIGZvcmVjYXN0XG4gIGNvbnN0IHByb2Nlc3NIb3VybHlNYXJpbmVGb3JlY2FzdCA9IChcbiAgICBkYXRhOiBPcGVuTWV0ZW9NYXJpbmVSZXNwb25zZSxcbiAgICBtYXhIb3VyczogbnVtYmVyLFxuICApOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdID0gW107XG4gICAgY29uc3QgaG91cmx5ID0gZGF0YS5ob3VybHk7XG4gICAgaWYgKCFob3VybHkgfHwgIWhvdXJseS50aW1lKSByZXR1cm4gZm9yZWNhc3RzO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCBzdGFydEluZGV4ID0gaG91cmx5LnRpbWUuZmluZEluZGV4KFxuICAgICAgKHQpID0+IG5ldyBEYXRlKHQpID49IG5vdyxcbiAgICApO1xuICAgIGlmIChzdGFydEluZGV4ID09PSAtMSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IGNvdW50ID0gTWF0aC5taW4obWF4SG91cnMsIGhvdXJseS50aW1lLmxlbmd0aCAtIHN0YXJ0SW5kZXgpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICBjb25zdCBkYXRhSW5kZXggPSBzdGFydEluZGV4ICsgaTtcbiAgICAgIGNvbnN0IGZvcmVjYXN0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgICB0aW1lc3RhbXA6IGhvdXJseS50aW1lW2RhdGFJbmRleF0sXG4gICAgICAgIHJlbGF0aXZlSG91cjogaSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFByb2Nlc3MgZWFjaCBmaWVsZCB3aXRoIHVuaXQgY29udmVyc2lvbnMgYW5kIHRyYW5zbGF0ZSBmaWVsZCBuYW1lc1xuICAgICAgT2JqZWN0LmVudHJpZXMoaG91cmx5KS5mb3JFYWNoKChbZmllbGQsIHZhbHVlc10pID0+IHtcbiAgICAgICAgaWYgKGZpZWxkID09PSBcInRpbWVcIiB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZXMpKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVzW2RhdGFJbmRleF07XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSByZXR1cm47XG5cbiAgICAgICAgLy8gVHJhbnNsYXRlIGZpZWxkIG5hbWUgdG8gU2lnbmFsSy1hbGlnbmVkIG5hbWVcbiAgICAgICAgY29uc3QgdHJhbnNsYXRlZEZpZWxkID0gdHJhbnNsYXRlRmllbGROYW1lKGZpZWxkKTtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJzZWFfc3VyZmFjZV90ZW1wZXJhdHVyZVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGNlbHNpdXNUb0tlbHZpbih2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkLmluY2x1ZGVzKFwiZGlyZWN0aW9uXCIpKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGRlZ1RvUmFkKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwib2NlYW5fY3VycmVudF92ZWxvY2l0eVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGttaFRvTXModmFsdWUgYXMgbnVtYmVyKTsgLy8gQ3VycmVudCB2ZWxvY2l0eSBpcyBpbiBrbS9oXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gV2F2ZSBoZWlnaHRzLCBwZXJpb2RzIGFyZSBhbHJlYWR5IGluIG1ldGVycy9zZWNvbmRzXG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZm9yZWNhc3RzLnB1c2goZm9yZWNhc3QpO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBkYWlseSBtYXJpbmUgZm9yZWNhc3RcbiAgY29uc3QgcHJvY2Vzc0RhaWx5TWFyaW5lRm9yZWNhc3QgPSAoXG4gICAgZGF0YTogT3Blbk1ldGVvTWFyaW5lUmVzcG9uc2UsXG4gICAgbWF4RGF5czogbnVtYmVyLFxuICApOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdID0gW107XG4gICAgY29uc3QgZGFpbHkgPSBkYXRhLmRhaWx5O1xuICAgIGlmICghZGFpbHkgfHwgIWRhaWx5LnRpbWUpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKG1heERheXMsIGRhaWx5LnRpbWUubGVuZ3RoKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgY29uc3QgZm9yZWNhc3Q6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgIGRhdGU6IGRhaWx5LnRpbWVbaV0sXG4gICAgICAgIGRheUluZGV4OiBpLFxuICAgICAgfTtcblxuICAgICAgLy8gUHJvY2VzcyBlYWNoIGZpZWxkIHdpdGggdW5pdCBjb252ZXJzaW9ucyBhbmQgdHJhbnNsYXRlIGZpZWxkIG5hbWVzXG4gICAgICBPYmplY3QuZW50cmllcyhkYWlseSkuZm9yRWFjaCgoW2ZpZWxkLCB2YWx1ZXNdKSA9PiB7XG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJ0aW1lXCIgfHwgIUFycmF5LmlzQXJyYXkodmFsdWVzKSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHZhbHVlc1tpXTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybjtcblxuICAgICAgICAvLyBUcmFuc2xhdGUgZmllbGQgbmFtZSB0byBTaWduYWxLLWFsaWduZWQgbmFtZVxuICAgICAgICBjb25zdCB0cmFuc2xhdGVkRmllbGQgPSB0cmFuc2xhdGVGaWVsZE5hbWUoZmllbGQpO1xuXG4gICAgICAgIC8vIEFwcGx5IHVuaXQgY29udmVyc2lvbnNcbiAgICAgICAgaWYgKGZpZWxkLmluY2x1ZGVzKFwiZGlyZWN0aW9uXCIpKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGRlZ1RvUmFkKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZm9yZWNhc3RzLnB1c2goZm9yZWNhc3QpO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gUHVibGlzaCBob3VybHkgZm9yZWNhc3RzIGZvciBhIHNpbmdsZSBwYWNrYWdlICh3ZWF0aGVyIG9yIG1hcmluZSkgLSBiYXRjaGVkIGludG8gb25lIGRlbHRhXG4gIGNvbnN0IHB1Ymxpc2hIb3VybHlQYWNrYWdlID0gKFxuICAgIGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdLFxuICAgIHBhY2thZ2VUeXBlOiBzdHJpbmcsXG4gICk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IHNvdXJjZUxhYmVsID0gZ2V0U291cmNlTGFiZWwoYGhvdXJseS0ke3BhY2thZ2VUeXBlfWApO1xuICAgIGNvbnN0IGFsbFZhbHVlczogeyBwYXRoOiBzdHJpbmc7IHZhbHVlOiBhbnkgfVtdID0gW107XG4gICAgY29uc3QgYWxsTWV0YTogeyBwYXRoOiBzdHJpbmc7IHZhbHVlOiBhbnkgfVtdID0gW107XG5cbiAgICAvLyBDb2xsZWN0IGFsbCB2YWx1ZXMgZnJvbSBhbGwgaG91cnMgaW50byBzaW5nbGUgYXJyYXlzXG4gICAgZm9yZWNhc3RzLmZvckVhY2goKGZvcmVjYXN0LCBpbmRleCkgPT4ge1xuICAgICAgT2JqZWN0LmVudHJpZXMoZm9yZWNhc3QpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcInRpbWVzdGFtcFwiIHx8IGtleSA9PT0gXCJyZWxhdGl2ZUhvdXJcIikgcmV0dXJuO1xuICAgICAgICBjb25zdCBwYXRoID0gYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmhvdXJseS4ke2tleX0uJHtpbmRleH1gO1xuICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGdldFBhcmFtZXRlck1ldGFkYXRhKGtleSk7XG4gICAgICAgIGFsbFZhbHVlcy5wdXNoKHsgcGF0aCwgdmFsdWUgfSk7XG4gICAgICAgIGFsbE1ldGEucHVzaCh7IHBhdGgsIHZhbHVlOiBtZXRhZGF0YSB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaWYgKGFsbFZhbHVlcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIC8vIFNlbmQgYWxsIHZhbHVlcyBpbiBvbmUgZGVsdGEgbWVzc2FnZVxuICAgIGNvbnN0IGRlbHRhOiBTaWduYWxLRGVsdGEgPSB7XG4gICAgICBjb250ZXh0OiBcInZlc3NlbHMuc2VsZlwiLFxuICAgICAgdXBkYXRlczogW1xuICAgICAgICB7XG4gICAgICAgICAgJHNvdXJjZTogc291cmNlTGFiZWwsXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgdmFsdWVzOiBhbGxWYWx1ZXMsXG4gICAgICAgICAgbWV0YTogYWxsTWV0YSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfTtcblxuICAgIGFwcC5oYW5kbGVNZXNzYWdlKHBsdWdpbi5pZCwgZGVsdGEpO1xuICAgIGFwcC5kZWJ1ZyhgUHVibGlzaGVkICR7Zm9yZWNhc3RzLmxlbmd0aH0gaG91cmx5ICR7cGFja2FnZVR5cGV9IGZvcmVjYXN0cyAoJHthbGxWYWx1ZXMubGVuZ3RofSB2YWx1ZXMgaW4gMSBtZXNzYWdlKWApO1xuICB9O1xuXG4gIC8vIFB1Ymxpc2ggZGFpbHkgZm9yZWNhc3RzIGZvciBhIHNpbmdsZSBwYWNrYWdlICh3ZWF0aGVyIG9yIG1hcmluZSkgLSBiYXRjaGVkIGludG8gb25lIGRlbHRhXG4gIGNvbnN0IHB1Ymxpc2hEYWlseVBhY2thZ2UgPSAoXG4gICAgZm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10sXG4gICAgcGFja2FnZVR5cGU6IHN0cmluZyxcbiAgKTogdm9pZCA9PiB7XG4gICAgY29uc3Qgc291cmNlTGFiZWwgPSBnZXRTb3VyY2VMYWJlbChgZGFpbHktJHtwYWNrYWdlVHlwZX1gKTtcbiAgICBjb25zdCBhbGxWYWx1ZXM6IHsgcGF0aDogc3RyaW5nOyB2YWx1ZTogYW55IH1bXSA9IFtdO1xuICAgIGNvbnN0IGFsbE1ldGE6IHsgcGF0aDogc3RyaW5nOyB2YWx1ZTogYW55IH1bXSA9IFtdO1xuXG4gICAgLy8gQ29sbGVjdCBhbGwgdmFsdWVzIGZyb20gYWxsIGRheXMgaW50byBzaW5nbGUgYXJyYXlzXG4gICAgZm9yZWNhc3RzLmZvckVhY2goKGZvcmVjYXN0LCBpbmRleCkgPT4ge1xuICAgICAgT2JqZWN0LmVudHJpZXMoZm9yZWNhc3QpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSBcImRhdGVcIiB8fCBrZXkgPT09IFwiZGF5SW5kZXhcIikgcmV0dXJuO1xuICAgICAgICBjb25zdCBwYXRoID0gYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmRhaWx5LiR7a2V5fS4ke2luZGV4fWA7XG4gICAgICAgIGNvbnN0IG1ldGFkYXRhID0gZ2V0UGFyYW1ldGVyTWV0YWRhdGEoa2V5KTtcbiAgICAgICAgYWxsVmFsdWVzLnB1c2goeyBwYXRoLCB2YWx1ZSB9KTtcbiAgICAgICAgYWxsTWV0YS5wdXNoKHsgcGF0aCwgdmFsdWU6IG1ldGFkYXRhIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBpZiAoYWxsVmFsdWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgLy8gU2VuZCBhbGwgdmFsdWVzIGluIG9uZSBkZWx0YSBtZXNzYWdlXG4gICAgY29uc3QgZGVsdGE6IFNpZ25hbEtEZWx0YSA9IHtcbiAgICAgIGNvbnRleHQ6IFwidmVzc2Vscy5zZWxmXCIsXG4gICAgICB1cGRhdGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICAkc291cmNlOiBzb3VyY2VMYWJlbCxcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB2YWx1ZXM6IGFsbFZhbHVlcyxcbiAgICAgICAgICBtZXRhOiBhbGxNZXRhLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9O1xuXG4gICAgYXBwLmhhbmRsZU1lc3NhZ2UocGx1Z2luLmlkLCBkZWx0YSk7XG4gICAgYXBwLmRlYnVnKGBQdWJsaXNoZWQgJHtmb3JlY2FzdHMubGVuZ3RofSBkYWlseSAke3BhY2thZ2VUeXBlfSBmb3JlY2FzdHMgKCR7YWxsVmFsdWVzLmxlbmd0aH0gdmFsdWVzIGluIDEgbWVzc2FnZSlgKTtcbiAgfTtcblxuICAvLyBGZXRjaCBmb3JlY2FzdHMgZm9yIGEgbW92aW5nIHZlc3NlbCAocG9zaXRpb24tc3BlY2lmaWMgZm9yZWNhc3RzIGFsb25nIHByZWRpY3RlZCByb3V0ZSlcbiAgY29uc3QgZmV0Y2hGb3JlY2FzdEZvck1vdmluZ1Zlc3NlbCA9IGFzeW5jIChcbiAgICBjb25maWc6IFBsdWdpbkNvbmZpZyxcbiAgKTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgaWYgKFxuICAgICAgIXN0YXRlLmN1cnJlbnRQb3NpdGlvbiB8fFxuICAgICAgIXN0YXRlLmN1cnJlbnRIZWFkaW5nIHx8XG4gICAgICAhc3RhdGUuY3VycmVudFNPRyB8fFxuICAgICAgIWlzVmVzc2VsTW92aW5nKHN0YXRlLmN1cnJlbnRTT0csIGNvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZCkgfHxcbiAgICAgICFzdGF0ZS5tb3ZpbmdGb3JlY2FzdEVuZ2FnZWRcbiAgICApIHtcbiAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgXCJWZXNzZWwgbm90IG1vdmluZywgbWlzc2luZyBuYXZpZ2F0aW9uIGRhdGEsIG9yIG1vdmluZyBmb3JlY2FzdCBub3QgZW5nYWdlZCwgZmFsbGluZyBiYWNrIHRvIHN0YXRpb25hcnkgZm9yZWNhc3RcIixcbiAgICAgICk7XG4gICAgICByZXR1cm4gZmV0Y2hBbmRQdWJsaXNoRm9yZWNhc3RzKGNvbmZpZyk7XG4gICAgfVxuXG4gICAgYXBwLmRlYnVnKFxuICAgICAgYFZlc3NlbCBtb3ZpbmcgYXQgJHsoc3RhdGUuY3VycmVudFNPRyAqIDEuOTQzODQ0KS50b0ZpeGVkKDEpfSBrbm90cyAodGhyZXNob2xkOiAke2NvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZH0ga25vdHMpLCBoZWFkaW5nICR7cmFkVG9EZWcoc3RhdGUuY3VycmVudEhlYWRpbmcpLnRvRml4ZWQoMSl9wrBgLFxuICAgICk7XG4gICAgYXBwLmRlYnVnKFxuICAgICAgYEZldGNoaW5nIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0cyBmb3IgJHtjb25maWcubWF4Rm9yZWNhc3RIb3Vyc30gaG91cnNgLFxuICAgICk7XG5cbiAgICAvLyBDYXB0dXJlIHZhbGlkYXRlZCBzdGF0ZSBmb3IgdXNlIGluIGhlbHBlciBmdW5jdGlvbnNcbiAgICBjb25zdCBjdXJyZW50UG9zaXRpb24gPSBzdGF0ZS5jdXJyZW50UG9zaXRpb24hO1xuICAgIGNvbnN0IGN1cnJlbnRIZWFkaW5nID0gc3RhdGUuY3VycmVudEhlYWRpbmchO1xuICAgIGNvbnN0IGN1cnJlbnRTT0cgPSBzdGF0ZS5jdXJyZW50U09HITtcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgY29uc3QgY3VycmVudEhvdXIgPSBuZXcgRGF0ZShcbiAgICAgIG5vdy5nZXRGdWxsWWVhcigpLFxuICAgICAgbm93LmdldE1vbnRoKCksXG4gICAgICBub3cuZ2V0RGF0ZSgpLFxuICAgICAgbm93LmdldEhvdXJzKCksXG4gICAgICAwLFxuICAgICAgMCxcbiAgICAgIDAsXG4gICAgKTtcblxuICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmZXRjaCBmb3JlY2FzdCBmb3IgYSBzaW5nbGUgaG91clxuICAgIGNvbnN0IGZldGNoSG91ckZvcmVjYXN0ID0gYXN5bmMgKGhvdXI6IG51bWJlcik6IFByb21pc2U8e1xuICAgICAgaG91cjogbnVtYmVyO1xuICAgICAgcHJlZGljdGVkUG9zOiBQb3NpdGlvbjtcbiAgICAgIHRhcmdldFRpbWU6IERhdGU7XG4gICAgICB3ZWF0aGVyRGF0YTogT3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlIHwgbnVsbDtcbiAgICAgIG1hcmluZURhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbDtcbiAgICB9IHwgbnVsbD4gPT4ge1xuICAgICAgY29uc3QgcHJlZGljdGVkUG9zID0gY2FsY3VsYXRlRnV0dXJlUG9zaXRpb24oXG4gICAgICAgIGN1cnJlbnRQb3NpdGlvbixcbiAgICAgICAgY3VycmVudEhlYWRpbmcsXG4gICAgICAgIGN1cnJlbnRTT0csXG4gICAgICAgIGhvdXIsXG4gICAgICApO1xuICAgICAgY29uc3QgdGFyZ2V0VGltZSA9IG5ldyBEYXRlKGN1cnJlbnRIb3VyLmdldFRpbWUoKSArIGhvdXIgKiAzNjAwMDAwKTtcblxuICAgICAgYXBwLmRlYnVnKFxuICAgICAgICBgSG91ciAke2hvdXJ9OiBGZXRjaGluZyB3ZWF0aGVyIGZvciBwb3NpdGlvbiAke3ByZWRpY3RlZFBvcy5sYXRpdHVkZS50b0ZpeGVkKDYpfSwgJHtwcmVkaWN0ZWRQb3MubG9uZ2l0dWRlLnRvRml4ZWQoNil9YCxcbiAgICAgICk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHdlYXRoZXJEYXRhID0gYXdhaXQgZmV0Y2hXZWF0aGVyRGF0YShwcmVkaWN0ZWRQb3MsIGNvbmZpZyk7XG4gICAgICAgIGNvbnN0IG1hcmluZURhdGEgPVxuICAgICAgICAgIGNvbmZpZy5lbmFibGVNYXJpbmVIb3VybHkgfHwgY29uZmlnLmVuYWJsZU1hcmluZURhaWx5XG4gICAgICAgICAgICA/IGF3YWl0IGZldGNoTWFyaW5lRGF0YShwcmVkaWN0ZWRQb3MsIGNvbmZpZylcbiAgICAgICAgICAgIDogbnVsbDtcblxuICAgICAgICByZXR1cm4geyBob3VyLCBwcmVkaWN0ZWRQb3MsIHRhcmdldFRpbWUsIHdlYXRoZXJEYXRhLCBtYXJpbmVEYXRhIH07XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgYXBwLmRlYnVnKGBIb3VyICR7aG91cn06IEZldGNoIGZhaWxlZCAtICR7ZXJyfWApO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEZldGNoIGZvcmVjYXN0cyBpbiBwYXJhbGxlbCBiYXRjaGVzICg1IGNvbmN1cnJlbnQgcmVxdWVzdHMpXG4gICAgICBjb25zdCBCQVRDSF9TSVpFID0gNTtcbiAgICAgIGNvbnN0IEJBVENIX0RFTEFZX01TID0gMjAwO1xuXG4gICAgICBjb25zdCBhbGxSZXN1bHRzOiBBcnJheTx7XG4gICAgICAgIGhvdXI6IG51bWJlcjtcbiAgICAgICAgcHJlZGljdGVkUG9zOiBQb3NpdGlvbjtcbiAgICAgICAgdGFyZ2V0VGltZTogRGF0ZTtcbiAgICAgICAgd2VhdGhlckRhdGE6IE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSB8IG51bGw7XG4gICAgICAgIG1hcmluZURhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbDtcbiAgICAgIH0+ID0gW107XG5cbiAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgYEZldGNoaW5nICR7Y29uZmlnLm1heEZvcmVjYXN0SG91cnN9IGhvdXJseSBmb3JlY2FzdHMgaW4gYmF0Y2hlcyBvZiAke0JBVENIX1NJWkV9YCxcbiAgICAgICk7XG5cbiAgICAgIGZvciAoXG4gICAgICAgIGxldCBiYXRjaFN0YXJ0ID0gMDtcbiAgICAgICAgYmF0Y2hTdGFydCA8IGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzO1xuICAgICAgICBiYXRjaFN0YXJ0ICs9IEJBVENIX1NJWkVcbiAgICAgICkge1xuICAgICAgICBjb25zdCBiYXRjaEVuZCA9IE1hdGgubWluKFxuICAgICAgICAgIGJhdGNoU3RhcnQgKyBCQVRDSF9TSVpFLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzLFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBiYXRjaEhvdXJzID0gQXJyYXkuZnJvbShcbiAgICAgICAgICB7IGxlbmd0aDogYmF0Y2hFbmQgLSBiYXRjaFN0YXJ0IH0sXG4gICAgICAgICAgKF8sIGkpID0+IGJhdGNoU3RhcnQgKyBpLFxuICAgICAgICApO1xuXG4gICAgICAgIGFwcC5kZWJ1ZyhgRmV0Y2hpbmcgYmF0Y2g6IGhvdXJzICR7YmF0Y2hTdGFydH0tJHtiYXRjaEVuZCAtIDF9YCk7XG5cbiAgICAgICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgYmF0Y2hIb3Vycy5tYXAoKGhvdXIpID0+IGZldGNoSG91ckZvcmVjYXN0KGhvdXIpKSxcbiAgICAgICAgKTtcblxuICAgICAgICBiYXRjaFJlc3VsdHMuZm9yRWFjaCgocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgYWxsUmVzdWx0cy5wdXNoKHJlc3VsdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoYmF0Y2hFbmQgPCBjb25maWcubWF4Rm9yZWNhc3RIb3Vycykge1xuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIEJBVENIX0RFTEFZX01TKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUHJvY2VzcyBhbmQgcHVibGlzaCB3ZWF0aGVyIGhvdXJseSBmb3JlY2FzdHNcbiAgICAgIGlmIChjb25maWcuZW5hYmxlSG91cmx5V2VhdGhlcikge1xuICAgICAgICBjb25zdCBob3VybHlXZWF0aGVyRm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPSBbXTtcblxuICAgICAgICBhbGxSZXN1bHRzLmZvckVhY2goKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHQud2VhdGhlckRhdGE/LmhvdXJseSkge1xuICAgICAgICAgICAgY29uc3QgaG91cmx5RGF0YSA9IHJlc3VsdC53ZWF0aGVyRGF0YS5ob3VybHk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRIb3VyID0gcmVzdWx0LnRhcmdldFRpbWUuZ2V0SG91cnMoKTtcblxuICAgICAgICAgICAgLy8gRmluZCBtYXRjaGluZyBob3VyIGluIHRoZSByZXNwb25zZVxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSBob3VybHlEYXRhLnRpbWUgfHwgW107XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGZvcmVjYXN0VGltZSA9IG5ldyBEYXRlKHRpbWVzW2ldKTtcbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZvcmVjYXN0VGltZS5nZXRGdWxsWWVhcigpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXRGdWxsWWVhcigpICYmXG4gICAgICAgICAgICAgICAgZm9yZWNhc3RUaW1lLmdldE1vbnRoKCkgPT09IHJlc3VsdC50YXJnZXRUaW1lLmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0RGF0ZSgpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0SG91cnMoKSA9PT0gdGFyZ2V0SG91clxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3RUaW1lLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwcmVkaWN0ZWRMYXRpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHByZWRpY3RlZExvbmdpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sb25naXR1ZGUsXG4gICAgICAgICAgICAgICAgICB2ZXNzZWxNb3Zpbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgYWxsIGhvdXJseSBmaWVsZHMgZm9yIHRoaXMgdGltZSBpbmRleFxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKGhvdXJseURhdGEpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gXCJ0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsdWVzID0gKGhvdXJseURhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55Pilba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWVzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIGZvcmVjYXN0W2tleV0gPSB2YWx1ZXNbaV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGhvdXJseVdlYXRoZXJGb3JlY2FzdHMucHVzaChmb3JlY2FzdCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChob3VybHlXZWF0aGVyRm9yZWNhc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBwdWJsaXNoSG91cmx5UGFja2FnZShob3VybHlXZWF0aGVyRm9yZWNhc3RzLCBcIndlYXRoZXJcIik7XG4gICAgICAgICAgYXBwLmRlYnVnKFxuICAgICAgICAgICAgYFB1Ymxpc2hlZCAke2hvdXJseVdlYXRoZXJGb3JlY2FzdHMubGVuZ3RofSBwb3NpdGlvbi1zcGVjaWZpYyB3ZWF0aGVyIGZvcmVjYXN0c2AsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBQcm9jZXNzIGFuZCBwdWJsaXNoIG1hcmluZSBob3VybHkgZm9yZWNhc3RzXG4gICAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZUhvdXJseSkge1xuICAgICAgICBjb25zdCBob3VybHlNYXJpbmVGb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuXG4gICAgICAgIGFsbFJlc3VsdHMuZm9yRWFjaCgocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5tYXJpbmVEYXRhPy5ob3VybHkpIHtcbiAgICAgICAgICAgIGNvbnN0IGhvdXJseURhdGEgPSByZXN1bHQubWFyaW5lRGF0YS5ob3VybHk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRIb3VyID0gcmVzdWx0LnRhcmdldFRpbWUuZ2V0SG91cnMoKTtcblxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSBob3VybHlEYXRhLnRpbWUgfHwgW107XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGZvcmVjYXN0VGltZSA9IG5ldyBEYXRlKHRpbWVzW2ldKTtcbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZvcmVjYXN0VGltZS5nZXRGdWxsWWVhcigpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXRGdWxsWWVhcigpICYmXG4gICAgICAgICAgICAgICAgZm9yZWNhc3RUaW1lLmdldE1vbnRoKCkgPT09IHJlc3VsdC50YXJnZXRUaW1lLmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0RGF0ZSgpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0SG91cnMoKSA9PT0gdGFyZ2V0SG91clxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3RUaW1lLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwcmVkaWN0ZWRMYXRpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHByZWRpY3RlZExvbmdpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sb25naXR1ZGUsXG4gICAgICAgICAgICAgICAgICB2ZXNzZWxNb3Zpbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKGhvdXJseURhdGEpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gXCJ0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsdWVzID0gKGhvdXJseURhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55Pilba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWVzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIGZvcmVjYXN0W2tleV0gPSB2YWx1ZXNbaV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGhvdXJseU1hcmluZUZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGhvdXJseU1hcmluZUZvcmVjYXN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcHVibGlzaEhvdXJseVBhY2thZ2UoaG91cmx5TWFyaW5lRm9yZWNhc3RzLCBcIm1hcmluZVwiKTtcbiAgICAgICAgICBhcHAuZGVidWcoXG4gICAgICAgICAgICBgUHVibGlzaGVkICR7aG91cmx5TWFyaW5lRm9yZWNhc3RzLmxlbmd0aH0gcG9zaXRpb24tc3BlY2lmaWMgbWFyaW5lIGZvcmVjYXN0c2AsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBEYWlseSBmb3JlY2FzdHMgc3RpbGwgdXNlIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgIGlmIChjb25maWcuZW5hYmxlRGFpbHlXZWF0aGVyICYmIGFsbFJlc3VsdHNbMF0/LndlYXRoZXJEYXRhKSB7XG4gICAgICAgIGNvbnN0IGRhaWx5V2VhdGhlciA9IHByb2Nlc3NEYWlseVdlYXRoZXJGb3JlY2FzdChcbiAgICAgICAgICBhbGxSZXN1bHRzWzBdLndlYXRoZXJEYXRhLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdERheXMsXG4gICAgICAgICk7XG4gICAgICAgIGlmIChkYWlseVdlYXRoZXIubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHB1Ymxpc2hEYWlseVBhY2thZ2UoZGFpbHlXZWF0aGVyLCBcIndlYXRoZXJcIik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGNvbmZpZy5lbmFibGVNYXJpbmVEYWlseSAmJiBhbGxSZXN1bHRzWzBdPy5tYXJpbmVEYXRhKSB7XG4gICAgICAgIGNvbnN0IGRhaWx5TWFyaW5lID0gcHJvY2Vzc0RhaWx5TWFyaW5lRm9yZWNhc3QoXG4gICAgICAgICAgYWxsUmVzdWx0c1swXS5tYXJpbmVEYXRhLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdERheXMsXG4gICAgICAgICk7XG4gICAgICAgIGlmIChkYWlseU1hcmluZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcHVibGlzaERhaWx5UGFja2FnZShkYWlseU1hcmluZSwgXCJtYXJpbmVcIik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgc3RhdGUubGFzdEZvcmVjYXN0VXBkYXRlID0gRGF0ZS5ub3coKTtcbiAgICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJBY3RpdmUgLSBNb3ZpbmcgdmVzc2VsIGZvcmVjYXN0cyB1cGRhdGVkXCIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvck1zZyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGFwcC5lcnJvcihgRmFpbGVkIHRvIGZldGNoIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0czogJHtlcnJvck1zZ31gKTtcbiAgICAgIGFwcC5kZWJ1ZyhcIkZhbGxpbmcgYmFjayB0byBzdGF0aW9uYXJ5IGZvcmVjYXN0XCIpO1xuICAgICAgcmV0dXJuIGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhjb25maWcpO1xuICAgIH1cbiAgfTtcblxuICAvLyBGZXRjaCBhbmQgcHVibGlzaCBhbGwgZm9yZWNhc3RzXG4gIGNvbnN0IGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyA9IGFzeW5jIChjb25maWc6IFBsdWdpbkNvbmZpZykgPT4ge1xuICAgIGlmICghc3RhdGUuY3VycmVudFBvc2l0aW9uKSB7XG4gICAgICBhcHAuZGVidWcoXCJObyBwb3NpdGlvbiBhdmFpbGFibGUsIHNraXBwaW5nIGZvcmVjYXN0IGZldGNoXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBvc2l0aW9uID0gc3RhdGUuY3VycmVudFBvc2l0aW9uO1xuXG4gICAgLy8gRmV0Y2ggd2VhdGhlciBhbmQgbWFyaW5lIGRhdGEgaW4gcGFyYWxsZWxcbiAgICBjb25zdCBuZWVkc01hcmluZSA9IGNvbmZpZy5lbmFibGVNYXJpbmVIb3VybHkgfHwgY29uZmlnLmVuYWJsZU1hcmluZURhaWx5O1xuICAgIGNvbnN0IFt3ZWF0aGVyRGF0YSwgbWFyaW5lRGF0YV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBmZXRjaFdlYXRoZXJEYXRhKHBvc2l0aW9uLCBjb25maWcpLFxuICAgICAgbmVlZHNNYXJpbmUgPyBmZXRjaE1hcmluZURhdGEocG9zaXRpb24sIGNvbmZpZykgOiBQcm9taXNlLnJlc29sdmUobnVsbCksXG4gICAgXSk7XG5cbiAgICBpZiAoIXdlYXRoZXJEYXRhICYmICFtYXJpbmVEYXRhKSB7XG4gICAgICBhcHAuZXJyb3IoXCJGYWlsZWQgdG8gZmV0Y2ggYW55IGZvcmVjYXN0IGRhdGFcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBhbmQgcHVibGlzaCBob3VybHkgZm9yZWNhc3RzIC0gc2VwYXJhdGUgcGFja2FnZXMgbGlrZSBtZXRlb2JsdWVcbiAgICBpZiAoY29uZmlnLmVuYWJsZUhvdXJseVdlYXRoZXIgJiYgd2VhdGhlckRhdGEpIHtcbiAgICAgIGNvbnN0IGhvdXJseVdlYXRoZXIgPSBwcm9jZXNzSG91cmx5V2VhdGhlckZvcmVjYXN0KHdlYXRoZXJEYXRhLCBjb25maWcubWF4Rm9yZWNhc3RIb3Vycyk7XG4gICAgICBpZiAoaG91cmx5V2VhdGhlci5sZW5ndGggPiAwKSB7XG4gICAgICAgIHB1Ymxpc2hIb3VybHlQYWNrYWdlKGhvdXJseVdlYXRoZXIsIFwid2VhdGhlclwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZUhvdXJseSAmJiBtYXJpbmVEYXRhKSB7XG4gICAgICBjb25zdCBob3VybHlNYXJpbmUgPSBwcm9jZXNzSG91cmx5TWFyaW5lRm9yZWNhc3QobWFyaW5lRGF0YSwgY29uZmlnLm1heEZvcmVjYXN0SG91cnMpO1xuICAgICAgaWYgKGhvdXJseU1hcmluZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHB1Ymxpc2hIb3VybHlQYWNrYWdlKGhvdXJseU1hcmluZSwgXCJtYXJpbmVcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBhbmQgcHVibGlzaCBkYWlseSBmb3JlY2FzdHMgLSBzZXBhcmF0ZSBwYWNrYWdlcyBsaWtlIG1ldGVvYmx1ZVxuICAgIGlmIChjb25maWcuZW5hYmxlRGFpbHlXZWF0aGVyICYmIHdlYXRoZXJEYXRhKSB7XG4gICAgICBjb25zdCBkYWlseVdlYXRoZXIgPSBwcm9jZXNzRGFpbHlXZWF0aGVyRm9yZWNhc3Qod2VhdGhlckRhdGEsIGNvbmZpZy5tYXhGb3JlY2FzdERheXMpO1xuICAgICAgaWYgKGRhaWx5V2VhdGhlci5sZW5ndGggPiAwKSB7XG4gICAgICAgIHB1Ymxpc2hEYWlseVBhY2thZ2UoZGFpbHlXZWF0aGVyLCBcIndlYXRoZXJcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy5lbmFibGVNYXJpbmVEYWlseSAmJiBtYXJpbmVEYXRhKSB7XG4gICAgICBjb25zdCBkYWlseU1hcmluZSA9IHByb2Nlc3NEYWlseU1hcmluZUZvcmVjYXN0KG1hcmluZURhdGEsIGNvbmZpZy5tYXhGb3JlY2FzdERheXMpO1xuICAgICAgaWYgKGRhaWx5TWFyaW5lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcHVibGlzaERhaWx5UGFja2FnZShkYWlseU1hcmluZSwgXCJtYXJpbmVcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgc3RhdGUubGFzdEZvcmVjYXN0VXBkYXRlID0gRGF0ZS5ub3coKTtcbiAgICBhcHAuc2V0UGx1Z2luU3RhdHVzKFwiQWN0aXZlIC0gRm9yZWNhc3RzIHVwZGF0ZWRcIik7XG4gIH07XG5cbiAgLy8gV2VhdGhlciBBUEkgcHJvdmlkZXIgaW1wbGVtZW50YXRpb24gKHVzaW5nIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcylcbiAgY29uc3QgY29udmVydFRvV2VhdGhlckFQSUZvcmVjYXN0ID0gKFxuICAgIGZvcmVjYXN0RGF0YTogYW55LFxuICAgIHR5cGU6IFdlYXRoZXJGb3JlY2FzdFR5cGUsXG4gICk6IFdlYXRoZXJEYXRhID0+IHtcbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZTogZm9yZWNhc3REYXRhLnRpbWVzdGFtcCB8fCBmb3JlY2FzdERhdGEuZGF0ZSB8fCBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB0eXBlLFxuICAgICAgZGVzY3JpcHRpb246IGdldFdlYXRoZXJEZXNjcmlwdGlvbihcbiAgICAgICAgZm9yZWNhc3REYXRhLndlYXRoZXJDb2RlLFxuICAgICAgICBcIk9wZW4tTWV0ZW8gd2VhdGhlclwiLFxuICAgICAgKSxcbiAgICAgIGxvbmdEZXNjcmlwdGlvbjogZ2V0V2VhdGhlckxvbmdEZXNjcmlwdGlvbihcbiAgICAgICAgZm9yZWNhc3REYXRhLndlYXRoZXJDb2RlLFxuICAgICAgICBcIk9wZW4tTWV0ZW8gd2VhdGhlciBmb3JlY2FzdFwiLFxuICAgICAgKSxcbiAgICAgIGljb246IGdldFdlYXRoZXJJY29uKGZvcmVjYXN0RGF0YS53ZWF0aGVyQ29kZSwgZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQpLFxuICAgICAgb3V0c2lkZToge1xuICAgICAgICB0ZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmFpclRlbXBlcmF0dXJlLFxuICAgICAgICBtYXhUZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmFpclRlbXBIaWdoLFxuICAgICAgICBtaW5UZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmFpclRlbXBMb3csXG4gICAgICAgIGZlZWxzTGlrZVRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEuZmVlbHNMaWtlIHx8IGZvcmVjYXN0RGF0YS5mZWVsc0xpa2VIaWdoLFxuICAgICAgICBwcmVzc3VyZTogZm9yZWNhc3REYXRhLnNlYUxldmVsUHJlc3N1cmUsXG4gICAgICAgIHJlbGF0aXZlSHVtaWRpdHk6IGZvcmVjYXN0RGF0YS5yZWxhdGl2ZUh1bWlkaXR5LFxuICAgICAgICB1dkluZGV4OiBmb3JlY2FzdERhdGEudXZJbmRleCB8fCBmb3JlY2FzdERhdGEudXZJbmRleE1heCxcbiAgICAgICAgY2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLmNsb3VkQ292ZXIsXG4gICAgICAgIHByZWNpcGl0YXRpb25Wb2x1bWU6IGZvcmVjYXN0RGF0YS5wcmVjaXAgfHwgZm9yZWNhc3REYXRhLnByZWNpcFN1bSxcbiAgICAgICAgZGV3UG9pbnRUZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmRld1BvaW50LFxuICAgICAgICBob3Jpem9udGFsVmlzaWJpbGl0eTogZm9yZWNhc3REYXRhLnZpc2liaWxpdHksXG4gICAgICAgIHByZWNpcGl0YXRpb25Qcm9iYWJpbGl0eTogZm9yZWNhc3REYXRhLnByZWNpcFByb2JhYmlsaXR5IHx8IGZvcmVjYXN0RGF0YS5wcmVjaXBQcm9iYWJpbGl0eU1heCxcbiAgICAgICAgbG93Q2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLmxvd0Nsb3VkQ292ZXIsXG4gICAgICAgIG1pZENsb3VkQ292ZXI6IGZvcmVjYXN0RGF0YS5taWRDbG91ZENvdmVyLFxuICAgICAgICBoaWdoQ2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLmhpZ2hDbG91ZENvdmVyLFxuICAgICAgICBzb2xhclJhZGlhdGlvbjogZm9yZWNhc3REYXRhLnNvbGFyUmFkaWF0aW9uIHx8IGZvcmVjYXN0RGF0YS5zb2xhclJhZGlhdGlvblN1bSxcbiAgICAgICAgZGlyZWN0Tm9ybWFsSXJyYWRpYW5jZTogZm9yZWNhc3REYXRhLmlycmFkaWFuY2VEaXJlY3ROb3JtYWwsXG4gICAgICAgIGRpZmZ1c2VIb3Jpem9udGFsSXJyYWRpYW5jZTogZm9yZWNhc3REYXRhLmRpZmZ1c2VSYWRpYXRpb24sXG4gICAgICB9LFxuICAgICAgd2F0ZXI6IHtcbiAgICAgICAgdGVtcGVyYXR1cmU6IGZvcmVjYXN0RGF0YS5zZWFTdXJmYWNlVGVtcGVyYXR1cmUsXG4gICAgICAgIHdhdmVTaWduaWZpY2FudEhlaWdodDogZm9yZWNhc3REYXRhLnNpZ25pZmljYW50V2F2ZUhlaWdodCB8fCBmb3JlY2FzdERhdGEuc2lnbmlmaWNhbnRXYXZlSGVpZ2h0TWF4LFxuICAgICAgICB3YXZlUGVyaW9kOiBmb3JlY2FzdERhdGEubWVhbldhdmVQZXJpb2QgfHwgZm9yZWNhc3REYXRhLm1lYW5XYXZlUGVyaW9kTWF4LFxuICAgICAgICB3YXZlRGlyZWN0aW9uOiBmb3JlY2FzdERhdGEubWVhbldhdmVEaXJlY3Rpb24gfHwgZm9yZWNhc3REYXRhLm1lYW5XYXZlRGlyZWN0aW9uRG9taW5hbnQsXG4gICAgICAgIHdpbmRXYXZlSGVpZ2h0OiBmb3JlY2FzdERhdGEud2luZFdhdmVIZWlnaHQgfHwgZm9yZWNhc3REYXRhLndpbmRXYXZlSGVpZ2h0TWF4LFxuICAgICAgICB3aW5kV2F2ZVBlcmlvZDogZm9yZWNhc3REYXRhLndpbmRXYXZlUGVyaW9kIHx8IGZvcmVjYXN0RGF0YS53aW5kV2F2ZVBlcmlvZE1heCxcbiAgICAgICAgd2luZFdhdmVEaXJlY3Rpb246IGZvcmVjYXN0RGF0YS53aW5kV2F2ZURpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEud2luZFdhdmVEaXJlY3Rpb25Eb21pbmFudCxcbiAgICAgICAgc3dlbGxIZWlnaHQ6IGZvcmVjYXN0RGF0YS5zd2VsbFNpZ25pZmljYW50SGVpZ2h0IHx8IGZvcmVjYXN0RGF0YS5zd2VsbFNpZ25pZmljYW50SGVpZ2h0TWF4LFxuICAgICAgICBzd2VsbFBlcmlvZDogZm9yZWNhc3REYXRhLnN3ZWxsTWVhblBlcmlvZCB8fCBmb3JlY2FzdERhdGEuc3dlbGxNZWFuUGVyaW9kTWF4LFxuICAgICAgICBzd2VsbERpcmVjdGlvbjogZm9yZWNhc3REYXRhLnN3ZWxsTWVhbkRpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEuc3dlbGxNZWFuRGlyZWN0aW9uRG9taW5hbnQsXG4gICAgICAgIHN1cmZhY2VDdXJyZW50U3BlZWQ6IGZvcmVjYXN0RGF0YS5jdXJyZW50VmVsb2NpdHksXG4gICAgICAgIHN1cmZhY2VDdXJyZW50RGlyZWN0aW9uOiBmb3JlY2FzdERhdGEuY3VycmVudERpcmVjdGlvbixcbiAgICAgICAgc3dlbGxQZWFrUGVyaW9kOiBmb3JlY2FzdERhdGEuc3dlbGxQZWFrUGVyaW9kIHx8IGZvcmVjYXN0RGF0YS5zd2VsbFBlYWtQZXJpb2RNYXgsXG4gICAgICAgIHdpbmRXYXZlUGVha1BlcmlvZDogZm9yZWNhc3REYXRhLndpbmRXYXZlUGVha1BlcmlvZCB8fCBmb3JlY2FzdERhdGEud2luZFdhdmVQZWFrUGVyaW9kTWF4LFxuICAgICAgfSxcbiAgICAgIHdpbmQ6IHtcbiAgICAgICAgc3BlZWRUcnVlOiBmb3JlY2FzdERhdGEud2luZEF2ZyB8fCBmb3JlY2FzdERhdGEud2luZEF2Z01heCxcbiAgICAgICAgZGlyZWN0aW9uVHJ1ZTogZm9yZWNhc3REYXRhLndpbmREaXJlY3Rpb24gfHwgZm9yZWNhc3REYXRhLndpbmREaXJlY3Rpb25Eb21pbmFudCxcbiAgICAgICAgZ3VzdDogZm9yZWNhc3REYXRhLndpbmRHdXN0IHx8IGZvcmVjYXN0RGF0YS53aW5kR3VzdE1heCxcbiAgICAgIH0sXG4gICAgICBzdW46IHtcbiAgICAgICAgc3VucmlzZTogZm9yZWNhc3REYXRhLnN1bnJpc2UsXG4gICAgICAgIHN1bnNldDogZm9yZWNhc3REYXRhLnN1bnNldCxcbiAgICAgICAgc3Vuc2hpbmVEdXJhdGlvbjogZm9yZWNhc3REYXRhLnN1bnNoaW5lRHVyYXRpb24sXG4gICAgICAgIC8vIGlzRGF5bGlnaHQ6IHRydWUgaWYgMS90cnVlLCBmYWxzZSBpZiAwL2ZhbHNlLCB1bmRlZmluZWQgaWYgbm90IHByZXNlbnQgKGRhaWx5IGZvcmVjYXN0cylcbiAgICAgICAgaXNEYXlsaWdodDogZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQgPT09IDEgfHwgZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQgPT09IHRydWVcbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIH0sXG4gICAgfTtcbiAgfTtcblxuICAvLyBHZXQgaG91cmx5IGZvcmVjYXN0cyBmcm9tIFNpZ25hbEsgdHJlZSAodXNpbmcgU2lnbmFsSy1hbGlnbmVkIGZpZWxkIG5hbWVzKVxuICBjb25zdCBnZXRIb3VybHlGb3JlY2FzdHMgPSAobWF4Q291bnQ6IG51bWJlcik6IFdlYXRoZXJEYXRhW10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogV2VhdGhlckRhdGFbXSA9IFtdO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFJlYWQgZm9yZWNhc3QgZGF0YSBmcm9tIFNpZ25hbEsgdHJlZSB1c2luZyB0cmFuc2xhdGVkIGZpZWxkIG5hbWVzXG4gICAgICBsZXQgZm9yZWNhc3RDb3VudCA9IDA7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1heENvdW50ICsgMTA7IGkrKykge1xuICAgICAgICBjb25zdCB0ZW1wID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5ob3VybHkuYWlyVGVtcGVyYXR1cmUuJHtpfWAsXG4gICAgICAgICk7XG4gICAgICAgIGlmICh0ZW1wICYmIHRlbXAudmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGZvcmVjYXN0Q291bnQgPSBpICsgMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3R1YWxDb3VudCA9IE1hdGgubWluKGZvcmVjYXN0Q291bnQsIG1heENvdW50KTtcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhY3R1YWxDb3VudDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGZvcmVjYXN0RGF0YTogYW55ID0ge307XG4gICAgICAgIC8vIFVzZSBTaWduYWxLLWFsaWduZWQgZmllbGQgbmFtZXMgKHRyYW5zbGF0ZWQgbmFtZXMpXG4gICAgICAgIGNvbnN0IGZpZWxkcyA9IFtcbiAgICAgICAgICBcImFpclRlbXBlcmF0dXJlXCIsXG4gICAgICAgICAgXCJyZWxhdGl2ZUh1bWlkaXR5XCIsXG4gICAgICAgICAgXCJkZXdQb2ludFwiLFxuICAgICAgICAgIFwiZmVlbHNMaWtlXCIsXG4gICAgICAgICAgXCJwcmVjaXBQcm9iYWJpbGl0eVwiLFxuICAgICAgICAgIFwicHJlY2lwXCIsXG4gICAgICAgICAgXCJ3ZWF0aGVyQ29kZVwiLFxuICAgICAgICAgIFwic2VhTGV2ZWxQcmVzc3VyZVwiLFxuICAgICAgICAgIFwiY2xvdWRDb3ZlclwiLFxuICAgICAgICAgIFwibG93Q2xvdWRDb3ZlclwiLFxuICAgICAgICAgIFwibWlkQ2xvdWRDb3ZlclwiLFxuICAgICAgICAgIFwiaGlnaENsb3VkQ292ZXJcIixcbiAgICAgICAgICBcInZpc2liaWxpdHlcIixcbiAgICAgICAgICBcIndpbmRBdmdcIixcbiAgICAgICAgICBcIndpbmREaXJlY3Rpb25cIixcbiAgICAgICAgICBcIndpbmRHdXN0XCIsXG4gICAgICAgICAgXCJ1dkluZGV4XCIsXG4gICAgICAgICAgXCJpc0RheWxpZ2h0XCIsXG4gICAgICAgICAgXCJzdW5zaGluZUR1cmF0aW9uXCIsXG4gICAgICAgICAgXCJzb2xhclJhZGlhdGlvblwiLFxuICAgICAgICAgIFwiZGlyZWN0UmFkaWF0aW9uXCIsXG4gICAgICAgICAgXCJkaWZmdXNlUmFkaWF0aW9uXCIsXG4gICAgICAgICAgXCJpcnJhZGlhbmNlRGlyZWN0Tm9ybWFsXCIsXG4gICAgICAgICAgXCJzaWduaWZpY2FudFdhdmVIZWlnaHRcIixcbiAgICAgICAgICBcIm1lYW5XYXZlRGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJtZWFuV2F2ZVBlcmlvZFwiLFxuICAgICAgICAgIFwid2luZFdhdmVIZWlnaHRcIixcbiAgICAgICAgICBcIndpbmRXYXZlRGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJ3aW5kV2F2ZVBlcmlvZFwiLFxuICAgICAgICAgIFwic3dlbGxTaWduaWZpY2FudEhlaWdodFwiLFxuICAgICAgICAgIFwic3dlbGxNZWFuRGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJzd2VsbE1lYW5QZXJpb2RcIixcbiAgICAgICAgICBcImN1cnJlbnRWZWxvY2l0eVwiLFxuICAgICAgICAgIFwiY3VycmVudERpcmVjdGlvblwiLFxuICAgICAgICAgIFwic2VhU3VyZmFjZVRlbXBlcmF0dXJlXCIsXG4gICAgICAgIF07XG5cbiAgICAgICAgZmllbGRzLmZvckVhY2goKGZpZWxkKSA9PiB7XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGFwcC5nZXRTZWxmUGF0aChcbiAgICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5ob3VybHkuJHtmaWVsZH0uJHtpfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoZGF0YSAmJiBkYXRhLnZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZvcmVjYXN0RGF0YVtmaWVsZF0gPSBkYXRhLnZhbHVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGZvcmVjYXN0RGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgIGRhdGUuc2V0SG91cnMoZGF0ZS5nZXRIb3VycygpICsgaSk7XG4gICAgICAgICAgZm9yZWNhc3REYXRhLnRpbWVzdGFtcCA9IGRhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICBmb3JlY2FzdHMucHVzaChjb252ZXJ0VG9XZWF0aGVyQVBJRm9yZWNhc3QoZm9yZWNhc3REYXRhLCBcInBvaW50XCIpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBFcnJvciByZWFkaW5nIGhvdXJseSBmb3JlY2FzdHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gR2V0IGRhaWx5IGZvcmVjYXN0cyBmcm9tIFNpZ25hbEsgdHJlZSAodXNpbmcgU2lnbmFsSy1hbGlnbmVkIGZpZWxkIG5hbWVzKVxuICBjb25zdCBnZXREYWlseUZvcmVjYXN0cyA9IChtYXhDb3VudDogbnVtYmVyKTogV2VhdGhlckRhdGFbXSA9PiB7XG4gICAgY29uc3QgZm9yZWNhc3RzOiBXZWF0aGVyRGF0YVtdID0gW107XG5cbiAgICB0cnkge1xuICAgICAgbGV0IGZvcmVjYXN0Q291bnQgPSAwO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYXhDb3VudCArIDI7IGkrKykge1xuICAgICAgICBjb25zdCB0ZW1wID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5kYWlseS5haXJUZW1wSGlnaC4ke2l9YCxcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHRlbXAgJiYgdGVtcC52YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZm9yZWNhc3RDb3VudCA9IGkgKyAxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbENvdW50ID0gTWF0aC5taW4oZm9yZWNhc3RDb3VudCwgbWF4Q291bnQpO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFjdHVhbENvdW50OyBpKyspIHtcbiAgICAgICAgY29uc3QgZm9yZWNhc3REYXRhOiBhbnkgPSB7fTtcbiAgICAgICAgLy8gVXNlIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcyAodHJhbnNsYXRlZCBuYW1lcylcbiAgICAgICAgY29uc3QgZmllbGRzID0gW1xuICAgICAgICAgIFwid2VhdGhlckNvZGVcIixcbiAgICAgICAgICBcImFpclRlbXBIaWdoXCIsXG4gICAgICAgICAgXCJhaXJUZW1wTG93XCIsXG4gICAgICAgICAgXCJmZWVsc0xpa2VIaWdoXCIsXG4gICAgICAgICAgXCJmZWVsc0xpa2VMb3dcIixcbiAgICAgICAgICBcInN1bnJpc2VcIixcbiAgICAgICAgICBcInN1bnNldFwiLFxuICAgICAgICAgIFwic3Vuc2hpbmVEdXJhdGlvblwiLFxuICAgICAgICAgIFwidXZJbmRleE1heFwiLFxuICAgICAgICAgIFwicHJlY2lwU3VtXCIsXG4gICAgICAgICAgXCJwcmVjaXBQcm9iYWJpbGl0eU1heFwiLFxuICAgICAgICAgIFwid2luZEF2Z01heFwiLFxuICAgICAgICAgIFwid2luZEd1c3RNYXhcIixcbiAgICAgICAgICBcIndpbmREaXJlY3Rpb25Eb21pbmFudFwiLFxuICAgICAgICAgIFwic2lnbmlmaWNhbnRXYXZlSGVpZ2h0TWF4XCIsXG4gICAgICAgICAgXCJtZWFuV2F2ZURpcmVjdGlvbkRvbWluYW50XCIsXG4gICAgICAgICAgXCJtZWFuV2F2ZVBlcmlvZE1heFwiLFxuICAgICAgICAgIFwic3dlbGxTaWduaWZpY2FudEhlaWdodE1heFwiLFxuICAgICAgICAgIFwic3dlbGxNZWFuRGlyZWN0aW9uRG9taW5hbnRcIixcbiAgICAgICAgICBcInN3ZWxsTWVhblBlcmlvZE1heFwiLFxuICAgICAgICBdO1xuXG4gICAgICAgIGZpZWxkcy5mb3JFYWNoKChmaWVsZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhcHAuZ2V0U2VsZlBhdGgoXG4gICAgICAgICAgICBgZW52aXJvbm1lbnQub3V0c2lkZS5vcGVubWV0ZW8uZm9yZWNhc3QuZGFpbHkuJHtmaWVsZH0uJHtpfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoZGF0YSAmJiBkYXRhLnZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZvcmVjYXN0RGF0YVtmaWVsZF0gPSBkYXRhLnZhbHVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGZvcmVjYXN0RGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgIGRhdGUuc2V0RGF0ZShkYXRlLmdldERhdGUoKSArIGkpO1xuICAgICAgICAgIGZvcmVjYXN0RGF0YS5kYXRlID0gZGF0ZS50b0lTT1N0cmluZygpLnNwbGl0KFwiVFwiKVswXTtcbiAgICAgICAgICBmb3JlY2FzdHMucHVzaChjb252ZXJ0VG9XZWF0aGVyQVBJRm9yZWNhc3QoZm9yZWNhc3REYXRhLCBcImRhaWx5XCIpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBFcnJvciByZWFkaW5nIGRhaWx5IGZvcmVjYXN0czogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcmVjYXN0cztcbiAgfTtcblxuICAvLyBXZWF0aGVyIEFQSSBwcm92aWRlclxuICBjb25zdCB3ZWF0aGVyUHJvdmlkZXI6IFdlYXRoZXJQcm92aWRlciA9IHtcbiAgICBuYW1lOiBcInNpZ25hbGstb3Blbi1tZXRlb1wiLFxuICAgIG1ldGhvZHM6IHtcbiAgICAgIHBsdWdpbklkOiBwbHVnaW4uaWQsXG4gICAgICBnZXRPYnNlcnZhdGlvbnM6IGFzeW5jIChcbiAgICAgICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgICAgICBvcHRpb25zPzogV2VhdGhlclJlcVBhcmFtcyxcbiAgICAgICk6IFByb21pc2U8V2VhdGhlckRhdGFbXT4gPT4ge1xuICAgICAgICAvLyBSZXR1cm4gY3VycmVudCBjb25kaXRpb25zIGFzIG9ic2VydmF0aW9uXG4gICAgICAgIGNvbnN0IGZvcmVjYXN0cyA9IGdldEhvdXJseUZvcmVjYXN0cygxKTtcbiAgICAgICAgaWYgKGZvcmVjYXN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZm9yZWNhc3RzWzBdLnR5cGUgPSBcIm9ic2VydmF0aW9uXCI7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZvcmVjYXN0cztcbiAgICAgIH0sXG4gICAgICBnZXRGb3JlY2FzdHM6IGFzeW5jIChcbiAgICAgICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgICAgICB0eXBlOiBXZWF0aGVyRm9yZWNhc3RUeXBlLFxuICAgICAgICBvcHRpb25zPzogV2VhdGhlclJlcVBhcmFtcyxcbiAgICAgICk6IFByb21pc2U8V2VhdGhlckRhdGFbXT4gPT4ge1xuICAgICAgICBjb25zdCBtYXhDb3VudCA9IG9wdGlvbnM/Lm1heENvdW50IHx8ICh0eXBlID09PSBcImRhaWx5XCIgPyA3IDogNzIpO1xuXG4gICAgICAgIGlmICh0eXBlID09PSBcImRhaWx5XCIpIHtcbiAgICAgICAgICByZXR1cm4gZ2V0RGFpbHlGb3JlY2FzdHMobWF4Q291bnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBnZXRIb3VybHlGb3JlY2FzdHMobWF4Q291bnQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgZ2V0V2FybmluZ3M6IGFzeW5jIChwb3NpdGlvbjogUG9zaXRpb24pOiBQcm9taXNlPFdlYXRoZXJXYXJuaW5nW10+ID0+IHtcbiAgICAgICAgLy8gT3Blbi1NZXRlbyBkb2Vzbid0IHByb3ZpZGUgd2VhdGhlciB3YXJuaW5nc1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9LFxuICAgIH0sXG4gIH07XG5cbiAgLy8gU2V0dXAgcG9zaXRpb24gc3Vic2NyaXB0aW9uXG4gIGNvbnN0IHNldHVwUG9zaXRpb25TdWJzY3JpcHRpb24gPSAoY29uZmlnOiBQbHVnaW5Db25maWcpID0+IHtcbiAgICBpZiAoIWNvbmZpZy5lbmFibGVQb3NpdGlvblN1YnNjcmlwdGlvbikge1xuICAgICAgYXBwLmRlYnVnKFwiUG9zaXRpb24gc3Vic2NyaXB0aW9uIGRpc2FibGVkXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGFwcC5kZWJ1ZyhcIlNldHRpbmcgdXAgcG9zaXRpb24gc3Vic2NyaXB0aW9uXCIpO1xuXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uOiBTdWJzY3JpcHRpb25SZXF1ZXN0ID0ge1xuICAgICAgY29udGV4dDogXCJ2ZXNzZWxzLnNlbGZcIixcbiAgICAgIHN1YnNjcmliZTogW1xuICAgICAgICB7IHBhdGg6IFwibmF2aWdhdGlvbi5wb3NpdGlvblwiLCBwZXJpb2Q6IDYwMDAwIH0sXG4gICAgICAgIHsgcGF0aDogXCJuYXZpZ2F0aW9uLmNvdXJzZU92ZXJHcm91bmRUcnVlXCIsIHBlcmlvZDogNjAwMDAgfSxcbiAgICAgICAgeyBwYXRoOiBcIm5hdmlnYXRpb24uc3BlZWRPdmVyR3JvdW5kXCIsIHBlcmlvZDogNjAwMDAgfSxcbiAgICAgIF0sXG4gICAgfTtcblxuICAgIGFwcC5zdWJzY3JpcHRpb25tYW5hZ2VyLnN1YnNjcmliZShcbiAgICAgIHN1YnNjcmlwdGlvbixcbiAgICAgIHN0YXRlLm5hdmlnYXRpb25TdWJzY3JpcHRpb25zLFxuICAgICAgKGVycikgPT4ge1xuICAgICAgICBhcHAuZXJyb3IoYE5hdmlnYXRpb24gc3Vic2NyaXB0aW9uIGVycm9yOiAke2Vycn1gKTtcbiAgICAgIH0sXG4gICAgICAoZGVsdGEpID0+IHtcbiAgICAgICAgZGVsdGEudXBkYXRlcz8uZm9yRWFjaCgodXBkYXRlKSA9PiB7XG4gICAgICAgICAgdXBkYXRlLnZhbHVlcz8uZm9yRWFjaCgodikgPT4ge1xuICAgICAgICAgICAgaWYgKHYucGF0aCA9PT0gXCJuYXZpZ2F0aW9uLnBvc2l0aW9uXCIgJiYgdi52YWx1ZSkge1xuICAgICAgICAgICAgICBjb25zdCBwb3MgPSB2LnZhbHVlIGFzIHsgbGF0aXR1ZGU6IG51bWJlcjsgbG9uZ2l0dWRlOiBudW1iZXIgfTtcbiAgICAgICAgICAgICAgaWYgKHBvcy5sYXRpdHVkZSAmJiBwb3MubG9uZ2l0dWRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmV3UG9zaXRpb246IFBvc2l0aW9uID0ge1xuICAgICAgICAgICAgICAgICAgbGF0aXR1ZGU6IHBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIGxvbmdpdHVkZTogcG9zLmxvbmdpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKSxcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5jdXJyZW50UG9zaXRpb24pIHtcbiAgICAgICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRQb3NpdGlvbiA9IG5ld1Bvc2l0aW9uO1xuICAgICAgICAgICAgICAgICAgYXBwLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICBgSW5pdGlhbCBwb3NpdGlvbjogJHtwb3MubGF0aXR1ZGV9LCAke3Bvcy5sb25naXR1ZGV9YCxcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAvLyBUcmlnZ2VyIGluaXRpYWwgZm9yZWNhc3QgZmV0Y2ggKHVzZSBtb3ZpbmcgdmVzc2VsIGlmIGFwcHJvcHJpYXRlKVxuICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmN1cnJlbnRDb25maWcpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRTT0cgJiZcbiAgICAgICAgICAgICAgICAgICAgICBpc1Zlc3NlbE1vdmluZyhzdGF0ZS5jdXJyZW50U09HLCBzdGF0ZS5jdXJyZW50Q29uZmlnLm1vdmluZ1NwZWVkVGhyZXNob2xkKSAmJlxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZFxuICAgICAgICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICAgICAgICBmZXRjaEZvcmVjYXN0Rm9yTW92aW5nVmVzc2VsKHN0YXRlLmN1cnJlbnRDb25maWcpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgIGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhzdGF0ZS5jdXJyZW50Q29uZmlnKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50UG9zaXRpb24gPSBuZXdQb3NpdGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAodi5wYXRoID09PSBcIm5hdmlnYXRpb24uY291cnNlT3Zlckdyb3VuZFRydWVcIiAmJiB2LnZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRIZWFkaW5nID0gdi52YWx1ZSBhcyBudW1iZXI7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHYucGF0aCA9PT0gXCJuYXZpZ2F0aW9uLnNwZWVkT3Zlckdyb3VuZFwiICYmIHYudmFsdWUgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgc3RhdGUuY3VycmVudFNPRyA9IHYudmFsdWUgYXMgbnVtYmVyO1xuXG4gICAgICAgICAgICAgIC8vIEF1dG8tZW5nYWdlIG1vdmluZyBmb3JlY2FzdCBpZiBlbmFibGVkIGFuZCBzcGVlZCBleGNlZWRzIHRocmVzaG9sZFxuICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgc3RhdGUuY3VycmVudENvbmZpZz8uZW5hYmxlQXV0b01vdmluZ0ZvcmVjYXN0ICYmXG4gICAgICAgICAgICAgICAgaXNWZXNzZWxNb3ZpbmcoXG4gICAgICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50U09HLFxuICAgICAgICAgICAgICAgICAgc3RhdGUuY3VycmVudENvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZCxcbiAgICAgICAgICAgICAgICApICYmXG4gICAgICAgICAgICAgICAgIXN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZFxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5tb3ZpbmdGb3JlY2FzdEVuZ2FnZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgICAgICAgICAgIGBBdXRvLWVuYWJsZWQgbW92aW5nIGZvcmVjYXN0IGR1ZSB0byB2ZXNzZWwgbW92ZW1lbnQgZXhjZWVkaW5nICR7c3RhdGUuY3VycmVudENvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZH0ga25vdHNgLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICk7XG4gIH07XG5cbiAgLy8gUGx1Z2luIHN0YXJ0XG4gIHBsdWdpbi5zdGFydCA9IChvcHRpb25zOiBQYXJ0aWFsPFBsdWdpbkNvbmZpZz4pID0+IHtcbiAgICBjb25zdCBjb25maWc6IFBsdWdpbkNvbmZpZyA9IHtcbiAgICAgIGFwaUtleTogb3B0aW9ucy5hcGlLZXkgfHwgXCJcIixcbiAgICAgIGZvcmVjYXN0SW50ZXJ2YWw6IG9wdGlvbnMuZm9yZWNhc3RJbnRlcnZhbCB8fCA2MCxcbiAgICAgIGFsdGl0dWRlOiBvcHRpb25zLmFsdGl0dWRlIHx8IDIsXG4gICAgICBlbmFibGVQb3NpdGlvblN1YnNjcmlwdGlvbjogb3B0aW9ucy5lbmFibGVQb3NpdGlvblN1YnNjcmlwdGlvbiAhPT0gZmFsc2UsXG4gICAgICBtYXhGb3JlY2FzdEhvdXJzOiBvcHRpb25zLm1heEZvcmVjYXN0SG91cnMgfHwgNzIsXG4gICAgICBtYXhGb3JlY2FzdERheXM6IG9wdGlvbnMubWF4Rm9yZWNhc3REYXlzIHx8IDcsXG4gICAgICBlbmFibGVIb3VybHlXZWF0aGVyOiBvcHRpb25zLmVuYWJsZUhvdXJseVdlYXRoZXIgIT09IGZhbHNlLFxuICAgICAgZW5hYmxlRGFpbHlXZWF0aGVyOiBvcHRpb25zLmVuYWJsZURhaWx5V2VhdGhlciAhPT0gZmFsc2UsXG4gICAgICBlbmFibGVNYXJpbmVIb3VybHk6IG9wdGlvbnMuZW5hYmxlTWFyaW5lSG91cmx5ICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZU1hcmluZURhaWx5OiBvcHRpb25zLmVuYWJsZU1hcmluZURhaWx5ICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZUN1cnJlbnRDb25kaXRpb25zOiBvcHRpb25zLmVuYWJsZUN1cnJlbnRDb25kaXRpb25zICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZUF1dG9Nb3ZpbmdGb3JlY2FzdDogb3B0aW9ucy5lbmFibGVBdXRvTW92aW5nRm9yZWNhc3QgfHwgZmFsc2UsXG4gICAgICBtb3ZpbmdTcGVlZFRocmVzaG9sZDogb3B0aW9ucy5tb3ZpbmdTcGVlZFRocmVzaG9sZCB8fCAxLjAsXG4gICAgfTtcblxuICAgIHN0YXRlLmN1cnJlbnRDb25maWcgPSBjb25maWc7XG5cbiAgICBhcHAuZGVidWcoXCJTdGFydGluZyBPcGVuLU1ldGVvIHBsdWdpblwiKTtcbiAgICBhcHAuc2V0UGx1Z2luU3RhdHVzKFwiSW5pdGlhbGl6aW5nLi4uXCIpO1xuXG4gICAgLy8gUmVnaXN0ZXIgYXMgV2VhdGhlciBBUEkgcHJvdmlkZXJcbiAgICB0cnkge1xuICAgICAgYXBwLnJlZ2lzdGVyV2VhdGhlclByb3ZpZGVyKHdlYXRoZXJQcm92aWRlcik7XG4gICAgICBhcHAuZGVidWcoXCJTdWNjZXNzZnVsbHkgcmVnaXN0ZXJlZCBhcyBXZWF0aGVyIEFQSSBwcm92aWRlclwiKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXBwLmVycm9yKFxuICAgICAgICBgRmFpbGVkIHRvIHJlZ2lzdGVyIFdlYXRoZXIgQVBJIHByb3ZpZGVyOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBTZXR1cCBwb3NpdGlvbiBzdWJzY3JpcHRpb25cbiAgICBzZXR1cFBvc2l0aW9uU3Vic2NyaXB0aW9uKGNvbmZpZyk7XG5cbiAgICAvLyBIZWxwZXIgdG8gZGV0ZXJtaW5lIHdoaWNoIGZldGNoIGZ1bmN0aW9uIHRvIHVzZVxuICAgIGNvbnN0IGRvRm9yZWNhc3RGZXRjaCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChcbiAgICAgICAgc3RhdGUuY3VycmVudFNPRyAmJlxuICAgICAgICBpc1Zlc3NlbE1vdmluZyhzdGF0ZS5jdXJyZW50U09HLCBjb25maWcubW92aW5nU3BlZWRUaHJlc2hvbGQpICYmXG4gICAgICAgIHN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZFxuICAgICAgKSB7XG4gICAgICAgIGFwcC5kZWJ1ZyhcIlVzaW5nIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0aW5nIGZvciBtb3ZpbmcgdmVzc2VsXCIpO1xuICAgICAgICBhd2FpdCBmZXRjaEZvcmVjYXN0Rm9yTW92aW5nVmVzc2VsKGNvbmZpZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhcHAuZGVidWcoXCJVc2luZyBzdGFuZGFyZCBmb3JlY2FzdGluZyBmb3Igc3RhdGlvbmFyeSB2ZXNzZWxcIik7XG4gICAgICAgIGF3YWl0IGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhjb25maWcpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBTZXR1cCBmb3JlY2FzdCBpbnRlcnZhbFxuICAgIGNvbnN0IGludGVydmFsTXMgPSBjb25maWcuZm9yZWNhc3RJbnRlcnZhbCAqIDYwICogMTAwMDtcbiAgICBzdGF0ZS5mb3JlY2FzdEludGVydmFsID0gc2V0SW50ZXJ2YWwoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHN0YXRlLmZvcmVjYXN0RW5hYmxlZCAmJiBzdGF0ZS5jdXJyZW50UG9zaXRpb24pIHtcbiAgICAgICAgYXdhaXQgZG9Gb3JlY2FzdEZldGNoKCk7XG4gICAgICB9XG4gICAgfSwgaW50ZXJ2YWxNcyk7XG5cbiAgICAvLyBJbml0aWFsIGZldGNoIGlmIHBvc2l0aW9uIGlzIGF2YWlsYWJsZVxuICAgIHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHN0YXRlLmN1cnJlbnRQb3NpdGlvbikge1xuICAgICAgICBhd2FpdCBkb0ZvcmVjYXN0RmV0Y2goKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFwcC5kZWJ1ZyhcIk5vIHBvc2l0aW9uIGF2YWlsYWJsZSB5ZXQsIHdhaXRpbmcgZm9yIHBvc2l0aW9uIHN1YnNjcmlwdGlvblwiKTtcbiAgICAgICAgYXBwLnNldFBsdWdpblN0YXR1cyhcIldhaXRpbmcgZm9yIHBvc2l0aW9uLi4uXCIpO1xuICAgICAgfVxuICAgIH0sIDEwMDApO1xuICB9O1xuXG4gIC8vIFBsdWdpbiBzdG9wXG4gIHBsdWdpbi5zdG9wID0gKCkgPT4ge1xuICAgIGFwcC5kZWJ1ZyhcIlN0b3BwaW5nIE9wZW4tTWV0ZW8gcGx1Z2luXCIpO1xuXG4gICAgLy8gQ2xlYXIgZm9yZWNhc3QgaW50ZXJ2YWxcbiAgICBpZiAoc3RhdGUuZm9yZWNhc3RJbnRlcnZhbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbChzdGF0ZS5mb3JlY2FzdEludGVydmFsKTtcbiAgICAgIHN0YXRlLmZvcmVjYXN0SW50ZXJ2YWwgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIFVuc3Vic2NyaWJlIGZyb20gbmF2aWdhdGlvblxuICAgIHN0YXRlLm5hdmlnYXRpb25TdWJzY3JpcHRpb25zLmZvckVhY2goKHVuc3ViKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICB1bnN1YigpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBJZ25vcmUgdW5zdWJzY3JpYmUgZXJyb3JzXG4gICAgICB9XG4gICAgfSk7XG4gICAgc3RhdGUubmF2aWdhdGlvblN1YnNjcmlwdGlvbnMgPSBbXTtcblxuICAgIC8vIFJlc2V0IHN0YXRlXG4gICAgc3RhdGUuY3VycmVudFBvc2l0aW9uID0gbnVsbDtcbiAgICBzdGF0ZS5jdXJyZW50SGVhZGluZyA9IG51bGw7XG4gICAgc3RhdGUuY3VycmVudFNPRyA9IG51bGw7XG4gICAgc3RhdGUubGFzdEZvcmVjYXN0VXBkYXRlID0gMDtcbiAgICBzdGF0ZS5tb3ZpbmdGb3JlY2FzdEVuZ2FnZWQgPSBmYWxzZTtcblxuICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJTdG9wcGVkXCIpO1xuICB9O1xuXG4gIHJldHVybiBwbHVnaW47XG59O1xuIl19