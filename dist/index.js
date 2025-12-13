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
    // Publish hourly forecasts for a single package (weather or marine)
    const publishHourlyPackage = (forecasts, packageType) => {
        const sourceLabel = getSourceLabel(`hourly-${packageType}`);
        forecasts.forEach((forecast, index) => {
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
                return;
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
        });
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
        name: "Openmeteo Weather",
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUFBLDREQUErQjtBQWtCL0IsaUJBQVMsVUFBVSxHQUFlO0lBQ2hDLE1BQU0sTUFBTSxHQUFrQjtRQUM1QixFQUFFLEVBQUUsb0JBQW9CO1FBQ3hCLElBQUksRUFBRSw0QkFBNEI7UUFDbEMsV0FBVyxFQUFFLHFFQUFxRTtRQUNsRixNQUFNLEVBQUUsRUFBRTtRQUNWLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRSxDQUFDO1FBQ2YsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFFLENBQUM7S0FDZixDQUFDO0lBRUYsTUFBTSxLQUFLLEdBQWdCO1FBQ3pCLGdCQUFnQixFQUFFLElBQUk7UUFDdEIsdUJBQXVCLEVBQUUsRUFBRTtRQUMzQixhQUFhLEVBQUUsU0FBUztRQUN4QixlQUFlLEVBQUUsSUFBSTtRQUNyQixjQUFjLEVBQUUsSUFBSTtRQUNwQixVQUFVLEVBQUUsSUFBSTtRQUNoQixrQkFBa0IsRUFBRSxDQUFDO1FBQ3JCLGVBQWUsRUFBRSxJQUFJO1FBQ3JCLHFCQUFxQixFQUFFLEtBQUs7S0FDN0IsQ0FBQztJQUVGLHdEQUF3RDtJQUN4RCxrREFBa0Q7SUFDbEQsTUFBTSxtQkFBbUIsR0FBMkI7UUFDbEQsQ0FBQyxFQUFFLE9BQU87UUFDVixDQUFDLEVBQUUsY0FBYztRQUNqQixDQUFDLEVBQUUsZUFBZTtRQUNsQixDQUFDLEVBQUUsVUFBVTtRQUNiLEVBQUUsRUFBRSxLQUFLO1FBQ1QsRUFBRSxFQUFFLHFCQUFxQjtRQUN6QixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVBQUUsa0JBQWtCO1FBQ3RCLEVBQUUsRUFBRSxlQUFlO1FBQ25CLEVBQUUsRUFBRSx3QkFBd0I7UUFDNUIsRUFBRSxFQUFFLHdCQUF3QjtRQUM1QixFQUFFLEVBQUUsYUFBYTtRQUNqQixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVB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QUFJLENBQUM7UUFDeEIsS0FBSyxDQUFDLGtCQUFrQixHQUFHLENBQUMsQ0FBQztRQUM3QixLQUFLLENBQUMscUJBQXFCLEdBQUcsS0FBSyxDQUFDO1FBRXBDLEdBQUcsQ0FBQyxlQUFlLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDakMsQ0FBQyxDQUFDO0lBRUYsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGZldGNoIGZyb20gXCJub2RlLWZldGNoXCI7XG5pbXBvcnQge1xuICBTaWduYWxLQXBwLFxuICBTaWduYWxLUGx1Z2luLFxuICBQbHVnaW5Db25maWcsXG4gIFBsdWdpblN0YXRlLFxuICBQb3NpdGlvbixcbiAgT3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlLFxuICBPcGVuTWV0ZW9NYXJpbmVSZXNwb25zZSxcbiAgU2lnbmFsS0RlbHRhLFxuICBTdWJzY3JpcHRpb25SZXF1ZXN0LFxuICBXZWF0aGVyUHJvdmlkZXIsXG4gIFdlYXRoZXJEYXRhLFxuICBXZWF0aGVyV2FybmluZyxcbiAgV2VhdGhlclJlcVBhcmFtcyxcbiAgV2VhdGhlckZvcmVjYXN0VHlwZSxcbn0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZXhwb3J0ID0gZnVuY3Rpb24gKGFwcDogU2lnbmFsS0FwcCk6IFNpZ25hbEtQbHVnaW4ge1xuICBjb25zdCBwbHVnaW46IFNpZ25hbEtQbHVnaW4gPSB7XG4gICAgaWQ6IFwic2lnbmFsay1vcGVuLW1ldGVvXCIsXG4gICAgbmFtZTogXCJTaWduYWxLIE9wZW4tTWV0ZW8gV2VhdGhlclwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIlBvc2l0aW9uLWJhc2VkIHdlYXRoZXIgYW5kIG1hcmluZSBmb3JlY2FzdCBkYXRhIGZyb20gT3Blbi1NZXRlbyBBUElcIixcbiAgICBzY2hlbWE6IHt9LFxuICAgIHN0YXJ0OiAoKSA9PiB7fSxcbiAgICBzdG9wOiAoKSA9PiB7fSxcbiAgfTtcblxuICBjb25zdCBzdGF0ZTogUGx1Z2luU3RhdGUgPSB7XG4gICAgZm9yZWNhc3RJbnRlcnZhbDogbnVsbCxcbiAgICBuYXZpZ2F0aW9uU3Vic2NyaXB0aW9uczogW10sXG4gICAgY3VycmVudENvbmZpZzogdW5kZWZpbmVkLFxuICAgIGN1cnJlbnRQb3NpdGlvbjogbnVsbCxcbiAgICBjdXJyZW50SGVhZGluZzogbnVsbCxcbiAgICBjdXJyZW50U09HOiBudWxsLFxuICAgIGxhc3RGb3JlY2FzdFVwZGF0ZTogMCxcbiAgICBmb3JlY2FzdEVuYWJsZWQ6IHRydWUsXG4gICAgbW92aW5nRm9yZWNhc3RFbmdhZ2VkOiBmYWxzZSxcbiAgfTtcblxuICAvLyBXTU8gV2VhdGhlciBpbnRlcnByZXRhdGlvbiBjb2RlcyAodXNlZCBieSBPcGVuLU1ldGVvKVxuICAvLyBodHRwczovL29wZW4tbWV0ZW8uY29tL2VuL2RvY3Mjd2VhdGhlcnZhcmlhYmxlc1xuICBjb25zdCB3bW9Db2RlRGVzY3JpcHRpb25zOiBSZWNvcmQ8bnVtYmVyLCBzdHJpbmc+ID0ge1xuICAgIDA6IFwiQ2xlYXJcIixcbiAgICAxOiBcIk1vc3RseSBDbGVhclwiLFxuICAgIDI6IFwiUGFydGx5IENsb3VkeVwiLFxuICAgIDM6IFwiT3ZlcmNhc3RcIixcbiAgICA0NTogXCJGb2dcIixcbiAgICA0ODogXCJEZXBvc2l0aW5nIFJpbWUgRm9nXCIsXG4gICAgNTE6IFwiTGlnaHQgRHJpenpsZVwiLFxuICAgIDUzOiBcIk1vZGVyYXRlIERyaXp6bGVcIixcbiAgICA1NTogXCJEZW5zZSBEcml6emxlXCIsXG4gICAgNTY6IFwiTGlnaHQgRnJlZXppbmcgRHJpenpsZVwiLFxuICAgIDU3OiBcIkRlbnNlIEZyZWV6aW5nIERyaXp6bGVcIixcbiAgICA2MTogXCJTbGlnaHQgUmFpblwiLFxuICAgIDYzOiBcIk1vZGVyYXRlIFJhaW5cIixcbiAgICA2NTogXCJIZWF2eSBSYWluXCIsXG4gICAgNjY6IFwiTGlnaHQgRnJlZXppbmcgUmFpblwiLFxuICAgIDY3OiBcIkhlYXZ5IEZyZWV6aW5nIFJhaW5cIixcbiAgICA3MTogXCJTbGlnaHQgU25vd1wiLFxuICAgIDczOiBcIk1vZGVyYXRlIFNub3dcIixcbiAgICA3NTogXCJIZWF2eSBTbm93XCIsXG4gICAgNzc6IFwiU25vdyBHcmFpbnNcIixcbiAgICA4MDogXCJTbGlnaHQgUmFpbiBTaG93ZXJzXCIsXG4gICAgODE6IFwiTW9kZXJhdGUgUmFpbiBTaG93ZXJzXCIsXG4gICAgODI6IFwiVmlvbGVudCBSYWluIFNob3dlcnNcIixcbiAgICA4NTogXCJTbGlnaHQgU25vdyBTaG93ZXJzXCIsXG4gICAgODY6IFwiSGVhdnkgU25vdyBTaG93ZXJzXCIsXG4gICAgOTU6IFwiVGh1bmRlcnN0b3JtXCIsXG4gICAgOTY6IFwiVGh1bmRlcnN0b3JtIHdpdGggU2xpZ2h0IEhhaWxcIixcbiAgICA5OTogXCJUaHVuZGVyc3Rvcm0gd2l0aCBIZWF2eSBIYWlsXCIsXG4gIH07XG5cbiAgY29uc3Qgd21vQ29kZUxvbmdEZXNjcmlwdGlvbnM6IFJlY29yZDxudW1iZXIsIHN0cmluZz4gPSB7XG4gICAgMDogXCJDbGVhciBza3kgd2l0aCBubyBjbG91ZCBjb3ZlclwiLFxuICAgIDE6IFwiTWFpbmx5IGNsZWFyIHdpdGggbWluaW1hbCBjbG91ZCBjb3ZlclwiLFxuICAgIDI6IFwiUGFydGx5IGNsb3VkeSB3aXRoIHNjYXR0ZXJlZCBjbG91ZHNcIixcbiAgICAzOiBcIk92ZXJjYXN0IHdpdGggY29tcGxldGUgY2xvdWQgY292ZXJcIixcbiAgICA0NTogXCJGb2cgcmVkdWNpbmcgdmlzaWJpbGl0eVwiLFxuICAgIDQ4OiBcIkRlcG9zaXRpbmcgcmltZSBmb2cgd2l0aCBpY2UgZm9ybWF0aW9uXCIsXG4gICAgNTE6IFwiTGlnaHQgZHJpenpsZSB3aXRoIGZpbmUgcHJlY2lwaXRhdGlvblwiLFxuICAgIDUzOiBcIk1vZGVyYXRlIGRyaXp6bGUgd2l0aCBzdGVhZHkgbGlnaHQgcmFpblwiLFxuICAgIDU1OiBcIkRlbnNlIGRyaXp6bGUgd2l0aCBjb250aW51b3VzIGxpZ2h0IHJhaW5cIixcbiAgICA1NjogXCJMaWdodCBmcmVlemluZyBkcml6emxlLCBpY2UgcG9zc2libGVcIixcbiAgICA1NzogXCJEZW5zZSBmcmVlemluZyBkcml6emxlLCBoYXphcmRvdXMgY29uZGl0aW9uc1wiLFxuICAgIDYxOiBcIlNsaWdodCByYWluIHdpdGggbGlnaHQgcHJlY2lwaXRhdGlvblwiLFxuICAgIDYzOiBcIk1vZGVyYXRlIHJhaW4gd2l0aCBzdGVhZHkgcHJlY2lwaXRhdGlvblwiLFxuICAgIDY1OiBcIkhlYXZ5IHJhaW4gd2l0aCBpbnRlbnNlIHByZWNpcGl0YXRpb25cIixcbiAgICA2NjogXCJMaWdodCBmcmVlemluZyByYWluLCBpY2UgYWNjdW11bGF0aW9uIHBvc3NpYmxlXCIsXG4gICAgNjc6IFwiSGVhdnkgZnJlZXppbmcgcmFpbiwgaGF6YXJkb3VzIGljZSBjb25kaXRpb25zXCIsXG4gICAgNzE6IFwiU2xpZ2h0IHNub3dmYWxsIHdpdGggbGlnaHQgYWNjdW11bGF0aW9uXCIsXG4gICAgNzM6IFwiTW9kZXJhdGUgc25vd2ZhbGwgd2l0aCBzdGVhZHkgYWNjdW11bGF0aW9uXCIsXG4gICAgNzU6IFwiSGVhdnkgc25vd2ZhbGwgd2l0aCBzaWduaWZpY2FudCBhY2N1bXVsYXRpb25cIixcbiAgICA3NzogXCJTbm93IGdyYWlucywgZmluZSBpY2UgcGFydGljbGVzIGZhbGxpbmdcIixcbiAgICA4MDogXCJTbGlnaHQgcmFpbiBzaG93ZXJzLCBicmllZiBsaWdodCByYWluXCIsXG4gICAgODE6IFwiTW9kZXJhdGUgcmFpbiBzaG93ZXJzLCBpbnRlcm1pdHRlbnQgcmFpblwiLFxuICAgIDgyOiBcIlZpb2xlbnQgcmFpbiBzaG93ZXJzLCBpbnRlbnNlIGRvd25wb3Vyc1wiLFxuICAgIDg1OiBcIlNsaWdodCBzbm93IHNob3dlcnMsIGJyaWVmIGxpZ2h0IHNub3dcIixcbiAgICA4NjogXCJIZWF2eSBzbm93IHNob3dlcnMsIGludGVuc2Ugc25vd2ZhbGxcIixcbiAgICA5NTogXCJUaHVuZGVyc3Rvcm0gd2l0aCBsaWdodG5pbmcgYW5kIHRodW5kZXJcIixcbiAgICA5NjogXCJUaHVuZGVyc3Rvcm0gd2l0aCBzbGlnaHQgaGFpbFwiLFxuICAgIDk5OiBcIlRodW5kZXJzdG9ybSB3aXRoIGhlYXZ5IGhhaWwsIGRhbmdlcm91cyBjb25kaXRpb25zXCIsXG4gIH07XG5cbiAgLy8gR2V0IGljb24gbmFtZSBmcm9tIFdNTyBjb2RlXG4gIC8vIGlzRGF5OiB0cnVlLzEgPSBkYXksIGZhbHNlLzAgPSBuaWdodCwgdW5kZWZpbmVkID0gZGVmYXVsdCB0byBkYXkgKGZvciBkYWlseSBmb3JlY2FzdHMpXG4gIGNvbnN0IGdldFdlYXRoZXJJY29uID0gKFxuICAgIHdtb0NvZGU6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBpc0RheTogYm9vbGVhbiB8IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkID0+IHtcbiAgICBpZiAod21vQ29kZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIC8vIERlZmF1bHQgdG8gZGF5IGlmIGlzRGF5IGlzIHVuZGVmaW5lZCAoZS5nLiwgZGFpbHkgZm9yZWNhc3RzIGRvbid0IGhhdmUgaXNfZGF5IGZpZWxkKVxuICAgIGNvbnN0IGRheU5pZ2h0ID0gaXNEYXkgPT09IGZhbHNlIHx8IGlzRGF5ID09PSAwID8gXCJuaWdodFwiIDogXCJkYXlcIjtcbiAgICByZXR1cm4gYHdtb18ke3dtb0NvZGV9XyR7ZGF5TmlnaHR9LnN2Z2A7XG4gIH07XG5cbiAgY29uc3QgZ2V0V2VhdGhlckRlc2NyaXB0aW9uID0gKFxuICAgIHdtb0NvZGU6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBmYWxsYmFjazogc3RyaW5nLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGlmICh3bW9Db2RlID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxsYmFjaztcbiAgICByZXR1cm4gd21vQ29kZURlc2NyaXB0aW9uc1t3bW9Db2RlXSB8fCBmYWxsYmFjaztcbiAgfTtcblxuICBjb25zdCBnZXRXZWF0aGVyTG9uZ0Rlc2NyaXB0aW9uID0gKFxuICAgIHdtb0NvZGU6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBmYWxsYmFjazogc3RyaW5nLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGlmICh3bW9Db2RlID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxsYmFjaztcbiAgICByZXR1cm4gd21vQ29kZUxvbmdEZXNjcmlwdGlvbnNbd21vQ29kZV0gfHwgZmFsbGJhY2s7XG4gIH07XG5cbiAgLy8gQ29uZmlndXJhdGlvbiBzY2hlbWFcbiAgcGx1Z2luLnNjaGVtYSA9IHtcbiAgICB0eXBlOiBcIm9iamVjdFwiLFxuICAgIHJlcXVpcmVkOiBbXSxcbiAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICBhcGlLZXk6IHtcbiAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgdGl0bGU6IFwiQVBJIEtleSAoT3B0aW9uYWwpXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAgIFwiT3Blbi1NZXRlbyBBUEkga2V5IGZvciBjb21tZXJjaWFsIHVzZS4gTGVhdmUgZW1wdHkgZm9yIGZyZWUgbm9uLWNvbW1lcmNpYWwgdXNlLlwiLFxuICAgICAgfSxcbiAgICAgIGZvcmVjYXN0SW50ZXJ2YWw6IHtcbiAgICAgICAgdHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgdGl0bGU6IFwiRm9yZWNhc3QgVXBkYXRlIEludGVydmFsIChtaW51dGVzKVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJIb3cgb2Z0ZW4gdG8gZmV0Y2ggbmV3IGZvcmVjYXN0IGRhdGFcIixcbiAgICAgICAgZGVmYXVsdDogNjAsXG4gICAgICAgIG1pbmltdW06IDE1LFxuICAgICAgICBtYXhpbXVtOiAxNDQwLFxuICAgICAgfSxcbiAgICAgIGFsdGl0dWRlOiB7XG4gICAgICAgIHR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgIHRpdGxlOiBcIkRlZmF1bHQgQWx0aXR1ZGUgKG1ldGVycylcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGVmYXVsdCBhbHRpdHVkZSBmb3IgZWxldmF0aW9uIGNvcnJlY3Rpb25cIixcbiAgICAgICAgZGVmYXVsdDogMixcbiAgICAgICAgbWluaW11bTogMCxcbiAgICAgICAgbWF4aW11bTogMTAwMDAsXG4gICAgICB9LFxuICAgICAgZW5hYmxlUG9zaXRpb25TdWJzY3JpcHRpb246IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBQb3NpdGlvbiBTdWJzY3JpcHRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgXCJTdWJzY3JpYmUgdG8gbmF2aWdhdGlvbi5wb3NpdGlvbiB1cGRhdGVzIGZvciBhdXRvbWF0aWMgZm9yZWNhc3QgdXBkYXRlc1wiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIG1heEZvcmVjYXN0SG91cnM6IHtcbiAgICAgICAgdHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgdGl0bGU6IFwiTWF4IEZvcmVjYXN0IEhvdXJzXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gbnVtYmVyIG9mIGhvdXJseSBmb3JlY2FzdHMgdG8gcmV0cmlldmUgKDEtMzg0KVwiLFxuICAgICAgICBkZWZhdWx0OiA3MixcbiAgICAgICAgbWluaW11bTogMSxcbiAgICAgICAgbWF4aW11bTogMzg0LFxuICAgICAgfSxcbiAgICAgIG1heEZvcmVjYXN0RGF5czoge1xuICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICB0aXRsZTogXCJNYXggRm9yZWNhc3QgRGF5c1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIG51bWJlciBvZiBkYWlseSBmb3JlY2FzdHMgdG8gcmV0cmlldmUgKDEtMTYpXCIsXG4gICAgICAgIGRlZmF1bHQ6IDcsXG4gICAgICAgIG1pbmltdW06IDEsXG4gICAgICAgIG1heGltdW06IDE2LFxuICAgICAgfSxcbiAgICAgIGVuYWJsZUhvdXJseVdlYXRoZXI6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBIb3VybHkgV2VhdGhlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJGZXRjaCBob3VybHkgd2VhdGhlciBmb3JlY2FzdHNcIixcbiAgICAgICAgZGVmYXVsdDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBlbmFibGVEYWlseVdlYXRoZXI6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBEYWlseSBXZWF0aGVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoIGRhaWx5IHdlYXRoZXIgZm9yZWNhc3RzXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlTWFyaW5lSG91cmx5OiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgTWFyaW5lIEhvdXJseVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJGZXRjaCBob3VybHkgbWFyaW5lIGZvcmVjYXN0cyAod2F2ZXMsIGN1cnJlbnRzLCBzZWEgdGVtcGVyYXR1cmUpXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlTWFyaW5lRGFpbHk6IHtcbiAgICAgICAgdHlwZTogXCJib29sZWFuXCIsXG4gICAgICAgIHRpdGxlOiBcIkVuYWJsZSBNYXJpbmUgRGFpbHlcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRmV0Y2ggZGFpbHkgbWFyaW5lIGZvcmVjYXN0c1wiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZUN1cnJlbnRDb25kaXRpb25zOiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgQ3VycmVudCBDb25kaXRpb25zXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoIGN1cnJlbnQgd2VhdGhlciBjb25kaXRpb25zXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlQXV0b01vdmluZ0ZvcmVjYXN0OiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgQXV0byBNb3ZpbmcgRm9yZWNhc3RcIixcbiAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgXCJBdXRvbWF0aWNhbGx5IGVuZ2FnZSBtb3ZpbmcgZm9yZWNhc3QgbW9kZSB3aGVuIHZlc3NlbCBzcGVlZCBleGNlZWRzIHRocmVzaG9sZFwiLFxuICAgICAgICBkZWZhdWx0OiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBtb3ZpbmdTcGVlZFRocmVzaG9sZDoge1xuICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICB0aXRsZTogXCJNb3ZpbmcgU3BlZWQgVGhyZXNob2xkIChrbm90cylcIixcbiAgICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgICAgXCJNaW5pbXVtIHNwZWVkIGluIGtub3RzIHRvIGF1dG9tYXRpY2FsbHkgZW5nYWdlIG1vdmluZyBmb3JlY2FzdCBtb2RlXCIsXG4gICAgICAgIGRlZmF1bHQ6IDEuMCxcbiAgICAgICAgbWluaW11bTogMC4xLFxuICAgICAgICBtYXhpbXVtOiAxMC4wLFxuICAgICAgfSxcbiAgICB9LFxuICB9O1xuXG4gIC8vIFV0aWxpdHkgZnVuY3Rpb25zXG4gIGNvbnN0IGRlZ1RvUmFkID0gKGRlZ3JlZXM6IG51bWJlcik6IG51bWJlciA9PiBkZWdyZWVzICogKE1hdGguUEkgLyAxODApO1xuICBjb25zdCByYWRUb0RlZyA9IChyYWRpYW5zOiBudW1iZXIpOiBudW1iZXIgPT4gcmFkaWFucyAqICgxODAgLyBNYXRoLlBJKTtcbiAgY29uc3QgY2Vsc2l1c1RvS2VsdmluID0gKGNlbHNpdXM6IG51bWJlcik6IG51bWJlciA9PiBjZWxzaXVzICsgMjczLjE1O1xuICBjb25zdCBoUGFUb1BBID0gKGhQYTogbnVtYmVyKTogbnVtYmVyID0+IGhQYSAqIDEwMDtcbiAgY29uc3QgbW1Ub00gPSAobW06IG51bWJlcik6IG51bWJlciA9PiBtbSAvIDEwMDA7XG4gIGNvbnN0IGNtVG9NID0gKGNtOiBudW1iZXIpOiBudW1iZXIgPT4gY20gLyAxMDA7XG4gIGNvbnN0IGttVG9NID0gKGttOiBudW1iZXIpOiBudW1iZXIgPT4ga20gKiAxMDAwO1xuICBjb25zdCBrbWhUb01zID0gKGttaDogbnVtYmVyKTogbnVtYmVyID0+IGttaCAvIDMuNjtcbiAgY29uc3QgcGVyY2VudFRvUmF0aW8gPSAocGVyY2VudDogbnVtYmVyKTogbnVtYmVyID0+IHBlcmNlbnQgLyAxMDA7XG5cbiAgLy8gRmllbGQgbmFtZSB0cmFuc2xhdGlvbjogT3Blbi1NZXRlbyBBUEkgbmFtZXMg4oaSIFNpZ25hbEstYWxpZ25lZCBuYW1lcyAoZm9sbG93aW5nIHNpZ25hbGstd2VhdGhlcmZsb3cgY29udmVudGlvbilcbiAgY29uc3QgZmllbGROYW1lTWFwOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgIC8vIFRlbXBlcmF0dXJlIGZpZWxkc1xuICAgIHRlbXBlcmF0dXJlXzJtOiBcImFpclRlbXBlcmF0dXJlXCIsXG4gICAgYXBwYXJlbnRfdGVtcGVyYXR1cmU6IFwiZmVlbHNMaWtlXCIsXG4gICAgZGV3X3BvaW50XzJtOiBcImRld1BvaW50XCIsXG4gICAgdGVtcGVyYXR1cmVfMm1fbWF4OiBcImFpclRlbXBIaWdoXCIsXG4gICAgdGVtcGVyYXR1cmVfMm1fbWluOiBcImFpclRlbXBMb3dcIixcbiAgICBhcHBhcmVudF90ZW1wZXJhdHVyZV9tYXg6IFwiZmVlbHNMaWtlSGlnaFwiLFxuICAgIGFwcGFyZW50X3RlbXBlcmF0dXJlX21pbjogXCJmZWVsc0xpa2VMb3dcIixcbiAgICBzZWFfc3VyZmFjZV90ZW1wZXJhdHVyZTogXCJzZWFTdXJmYWNlVGVtcGVyYXR1cmVcIixcblxuICAgIC8vIFdpbmQgZmllbGRzXG4gICAgd2luZF9zcGVlZF8xMG06IFwid2luZEF2Z1wiLFxuICAgIHdpbmRfZGlyZWN0aW9uXzEwbTogXCJ3aW5kRGlyZWN0aW9uXCIsXG4gICAgd2luZF9ndXN0c18xMG06IFwid2luZEd1c3RcIixcbiAgICB3aW5kX3NwZWVkXzEwbV9tYXg6IFwid2luZEF2Z01heFwiLFxuICAgIHdpbmRfZ3VzdHNfMTBtX21heDogXCJ3aW5kR3VzdE1heFwiLFxuICAgIHdpbmRfZGlyZWN0aW9uXzEwbV9kb21pbmFudDogXCJ3aW5kRGlyZWN0aW9uRG9taW5hbnRcIixcblxuICAgIC8vIFByZXNzdXJlIGZpZWxkc1xuICAgIHByZXNzdXJlX21zbDogXCJzZWFMZXZlbFByZXNzdXJlXCIsXG4gICAgc3VyZmFjZV9wcmVzc3VyZTogXCJzdGF0aW9uUHJlc3N1cmVcIixcblxuICAgIC8vIEh1bWlkaXR5IGZpZWxkc1xuICAgIHJlbGF0aXZlX2h1bWlkaXR5XzJtOiBcInJlbGF0aXZlSHVtaWRpdHlcIixcblxuICAgIC8vIFByZWNpcGl0YXRpb24gZmllbGRzXG4gICAgcHJlY2lwaXRhdGlvbjogXCJwcmVjaXBcIixcbiAgICBwcmVjaXBpdGF0aW9uX3Byb2JhYmlsaXR5OiBcInByZWNpcFByb2JhYmlsaXR5XCIsXG4gICAgcHJlY2lwaXRhdGlvbl9zdW06IFwicHJlY2lwU3VtXCIsXG4gICAgcHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eV9tYXg6IFwicHJlY2lwUHJvYmFiaWxpdHlNYXhcIixcbiAgICBwcmVjaXBpdGF0aW9uX2hvdXJzOiBcInByZWNpcEhvdXJzXCIsXG4gICAgcmFpbjogXCJyYWluXCIsXG4gICAgcmFpbl9zdW06IFwicmFpblN1bVwiLFxuICAgIHNob3dlcnM6IFwic2hvd2Vyc1wiLFxuICAgIHNob3dlcnNfc3VtOiBcInNob3dlcnNTdW1cIixcbiAgICBzbm93ZmFsbDogXCJzbm93ZmFsbFwiLFxuICAgIHNub3dmYWxsX3N1bTogXCJzbm93ZmFsbFN1bVwiLFxuXG4gICAgLy8gQ2xvdWQgY292ZXIgZmllbGRzXG4gICAgY2xvdWRfY292ZXI6IFwiY2xvdWRDb3ZlclwiLFxuICAgIGNsb3VkX2NvdmVyX2xvdzogXCJsb3dDbG91ZENvdmVyXCIsXG4gICAgY2xvdWRfY292ZXJfbWlkOiBcIm1pZENsb3VkQ292ZXJcIixcbiAgICBjbG91ZF9jb3Zlcl9oaWdoOiBcImhpZ2hDbG91ZENvdmVyXCIsXG5cbiAgICAvLyBTb2xhci9VViBmaWVsZHNcbiAgICB1dl9pbmRleDogXCJ1dkluZGV4XCIsXG4gICAgdXZfaW5kZXhfbWF4OiBcInV2SW5kZXhNYXhcIixcbiAgICBzaG9ydHdhdmVfcmFkaWF0aW9uOiBcInNvbGFyUmFkaWF0aW9uXCIsXG4gICAgc2hvcnR3YXZlX3JhZGlhdGlvbl9zdW06IFwic29sYXJSYWRpYXRpb25TdW1cIixcbiAgICBkaXJlY3RfcmFkaWF0aW9uOiBcImRpcmVjdFJhZGlhdGlvblwiLFxuICAgIGRpZmZ1c2VfcmFkaWF0aW9uOiBcImRpZmZ1c2VSYWRpYXRpb25cIixcbiAgICBkaXJlY3Rfbm9ybWFsX2lycmFkaWFuY2U6IFwiaXJyYWRpYW5jZURpcmVjdE5vcm1hbFwiLFxuICAgIHN1bnNoaW5lX2R1cmF0aW9uOiBcInN1bnNoaW5lRHVyYXRpb25cIixcbiAgICBkYXlsaWdodF9kdXJhdGlvbjogXCJkYXlsaWdodER1cmF0aW9uXCIsXG5cbiAgICAvLyBNYXJpbmUvV2F2ZSBmaWVsZHNcbiAgICB3YXZlX2hlaWdodDogXCJzaWduaWZpY2FudFdhdmVIZWlnaHRcIixcbiAgICB3YXZlX2hlaWdodF9tYXg6IFwic2lnbmlmaWNhbnRXYXZlSGVpZ2h0TWF4XCIsXG4gICAgd2F2ZV9kaXJlY3Rpb246IFwibWVhbldhdmVEaXJlY3Rpb25cIixcbiAgICB3YXZlX2RpcmVjdGlvbl9kb21pbmFudDogXCJtZWFuV2F2ZURpcmVjdGlvbkRvbWluYW50XCIsXG4gICAgd2F2ZV9wZXJpb2Q6IFwibWVhbldhdmVQZXJpb2RcIixcbiAgICB3YXZlX3BlcmlvZF9tYXg6IFwibWVhbldhdmVQZXJpb2RNYXhcIixcbiAgICB3aW5kX3dhdmVfaGVpZ2h0OiBcIndpbmRXYXZlSGVpZ2h0XCIsXG4gICAgd2luZF93YXZlX2hlaWdodF9tYXg6IFwid2luZFdhdmVIZWlnaHRNYXhcIixcbiAgICB3aW5kX3dhdmVfZGlyZWN0aW9uOiBcIndpbmRXYXZlRGlyZWN0aW9uXCIsXG4gICAgd2luZF93YXZlX2RpcmVjdGlvbl9kb21pbmFudDogXCJ3aW5kV2F2ZURpcmVjdGlvbkRvbWluYW50XCIsXG4gICAgd2luZF93YXZlX3BlcmlvZDogXCJ3aW5kV2F2ZVBlcmlvZFwiLFxuICAgIHdpbmRfd2F2ZV9wZXJpb2RfbWF4OiBcIndpbmRXYXZlUGVyaW9kTWF4XCIsXG4gICAgd2luZF93YXZlX3BlYWtfcGVyaW9kOiBcIndpbmRXYXZlUGVha1BlcmlvZFwiLFxuICAgIHdpbmRfd2F2ZV9wZWFrX3BlcmlvZF9tYXg6IFwid2luZFdhdmVQZWFrUGVyaW9kTWF4XCIsXG4gICAgc3dlbGxfd2F2ZV9oZWlnaHQ6IFwic3dlbGxTaWduaWZpY2FudEhlaWdodFwiLFxuICAgIHN3ZWxsX3dhdmVfaGVpZ2h0X21heDogXCJzd2VsbFNpZ25pZmljYW50SGVpZ2h0TWF4XCIsXG4gICAgc3dlbGxfd2F2ZV9kaXJlY3Rpb246IFwic3dlbGxNZWFuRGlyZWN0aW9uXCIsXG4gICAgc3dlbGxfd2F2ZV9kaXJlY3Rpb25fZG9taW5hbnQ6IFwic3dlbGxNZWFuRGlyZWN0aW9uRG9taW5hbnRcIixcbiAgICBzd2VsbF93YXZlX3BlcmlvZDogXCJzd2VsbE1lYW5QZXJpb2RcIixcbiAgICBzd2VsbF93YXZlX3BlcmlvZF9tYXg6IFwic3dlbGxNZWFuUGVyaW9kTWF4XCIsXG4gICAgc3dlbGxfd2F2ZV9wZWFrX3BlcmlvZDogXCJzd2VsbFBlYWtQZXJpb2RcIixcbiAgICBzd2VsbF93YXZlX3BlYWtfcGVyaW9kX21heDogXCJzd2VsbFBlYWtQZXJpb2RNYXhcIixcbiAgICBvY2Vhbl9jdXJyZW50X3ZlbG9jaXR5OiBcImN1cnJlbnRWZWxvY2l0eVwiLFxuICAgIG9jZWFuX2N1cnJlbnRfZGlyZWN0aW9uOiBcImN1cnJlbnREaXJlY3Rpb25cIixcblxuICAgIC8vIE90aGVyIGZpZWxkc1xuICAgIHZpc2liaWxpdHk6IFwidmlzaWJpbGl0eVwiLFxuICAgIGlzX2RheTogXCJpc0RheWxpZ2h0XCIsXG4gICAgd2VhdGhlcl9jb2RlOiBcIndlYXRoZXJDb2RlXCIsXG4gICAgY2FwZTogXCJjYXBlXCIsXG4gICAgc3VucmlzZTogXCJzdW5yaXNlXCIsXG4gICAgc3Vuc2V0OiBcInN1bnNldFwiLFxuICB9O1xuXG4gIC8vIFRyYW5zbGF0ZSBPcGVuLU1ldGVvIGZpZWxkIG5hbWUgdG8gU2lnbmFsSy1hbGlnbmVkIG5hbWVcbiAgY29uc3QgdHJhbnNsYXRlRmllbGROYW1lID0gKG9wZW5NZXRlb05hbWU6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gICAgcmV0dXJuIGZpZWxkTmFtZU1hcFtvcGVuTWV0ZW9OYW1lXSB8fCBvcGVuTWV0ZW9OYW1lO1xuICB9O1xuXG4gIC8vIFJldmVyc2UgbG9va3VwOiBTaWduYWxLIG5hbWUgdG8gT3Blbi1NZXRlbyBuYW1lIChmb3IgcmVhZGluZyBiYWNrIGZyb20gU2lnbmFsSylcbiAgY29uc3QgcmV2ZXJzZUZpZWxkTmFtZU1hcDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IE9iamVjdC5lbnRyaWVzKFxuICAgIGZpZWxkTmFtZU1hcCxcbiAgKS5yZWR1Y2UoXG4gICAgKGFjYywgW29wZW5NZXRlbywgc2lnbmFsa10pID0+IHtcbiAgICAgIGFjY1tzaWduYWxrXSA9IG9wZW5NZXRlbztcbiAgICAgIHJldHVybiBhY2M7XG4gICAgfSxcbiAgICB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICApO1xuXG4gIC8vIENhbGN1bGF0ZSBmdXR1cmUgcG9zaXRpb24gYmFzZWQgb24gY3VycmVudCBoZWFkaW5nIGFuZCBzcGVlZFxuICBjb25zdCBjYWxjdWxhdGVGdXR1cmVQb3NpdGlvbiA9IChcbiAgICBjdXJyZW50UG9zOiBQb3NpdGlvbixcbiAgICBoZWFkaW5nUmFkOiBudW1iZXIsXG4gICAgc29nTXBzOiBudW1iZXIsXG4gICAgaG91cnNBaGVhZDogbnVtYmVyLFxuICApOiBQb3NpdGlvbiA9PiB7XG4gICAgY29uc3QgZGlzdGFuY2VNZXRlcnMgPSBzb2dNcHMgKiBob3Vyc0FoZWFkICogMzYwMDtcbiAgICBjb25zdCBlYXJ0aFJhZGl1cyA9IDYzNzEwMDA7XG5cbiAgICBjb25zdCBsYXQxID0gZGVnVG9SYWQoY3VycmVudFBvcy5sYXRpdHVkZSk7XG4gICAgY29uc3QgbG9uMSA9IGRlZ1RvUmFkKGN1cnJlbnRQb3MubG9uZ2l0dWRlKTtcblxuICAgIGNvbnN0IGxhdDIgPSBNYXRoLmFzaW4oXG4gICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguY29zKGRpc3RhbmNlTWV0ZXJzIC8gZWFydGhSYWRpdXMpICtcbiAgICAgICAgTWF0aC5jb3MobGF0MSkgKlxuICAgICAgICAgIE1hdGguc2luKGRpc3RhbmNlTWV0ZXJzIC8gZWFydGhSYWRpdXMpICpcbiAgICAgICAgICBNYXRoLmNvcyhoZWFkaW5nUmFkKSxcbiAgICApO1xuXG4gICAgY29uc3QgbG9uMiA9XG4gICAgICBsb24xICtcbiAgICAgIE1hdGguYXRhbjIoXG4gICAgICAgIE1hdGguc2luKGhlYWRpbmdSYWQpICpcbiAgICAgICAgICBNYXRoLnNpbihkaXN0YW5jZU1ldGVycyAvIGVhcnRoUmFkaXVzKSAqXG4gICAgICAgICAgTWF0aC5jb3MobGF0MSksXG4gICAgICAgIE1hdGguY29zKGRpc3RhbmNlTWV0ZXJzIC8gZWFydGhSYWRpdXMpIC1cbiAgICAgICAgICBNYXRoLnNpbihsYXQxKSAqIE1hdGguc2luKGxhdDIpLFxuICAgICAgKTtcblxuICAgIHJldHVybiB7XG4gICAgICBsYXRpdHVkZTogcmFkVG9EZWcobGF0MiksXG4gICAgICBsb25naXR1ZGU6IHJhZFRvRGVnKGxvbjIpLFxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZShEYXRlLm5vdygpICsgaG91cnNBaGVhZCAqIDM2MDAwMDApLFxuICAgIH07XG4gIH07XG5cbiAgLy8gQ2hlY2sgaWYgdmVzc2VsIGlzIG1vdmluZyBhYm92ZSB0aHJlc2hvbGRcbiAgY29uc3QgaXNWZXNzZWxNb3ZpbmcgPSAoXG4gICAgc29nTXBzOiBudW1iZXIsXG4gICAgdGhyZXNob2xkS25vdHM6IG51bWJlciA9IDEuMCxcbiAgKTogYm9vbGVhbiA9PiB7XG4gICAgY29uc3QgdGhyZXNob2xkTXBzID0gdGhyZXNob2xkS25vdHMgKiAwLjUxNDQ0NDtcbiAgICByZXR1cm4gc29nTXBzID4gdGhyZXNob2xkTXBzO1xuICB9O1xuXG4gIC8vIEJ1aWxkIE9wZW4tTWV0ZW8gV2VhdGhlciBBUEkgVVJMXG4gIGNvbnN0IGJ1aWxkV2VhdGhlclVybCA9IChcbiAgICBwb3NpdGlvbjogUG9zaXRpb24sXG4gICAgY29uZmlnOiBQbHVnaW5Db25maWcsXG4gICk6IHN0cmluZyA9PiB7XG4gICAgY29uc3QgYmFzZVVybCA9IGNvbmZpZy5hcGlLZXlcbiAgICAgID8gYGh0dHBzOi8vY3VzdG9tZXItYXBpLm9wZW4tbWV0ZW8uY29tL3YxL2ZvcmVjYXN0YFxuICAgICAgOiBgaHR0cHM6Ly9hcGkub3Blbi1tZXRlby5jb20vdjEvZm9yZWNhc3RgO1xuXG4gICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgICBsYXRpdHVkZTogcG9zaXRpb24ubGF0aXR1ZGUudG9TdHJpbmcoKSxcbiAgICAgIGxvbmdpdHVkZTogcG9zaXRpb24ubG9uZ2l0dWRlLnRvU3RyaW5nKCksXG4gICAgICB0aW1lem9uZTogXCJVVENcIixcbiAgICAgIGZvcmVjYXN0X2RheXM6IE1hdGgubWluKGNvbmZpZy5tYXhGb3JlY2FzdERheXMsIDE2KS50b1N0cmluZygpLFxuICAgIH0pO1xuXG4gICAgaWYgKGNvbmZpZy5hcGlLZXkpIHtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJhcGlrZXlcIiwgY29uZmlnLmFwaUtleSk7XG4gICAgfVxuXG4gICAgLy8gSG91cmx5IHdlYXRoZXIgdmFyaWFibGVzXG4gICAgaWYgKGNvbmZpZy5lbmFibGVIb3VybHlXZWF0aGVyKSB7XG4gICAgICBjb25zdCBob3VybHlWYXJzID0gW1xuICAgICAgICBcInRlbXBlcmF0dXJlXzJtXCIsXG4gICAgICAgIFwicmVsYXRpdmVfaHVtaWRpdHlfMm1cIixcbiAgICAgICAgXCJkZXdfcG9pbnRfMm1cIixcbiAgICAgICAgXCJhcHBhcmVudF90ZW1wZXJhdHVyZVwiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25fcHJvYmFiaWxpdHlcIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uXCIsXG4gICAgICAgIFwicmFpblwiLFxuICAgICAgICBcInNob3dlcnNcIixcbiAgICAgICAgXCJzbm93ZmFsbFwiLFxuICAgICAgICBcIndlYXRoZXJfY29kZVwiLFxuICAgICAgICBcInByZXNzdXJlX21zbFwiLFxuICAgICAgICBcInN1cmZhY2VfcHJlc3N1cmVcIixcbiAgICAgICAgXCJjbG91ZF9jb3ZlclwiLFxuICAgICAgICBcImNsb3VkX2NvdmVyX2xvd1wiLFxuICAgICAgICBcImNsb3VkX2NvdmVyX21pZFwiLFxuICAgICAgICBcImNsb3VkX2NvdmVyX2hpZ2hcIixcbiAgICAgICAgXCJ2aXNpYmlsaXR5XCIsXG4gICAgICAgIFwid2luZF9zcGVlZF8xMG1cIixcbiAgICAgICAgXCJ3aW5kX2RpcmVjdGlvbl8xMG1cIixcbiAgICAgICAgXCJ3aW5kX2d1c3RzXzEwbVwiLFxuICAgICAgICBcInV2X2luZGV4XCIsXG4gICAgICAgIFwiaXNfZGF5XCIsXG4gICAgICAgIFwic3Vuc2hpbmVfZHVyYXRpb25cIixcbiAgICAgICAgXCJjYXBlXCIsXG4gICAgICAgIFwic2hvcnR3YXZlX3JhZGlhdGlvblwiLFxuICAgICAgICBcImRpcmVjdF9yYWRpYXRpb25cIixcbiAgICAgICAgXCJkaWZmdXNlX3JhZGlhdGlvblwiLFxuICAgICAgICBcImRpcmVjdF9ub3JtYWxfaXJyYWRpYW5jZVwiLFxuICAgICAgXTtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJob3VybHlcIiwgaG91cmx5VmFycy5qb2luKFwiLFwiKSk7XG4gICAgfVxuXG4gICAgLy8gRGFpbHkgd2VhdGhlciB2YXJpYWJsZXNcbiAgICBpZiAoY29uZmlnLmVuYWJsZURhaWx5V2VhdGhlcikge1xuICAgICAgY29uc3QgZGFpbHlWYXJzID0gW1xuICAgICAgICBcIndlYXRoZXJfY29kZVwiLFxuICAgICAgICBcInRlbXBlcmF0dXJlXzJtX21heFwiLFxuICAgICAgICBcInRlbXBlcmF0dXJlXzJtX21pblwiLFxuICAgICAgICBcImFwcGFyZW50X3RlbXBlcmF0dXJlX21heFwiLFxuICAgICAgICBcImFwcGFyZW50X3RlbXBlcmF0dXJlX21pblwiLFxuICAgICAgICBcInN1bnJpc2VcIixcbiAgICAgICAgXCJzdW5zZXRcIixcbiAgICAgICAgXCJkYXlsaWdodF9kdXJhdGlvblwiLFxuICAgICAgICBcInN1bnNoaW5lX2R1cmF0aW9uXCIsXG4gICAgICAgIFwidXZfaW5kZXhfbWF4XCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvbl9zdW1cIixcbiAgICAgICAgXCJyYWluX3N1bVwiLFxuICAgICAgICBcInNob3dlcnNfc3VtXCIsXG4gICAgICAgIFwic25vd2ZhbGxfc3VtXCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvbl9ob3Vyc1wiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25fcHJvYmFiaWxpdHlfbWF4XCIsXG4gICAgICAgIFwid2luZF9zcGVlZF8xMG1fbWF4XCIsXG4gICAgICAgIFwid2luZF9ndXN0c18xMG1fbWF4XCIsXG4gICAgICAgIFwid2luZF9kaXJlY3Rpb25fMTBtX2RvbWluYW50XCIsXG4gICAgICAgIFwic2hvcnR3YXZlX3JhZGlhdGlvbl9zdW1cIixcbiAgICAgIF07XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiZGFpbHlcIiwgZGFpbHlWYXJzLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICAvLyBDdXJyZW50IGNvbmRpdGlvbnNcbiAgICBpZiAoY29uZmlnLmVuYWJsZUN1cnJlbnRDb25kaXRpb25zKSB7XG4gICAgICBjb25zdCBjdXJyZW50VmFycyA9IFtcbiAgICAgICAgXCJ0ZW1wZXJhdHVyZV8ybVwiLFxuICAgICAgICBcInJlbGF0aXZlX2h1bWlkaXR5XzJtXCIsXG4gICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVcIixcbiAgICAgICAgXCJpc19kYXlcIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uXCIsXG4gICAgICAgIFwicmFpblwiLFxuICAgICAgICBcInNob3dlcnNcIixcbiAgICAgICAgXCJzbm93ZmFsbFwiLFxuICAgICAgICBcIndlYXRoZXJfY29kZVwiLFxuICAgICAgICBcImNsb3VkX2NvdmVyXCIsXG4gICAgICAgIFwicHJlc3N1cmVfbXNsXCIsXG4gICAgICAgIFwic3VyZmFjZV9wcmVzc3VyZVwiLFxuICAgICAgICBcIndpbmRfc3BlZWRfMTBtXCIsXG4gICAgICAgIFwid2luZF9kaXJlY3Rpb25fMTBtXCIsXG4gICAgICAgIFwid2luZF9ndXN0c18xMG1cIixcbiAgICAgIF07XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiY3VycmVudFwiLCBjdXJyZW50VmFycy5qb2luKFwiLFwiKSk7XG4gICAgfVxuXG4gICAgLy8gUmVxdWVzdCB3aW5kIHNwZWVkIGluIG0vcyBmb3IgU2lnbmFsSyBjb21wYXRpYmlsaXR5XG4gICAgcGFyYW1zLmFwcGVuZChcIndpbmRfc3BlZWRfdW5pdFwiLCBcIm1zXCIpO1xuXG4gICAgcmV0dXJuIGAke2Jhc2VVcmx9PyR7cGFyYW1zLnRvU3RyaW5nKCl9YDtcbiAgfTtcblxuICAvLyBCdWlsZCBPcGVuLU1ldGVvIE1hcmluZSBBUEkgVVJMXG4gIGNvbnN0IGJ1aWxkTWFyaW5lVXJsID0gKFxuICAgIHBvc2l0aW9uOiBQb3NpdGlvbixcbiAgICBjb25maWc6IFBsdWdpbkNvbmZpZyxcbiAgKTogc3RyaW5nID0+IHtcbiAgICBjb25zdCBiYXNlVXJsID0gY29uZmlnLmFwaUtleVxuICAgICAgPyBgaHR0cHM6Ly9jdXN0b21lci1tYXJpbmUtYXBpLm9wZW4tbWV0ZW8uY29tL3YxL21hcmluZWBcbiAgICAgIDogYGh0dHBzOi8vbWFyaW5lLWFwaS5vcGVuLW1ldGVvLmNvbS92MS9tYXJpbmVgO1xuXG4gICAgY29uc3QgcGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh7XG4gICAgICBsYXRpdHVkZTogcG9zaXRpb24ubGF0aXR1ZGUudG9TdHJpbmcoKSxcbiAgICAgIGxvbmdpdHVkZTogcG9zaXRpb24ubG9uZ2l0dWRlLnRvU3RyaW5nKCksXG4gICAgICB0aW1lem9uZTogXCJVVENcIixcbiAgICAgIGZvcmVjYXN0X2RheXM6IE1hdGgubWluKGNvbmZpZy5tYXhGb3JlY2FzdERheXMsIDgpLnRvU3RyaW5nKCksIC8vIE1hcmluZSBBUEkgbWF4IGlzIDggZGF5c1xuICAgIH0pO1xuXG4gICAgaWYgKGNvbmZpZy5hcGlLZXkpIHtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJhcGlrZXlcIiwgY29uZmlnLmFwaUtleSk7XG4gICAgfVxuXG4gICAgLy8gSG91cmx5IG1hcmluZSB2YXJpYWJsZXNcbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZUhvdXJseSkge1xuICAgICAgY29uc3QgaG91cmx5VmFycyA9IFtcbiAgICAgICAgXCJ3YXZlX2hlaWdodFwiLFxuICAgICAgICBcIndhdmVfZGlyZWN0aW9uXCIsXG4gICAgICAgIFwid2F2ZV9wZXJpb2RcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfaGVpZ2h0XCIsXG4gICAgICAgIFwid2luZF93YXZlX2RpcmVjdGlvblwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9wZXJpb2RcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfcGVha19wZXJpb2RcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX2hlaWdodFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfZGlyZWN0aW9uXCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9wZXJpb2RcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX3BlYWtfcGVyaW9kXCIsXG4gICAgICAgIFwib2NlYW5fY3VycmVudF92ZWxvY2l0eVwiLFxuICAgICAgICBcIm9jZWFuX2N1cnJlbnRfZGlyZWN0aW9uXCIsXG4gICAgICAgIFwic2VhX3N1cmZhY2VfdGVtcGVyYXR1cmVcIixcbiAgICAgIF07XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiaG91cmx5XCIsIGhvdXJseVZhcnMuam9pbihcIixcIikpO1xuICAgIH1cblxuICAgIC8vIERhaWx5IG1hcmluZSB2YXJpYWJsZXNcbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZURhaWx5KSB7XG4gICAgICBjb25zdCBkYWlseVZhcnMgPSBbXG4gICAgICAgIFwid2F2ZV9oZWlnaHRfbWF4XCIsXG4gICAgICAgIFwid2F2ZV9kaXJlY3Rpb25fZG9taW5hbnRcIixcbiAgICAgICAgXCJ3YXZlX3BlcmlvZF9tYXhcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfaGVpZ2h0X21heFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9kaXJlY3Rpb25fZG9taW5hbnRcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfcGVyaW9kX21heFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9wZWFrX3BlcmlvZF9tYXhcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX2hlaWdodF9tYXhcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX2RpcmVjdGlvbl9kb21pbmFudFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfcGVyaW9kX21heFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfcGVha19wZXJpb2RfbWF4XCIsXG4gICAgICBdO1xuICAgICAgcGFyYW1zLmFwcGVuZChcImRhaWx5XCIsIGRhaWx5VmFycy5qb2luKFwiLFwiKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGAke2Jhc2VVcmx9PyR7cGFyYW1zLnRvU3RyaW5nKCl9YDtcbiAgfTtcblxuICAvLyBGZXRjaCB3ZWF0aGVyIGRhdGEgZnJvbSBPcGVuLU1ldGVvXG4gIGNvbnN0IGZldGNoV2VhdGhlckRhdGEgPSBhc3luYyAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBQcm9taXNlPE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSB8IG51bGw+ID0+IHtcbiAgICBjb25zdCB1cmwgPSBidWlsZFdlYXRoZXJVcmwocG9zaXRpb24sIGNvbmZpZyk7XG4gICAgYXBwLmRlYnVnKGBGZXRjaGluZyB3ZWF0aGVyIGZyb206ICR7dXJsfWApO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsKTtcbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgICAgY29uc3QgZXJyb3JUZXh0ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke2Vycm9yVGV4dH1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyBPcGVuTWV0ZW9XZWF0aGVyUmVzcG9uc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGFwcC5lcnJvcihcbiAgICAgICAgYEZhaWxlZCB0byBmZXRjaCB3ZWF0aGVyIGRhdGE6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9O1xuXG4gIC8vIEZldGNoIG1hcmluZSBkYXRhIGZyb20gT3Blbi1NZXRlb1xuICBjb25zdCBmZXRjaE1hcmluZURhdGEgPSBhc3luYyAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBQcm9taXNlPE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbD4gPT4ge1xuICAgIGNvbnN0IHVybCA9IGJ1aWxkTWFyaW5lVXJsKHBvc2l0aW9uLCBjb25maWcpO1xuICAgIGFwcC5kZWJ1ZyhgRmV0Y2hpbmcgbWFyaW5lIGRhdGEgZnJvbTogJHt1cmx9YCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICBjb25zdCBlcnJvclRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7ZXJyb3JUZXh0fWApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIE9wZW5NZXRlb01hcmluZVJlc3BvbnNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBGYWlsZWQgdG8gZmV0Y2ggbWFyaW5lIGRhdGE6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9O1xuXG4gIC8vIEdldCBzb3VyY2UgbGFiZWwgZm9yIFNpZ25hbEsgKGZvbGxvd2luZyB3ZWF0aGVyZmxvdy9tZXRlbyBwYXR0ZXJuKVxuICBjb25zdCBnZXRTb3VyY2VMYWJlbCA9IChwYWNrYWdlVHlwZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICByZXR1cm4gYG9wZW5tZXRlby0ke3BhY2thZ2VUeXBlfS1hcGlgO1xuICB9O1xuXG4gIC8vIEdldCBwYXJhbWV0ZXIgbWV0YWRhdGEgZm9yIFNpZ25hbEsgKHVzaW5nIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcylcbiAgY29uc3QgZ2V0UGFyYW1ldGVyTWV0YWRhdGEgPSAocGFyYW1ldGVyTmFtZTogc3RyaW5nKTogYW55ID0+IHtcbiAgICBjb25zdCBtZXRhZGF0YU1hcDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgIC8vIFRlbXBlcmF0dXJlIHBhcmFtZXRlcnMgKFNpZ25hbEsgY29tcGxpYW50IC0gS2VsdmluKVxuICAgICAgYWlyVGVtcGVyYXR1cmU6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBaXIgdGVtcGVyYXR1cmUgYXQgMm0gaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgZmVlbHNMaWtlOiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRmVlbHMgTGlrZSBUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBcHBhcmVudCB0ZW1wZXJhdHVyZSBjb25zaWRlcmluZyB3aW5kIGFuZCBodW1pZGl0eVwiLFxuICAgICAgfSxcbiAgICAgIGRld1BvaW50OiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGV3IFBvaW50XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRldyBwb2ludCB0ZW1wZXJhdHVyZSBhdCAybSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBzZWFTdXJmYWNlVGVtcGVyYXR1cmU6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTZWEgU3VyZmFjZSBUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTZWEgc3VyZmFjZSB0ZW1wZXJhdHVyZVwiLFxuICAgICAgfSxcbiAgICAgIGFpclRlbXBIaWdoOiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiSGlnaCBUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIGFpciB0ZW1wZXJhdHVyZVwiLFxuICAgICAgfSxcbiAgICAgIGFpclRlbXBMb3c6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJMb3cgVGVtcGVyYXR1cmVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWluaW11bSBhaXIgdGVtcGVyYXR1cmVcIixcbiAgICAgIH0sXG4gICAgICBmZWVsc0xpa2VIaWdoOiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRmVlbHMgTGlrZSBIaWdoXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gYXBwYXJlbnQgdGVtcGVyYXR1cmVcIixcbiAgICAgIH0sXG4gICAgICBmZWVsc0xpa2VMb3c6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJGZWVscyBMaWtlIExvd1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNaW5pbXVtIGFwcGFyZW50IHRlbXBlcmF0dXJlXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBXaW5kIHBhcmFtZXRlcnMgKFNpZ25hbEsgY29tcGxpYW50IC0gbS9zLCByYWRpYW5zKVxuICAgICAgd2luZEF2Zzoge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBTcGVlZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kIHNwZWVkIGF0IDEwbSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kR3VzdDoge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBHdXN0c1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kIGd1c3Qgc3BlZWQgYXQgMTBtIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmREaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQgZGlyZWN0aW9uIGF0IDEwbSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kQXZnTWF4OiB7XG4gICAgICAgIHVuaXRzOiBcIm0vc1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2luZCBTcGVlZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIHdpbmQgc3BlZWRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kR3VzdE1heDoge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTWF4IFdpbmQgR3VzdHNcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSB3aW5kIGd1c3Qgc3BlZWRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kRGlyZWN0aW9uRG9taW5hbnQ6IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRvbWluYW50IFdpbmQgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRvbWluYW50IHdpbmQgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBQcmVzc3VyZSBwYXJhbWV0ZXJzIChTaWduYWxLIGNvbXBsaWFudCAtIFBhc2NhbClcbiAgICAgIHNlYUxldmVsUHJlc3N1cmU6IHtcbiAgICAgICAgdW5pdHM6IFwiUGFcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU2VhIExldmVsIFByZXNzdXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkF0bW9zcGhlcmljIHByZXNzdXJlIGF0IG1lYW4gc2VhIGxldmVsXCIsXG4gICAgICB9LFxuICAgICAgc3RhdGlvblByZXNzdXJlOiB7XG4gICAgICAgIHVuaXRzOiBcIlBhXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN1cmZhY2UgUHJlc3N1cmVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiQXRtb3NwaGVyaWMgcHJlc3N1cmUgYXQgc3VyZmFjZVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gSHVtaWRpdHkgKFNpZ25hbEsgY29tcGxpYW50IC0gcmF0aW8gMC0xKVxuICAgICAgcmVsYXRpdmVIdW1pZGl0eToge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJSZWxhdGl2ZSBIdW1pZGl0eVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJSZWxhdGl2ZSBodW1pZGl0eSBhdCAybSBoZWlnaHQgKDAtMSlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIENsb3VkIGNvdmVyIChTaWduYWxLIGNvbXBsaWFudCAtIHJhdGlvIDAtMSlcbiAgICAgIGNsb3VkQ292ZXI6IHtcbiAgICAgICAgdW5pdHM6IFwicmF0aW9cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ2xvdWQgQ292ZXJcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVG90YWwgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBsb3dDbG91ZENvdmVyOiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkxvdyBDbG91ZCBDb3ZlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJMb3cgYWx0aXR1ZGUgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBtaWRDbG91ZENvdmVyOiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1pZCBDbG91ZCBDb3ZlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNaWQgYWx0aXR1ZGUgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBoaWdoQ2xvdWRDb3Zlcjoge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJIaWdoIENsb3VkIENvdmVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkhpZ2ggYWx0aXR1ZGUgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFByZWNpcGl0YXRpb24gKFNpZ25hbEsgY29tcGxpYW50IC0gbWV0ZXJzKVxuICAgICAgcHJlY2lwOiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiUHJlY2lwaXRhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJQcmVjaXBpdGF0aW9uIGFtb3VudFwiLFxuICAgICAgfSxcbiAgICAgIHJhaW46IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJSYWluXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlJhaW4gYW1vdW50XCIsXG4gICAgICB9LFxuICAgICAgc25vd2ZhbGw6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTbm93ZmFsbFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTbm93ZmFsbCBhbW91bnRcIixcbiAgICAgIH0sXG4gICAgICBwcmVjaXBQcm9iYWJpbGl0eToge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJQcmVjaXBpdGF0aW9uIFByb2JhYmlsaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlByb2JhYmlsaXR5IG9mIHByZWNpcGl0YXRpb24gKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBwcmVjaXBTdW06IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJQcmVjaXBpdGF0aW9uIFN1bVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJUb3RhbCBwcmVjaXBpdGF0aW9uIGFtb3VudFwiLFxuICAgICAgfSxcbiAgICAgIHByZWNpcFByb2JhYmlsaXR5TWF4OiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBQcmVjaXBpdGF0aW9uIFByb2JhYmlsaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gcHJvYmFiaWxpdHkgb2YgcHJlY2lwaXRhdGlvbiAoMC0xKVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gVmlzaWJpbGl0eSAoU2lnbmFsSyBjb21wbGlhbnQgLSBtZXRlcnMpXG4gICAgICB2aXNpYmlsaXR5OiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiVmlzaWJpbGl0eVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJIb3Jpem9udGFsIHZpc2liaWxpdHlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFdhdmUgcGFyYW1ldGVycyAobWV0ZXJzLCBzZWNvbmRzLCByYWRpYW5zKVxuICAgICAgc2lnbmlmaWNhbnRXYXZlSGVpZ2h0OiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2F2ZSBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU2lnbmlmaWNhbnQgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBzaWduaWZpY2FudFdhdmVIZWlnaHRNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2F2ZSBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBzaWduaWZpY2FudCB3YXZlIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIG1lYW5XYXZlUGVyaW9kOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2F2ZSBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWVhbiB3YXZlIHBlcmlvZFwiLFxuICAgICAgfSxcbiAgICAgIG1lYW5XYXZlUGVyaW9kTWF4OiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTWF4IFdhdmUgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gd2F2ZSBwZXJpb2RcIixcbiAgICAgIH0sXG4gICAgICBtZWFuV2F2ZURpcmVjdGlvbjoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2F2ZSBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWVhbiB3YXZlIGRpcmVjdGlvblwiLFxuICAgICAgfSxcbiAgICAgIG1lYW5XYXZlRGlyZWN0aW9uRG9taW5hbnQ6IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRvbWluYW50IFdhdmUgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRvbWluYW50IHdhdmUgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVIZWlnaHQ6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXaW5kIFdhdmUgSGVpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQtZ2VuZXJhdGVkIHdhdmUgaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVIZWlnaHRNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2luZCBXYXZlIEhlaWdodFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIHdpbmQtZ2VuZXJhdGVkIHdhdmUgaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVQZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXaW5kIFdhdmUgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQtZ2VuZXJhdGVkIHdhdmUgcGVyaW9kXCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVEaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgV2F2ZSBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZC1nZW5lcmF0ZWQgd2F2ZSBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG4gICAgICB3aW5kV2F2ZURpcmVjdGlvbkRvbWluYW50OiB7XG4gICAgICAgIHVuaXRzOiBcInJhZFwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEb21pbmFudCBXaW5kIFdhdmUgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRvbWluYW50IHdpbmQtZ2VuZXJhdGVkIHdhdmUgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVQZWFrUGVyaW9kOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBXYXZlIFBlYWsgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlBlYWsgcGVyaW9kIG9mIHdpbmQtZ2VuZXJhdGVkIHdhdmVzXCIsXG4gICAgICB9LFxuICAgICAgc3dlbGxTaWduaWZpY2FudEhlaWdodDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIEhlaWdodFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTd2VsbCB3YXZlIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsU2lnbmlmaWNhbnRIZWlnaHRNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggU3dlbGwgSGVpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gc3dlbGwgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBzd2VsbE1lYW5QZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTd2VsbCBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU3dlbGwgd2F2ZSBwZXJpb2RcIixcbiAgICAgIH0sXG4gICAgICBzd2VsbE1lYW5QZXJpb2RNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggU3dlbGwgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gc3dlbGwgd2F2ZSBwZXJpb2RcIixcbiAgICAgIH0sXG4gICAgICBzd2VsbE1lYW5EaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTd2VsbCB3YXZlIGRpcmVjdGlvblwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsTWVhbkRpcmVjdGlvbkRvbWluYW50OiB7XG4gICAgICAgIHVuaXRzOiBcInJhZFwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEb21pbmFudCBTd2VsbCBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRG9taW5hbnQgc3dlbGwgd2F2ZSBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG4gICAgICBzd2VsbFBlYWtQZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTd2VsbCBQZWFrIFBlcmlvZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJQZWFrIHBlcmlvZCBvZiBzd2VsbCB3YXZlc1wiLFxuICAgICAgfSxcblxuICAgICAgLy8gT2NlYW4gY3VycmVudHNcbiAgICAgIGN1cnJlbnRWZWxvY2l0eToge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ3VycmVudCBTcGVlZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJPY2VhbiBjdXJyZW50IHZlbG9jaXR5XCIsXG4gICAgICB9LFxuICAgICAgY3VycmVudERpcmVjdGlvbjoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ3VycmVudCBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiT2NlYW4gY3VycmVudCBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFNvbGFyIHJhZGlhdGlvblxuICAgICAgc29sYXJSYWRpYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwiVy9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTb2xhciBSYWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU2hvcnR3YXZlIHNvbGFyIHJhZGlhdGlvblwiLFxuICAgICAgfSxcbiAgICAgIHNvbGFyUmFkaWF0aW9uU3VtOiB7XG4gICAgICAgIHVuaXRzOiBcIkovbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiVG90YWwgU29sYXIgUmFkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRvdGFsIHNob3J0d2F2ZSBzb2xhciByYWRpYXRpb25cIixcbiAgICAgIH0sXG4gICAgICBkaXJlY3RSYWRpYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwiVy9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEaXJlY3QgUmFkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRpcmVjdCBzb2xhciByYWRpYXRpb25cIixcbiAgICAgIH0sXG4gICAgICBkaWZmdXNlUmFkaWF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcIlcvbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGlmZnVzZSBSYWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGlmZnVzZSBzb2xhciByYWRpYXRpb25cIixcbiAgICAgIH0sXG4gICAgICBpcnJhZGlhbmNlRGlyZWN0Tm9ybWFsOiB7XG4gICAgICAgIHVuaXRzOiBcIlcvbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGlyZWN0IE5vcm1hbCBJcnJhZGlhbmNlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRpcmVjdCBub3JtYWwgc29sYXIgaXJyYWRpYW5jZVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gT3RoZXJcbiAgICAgIHV2SW5kZXg6IHtcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiVVYgSW5kZXhcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVVYgaW5kZXhcIixcbiAgICAgIH0sXG4gICAgICB1dkluZGV4TWF4OiB7XG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBVViBJbmRleFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIFVWIGluZGV4XCIsXG4gICAgICB9LFxuICAgICAgd2VhdGhlckNvZGU6IHtcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2VhdGhlciBDb2RlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldNTyB3ZWF0aGVyIGludGVycHJldGF0aW9uIGNvZGVcIixcbiAgICAgIH0sXG4gICAgICBpc0RheWxpZ2h0OiB7XG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIklzIERheWxpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldoZXRoZXIgaXQgaXMgZGF5ICgxKSBvciBuaWdodCAoMClcIixcbiAgICAgIH0sXG4gICAgICBzdW5zaGluZUR1cmF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU3Vuc2hpbmUgRHVyYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRHVyYXRpb24gb2Ygc3Vuc2hpbmVcIixcbiAgICAgIH0sXG4gICAgICBkYXlsaWdodER1cmF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGF5bGlnaHQgRHVyYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRHVyYXRpb24gb2YgZGF5bGlnaHRcIixcbiAgICAgIH0sXG4gICAgICBjYXBlOiB7XG4gICAgICAgIHVuaXRzOiBcIkova2dcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ0FQRVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJDb252ZWN0aXZlIEF2YWlsYWJsZSBQb3RlbnRpYWwgRW5lcmd5XCIsXG4gICAgICB9LFxuICAgICAgc3VucmlzZToge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJTdW5yaXNlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlN1bnJpc2UgdGltZVwiLFxuICAgICAgfSxcbiAgICAgIHN1bnNldDoge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJTdW5zZXRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU3Vuc2V0IHRpbWVcIixcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGlmIChtZXRhZGF0YU1hcFtwYXJhbWV0ZXJOYW1lXSkge1xuICAgICAgcmV0dXJuIG1ldGFkYXRhTWFwW3BhcmFtZXRlck5hbWVdO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIGZvciB1bmtub3duIHBhcmFtZXRlcnNcbiAgICBsZXQgdW5pdHMgPSBcIlwiO1xuICAgIGxldCBkZXNjcmlwdGlvbiA9IGAke3BhcmFtZXRlck5hbWV9IGZvcmVjYXN0IHBhcmFtZXRlcmA7XG5cbiAgICBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlRlbXBcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInRlbXBlcmF0dXJlXCIpKSB7XG4gICAgICB1bml0cyA9IFwiS1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlRlbXBlcmF0dXJlIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwid2luZFwiKSAmJiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIkF2Z1wiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiR3VzdFwiKSkpIHtcbiAgICAgIHVuaXRzID0gXCJtL3NcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJXaW5kIHNwZWVkIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiVmVsb2NpdHlcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInZlbG9jaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwibS9zXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiU3BlZWQgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJQcmVzc3VyZVwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwicHJlc3N1cmVcIikpIHtcbiAgICAgIHVuaXRzID0gXCJQYVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlByZXNzdXJlIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiSHVtaWRpdHlcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcImh1bWlkaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwicmF0aW9cIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJIdW1pZGl0eSBmb3JlY2FzdCAoMC0xKVwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInByZWNpcFwiKSAmJiAhcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlByb2JhYmlsaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwibVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlByZWNpcGl0YXRpb24gZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJQcm9iYWJpbGl0eVwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiQ292ZXJcIikpIHtcbiAgICAgIHVuaXRzID0gXCJyYXRpb1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlJhdGlvIGZvcmVjYXN0ICgwLTEpXCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiRGlyZWN0aW9uXCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJkaXJlY3Rpb25cIikpIHtcbiAgICAgIHVuaXRzID0gXCJyYWRcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJEaXJlY3Rpb24gZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJ2aXNpYmlsaXR5XCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJWaXNpYmlsaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwibVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlZpc2liaWxpdHkgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJIZWlnaHRcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcImhlaWdodFwiKSkge1xuICAgICAgdW5pdHMgPSBcIm1cIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJIZWlnaHQgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJQZXJpb2RcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInBlcmlvZFwiKSkge1xuICAgICAgdW5pdHMgPSBcInNcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJQZXJpb2QgZm9yZWNhc3RcIjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgdW5pdHMsXG4gICAgICBkaXNwbGF5TmFtZTogcGFyYW1ldGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uLFxuICAgIH07XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBob3VybHkgd2VhdGhlciBmb3JlY2FzdFxuICBjb25zdCBwcm9jZXNzSG91cmx5V2VhdGhlckZvcmVjYXN0ID0gKFxuICAgIGRhdGE6IE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSxcbiAgICBtYXhIb3VyczogbnVtYmVyLFxuICApOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdID0gW107XG4gICAgY29uc3QgaG91cmx5ID0gZGF0YS5ob3VybHk7XG4gICAgaWYgKCFob3VybHkgfHwgIWhvdXJseS50aW1lKSByZXR1cm4gZm9yZWNhc3RzO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCBzdGFydEluZGV4ID0gaG91cmx5LnRpbWUuZmluZEluZGV4KFxuICAgICAgKHQpID0+IG5ldyBEYXRlKHQpID49IG5vdyxcbiAgICApO1xuICAgIGlmIChzdGFydEluZGV4ID09PSAtMSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IGNvdW50ID0gTWF0aC5taW4obWF4SG91cnMsIGhvdXJseS50aW1lLmxlbmd0aCAtIHN0YXJ0SW5kZXgpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICBjb25zdCBkYXRhSW5kZXggPSBzdGFydEluZGV4ICsgaTtcbiAgICAgIGNvbnN0IGZvcmVjYXN0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgICB0aW1lc3RhbXA6IGhvdXJseS50aW1lW2RhdGFJbmRleF0sXG4gICAgICAgIHJlbGF0aXZlSG91cjogaSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFByb2Nlc3MgZWFjaCBmaWVsZCB3aXRoIHVuaXQgY29udmVyc2lvbnMgYW5kIHRyYW5zbGF0ZSBmaWVsZCBuYW1lc1xuICAgICAgT2JqZWN0LmVudHJpZXMoaG91cmx5KS5mb3JFYWNoKChbZmllbGQsIHZhbHVlc10pID0+IHtcbiAgICAgICAgaWYgKGZpZWxkID09PSBcInRpbWVcIiB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZXMpKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVzW2RhdGFJbmRleF07XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSByZXR1cm47XG5cbiAgICAgICAgLy8gVHJhbnNsYXRlIGZpZWxkIG5hbWUgdG8gU2lnbmFsSy1hbGlnbmVkIG5hbWVcbiAgICAgICAgY29uc3QgdHJhbnNsYXRlZEZpZWxkID0gdHJhbnNsYXRlRmllbGROYW1lKGZpZWxkKTtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZC5pbmNsdWRlcyhcInRlbXBlcmF0dXJlXCIpIHx8IGZpZWxkID09PSBcImRld19wb2ludF8ybVwiIHx8IGZpZWxkID09PSBcImFwcGFyZW50X3RlbXBlcmF0dXJlXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gY2Vsc2l1c1RvS2VsdmluKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQuaW5jbHVkZXMoXCJkaXJlY3Rpb25cIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gZGVnVG9SYWQodmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gXCJwcmVjaXBpdGF0aW9uXCIgfHwgZmllbGQgPT09IFwicmFpblwiIHx8IGZpZWxkID09PSBcInNob3dlcnNcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBtbVRvTSh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInNub3dmYWxsXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gY21Ub00odmFsdWUgYXMgbnVtYmVyKTsgLy8gU25vd2ZhbGwgaXMgaW4gY21cbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcInByZXNzdXJlXCIpKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGhQYVRvUEEodmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImh1bWlkaXR5XCIpIHx8IGZpZWxkLmluY2x1ZGVzKFwiY2xvdWRfY292ZXJcIikgfHwgZmllbGQgPT09IFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHBlcmNlbnRUb1JhdGlvKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwidmlzaWJpbGl0eVwiKSB7XG4gICAgICAgICAgLy8gVmlzaWJpbGl0eSBpcyBhbHJlYWR5IGluIG1ldGVycyBmcm9tIE9wZW4tTWV0ZW9cbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gdmFsdWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZm9yZWNhc3RzLnB1c2goZm9yZWNhc3QpO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBkYWlseSB3ZWF0aGVyIGZvcmVjYXN0XG4gIGNvbnN0IHByb2Nlc3NEYWlseVdlYXRoZXJGb3JlY2FzdCA9IChcbiAgICBkYXRhOiBPcGVuTWV0ZW9XZWF0aGVyUmVzcG9uc2UsXG4gICAgbWF4RGF5czogbnVtYmVyLFxuICApOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdID0gW107XG4gICAgY29uc3QgZGFpbHkgPSBkYXRhLmRhaWx5O1xuICAgIGlmICghZGFpbHkgfHwgIWRhaWx5LnRpbWUpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKG1heERheXMsIGRhaWx5LnRpbWUubGVuZ3RoKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgY29uc3QgZm9yZWNhc3Q6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgIGRhdGU6IGRhaWx5LnRpbWVbaV0sXG4gICAgICAgIGRheUluZGV4OiBpLFxuICAgICAgfTtcblxuICAgICAgLy8gUHJvY2VzcyBlYWNoIGZpZWxkIHdpdGggdW5pdCBjb252ZXJzaW9ucyBhbmQgdHJhbnNsYXRlIGZpZWxkIG5hbWVzXG4gICAgICBPYmplY3QuZW50cmllcyhkYWlseSkuZm9yRWFjaCgoW2ZpZWxkLCB2YWx1ZXNdKSA9PiB7XG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJ0aW1lXCIgfHwgIUFycmF5LmlzQXJyYXkodmFsdWVzKSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHZhbHVlc1tpXTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybjtcblxuICAgICAgICAvLyBUcmFuc2xhdGUgZmllbGQgbmFtZSB0byBTaWduYWxLLWFsaWduZWQgbmFtZVxuICAgICAgICBjb25zdCB0cmFuc2xhdGVkRmllbGQgPSB0cmFuc2xhdGVGaWVsZE5hbWUoZmllbGQpO1xuXG4gICAgICAgIC8vIEFwcGx5IHVuaXQgY29udmVyc2lvbnNcbiAgICAgICAgaWYgKGZpZWxkLmluY2x1ZGVzKFwidGVtcGVyYXR1cmVcIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gY2Vsc2l1c1RvS2VsdmluKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQuaW5jbHVkZXMoXCJkaXJlY3Rpb25cIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gZGVnVG9SYWQodmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gXCJwcmVjaXBpdGF0aW9uX3N1bVwiIHx8IGZpZWxkID09PSBcInJhaW5fc3VtXCIgfHwgZmllbGQgPT09IFwic2hvd2Vyc19zdW1cIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBtbVRvTSh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInNub3dmYWxsX3N1bVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGNtVG9NKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eV9tYXhcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBwZXJjZW50VG9SYXRpbyh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgaG91cmx5IG1hcmluZSBmb3JlY2FzdFxuICBjb25zdCBwcm9jZXNzSG91cmx5TWFyaW5lRm9yZWNhc3QgPSAoXG4gICAgZGF0YTogT3Blbk1ldGVvTWFyaW5lUmVzcG9uc2UsXG4gICAgbWF4SG91cnM6IG51bWJlcixcbiAgKTogUmVjb3JkPHN0cmluZywgYW55PltdID0+IHtcbiAgICBjb25zdCBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuICAgIGNvbnN0IGhvdXJseSA9IGRhdGEuaG91cmx5O1xuICAgIGlmICghaG91cmx5IHx8ICFob3VybHkudGltZSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IGhvdXJseS50aW1lLmZpbmRJbmRleChcbiAgICAgICh0KSA9PiBuZXcgRGF0ZSh0KSA+PSBub3csXG4gICAgKTtcbiAgICBpZiAoc3RhcnRJbmRleCA9PT0gLTEpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKG1heEhvdXJzLCBob3VybHkudGltZS5sZW5ndGggLSBzdGFydEluZGV4KTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgY29uc3QgZGF0YUluZGV4ID0gc3RhcnRJbmRleCArIGk7XG4gICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBob3VybHkudGltZVtkYXRhSW5kZXhdLFxuICAgICAgICByZWxhdGl2ZUhvdXI6IGksXG4gICAgICB9O1xuXG4gICAgICAvLyBQcm9jZXNzIGVhY2ggZmllbGQgd2l0aCB1bml0IGNvbnZlcnNpb25zIGFuZCB0cmFuc2xhdGUgZmllbGQgbmFtZXNcbiAgICAgIE9iamVjdC5lbnRyaWVzKGhvdXJseSkuZm9yRWFjaCgoW2ZpZWxkLCB2YWx1ZXNdKSA9PiB7XG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJ0aW1lXCIgfHwgIUFycmF5LmlzQXJyYXkodmFsdWVzKSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHZhbHVlc1tkYXRhSW5kZXhdO1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gICAgICAgIC8vIFRyYW5zbGF0ZSBmaWVsZCBuYW1lIHRvIFNpZ25hbEstYWxpZ25lZCBuYW1lXG4gICAgICAgIGNvbnN0IHRyYW5zbGF0ZWRGaWVsZCA9IHRyYW5zbGF0ZUZpZWxkTmFtZShmaWVsZCk7XG5cbiAgICAgICAgLy8gQXBwbHkgdW5pdCBjb252ZXJzaW9uc1xuICAgICAgICBpZiAoZmllbGQgPT09IFwic2VhX3N1cmZhY2VfdGVtcGVyYXR1cmVcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBjZWxzaXVzVG9LZWx2aW4odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBkZWdUb1JhZCh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcIm9jZWFuX2N1cnJlbnRfdmVsb2NpdHlcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBrbWhUb01zKHZhbHVlIGFzIG51bWJlcik7IC8vIEN1cnJlbnQgdmVsb2NpdHkgaXMgaW4ga20vaFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFdhdmUgaGVpZ2h0cywgcGVyaW9kcyBhcmUgYWxyZWFkeSBpbiBtZXRlcnMvc2Vjb25kc1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgZGFpbHkgbWFyaW5lIGZvcmVjYXN0XG4gIGNvbnN0IHByb2Nlc3NEYWlseU1hcmluZUZvcmVjYXN0ID0gKFxuICAgIGRhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlLFxuICAgIG1heERheXM6IG51bWJlcixcbiAgKTogUmVjb3JkPHN0cmluZywgYW55PltdID0+IHtcbiAgICBjb25zdCBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuICAgIGNvbnN0IGRhaWx5ID0gZGF0YS5kYWlseTtcbiAgICBpZiAoIWRhaWx5IHx8ICFkYWlseS50aW1lKSByZXR1cm4gZm9yZWNhc3RzO1xuXG4gICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihtYXhEYXlzLCBkYWlseS50aW1lLmxlbmd0aCk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgIGNvbnN0IGZvcmVjYXN0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgICBkYXRlOiBkYWlseS50aW1lW2ldLFxuICAgICAgICBkYXlJbmRleDogaSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFByb2Nlc3MgZWFjaCBmaWVsZCB3aXRoIHVuaXQgY29udmVyc2lvbnMgYW5kIHRyYW5zbGF0ZSBmaWVsZCBuYW1lc1xuICAgICAgT2JqZWN0LmVudHJpZXMoZGFpbHkpLmZvckVhY2goKFtmaWVsZCwgdmFsdWVzXSkgPT4ge1xuICAgICAgICBpZiAoZmllbGQgPT09IFwidGltZVwiIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykpIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB2YWx1ZXNbaV07XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSByZXR1cm47XG5cbiAgICAgICAgLy8gVHJhbnNsYXRlIGZpZWxkIG5hbWUgdG8gU2lnbmFsSy1hbGlnbmVkIG5hbWVcbiAgICAgICAgY29uc3QgdHJhbnNsYXRlZEZpZWxkID0gdHJhbnNsYXRlRmllbGROYW1lKGZpZWxkKTtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBkZWdUb1JhZCh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFB1Ymxpc2ggaG91cmx5IGZvcmVjYXN0cyBmb3IgYSBzaW5nbGUgcGFja2FnZSAod2VhdGhlciBvciBtYXJpbmUpXG4gIGNvbnN0IHB1Ymxpc2hIb3VybHlQYWNrYWdlID0gKFxuICAgIGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdLFxuICAgIHBhY2thZ2VUeXBlOiBzdHJpbmcsXG4gICk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IHNvdXJjZUxhYmVsID0gZ2V0U291cmNlTGFiZWwoYGhvdXJseS0ke3BhY2thZ2VUeXBlfWApO1xuXG4gICAgZm9yZWNhc3RzLmZvckVhY2goKGZvcmVjYXN0LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgdmFsdWVzOiB7IHBhdGg6IHN0cmluZzsgdmFsdWU6IGFueSB9W10gPSBbXTtcbiAgICAgIGNvbnN0IG1ldGE6IHsgcGF0aDogc3RyaW5nOyB2YWx1ZTogYW55IH1bXSA9IFtdO1xuXG4gICAgICBPYmplY3QuZW50cmllcyhmb3JlY2FzdCkuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwidGltZXN0YW1wXCIgfHwga2V5ID09PSBcInJlbGF0aXZlSG91clwiKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHBhdGggPSBgZW52aXJvbm1lbnQub3V0c2lkZS5vcGVubWV0ZW8uZm9yZWNhc3QuaG91cmx5LiR7a2V5fS4ke2luZGV4fWA7XG4gICAgICAgIGNvbnN0IG1ldGFkYXRhID0gZ2V0UGFyYW1ldGVyTWV0YWRhdGEoa2V5KTtcbiAgICAgICAgdmFsdWVzLnB1c2goeyBwYXRoLCB2YWx1ZSB9KTtcbiAgICAgICAgbWV0YS5wdXNoKHsgcGF0aCwgdmFsdWU6IG1ldGFkYXRhIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGlmICh2YWx1ZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGRlbHRhOiBTaWduYWxLRGVsdGEgPSB7XG4gICAgICAgIGNvbnRleHQ6IFwidmVzc2Vscy5zZWxmXCIsXG4gICAgICAgIHVwZGF0ZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAkc291cmNlOiBzb3VyY2VMYWJlbCxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3QudGltZXN0YW1wIHx8IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIHZhbHVlcyxcbiAgICAgICAgICAgIG1ldGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGFwcC5oYW5kbGVNZXNzYWdlKHBsdWdpbi5pZCwgZGVsdGEpO1xuICAgIH0pO1xuXG4gICAgYXBwLmRlYnVnKGBQdWJsaXNoZWQgJHtmb3JlY2FzdHMubGVuZ3RofSBob3VybHkgJHtwYWNrYWdlVHlwZX0gZm9yZWNhc3RzYCk7XG4gIH07XG5cbiAgLy8gUHVibGlzaCBkYWlseSBmb3JlY2FzdHMgZm9yIGEgc2luZ2xlIHBhY2thZ2UgKHdlYXRoZXIgb3IgbWFyaW5lKVxuICBjb25zdCBwdWJsaXNoRGFpbHlQYWNrYWdlID0gKFxuICAgIGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdLFxuICAgIHBhY2thZ2VUeXBlOiBzdHJpbmcsXG4gICk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IHNvdXJjZUxhYmVsID0gZ2V0U291cmNlTGFiZWwoYGRhaWx5LSR7cGFja2FnZVR5cGV9YCk7XG5cbiAgICBmb3JlY2FzdHMuZm9yRWFjaCgoZm9yZWNhc3QsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZXM6IHsgcGF0aDogc3RyaW5nOyB2YWx1ZTogYW55IH1bXSA9IFtdO1xuICAgICAgY29uc3QgbWV0YTogeyBwYXRoOiBzdHJpbmc7IHZhbHVlOiBhbnkgfVtdID0gW107XG5cbiAgICAgIE9iamVjdC5lbnRyaWVzKGZvcmVjYXN0KS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCJkYXRlXCIgfHwga2V5ID09PSBcImRheUluZGV4XCIpIHJldHVybjtcbiAgICAgICAgY29uc3QgcGF0aCA9IGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5kYWlseS4ke2tleX0uJHtpbmRleH1gO1xuICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGdldFBhcmFtZXRlck1ldGFkYXRhKGtleSk7XG4gICAgICAgIHZhbHVlcy5wdXNoKHsgcGF0aCwgdmFsdWUgfSk7XG4gICAgICAgIG1ldGEucHVzaCh7IHBhdGgsIHZhbHVlOiBtZXRhZGF0YSB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodmFsdWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBkZWx0YTogU2lnbmFsS0RlbHRhID0ge1xuICAgICAgICBjb250ZXh0OiBcInZlc3NlbHMuc2VsZlwiLFxuICAgICAgICB1cGRhdGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgJHNvdXJjZTogc291cmNlTGFiZWwsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIHZhbHVlcyxcbiAgICAgICAgICAgIG1ldGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGFwcC5oYW5kbGVNZXNzYWdlKHBsdWdpbi5pZCwgZGVsdGEpO1xuICAgIH0pO1xuXG4gICAgYXBwLmRlYnVnKGBQdWJsaXNoZWQgJHtmb3JlY2FzdHMubGVuZ3RofSBkYWlseSAke3BhY2thZ2VUeXBlfSBmb3JlY2FzdHNgKTtcbiAgfTtcblxuICAvLyBGZXRjaCBmb3JlY2FzdHMgZm9yIGEgbW92aW5nIHZlc3NlbCAocG9zaXRpb24tc3BlY2lmaWMgZm9yZWNhc3RzIGFsb25nIHByZWRpY3RlZCByb3V0ZSlcbiAgY29uc3QgZmV0Y2hGb3JlY2FzdEZvck1vdmluZ1Zlc3NlbCA9IGFzeW5jIChcbiAgICBjb25maWc6IFBsdWdpbkNvbmZpZyxcbiAgKTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgaWYgKFxuICAgICAgIXN0YXRlLmN1cnJlbnRQb3NpdGlvbiB8fFxuICAgICAgIXN0YXRlLmN1cnJlbnRIZWFkaW5nIHx8XG4gICAgICAhc3RhdGUuY3VycmVudFNPRyB8fFxuICAgICAgIWlzVmVzc2VsTW92aW5nKHN0YXRlLmN1cnJlbnRTT0csIGNvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZCkgfHxcbiAgICAgICFzdGF0ZS5tb3ZpbmdGb3JlY2FzdEVuZ2FnZWRcbiAgICApIHtcbiAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgXCJWZXNzZWwgbm90IG1vdmluZywgbWlzc2luZyBuYXZpZ2F0aW9uIGRhdGEsIG9yIG1vdmluZyBmb3JlY2FzdCBub3QgZW5nYWdlZCwgZmFsbGluZyBiYWNrIHRvIHN0YXRpb25hcnkgZm9yZWNhc3RcIixcbiAgICAgICk7XG4gICAgICByZXR1cm4gZmV0Y2hBbmRQdWJsaXNoRm9yZWNhc3RzKGNvbmZpZyk7XG4gICAgfVxuXG4gICAgYXBwLmRlYnVnKFxuICAgICAgYFZlc3NlbCBtb3ZpbmcgYXQgJHsoc3RhdGUuY3VycmVudFNPRyAqIDEuOTQzODQ0KS50b0ZpeGVkKDEpfSBrbm90cyAodGhyZXNob2xkOiAke2NvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZH0ga25vdHMpLCBoZWFkaW5nICR7cmFkVG9EZWcoc3RhdGUuY3VycmVudEhlYWRpbmcpLnRvRml4ZWQoMSl9wrBgLFxuICAgICk7XG4gICAgYXBwLmRlYnVnKFxuICAgICAgYEZldGNoaW5nIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0cyBmb3IgJHtjb25maWcubWF4Rm9yZWNhc3RIb3Vyc30gaG91cnNgLFxuICAgICk7XG5cbiAgICAvLyBDYXB0dXJlIHZhbGlkYXRlZCBzdGF0ZSBmb3IgdXNlIGluIGhlbHBlciBmdW5jdGlvbnNcbiAgICBjb25zdCBjdXJyZW50UG9zaXRpb24gPSBzdGF0ZS5jdXJyZW50UG9zaXRpb24hO1xuICAgIGNvbnN0IGN1cnJlbnRIZWFkaW5nID0gc3RhdGUuY3VycmVudEhlYWRpbmchO1xuICAgIGNvbnN0IGN1cnJlbnRTT0cgPSBzdGF0ZS5jdXJyZW50U09HITtcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgY29uc3QgY3VycmVudEhvdXIgPSBuZXcgRGF0ZShcbiAgICAgIG5vdy5nZXRGdWxsWWVhcigpLFxuICAgICAgbm93LmdldE1vbnRoKCksXG4gICAgICBub3cuZ2V0RGF0ZSgpLFxuICAgICAgbm93LmdldEhvdXJzKCksXG4gICAgICAwLFxuICAgICAgMCxcbiAgICAgIDAsXG4gICAgKTtcblxuICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmZXRjaCBmb3JlY2FzdCBmb3IgYSBzaW5nbGUgaG91clxuICAgIGNvbnN0IGZldGNoSG91ckZvcmVjYXN0ID0gYXN5bmMgKGhvdXI6IG51bWJlcik6IFByb21pc2U8e1xuICAgICAgaG91cjogbnVtYmVyO1xuICAgICAgcHJlZGljdGVkUG9zOiBQb3NpdGlvbjtcbiAgICAgIHRhcmdldFRpbWU6IERhdGU7XG4gICAgICB3ZWF0aGVyRGF0YTogT3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlIHwgbnVsbDtcbiAgICAgIG1hcmluZURhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbDtcbiAgICB9IHwgbnVsbD4gPT4ge1xuICAgICAgY29uc3QgcHJlZGljdGVkUG9zID0gY2FsY3VsYXRlRnV0dXJlUG9zaXRpb24oXG4gICAgICAgIGN1cnJlbnRQb3NpdGlvbixcbiAgICAgICAgY3VycmVudEhlYWRpbmcsXG4gICAgICAgIGN1cnJlbnRTT0csXG4gICAgICAgIGhvdXIsXG4gICAgICApO1xuICAgICAgY29uc3QgdGFyZ2V0VGltZSA9IG5ldyBEYXRlKGN1cnJlbnRIb3VyLmdldFRpbWUoKSArIGhvdXIgKiAzNjAwMDAwKTtcblxuICAgICAgYXBwLmRlYnVnKFxuICAgICAgICBgSG91ciAke2hvdXJ9OiBGZXRjaGluZyB3ZWF0aGVyIGZvciBwb3NpdGlvbiAke3ByZWRpY3RlZFBvcy5sYXRpdHVkZS50b0ZpeGVkKDYpfSwgJHtwcmVkaWN0ZWRQb3MubG9uZ2l0dWRlLnRvRml4ZWQoNil9YCxcbiAgICAgICk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHdlYXRoZXJEYXRhID0gYXdhaXQgZmV0Y2hXZWF0aGVyRGF0YShwcmVkaWN0ZWRQb3MsIGNvbmZpZyk7XG4gICAgICAgIGNvbnN0IG1hcmluZURhdGEgPVxuICAgICAgICAgIGNvbmZpZy5lbmFibGVNYXJpbmVIb3VybHkgfHwgY29uZmlnLmVuYWJsZU1hcmluZURhaWx5XG4gICAgICAgICAgICA/IGF3YWl0IGZldGNoTWFyaW5lRGF0YShwcmVkaWN0ZWRQb3MsIGNvbmZpZylcbiAgICAgICAgICAgIDogbnVsbDtcblxuICAgICAgICByZXR1cm4geyBob3VyLCBwcmVkaWN0ZWRQb3MsIHRhcmdldFRpbWUsIHdlYXRoZXJEYXRhLCBtYXJpbmVEYXRhIH07XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgYXBwLmRlYnVnKGBIb3VyICR7aG91cn06IEZldGNoIGZhaWxlZCAtICR7ZXJyfWApO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEZldGNoIGZvcmVjYXN0cyBpbiBwYXJhbGxlbCBiYXRjaGVzICg1IGNvbmN1cnJlbnQgcmVxdWVzdHMpXG4gICAgICBjb25zdCBCQVRDSF9TSVpFID0gNTtcbiAgICAgIGNvbnN0IEJBVENIX0RFTEFZX01TID0gMjAwO1xuXG4gICAgICBjb25zdCBhbGxSZXN1bHRzOiBBcnJheTx7XG4gICAgICAgIGhvdXI6IG51bWJlcjtcbiAgICAgICAgcHJlZGljdGVkUG9zOiBQb3NpdGlvbjtcbiAgICAgICAgdGFyZ2V0VGltZTogRGF0ZTtcbiAgICAgICAgd2VhdGhlckRhdGE6IE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSB8IG51bGw7XG4gICAgICAgIG1hcmluZURhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbDtcbiAgICAgIH0+ID0gW107XG5cbiAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgYEZldGNoaW5nICR7Y29uZmlnLm1heEZvcmVjYXN0SG91cnN9IGhvdXJseSBmb3JlY2FzdHMgaW4gYmF0Y2hlcyBvZiAke0JBVENIX1NJWkV9YCxcbiAgICAgICk7XG5cbiAgICAgIGZvciAoXG4gICAgICAgIGxldCBiYXRjaFN0YXJ0ID0gMDtcbiAgICAgICAgYmF0Y2hTdGFydCA8IGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzO1xuICAgICAgICBiYXRjaFN0YXJ0ICs9IEJBVENIX1NJWkVcbiAgICAgICkge1xuICAgICAgICBjb25zdCBiYXRjaEVuZCA9IE1hdGgubWluKFxuICAgICAgICAgIGJhdGNoU3RhcnQgKyBCQVRDSF9TSVpFLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzLFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBiYXRjaEhvdXJzID0gQXJyYXkuZnJvbShcbiAgICAgICAgICB7IGxlbmd0aDogYmF0Y2hFbmQgLSBiYXRjaFN0YXJ0IH0sXG4gICAgICAgICAgKF8sIGkpID0+IGJhdGNoU3RhcnQgKyBpLFxuICAgICAgICApO1xuXG4gICAgICAgIGFwcC5kZWJ1ZyhgRmV0Y2hpbmcgYmF0Y2g6IGhvdXJzICR7YmF0Y2hTdGFydH0tJHtiYXRjaEVuZCAtIDF9YCk7XG5cbiAgICAgICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgYmF0Y2hIb3Vycy5tYXAoKGhvdXIpID0+IGZldGNoSG91ckZvcmVjYXN0KGhvdXIpKSxcbiAgICAgICAgKTtcblxuICAgICAgICBiYXRjaFJlc3VsdHMuZm9yRWFjaCgocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgYWxsUmVzdWx0cy5wdXNoKHJlc3VsdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoYmF0Y2hFbmQgPCBjb25maWcubWF4Rm9yZWNhc3RIb3Vycykge1xuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIEJBVENIX0RFTEFZX01TKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUHJvY2VzcyBhbmQgcHVibGlzaCB3ZWF0aGVyIGhvdXJseSBmb3JlY2FzdHNcbiAgICAgIGlmIChjb25maWcuZW5hYmxlSG91cmx5V2VhdGhlcikge1xuICAgICAgICBjb25zdCBob3VybHlXZWF0aGVyRm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPSBbXTtcblxuICAgICAgICBhbGxSZXN1bHRzLmZvckVhY2goKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHQud2VhdGhlckRhdGE/LmhvdXJseSkge1xuICAgICAgICAgICAgY29uc3QgaG91cmx5RGF0YSA9IHJlc3VsdC53ZWF0aGVyRGF0YS5ob3VybHk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRIb3VyID0gcmVzdWx0LnRhcmdldFRpbWUuZ2V0SG91cnMoKTtcblxuICAgICAgICAgICAgLy8gRmluZCBtYXRjaGluZyBob3VyIGluIHRoZSByZXNwb25zZVxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSBob3VybHlEYXRhLnRpbWUgfHwgW107XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGZvcmVjYXN0VGltZSA9IG5ldyBEYXRlKHRpbWVzW2ldKTtcbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZvcmVjYXN0VGltZS5nZXRGdWxsWWVhcigpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXRGdWxsWWVhcigpICYmXG4gICAgICAgICAgICAgICAgZm9yZWNhc3RUaW1lLmdldE1vbnRoKCkgPT09IHJlc3VsdC50YXJnZXRUaW1lLmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0RGF0ZSgpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0SG91cnMoKSA9PT0gdGFyZ2V0SG91clxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3RUaW1lLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwcmVkaWN0ZWRMYXRpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHByZWRpY3RlZExvbmdpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sb25naXR1ZGUsXG4gICAgICAgICAgICAgICAgICB2ZXNzZWxNb3Zpbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgYWxsIGhvdXJseSBmaWVsZHMgZm9yIHRoaXMgdGltZSBpbmRleFxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKGhvdXJseURhdGEpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gXCJ0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsdWVzID0gKGhvdXJseURhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55Pilba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWVzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIGZvcmVjYXN0W2tleV0gPSB2YWx1ZXNbaV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGhvdXJseVdlYXRoZXJGb3JlY2FzdHMucHVzaChmb3JlY2FzdCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChob3VybHlXZWF0aGVyRm9yZWNhc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBwdWJsaXNoSG91cmx5UGFja2FnZShob3VybHlXZWF0aGVyRm9yZWNhc3RzLCBcIndlYXRoZXJcIik7XG4gICAgICAgICAgYXBwLmRlYnVnKFxuICAgICAgICAgICAgYFB1Ymxpc2hlZCAke2hvdXJseVdlYXRoZXJGb3JlY2FzdHMubGVuZ3RofSBwb3NpdGlvbi1zcGVjaWZpYyB3ZWF0aGVyIGZvcmVjYXN0c2AsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBQcm9jZXNzIGFuZCBwdWJsaXNoIG1hcmluZSBob3VybHkgZm9yZWNhc3RzXG4gICAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZUhvdXJseSkge1xuICAgICAgICBjb25zdCBob3VybHlNYXJpbmVGb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuXG4gICAgICAgIGFsbFJlc3VsdHMuZm9yRWFjaCgocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5tYXJpbmVEYXRhPy5ob3VybHkpIHtcbiAgICAgICAgICAgIGNvbnN0IGhvdXJseURhdGEgPSByZXN1bHQubWFyaW5lRGF0YS5ob3VybHk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRIb3VyID0gcmVzdWx0LnRhcmdldFRpbWUuZ2V0SG91cnMoKTtcblxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSBob3VybHlEYXRhLnRpbWUgfHwgW107XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGZvcmVjYXN0VGltZSA9IG5ldyBEYXRlKHRpbWVzW2ldKTtcbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZvcmVjYXN0VGltZS5nZXRGdWxsWWVhcigpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXRGdWxsWWVhcigpICYmXG4gICAgICAgICAgICAgICAgZm9yZWNhc3RUaW1lLmdldE1vbnRoKCkgPT09IHJlc3VsdC50YXJnZXRUaW1lLmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0RGF0ZSgpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0SG91cnMoKSA9PT0gdGFyZ2V0SG91clxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3RUaW1lLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwcmVkaWN0ZWRMYXRpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHByZWRpY3RlZExvbmdpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sb25naXR1ZGUsXG4gICAgICAgICAgICAgICAgICB2ZXNzZWxNb3Zpbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKGhvdXJseURhdGEpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gXCJ0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsdWVzID0gKGhvdXJseURhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55Pilba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWVzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIGZvcmVjYXN0W2tleV0gPSB2YWx1ZXNbaV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGhvdXJseU1hcmluZUZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGhvdXJseU1hcmluZUZvcmVjYXN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcHVibGlzaEhvdXJseVBhY2thZ2UoaG91cmx5TWFyaW5lRm9yZWNhc3RzLCBcIm1hcmluZVwiKTtcbiAgICAgICAgICBhcHAuZGVidWcoXG4gICAgICAgICAgICBgUHVibGlzaGVkICR7aG91cmx5TWFyaW5lRm9yZWNhc3RzLmxlbmd0aH0gcG9zaXRpb24tc3BlY2lmaWMgbWFyaW5lIGZvcmVjYXN0c2AsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBEYWlseSBmb3JlY2FzdHMgc3RpbGwgdXNlIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgIGlmIChjb25maWcuZW5hYmxlRGFpbHlXZWF0aGVyICYmIGFsbFJlc3VsdHNbMF0/LndlYXRoZXJEYXRhKSB7XG4gICAgICAgIGNvbnN0IGRhaWx5V2VhdGhlciA9IHByb2Nlc3NEYWlseVdlYXRoZXJGb3JlY2FzdChcbiAgICAgICAgICBhbGxSZXN1bHRzWzBdLndlYXRoZXJEYXRhLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdERheXMsXG4gICAgICAgICk7XG4gICAgICAgIGlmIChkYWlseVdlYXRoZXIubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHB1Ymxpc2hEYWlseVBhY2thZ2UoZGFpbHlXZWF0aGVyLCBcIndlYXRoZXJcIik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGNvbmZpZy5lbmFibGVNYXJpbmVEYWlseSAmJiBhbGxSZXN1bHRzWzBdPy5tYXJpbmVEYXRhKSB7XG4gICAgICAgIGNvbnN0IGRhaWx5TWFyaW5lID0gcHJvY2Vzc0RhaWx5TWFyaW5lRm9yZWNhc3QoXG4gICAgICAgICAgYWxsUmVzdWx0c1swXS5tYXJpbmVEYXRhLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdERheXMsXG4gICAgICAgICk7XG4gICAgICAgIGlmIChkYWlseU1hcmluZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcHVibGlzaERhaWx5UGFja2FnZShkYWlseU1hcmluZSwgXCJtYXJpbmVcIik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgc3RhdGUubGFzdEZvcmVjYXN0VXBkYXRlID0gRGF0ZS5ub3coKTtcbiAgICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJBY3RpdmUgLSBNb3ZpbmcgdmVzc2VsIGZvcmVjYXN0cyB1cGRhdGVkXCIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvck1zZyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGFwcC5lcnJvcihgRmFpbGVkIHRvIGZldGNoIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0czogJHtlcnJvck1zZ31gKTtcbiAgICAgIGFwcC5kZWJ1ZyhcIkZhbGxpbmcgYmFjayB0byBzdGF0aW9uYXJ5IGZvcmVjYXN0XCIpO1xuICAgICAgcmV0dXJuIGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhjb25maWcpO1xuICAgIH1cbiAgfTtcblxuICAvLyBGZXRjaCBhbmQgcHVibGlzaCBhbGwgZm9yZWNhc3RzXG4gIGNvbnN0IGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyA9IGFzeW5jIChjb25maWc6IFBsdWdpbkNvbmZpZykgPT4ge1xuICAgIGlmICghc3RhdGUuY3VycmVudFBvc2l0aW9uKSB7XG4gICAgICBhcHAuZGVidWcoXCJObyBwb3NpdGlvbiBhdmFpbGFibGUsIHNraXBwaW5nIGZvcmVjYXN0IGZldGNoXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBvc2l0aW9uID0gc3RhdGUuY3VycmVudFBvc2l0aW9uO1xuXG4gICAgLy8gRmV0Y2ggd2VhdGhlciBhbmQgbWFyaW5lIGRhdGEgaW4gcGFyYWxsZWxcbiAgICBjb25zdCBuZWVkc01hcmluZSA9IGNvbmZpZy5lbmFibGVNYXJpbmVIb3VybHkgfHwgY29uZmlnLmVuYWJsZU1hcmluZURhaWx5O1xuICAgIGNvbnN0IFt3ZWF0aGVyRGF0YSwgbWFyaW5lRGF0YV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBmZXRjaFdlYXRoZXJEYXRhKHBvc2l0aW9uLCBjb25maWcpLFxuICAgICAgbmVlZHNNYXJpbmUgPyBmZXRjaE1hcmluZURhdGEocG9zaXRpb24sIGNvbmZpZykgOiBQcm9taXNlLnJlc29sdmUobnVsbCksXG4gICAgXSk7XG5cbiAgICBpZiAoIXdlYXRoZXJEYXRhICYmICFtYXJpbmVEYXRhKSB7XG4gICAgICBhcHAuZXJyb3IoXCJGYWlsZWQgdG8gZmV0Y2ggYW55IGZvcmVjYXN0IGRhdGFcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBhbmQgcHVibGlzaCBob3VybHkgZm9yZWNhc3RzIC0gc2VwYXJhdGUgcGFja2FnZXMgbGlrZSBtZXRlb2JsdWVcbiAgICBpZiAoY29uZmlnLmVuYWJsZUhvdXJseVdlYXRoZXIgJiYgd2VhdGhlckRhdGEpIHtcbiAgICAgIGNvbnN0IGhvdXJseVdlYXRoZXIgPSBwcm9jZXNzSG91cmx5V2VhdGhlckZvcmVjYXN0KHdlYXRoZXJEYXRhLCBjb25maWcubWF4Rm9yZWNhc3RIb3Vycyk7XG4gICAgICBpZiAoaG91cmx5V2VhdGhlci5sZW5ndGggPiAwKSB7XG4gICAgICAgIHB1Ymxpc2hIb3VybHlQYWNrYWdlKGhvdXJseVdlYXRoZXIsIFwid2VhdGhlclwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZUhvdXJseSAmJiBtYXJpbmVEYXRhKSB7XG4gICAgICBjb25zdCBob3VybHlNYXJpbmUgPSBwcm9jZXNzSG91cmx5TWFyaW5lRm9yZWNhc3QobWFyaW5lRGF0YSwgY29uZmlnLm1heEZvcmVjYXN0SG91cnMpO1xuICAgICAgaWYgKGhvdXJseU1hcmluZS5sZW5ndGggPiAwKSB7XG4gICAgICAgIHB1Ymxpc2hIb3VybHlQYWNrYWdlKGhvdXJseU1hcmluZSwgXCJtYXJpbmVcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBhbmQgcHVibGlzaCBkYWlseSBmb3JlY2FzdHMgLSBzZXBhcmF0ZSBwYWNrYWdlcyBsaWtlIG1ldGVvYmx1ZVxuICAgIGlmIChjb25maWcuZW5hYmxlRGFpbHlXZWF0aGVyICYmIHdlYXRoZXJEYXRhKSB7XG4gICAgICBjb25zdCBkYWlseVdlYXRoZXIgPSBwcm9jZXNzRGFpbHlXZWF0aGVyRm9yZWNhc3Qod2VhdGhlckRhdGEsIGNvbmZpZy5tYXhGb3JlY2FzdERheXMpO1xuICAgICAgaWYgKGRhaWx5V2VhdGhlci5sZW5ndGggPiAwKSB7XG4gICAgICAgIHB1Ymxpc2hEYWlseVBhY2thZ2UoZGFpbHlXZWF0aGVyLCBcIndlYXRoZXJcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy5lbmFibGVNYXJpbmVEYWlseSAmJiBtYXJpbmVEYXRhKSB7XG4gICAgICBjb25zdCBkYWlseU1hcmluZSA9IHByb2Nlc3NEYWlseU1hcmluZUZvcmVjYXN0KG1hcmluZURhdGEsIGNvbmZpZy5tYXhGb3JlY2FzdERheXMpO1xuICAgICAgaWYgKGRhaWx5TWFyaW5lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcHVibGlzaERhaWx5UGFja2FnZShkYWlseU1hcmluZSwgXCJtYXJpbmVcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgc3RhdGUubGFzdEZvcmVjYXN0VXBkYXRlID0gRGF0ZS5ub3coKTtcbiAgICBhcHAuc2V0UGx1Z2luU3RhdHVzKFwiQWN0aXZlIC0gRm9yZWNhc3RzIHVwZGF0ZWRcIik7XG4gIH07XG5cbiAgLy8gV2VhdGhlciBBUEkgcHJvdmlkZXIgaW1wbGVtZW50YXRpb24gKHVzaW5nIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcylcbiAgY29uc3QgY29udmVydFRvV2VhdGhlckFQSUZvcmVjYXN0ID0gKFxuICAgIGZvcmVjYXN0RGF0YTogYW55LFxuICAgIHR5cGU6IFdlYXRoZXJGb3JlY2FzdFR5cGUsXG4gICk6IFdlYXRoZXJEYXRhID0+IHtcbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZTogZm9yZWNhc3REYXRhLnRpbWVzdGFtcCB8fCBmb3JlY2FzdERhdGEuZGF0ZSB8fCBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB0eXBlLFxuICAgICAgZGVzY3JpcHRpb246IGdldFdlYXRoZXJEZXNjcmlwdGlvbihcbiAgICAgICAgZm9yZWNhc3REYXRhLndlYXRoZXJDb2RlLFxuICAgICAgICBcIk9wZW4tTWV0ZW8gd2VhdGhlclwiLFxuICAgICAgKSxcbiAgICAgIGxvbmdEZXNjcmlwdGlvbjogZ2V0V2VhdGhlckxvbmdEZXNjcmlwdGlvbihcbiAgICAgICAgZm9yZWNhc3REYXRhLndlYXRoZXJDb2RlLFxuICAgICAgICBcIk9wZW4tTWV0ZW8gd2VhdGhlciBmb3JlY2FzdFwiLFxuICAgICAgKSxcbiAgICAgIGljb246IGdldFdlYXRoZXJJY29uKGZvcmVjYXN0RGF0YS53ZWF0aGVyQ29kZSwgZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQpLFxuICAgICAgb3V0c2lkZToge1xuICAgICAgICB0ZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmFpclRlbXBlcmF0dXJlLFxuICAgICAgICBtYXhUZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmFpclRlbXBIaWdoLFxuICAgICAgICBtaW5UZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmFpclRlbXBMb3csXG4gICAgICAgIGZlZWxzTGlrZVRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEuZmVlbHNMaWtlIHx8IGZvcmVjYXN0RGF0YS5mZWVsc0xpa2VIaWdoLFxuICAgICAgICBwcmVzc3VyZTogZm9yZWNhc3REYXRhLnNlYUxldmVsUHJlc3N1cmUsXG4gICAgICAgIHJlbGF0aXZlSHVtaWRpdHk6IGZvcmVjYXN0RGF0YS5yZWxhdGl2ZUh1bWlkaXR5LFxuICAgICAgICB1dkluZGV4OiBmb3JlY2FzdERhdGEudXZJbmRleCB8fCBmb3JlY2FzdERhdGEudXZJbmRleE1heCxcbiAgICAgICAgY2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLmNsb3VkQ292ZXIsXG4gICAgICAgIHByZWNpcGl0YXRpb25Wb2x1bWU6IGZvcmVjYXN0RGF0YS5wcmVjaXAgfHwgZm9yZWNhc3REYXRhLnByZWNpcFN1bSxcbiAgICAgICAgZGV3UG9pbnRUZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLmRld1BvaW50LFxuICAgICAgICBob3Jpem9udGFsVmlzaWJpbGl0eTogZm9yZWNhc3REYXRhLnZpc2liaWxpdHksXG4gICAgICAgIHByZWNpcGl0YXRpb25Qcm9iYWJpbGl0eTogZm9yZWNhc3REYXRhLnByZWNpcFByb2JhYmlsaXR5IHx8IGZvcmVjYXN0RGF0YS5wcmVjaXBQcm9iYWJpbGl0eU1heCxcbiAgICAgICAgbG93Q2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLmxvd0Nsb3VkQ292ZXIsXG4gICAgICAgIG1pZENsb3VkQ292ZXI6IGZvcmVjYXN0RGF0YS5taWRDbG91ZENvdmVyLFxuICAgICAgICBoaWdoQ2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLmhpZ2hDbG91ZENvdmVyLFxuICAgICAgICBzb2xhclJhZGlhdGlvbjogZm9yZWNhc3REYXRhLnNvbGFyUmFkaWF0aW9uIHx8IGZvcmVjYXN0RGF0YS5zb2xhclJhZGlhdGlvblN1bSxcbiAgICAgICAgZGlyZWN0Tm9ybWFsSXJyYWRpYW5jZTogZm9yZWNhc3REYXRhLmlycmFkaWFuY2VEaXJlY3ROb3JtYWwsXG4gICAgICAgIGRpZmZ1c2VIb3Jpem9udGFsSXJyYWRpYW5jZTogZm9yZWNhc3REYXRhLmRpZmZ1c2VSYWRpYXRpb24sXG4gICAgICB9LFxuICAgICAgd2F0ZXI6IHtcbiAgICAgICAgdGVtcGVyYXR1cmU6IGZvcmVjYXN0RGF0YS5zZWFTdXJmYWNlVGVtcGVyYXR1cmUsXG4gICAgICAgIHdhdmVTaWduaWZpY2FudEhlaWdodDogZm9yZWNhc3REYXRhLnNpZ25pZmljYW50V2F2ZUhlaWdodCB8fCBmb3JlY2FzdERhdGEuc2lnbmlmaWNhbnRXYXZlSGVpZ2h0TWF4LFxuICAgICAgICB3YXZlUGVyaW9kOiBmb3JlY2FzdERhdGEubWVhbldhdmVQZXJpb2QgfHwgZm9yZWNhc3REYXRhLm1lYW5XYXZlUGVyaW9kTWF4LFxuICAgICAgICB3YXZlRGlyZWN0aW9uOiBmb3JlY2FzdERhdGEubWVhbldhdmVEaXJlY3Rpb24gfHwgZm9yZWNhc3REYXRhLm1lYW5XYXZlRGlyZWN0aW9uRG9taW5hbnQsXG4gICAgICAgIHdpbmRXYXZlSGVpZ2h0OiBmb3JlY2FzdERhdGEud2luZFdhdmVIZWlnaHQgfHwgZm9yZWNhc3REYXRhLndpbmRXYXZlSGVpZ2h0TWF4LFxuICAgICAgICB3aW5kV2F2ZVBlcmlvZDogZm9yZWNhc3REYXRhLndpbmRXYXZlUGVyaW9kIHx8IGZvcmVjYXN0RGF0YS53aW5kV2F2ZVBlcmlvZE1heCxcbiAgICAgICAgd2luZFdhdmVEaXJlY3Rpb246IGZvcmVjYXN0RGF0YS53aW5kV2F2ZURpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEud2luZFdhdmVEaXJlY3Rpb25Eb21pbmFudCxcbiAgICAgICAgc3dlbGxIZWlnaHQ6IGZvcmVjYXN0RGF0YS5zd2VsbFNpZ25pZmljYW50SGVpZ2h0IHx8IGZvcmVjYXN0RGF0YS5zd2VsbFNpZ25pZmljYW50SGVpZ2h0TWF4LFxuICAgICAgICBzd2VsbFBlcmlvZDogZm9yZWNhc3REYXRhLnN3ZWxsTWVhblBlcmlvZCB8fCBmb3JlY2FzdERhdGEuc3dlbGxNZWFuUGVyaW9kTWF4LFxuICAgICAgICBzd2VsbERpcmVjdGlvbjogZm9yZWNhc3REYXRhLnN3ZWxsTWVhbkRpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEuc3dlbGxNZWFuRGlyZWN0aW9uRG9taW5hbnQsXG4gICAgICAgIHN1cmZhY2VDdXJyZW50U3BlZWQ6IGZvcmVjYXN0RGF0YS5jdXJyZW50VmVsb2NpdHksXG4gICAgICAgIHN1cmZhY2VDdXJyZW50RGlyZWN0aW9uOiBmb3JlY2FzdERhdGEuY3VycmVudERpcmVjdGlvbixcbiAgICAgICAgc3dlbGxQZWFrUGVyaW9kOiBmb3JlY2FzdERhdGEuc3dlbGxQZWFrUGVyaW9kIHx8IGZvcmVjYXN0RGF0YS5zd2VsbFBlYWtQZXJpb2RNYXgsXG4gICAgICAgIHdpbmRXYXZlUGVha1BlcmlvZDogZm9yZWNhc3REYXRhLndpbmRXYXZlUGVha1BlcmlvZCB8fCBmb3JlY2FzdERhdGEud2luZFdhdmVQZWFrUGVyaW9kTWF4LFxuICAgICAgfSxcbiAgICAgIHdpbmQ6IHtcbiAgICAgICAgc3BlZWRUcnVlOiBmb3JlY2FzdERhdGEud2luZEF2ZyB8fCBmb3JlY2FzdERhdGEud2luZEF2Z01heCxcbiAgICAgICAgZGlyZWN0aW9uVHJ1ZTogZm9yZWNhc3REYXRhLndpbmREaXJlY3Rpb24gfHwgZm9yZWNhc3REYXRhLndpbmREaXJlY3Rpb25Eb21pbmFudCxcbiAgICAgICAgZ3VzdDogZm9yZWNhc3REYXRhLndpbmRHdXN0IHx8IGZvcmVjYXN0RGF0YS53aW5kR3VzdE1heCxcbiAgICAgIH0sXG4gICAgICBzdW46IHtcbiAgICAgICAgc3VucmlzZTogZm9yZWNhc3REYXRhLnN1bnJpc2UsXG4gICAgICAgIHN1bnNldDogZm9yZWNhc3REYXRhLnN1bnNldCxcbiAgICAgICAgc3Vuc2hpbmVEdXJhdGlvbjogZm9yZWNhc3REYXRhLnN1bnNoaW5lRHVyYXRpb24sXG4gICAgICAgIC8vIGlzRGF5bGlnaHQ6IHRydWUgaWYgMS90cnVlLCBmYWxzZSBpZiAwL2ZhbHNlLCB1bmRlZmluZWQgaWYgbm90IHByZXNlbnQgKGRhaWx5IGZvcmVjYXN0cylcbiAgICAgICAgaXNEYXlsaWdodDogZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQgPT09IDEgfHwgZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQgPT09IHRydWVcbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIH0sXG4gICAgfTtcbiAgfTtcblxuICAvLyBHZXQgaG91cmx5IGZvcmVjYXN0cyBmcm9tIFNpZ25hbEsgdHJlZSAodXNpbmcgU2lnbmFsSy1hbGlnbmVkIGZpZWxkIG5hbWVzKVxuICBjb25zdCBnZXRIb3VybHlGb3JlY2FzdHMgPSAobWF4Q291bnQ6IG51bWJlcik6IFdlYXRoZXJEYXRhW10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogV2VhdGhlckRhdGFbXSA9IFtdO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFJlYWQgZm9yZWNhc3QgZGF0YSBmcm9tIFNpZ25hbEsgdHJlZSB1c2luZyB0cmFuc2xhdGVkIGZpZWxkIG5hbWVzXG4gICAgICBsZXQgZm9yZWNhc3RDb3VudCA9IDA7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1heENvdW50ICsgMTA7IGkrKykge1xuICAgICAgICBjb25zdCB0ZW1wID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5ob3VybHkuYWlyVGVtcGVyYXR1cmUuJHtpfWAsXG4gICAgICAgICk7XG4gICAgICAgIGlmICh0ZW1wICYmIHRlbXAudmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGZvcmVjYXN0Q291bnQgPSBpICsgMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3R1YWxDb3VudCA9IE1hdGgubWluKGZvcmVjYXN0Q291bnQsIG1heENvdW50KTtcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhY3R1YWxDb3VudDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGZvcmVjYXN0RGF0YTogYW55ID0ge307XG4gICAgICAgIC8vIFVzZSBTaWduYWxLLWFsaWduZWQgZmllbGQgbmFtZXMgKHRyYW5zbGF0ZWQgbmFtZXMpXG4gICAgICAgIGNvbnN0IGZpZWxkcyA9IFtcbiAgICAgICAgICBcImFpclRlbXBlcmF0dXJlXCIsXG4gICAgICAgICAgXCJyZWxhdGl2ZUh1bWlkaXR5XCIsXG4gICAgICAgICAgXCJkZXdQb2ludFwiLFxuICAgICAgICAgIFwiZmVlbHNMaWtlXCIsXG4gICAgICAgICAgXCJwcmVjaXBQcm9iYWJpbGl0eVwiLFxuICAgICAgICAgIFwicHJlY2lwXCIsXG4gICAgICAgICAgXCJ3ZWF0aGVyQ29kZVwiLFxuICAgICAgICAgIFwic2VhTGV2ZWxQcmVzc3VyZVwiLFxuICAgICAgICAgIFwiY2xvdWRDb3ZlclwiLFxuICAgICAgICAgIFwibG93Q2xvdWRDb3ZlclwiLFxuICAgICAgICAgIFwibWlkQ2xvdWRDb3ZlclwiLFxuICAgICAgICAgIFwiaGlnaENsb3VkQ292ZXJcIixcbiAgICAgICAgICBcInZpc2liaWxpdHlcIixcbiAgICAgICAgICBcIndpbmRBdmdcIixcbiAgICAgICAgICBcIndpbmREaXJlY3Rpb25cIixcbiAgICAgICAgICBcIndpbmRHdXN0XCIsXG4gICAgICAgICAgXCJ1dkluZGV4XCIsXG4gICAgICAgICAgXCJpc0RheWxpZ2h0XCIsXG4gICAgICAgICAgXCJzdW5zaGluZUR1cmF0aW9uXCIsXG4gICAgICAgICAgXCJzb2xhclJhZGlhdGlvblwiLFxuICAgICAgICAgIFwiZGlyZWN0UmFkaWF0aW9uXCIsXG4gICAgICAgICAgXCJkaWZmdXNlUmFkaWF0aW9uXCIsXG4gICAgICAgICAgXCJpcnJhZGlhbmNlRGlyZWN0Tm9ybWFsXCIsXG4gICAgICAgICAgXCJzaWduaWZpY2FudFdhdmVIZWlnaHRcIixcbiAgICAgICAgICBcIm1lYW5XYXZlRGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJtZWFuV2F2ZVBlcmlvZFwiLFxuICAgICAgICAgIFwid2luZFdhdmVIZWlnaHRcIixcbiAgICAgICAgICBcIndpbmRXYXZlRGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJ3aW5kV2F2ZVBlcmlvZFwiLFxuICAgICAgICAgIFwic3dlbGxTaWduaWZpY2FudEhlaWdodFwiLFxuICAgICAgICAgIFwic3dlbGxNZWFuRGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJzd2VsbE1lYW5QZXJpb2RcIixcbiAgICAgICAgICBcImN1cnJlbnRWZWxvY2l0eVwiLFxuICAgICAgICAgIFwiY3VycmVudERpcmVjdGlvblwiLFxuICAgICAgICAgIFwic2VhU3VyZmFjZVRlbXBlcmF0dXJlXCIsXG4gICAgICAgIF07XG5cbiAgICAgICAgZmllbGRzLmZvckVhY2goKGZpZWxkKSA9PiB7XG4gICAgICAgICAgY29uc3QgZGF0YSA9IGFwcC5nZXRTZWxmUGF0aChcbiAgICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5ob3VybHkuJHtmaWVsZH0uJHtpfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoZGF0YSAmJiBkYXRhLnZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZvcmVjYXN0RGF0YVtmaWVsZF0gPSBkYXRhLnZhbHVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGZvcmVjYXN0RGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgIGRhdGUuc2V0SG91cnMoZGF0ZS5nZXRIb3VycygpICsgaSk7XG4gICAgICAgICAgZm9yZWNhc3REYXRhLnRpbWVzdGFtcCA9IGRhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgICAgICBmb3JlY2FzdHMucHVzaChjb252ZXJ0VG9XZWF0aGVyQVBJRm9yZWNhc3QoZm9yZWNhc3REYXRhLCBcInBvaW50XCIpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBFcnJvciByZWFkaW5nIGhvdXJseSBmb3JlY2FzdHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gR2V0IGRhaWx5IGZvcmVjYXN0cyBmcm9tIFNpZ25hbEsgdHJlZSAodXNpbmcgU2lnbmFsSy1hbGlnbmVkIGZpZWxkIG5hbWVzKVxuICBjb25zdCBnZXREYWlseUZvcmVjYXN0cyA9IChtYXhDb3VudDogbnVtYmVyKTogV2VhdGhlckRhdGFbXSA9PiB7XG4gICAgY29uc3QgZm9yZWNhc3RzOiBXZWF0aGVyRGF0YVtdID0gW107XG5cbiAgICB0cnkge1xuICAgICAgbGV0IGZvcmVjYXN0Q291bnQgPSAwO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYXhDb3VudCArIDI7IGkrKykge1xuICAgICAgICBjb25zdCB0ZW1wID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgIGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5kYWlseS5haXJUZW1wSGlnaC4ke2l9YCxcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHRlbXAgJiYgdGVtcC52YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZm9yZWNhc3RDb3VudCA9IGkgKyAxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbENvdW50ID0gTWF0aC5taW4oZm9yZWNhc3RDb3VudCwgbWF4Q291bnQpO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFjdHVhbENvdW50OyBpKyspIHtcbiAgICAgICAgY29uc3QgZm9yZWNhc3REYXRhOiBhbnkgPSB7fTtcbiAgICAgICAgLy8gVXNlIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcyAodHJhbnNsYXRlZCBuYW1lcylcbiAgICAgICAgY29uc3QgZmllbGRzID0gW1xuICAgICAgICAgIFwid2VhdGhlckNvZGVcIixcbiAgICAgICAgICBcImFpclRlbXBIaWdoXCIsXG4gICAgICAgICAgXCJhaXJUZW1wTG93XCIsXG4gICAgICAgICAgXCJmZWVsc0xpa2VIaWdoXCIsXG4gICAgICAgICAgXCJmZWVsc0xpa2VMb3dcIixcbiAgICAgICAgICBcInN1bnJpc2VcIixcbiAgICAgICAgICBcInN1bnNldFwiLFxuICAgICAgICAgIFwic3Vuc2hpbmVEdXJhdGlvblwiLFxuICAgICAgICAgIFwidXZJbmRleE1heFwiLFxuICAgICAgICAgIFwicHJlY2lwU3VtXCIsXG4gICAgICAgICAgXCJwcmVjaXBQcm9iYWJpbGl0eU1heFwiLFxuICAgICAgICAgIFwid2luZEF2Z01heFwiLFxuICAgICAgICAgIFwid2luZEd1c3RNYXhcIixcbiAgICAgICAgICBcIndpbmREaXJlY3Rpb25Eb21pbmFudFwiLFxuICAgICAgICAgIFwic2lnbmlmaWNhbnRXYXZlSGVpZ2h0TWF4XCIsXG4gICAgICAgICAgXCJtZWFuV2F2ZURpcmVjdGlvbkRvbWluYW50XCIsXG4gICAgICAgICAgXCJtZWFuV2F2ZVBlcmlvZE1heFwiLFxuICAgICAgICAgIFwic3dlbGxTaWduaWZpY2FudEhlaWdodE1heFwiLFxuICAgICAgICAgIFwic3dlbGxNZWFuRGlyZWN0aW9uRG9taW5hbnRcIixcbiAgICAgICAgICBcInN3ZWxsTWVhblBlcmlvZE1heFwiLFxuICAgICAgICBdO1xuXG4gICAgICAgIGZpZWxkcy5mb3JFYWNoKChmaWVsZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGRhdGEgPSBhcHAuZ2V0U2VsZlBhdGgoXG4gICAgICAgICAgICBgZW52aXJvbm1lbnQub3V0c2lkZS5vcGVubWV0ZW8uZm9yZWNhc3QuZGFpbHkuJHtmaWVsZH0uJHtpfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoZGF0YSAmJiBkYXRhLnZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZvcmVjYXN0RGF0YVtmaWVsZF0gPSBkYXRhLnZhbHVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKE9iamVjdC5rZXlzKGZvcmVjYXN0RGF0YSkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSgpO1xuICAgICAgICAgIGRhdGUuc2V0RGF0ZShkYXRlLmdldERhdGUoKSArIGkpO1xuICAgICAgICAgIGZvcmVjYXN0RGF0YS5kYXRlID0gZGF0ZS50b0lTT1N0cmluZygpLnNwbGl0KFwiVFwiKVswXTtcbiAgICAgICAgICBmb3JlY2FzdHMucHVzaChjb252ZXJ0VG9XZWF0aGVyQVBJRm9yZWNhc3QoZm9yZWNhc3REYXRhLCBcImRhaWx5XCIpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBFcnJvciByZWFkaW5nIGRhaWx5IGZvcmVjYXN0czogJHtlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcil9YCxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcmVjYXN0cztcbiAgfTtcblxuICAvLyBXZWF0aGVyIEFQSSBwcm92aWRlclxuICBjb25zdCB3ZWF0aGVyUHJvdmlkZXI6IFdlYXRoZXJQcm92aWRlciA9IHtcbiAgICBuYW1lOiBcIk9wZW5tZXRlbyBXZWF0aGVyXCIsXG4gICAgbWV0aG9kczoge1xuICAgICAgcGx1Z2luSWQ6IHBsdWdpbi5pZCxcbiAgICAgIGdldE9ic2VydmF0aW9uczogYXN5bmMgKFxuICAgICAgICBwb3NpdGlvbjogUG9zaXRpb24sXG4gICAgICAgIG9wdGlvbnM/OiBXZWF0aGVyUmVxUGFyYW1zLFxuICAgICAgKTogUHJvbWlzZTxXZWF0aGVyRGF0YVtdPiA9PiB7XG4gICAgICAgIC8vIFJldHVybiBjdXJyZW50IGNvbmRpdGlvbnMgYXMgb2JzZXJ2YXRpb25cbiAgICAgICAgY29uc3QgZm9yZWNhc3RzID0gZ2V0SG91cmx5Rm9yZWNhc3RzKDEpO1xuICAgICAgICBpZiAoZm9yZWNhc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBmb3JlY2FzdHNbMF0udHlwZSA9IFwib2JzZXJ2YXRpb25cIjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZm9yZWNhc3RzO1xuICAgICAgfSxcbiAgICAgIGdldEZvcmVjYXN0czogYXN5bmMgKFxuICAgICAgICBwb3NpdGlvbjogUG9zaXRpb24sXG4gICAgICAgIHR5cGU6IFdlYXRoZXJGb3JlY2FzdFR5cGUsXG4gICAgICAgIG9wdGlvbnM/OiBXZWF0aGVyUmVxUGFyYW1zLFxuICAgICAgKTogUHJvbWlzZTxXZWF0aGVyRGF0YVtdPiA9PiB7XG4gICAgICAgIGNvbnN0IG1heENvdW50ID0gb3B0aW9ucz8ubWF4Q291bnQgfHwgKHR5cGUgPT09IFwiZGFpbHlcIiA/IDcgOiA3Mik7XG5cbiAgICAgICAgaWYgKHR5cGUgPT09IFwiZGFpbHlcIikge1xuICAgICAgICAgIHJldHVybiBnZXREYWlseUZvcmVjYXN0cyhtYXhDb3VudCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIGdldEhvdXJseUZvcmVjYXN0cyhtYXhDb3VudCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBnZXRXYXJuaW5nczogYXN5bmMgKHBvc2l0aW9uOiBQb3NpdGlvbik6IFByb21pc2U8V2VhdGhlcldhcm5pbmdbXT4gPT4ge1xuICAgICAgICAvLyBPcGVuLU1ldGVvIGRvZXNuJ3QgcHJvdmlkZSB3ZWF0aGVyIHdhcm5pbmdzXG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcblxuICAvLyBTZXR1cCBwb3NpdGlvbiBzdWJzY3JpcHRpb25cbiAgY29uc3Qgc2V0dXBQb3NpdGlvblN1YnNjcmlwdGlvbiA9IChjb25maWc6IFBsdWdpbkNvbmZpZykgPT4ge1xuICAgIGlmICghY29uZmlnLmVuYWJsZVBvc2l0aW9uU3Vic2NyaXB0aW9uKSB7XG4gICAgICBhcHAuZGVidWcoXCJQb3NpdGlvbiBzdWJzY3JpcHRpb24gZGlzYWJsZWRcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXBwLmRlYnVnKFwiU2V0dGluZyB1cCBwb3NpdGlvbiBzdWJzY3JpcHRpb25cIik7XG5cbiAgICBjb25zdCBzdWJzY3JpcHRpb246IFN1YnNjcmlwdGlvblJlcXVlc3QgPSB7XG4gICAgICBjb250ZXh0OiBcInZlc3NlbHMuc2VsZlwiLFxuICAgICAgc3Vic2NyaWJlOiBbXG4gICAgICAgIHsgcGF0aDogXCJuYXZpZ2F0aW9uLnBvc2l0aW9uXCIsIHBlcmlvZDogNjAwMDAgfSxcbiAgICAgICAgeyBwYXRoOiBcIm5hdmlnYXRpb24uY291cnNlT3Zlckdyb3VuZFRydWVcIiwgcGVyaW9kOiA2MDAwMCB9LFxuICAgICAgICB7IHBhdGg6IFwibmF2aWdhdGlvbi5zcGVlZE92ZXJHcm91bmRcIiwgcGVyaW9kOiA2MDAwMCB9LFxuICAgICAgXSxcbiAgICB9O1xuXG4gICAgYXBwLnN1YnNjcmlwdGlvbm1hbmFnZXIuc3Vic2NyaWJlKFxuICAgICAgc3Vic2NyaXB0aW9uLFxuICAgICAgc3RhdGUubmF2aWdhdGlvblN1YnNjcmlwdGlvbnMsXG4gICAgICAoZXJyKSA9PiB7XG4gICAgICAgIGFwcC5lcnJvcihgTmF2aWdhdGlvbiBzdWJzY3JpcHRpb24gZXJyb3I6ICR7ZXJyfWApO1xuICAgICAgfSxcbiAgICAgIChkZWx0YSkgPT4ge1xuICAgICAgICBkZWx0YS51cGRhdGVzPy5mb3JFYWNoKCh1cGRhdGUpID0+IHtcbiAgICAgICAgICB1cGRhdGUudmFsdWVzPy5mb3JFYWNoKCh2KSA9PiB7XG4gICAgICAgICAgICBpZiAodi5wYXRoID09PSBcIm5hdmlnYXRpb24ucG9zaXRpb25cIiAmJiB2LnZhbHVlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHBvcyA9IHYudmFsdWUgYXMgeyBsYXRpdHVkZTogbnVtYmVyOyBsb25naXR1ZGU6IG51bWJlciB9O1xuICAgICAgICAgICAgICBpZiAocG9zLmxhdGl0dWRlICYmIHBvcy5sb25naXR1ZGUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBuZXdQb3NpdGlvbjogUG9zaXRpb24gPSB7XG4gICAgICAgICAgICAgICAgICBsYXRpdHVkZTogcG9zLmxhdGl0dWRlLFxuICAgICAgICAgICAgICAgICAgbG9uZ2l0dWRlOiBwb3MubG9uZ2l0dWRlLFxuICAgICAgICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLFxuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICBpZiAoIXN0YXRlLmN1cnJlbnRQb3NpdGlvbikge1xuICAgICAgICAgICAgICAgICAgc3RhdGUuY3VycmVudFBvc2l0aW9uID0gbmV3UG9zaXRpb247XG4gICAgICAgICAgICAgICAgICBhcHAuZGVidWcoXG4gICAgICAgICAgICAgICAgICAgIGBJbml0aWFsIHBvc2l0aW9uOiAke3Bvcy5sYXRpdHVkZX0sICR7cG9zLmxvbmdpdHVkZX1gLFxuICAgICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICAgIC8vIFRyaWdnZXIgaW5pdGlhbCBmb3JlY2FzdCBmZXRjaCAodXNlIG1vdmluZyB2ZXNzZWwgaWYgYXBwcm9wcmlhdGUpXG4gICAgICAgICAgICAgICAgICBpZiAoc3RhdGUuY3VycmVudENvbmZpZykge1xuICAgICAgICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgICAgICAgc3RhdGUuY3VycmVudFNPRyAmJlxuICAgICAgICAgICAgICAgICAgICAgIGlzVmVzc2VsTW92aW5nKHN0YXRlLmN1cnJlbnRTT0csIHN0YXRlLmN1cnJlbnRDb25maWcubW92aW5nU3BlZWRUaHJlc2hvbGQpICYmXG4gICAgICAgICAgICAgICAgICAgICAgc3RhdGUubW92aW5nRm9yZWNhc3RFbmdhZ2VkXG4gICAgICAgICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgICAgICAgIGZldGNoRm9yZWNhc3RGb3JNb3ZpbmdWZXNzZWwoc3RhdGUuY3VycmVudENvbmZpZyk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgZmV0Y2hBbmRQdWJsaXNoRm9yZWNhc3RzKHN0YXRlLmN1cnJlbnRDb25maWcpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRQb3NpdGlvbiA9IG5ld1Bvc2l0aW9uO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIGlmICh2LnBhdGggPT09IFwibmF2aWdhdGlvbi5jb3Vyc2VPdmVyR3JvdW5kVHJ1ZVwiICYmIHYudmFsdWUgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgc3RhdGUuY3VycmVudEhlYWRpbmcgPSB2LnZhbHVlIGFzIG51bWJlcjtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAodi5wYXRoID09PSBcIm5hdmlnYXRpb24uc3BlZWRPdmVyR3JvdW5kXCIgJiYgdi52YWx1ZSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50U09HID0gdi52YWx1ZSBhcyBudW1iZXI7XG5cbiAgICAgICAgICAgICAgLy8gQXV0by1lbmdhZ2UgbW92aW5nIGZvcmVjYXN0IGlmIGVuYWJsZWQgYW5kIHNwZWVkIGV4Y2VlZHMgdGhyZXNob2xkXG4gICAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50Q29uZmlnPy5lbmFibGVBdXRvTW92aW5nRm9yZWNhc3QgJiZcbiAgICAgICAgICAgICAgICBpc1Zlc3NlbE1vdmluZyhcbiAgICAgICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRTT0csXG4gICAgICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50Q29uZmlnLm1vdmluZ1NwZWVkVGhyZXNob2xkLFxuICAgICAgICAgICAgICAgICkgJiZcbiAgICAgICAgICAgICAgICAhc3RhdGUubW92aW5nRm9yZWNhc3RFbmdhZ2VkXG4gICAgICAgICAgICAgICkge1xuICAgICAgICAgICAgICAgIHN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgYXBwLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgYEF1dG8tZW5hYmxlZCBtb3ZpbmcgZm9yZWNhc3QgZHVlIHRvIHZlc3NlbCBtb3ZlbWVudCBleGNlZWRpbmcgJHtzdGF0ZS5jdXJyZW50Q29uZmlnLm1vdmluZ1NwZWVkVGhyZXNob2xkfSBrbm90c2AsXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgKTtcbiAgfTtcblxuICAvLyBQbHVnaW4gc3RhcnRcbiAgcGx1Z2luLnN0YXJ0ID0gKG9wdGlvbnM6IFBhcnRpYWw8UGx1Z2luQ29uZmlnPikgPT4ge1xuICAgIGNvbnN0IGNvbmZpZzogUGx1Z2luQ29uZmlnID0ge1xuICAgICAgYXBpS2V5OiBvcHRpb25zLmFwaUtleSB8fCBcIlwiLFxuICAgICAgZm9yZWNhc3RJbnRlcnZhbDogb3B0aW9ucy5mb3JlY2FzdEludGVydmFsIHx8IDYwLFxuICAgICAgYWx0aXR1ZGU6IG9wdGlvbnMuYWx0aXR1ZGUgfHwgMixcbiAgICAgIGVuYWJsZVBvc2l0aW9uU3Vic2NyaXB0aW9uOiBvcHRpb25zLmVuYWJsZVBvc2l0aW9uU3Vic2NyaXB0aW9uICE9PSBmYWxzZSxcbiAgICAgIG1heEZvcmVjYXN0SG91cnM6IG9wdGlvbnMubWF4Rm9yZWNhc3RIb3VycyB8fCA3MixcbiAgICAgIG1heEZvcmVjYXN0RGF5czogb3B0aW9ucy5tYXhGb3JlY2FzdERheXMgfHwgNyxcbiAgICAgIGVuYWJsZUhvdXJseVdlYXRoZXI6IG9wdGlvbnMuZW5hYmxlSG91cmx5V2VhdGhlciAhPT0gZmFsc2UsXG4gICAgICBlbmFibGVEYWlseVdlYXRoZXI6IG9wdGlvbnMuZW5hYmxlRGFpbHlXZWF0aGVyICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZU1hcmluZUhvdXJseTogb3B0aW9ucy5lbmFibGVNYXJpbmVIb3VybHkgIT09IGZhbHNlLFxuICAgICAgZW5hYmxlTWFyaW5lRGFpbHk6IG9wdGlvbnMuZW5hYmxlTWFyaW5lRGFpbHkgIT09IGZhbHNlLFxuICAgICAgZW5hYmxlQ3VycmVudENvbmRpdGlvbnM6IG9wdGlvbnMuZW5hYmxlQ3VycmVudENvbmRpdGlvbnMgIT09IGZhbHNlLFxuICAgICAgZW5hYmxlQXV0b01vdmluZ0ZvcmVjYXN0OiBvcHRpb25zLmVuYWJsZUF1dG9Nb3ZpbmdGb3JlY2FzdCB8fCBmYWxzZSxcbiAgICAgIG1vdmluZ1NwZWVkVGhyZXNob2xkOiBvcHRpb25zLm1vdmluZ1NwZWVkVGhyZXNob2xkIHx8IDEuMCxcbiAgICB9O1xuXG4gICAgc3RhdGUuY3VycmVudENvbmZpZyA9IGNvbmZpZztcblxuICAgIGFwcC5kZWJ1ZyhcIlN0YXJ0aW5nIE9wZW4tTWV0ZW8gcGx1Z2luXCIpO1xuICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJJbml0aWFsaXppbmcuLi5cIik7XG5cbiAgICAvLyBSZWdpc3RlciBhcyBXZWF0aGVyIEFQSSBwcm92aWRlclxuICAgIHRyeSB7XG4gICAgICBhcHAucmVnaXN0ZXJXZWF0aGVyUHJvdmlkZXIod2VhdGhlclByb3ZpZGVyKTtcbiAgICAgIGFwcC5kZWJ1ZyhcIlN1Y2Nlc3NmdWxseSByZWdpc3RlcmVkIGFzIFdlYXRoZXIgQVBJIHByb3ZpZGVyXCIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBGYWlsZWQgdG8gcmVnaXN0ZXIgV2VhdGhlciBBUEkgcHJvdmlkZXI6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFNldHVwIHBvc2l0aW9uIHN1YnNjcmlwdGlvblxuICAgIHNldHVwUG9zaXRpb25TdWJzY3JpcHRpb24oY29uZmlnKTtcblxuICAgIC8vIEhlbHBlciB0byBkZXRlcm1pbmUgd2hpY2ggZmV0Y2ggZnVuY3Rpb24gdG8gdXNlXG4gICAgY29uc3QgZG9Gb3JlY2FzdEZldGNoID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKFxuICAgICAgICBzdGF0ZS5jdXJyZW50U09HICYmXG4gICAgICAgIGlzVmVzc2VsTW92aW5nKHN0YXRlLmN1cnJlbnRTT0csIGNvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZCkgJiZcbiAgICAgICAgc3RhdGUubW92aW5nRm9yZWNhc3RFbmdhZ2VkXG4gICAgICApIHtcbiAgICAgICAgYXBwLmRlYnVnKFwiVXNpbmcgcG9zaXRpb24tc3BlY2lmaWMgZm9yZWNhc3RpbmcgZm9yIG1vdmluZyB2ZXNzZWxcIik7XG4gICAgICAgIGF3YWl0IGZldGNoRm9yZWNhc3RGb3JNb3ZpbmdWZXNzZWwoY29uZmlnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFwcC5kZWJ1ZyhcIlVzaW5nIHN0YW5kYXJkIGZvcmVjYXN0aW5nIGZvciBzdGF0aW9uYXJ5IHZlc3NlbFwiKTtcbiAgICAgICAgYXdhaXQgZmV0Y2hBbmRQdWJsaXNoRm9yZWNhc3RzKGNvbmZpZyk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIC8vIFNldHVwIGZvcmVjYXN0IGludGVydmFsXG4gICAgY29uc3QgaW50ZXJ2YWxNcyA9IGNvbmZpZy5mb3JlY2FzdEludGVydmFsICogNjAgKiAxMDAwO1xuICAgIHN0YXRlLmZvcmVjYXN0SW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoc3RhdGUuZm9yZWNhc3RFbmFibGVkICYmIHN0YXRlLmN1cnJlbnRQb3NpdGlvbikge1xuICAgICAgICBhd2FpdCBkb0ZvcmVjYXN0RmV0Y2goKTtcbiAgICAgIH1cbiAgICB9LCBpbnRlcnZhbE1zKTtcblxuICAgIC8vIEluaXRpYWwgZmV0Y2ggaWYgcG9zaXRpb24gaXMgYXZhaWxhYmxlXG4gICAgc2V0VGltZW91dChhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoc3RhdGUuY3VycmVudFBvc2l0aW9uKSB7XG4gICAgICAgIGF3YWl0IGRvRm9yZWNhc3RGZXRjaCgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXBwLmRlYnVnKFwiTm8gcG9zaXRpb24gYXZhaWxhYmxlIHlldCwgd2FpdGluZyBmb3IgcG9zaXRpb24gc3Vic2NyaXB0aW9uXCIpO1xuICAgICAgICBhcHAuc2V0UGx1Z2luU3RhdHVzKFwiV2FpdGluZyBmb3IgcG9zaXRpb24uLi5cIik7XG4gICAgICB9XG4gICAgfSwgMTAwMCk7XG4gIH07XG5cbiAgLy8gUGx1Z2luIHN0b3BcbiAgcGx1Z2luLnN0b3AgPSAoKSA9PiB7XG4gICAgYXBwLmRlYnVnKFwiU3RvcHBpbmcgT3Blbi1NZXRlbyBwbHVnaW5cIik7XG5cbiAgICAvLyBDbGVhciBmb3JlY2FzdCBpbnRlcnZhbFxuICAgIGlmIChzdGF0ZS5mb3JlY2FzdEludGVydmFsKSB7XG4gICAgICBjbGVhckludGVydmFsKHN0YXRlLmZvcmVjYXN0SW50ZXJ2YWwpO1xuICAgICAgc3RhdGUuZm9yZWNhc3RJbnRlcnZhbCA9IG51bGw7XG4gICAgfVxuXG4gICAgLy8gVW5zdWJzY3JpYmUgZnJvbSBuYXZpZ2F0aW9uXG4gICAgc3RhdGUubmF2aWdhdGlvblN1YnNjcmlwdGlvbnMuZm9yRWFjaCgodW5zdWIpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHVuc3ViKCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIC8vIElnbm9yZSB1bnN1YnNjcmliZSBlcnJvcnNcbiAgICAgIH1cbiAgICB9KTtcbiAgICBzdGF0ZS5uYXZpZ2F0aW9uU3Vic2NyaXB0aW9ucyA9IFtdO1xuXG4gICAgLy8gUmVzZXQgc3RhdGVcbiAgICBzdGF0ZS5jdXJyZW50UG9zaXRpb24gPSBudWxsO1xuICAgIHN0YXRlLmN1cnJlbnRIZWFkaW5nID0gbnVsbDtcbiAgICBzdGF0ZS5jdXJyZW50U09HID0gbnVsbDtcbiAgICBzdGF0ZS5sYXN0Rm9yZWNhc3RVcGRhdGUgPSAwO1xuICAgIHN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZCA9IGZhbHNlO1xuXG4gICAgYXBwLnNldFBsdWdpblN0YXR1cyhcIlN0b3BwZWRcIik7XG4gIH07XG5cbiAgcmV0dXJuIHBsdWdpbjtcbn07XG4iXX0=