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
    // Helper to determine if a given timestamp is during daylight hours
    // Converts UTC timestamp to local time using utcOffsetSeconds before comparing to local sunrise/sunset
    const isDaytime = (timestamp, sunrise, sunset, utcOffsetSeconds) => {
        if (!timestamp || !sunrise || !sunset)
            return undefined;
        try {
            // Parse the forecast timestamp
            const forecastDate = new Date(timestamp);
            if (isNaN(forecastDate.getTime()))
                return undefined;
            // Convert UTC forecast time to local time using the offset
            // utcOffsetSeconds is positive for timezones ahead of UTC (e.g., +18000 for UTC+5)
            const offsetMs = (utcOffsetSeconds || 0) * 1000;
            const localTimeMs = forecastDate.getTime() + offsetMs;
            const localDate = new Date(localTimeMs);
            // Extract local hours and minutes
            const localHours = localDate.getUTCHours();
            const localMinutes = localDate.getUTCMinutes();
            const forecastMinutes = localHours * 60 + localMinutes;
            // Extract sunrise time (already in local time from API with timezone: "auto")
            const sunriseMatch = sunrise.match(/T(\d{2}):(\d{2})/);
            const sunsetMatch = sunset.match(/T(\d{2}):(\d{2})/);
            if (!sunriseMatch || !sunsetMatch)
                return undefined;
            const sunriseMinutes = parseInt(sunriseMatch[1], 10) * 60 + parseInt(sunriseMatch[2], 10);
            const sunsetMinutes = parseInt(sunsetMatch[1], 10) * 60 + parseInt(sunsetMatch[2], 10);
            // Normal case: sunrise is before sunset (same day)
            if (sunriseMinutes < sunsetMinutes) {
                return forecastMinutes >= sunriseMinutes && forecastMinutes < sunsetMinutes;
            }
            // Edge case: sunset wraps past midnight (polar regions)
            return forecastMinutes >= sunriseMinutes || forecastMinutes < sunsetMinutes;
        }
        catch {
            return undefined;
        }
    };
    // Get icon name from WMO code
    // Uses sunrise/sunset to calculate day/night if available, otherwise falls back to isDay
    const getWeatherIcon = (wmoCode, isDay, timestamp, sunrise, sunset, utcOffsetSeconds) => {
        if (wmoCode === undefined)
            return undefined;
        let dayNight;
        // Prefer calculating from sunrise/sunset if we have the data
        if (timestamp && sunrise && sunset) {
            const calculatedIsDay = isDaytime(timestamp, sunrise, sunset, utcOffsetSeconds);
            if (calculatedIsDay !== undefined) {
                dayNight = calculatedIsDay ? "day" : "night";
            }
            else {
                // Fall back to API's is_day field
                dayNight = isDay === false || isDay === 0 ? "night" : "day";
            }
        }
        else {
            // Default to day if isDay is undefined (e.g., daily forecasts don't have is_day field)
            dayNight = isDay === false || isDay === 0 ? "night" : "day";
        }
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
            timezone: "auto",
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
            timezone: "auto",
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
        // Store the UTC offset for timezone conversion (used for day/night icon calculation)
        if ((weatherData === null || weatherData === void 0 ? void 0 : weatherData.utc_offset_seconds) !== undefined) {
            const delta = {
                context: "vessels.self",
                updates: [
                    {
                        $source: getSourceLabel("weather"),
                        timestamp: new Date().toISOString(),
                        values: [
                            {
                                path: "environment.outside.openmeteo.utcOffsetSeconds",
                                value: weatherData.utc_offset_seconds,
                            },
                        ],
                    },
                ],
            };
            app.handleMessage(plugin.id, delta);
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
            icon: getWeatherIcon(forecastData.weatherCode, forecastData.isDaylight, forecastData.timestamp || forecastData.date, forecastData.sunrise, forecastData.sunset, forecastData.utcOffsetSeconds),
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
            // Read the UTC offset for timezone conversion
            const utcOffsetData = app.getSelfPath("environment.outside.openmeteo.utcOffsetSeconds");
            const utcOffsetSeconds = utcOffsetData === null || utcOffsetData === void 0 ? void 0 : utcOffsetData.value;
            // First, read sunrise/sunset from daily forecasts to use for day/night calculation
            // Build a map of date -> {sunrise, sunset}
            const sunTimes = new Map();
            for (let dayIndex = 0; dayIndex < 16; dayIndex++) {
                const sunriseData = app.getSelfPath(`environment.outside.openmeteo.forecast.daily.sunrise.${dayIndex}`);
                const sunsetData = app.getSelfPath(`environment.outside.openmeteo.forecast.daily.sunset.${dayIndex}`);
                if ((sunriseData === null || sunriseData === void 0 ? void 0 : sunriseData.value) && (sunsetData === null || sunsetData === void 0 ? void 0 : sunsetData.value)) {
                    // Extract the date part from sunrise (format: YYYY-MM-DD or ISO timestamp)
                    const sunriseStr = String(sunriseData.value);
                    const dateKey = sunriseStr.substring(0, 10); // Get YYYY-MM-DD
                    sunTimes.set(dateKey, {
                        sunrise: sunriseStr,
                        sunset: String(sunsetData.value),
                    });
                }
                else {
                    break;
                }
            }
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
                    // Look up sunrise/sunset for this forecast's date
                    const dateKey = date.toISOString().substring(0, 10); // YYYY-MM-DD
                    const sunData = sunTimes.get(dateKey);
                    if (sunData) {
                        forecastData.sunrise = sunData.sunrise;
                        forecastData.sunset = sunData.sunset;
                    }
                    // Add UTC offset for timezone conversion in day/night calculation
                    if (utcOffsetSeconds !== undefined) {
                        forecastData.utcOffsetSeconds = utcOffsetSeconds;
                    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUFBLDREQUErQjtBQWtCL0IsaUJBQVMsVUFBVSxHQUFlO0lBQ2hDLE1BQU0sTUFBTSxHQUFrQjtRQUM1QixFQUFFLEVBQUUsb0JBQW9CO1FBQ3hCLElBQUksRUFBRSw0QkFBNEI7UUFDbEMsV0FBVyxFQUFFLHFFQUFxRTtRQUNsRixNQUFNLEVBQUUsRUFBRTtRQUNWLEtBQUssRUFBRSxHQUFHLEVBQUUsR0FBRSxDQUFDO1FBQ2YsSUFBSSxFQUFFLEdBQUcsRUFBRSxHQUFFLENBQUM7S0FDZixDQUFDO0lBRUYsTUFBTSxLQUFLLEdBQWdCO1FBQ3pCLGdCQUFnQixFQUFFLElBQUk7UUFDdEIsdUJBQXVCLEVBQUUsRUFBRTtRQUMzQixhQUFhLEVBQUUsU0FBUztRQUN4QixlQUFlLEVBQUUsSUFBSTtRQUNyQixjQUFjLEVBQUUsSUFBSTtRQUNwQixVQUFVLEVBQUUsSUFBSTtRQUNoQixrQkFBa0IsRUFBRSxDQUFDO1FBQ3JCLGVBQWUsRUFBRSxJQUFJO1FBQ3JCLHFCQUFxQixFQUFFLEtBQUs7S0FDN0IsQ0FBQztJQUVGLHdEQUF3RDtJQUN4RCxrREFBa0Q7SUFDbEQsTUFBTSxtQkFBbUIsR0FBMkI7UUFDbEQsQ0FBQyxFQUFFLE9BQU87UUFDVixDQUFDLEVBQUUsY0FBYztRQUNqQixDQUFDLEVBQUUsZUFBZTtRQUNsQixDQUFDLEVBQUUsVUFBVTtRQUNiLEVBQUUsRUFBRSxLQUFLO1FBQ1QsRUFBRSxFQUFFLHFCQUFxQjtRQUN6QixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVBQUUsa0JBQWtCO1FBQ3RCLEVBQUUsRUFBRSxlQUFlO1FBQ25CLEVBQUUsRUFBRSx3QkFBd0I7UUFDNUIsRUFBRSxFQUFFLHdCQUF3QjtRQUM1QixFQUFFLEVBQUUsYUFBYTtRQUNqQixFQUFFLEVBQUUsZUFBZTtRQUNuQixFQUFFLEVB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QUFDO1FBQzVCLEtBQUssQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDO1FBQ3hCLEtBQUssQ0FBQyxrQkFBa0IsR0FBRyxDQUFDLENBQUM7UUFDN0IsS0FBSyxDQUFDLHFCQUFxQixHQUFHLEtBQUssQ0FBQztRQUVwQyxHQUFHLENBQUMsZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ2pDLENBQUMsQ0FBQztJQUVGLE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBmZXRjaCBmcm9tIFwibm9kZS1mZXRjaFwiO1xuaW1wb3J0IHtcbiAgU2lnbmFsS0FwcCxcbiAgU2lnbmFsS1BsdWdpbixcbiAgUGx1Z2luQ29uZmlnLFxuICBQbHVnaW5TdGF0ZSxcbiAgUG9zaXRpb24sXG4gIE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSxcbiAgT3Blbk1ldGVvTWFyaW5lUmVzcG9uc2UsXG4gIFNpZ25hbEtEZWx0YSxcbiAgU3Vic2NyaXB0aW9uUmVxdWVzdCxcbiAgV2VhdGhlclByb3ZpZGVyLFxuICBXZWF0aGVyRGF0YSxcbiAgV2VhdGhlcldhcm5pbmcsXG4gIFdlYXRoZXJSZXFQYXJhbXMsXG4gIFdlYXRoZXJGb3JlY2FzdFR5cGUsXG59IGZyb20gXCIuL3R5cGVzXCI7XG5cbmV4cG9ydCA9IGZ1bmN0aW9uIChhcHA6IFNpZ25hbEtBcHApOiBTaWduYWxLUGx1Z2luIHtcbiAgY29uc3QgcGx1Z2luOiBTaWduYWxLUGx1Z2luID0ge1xuICAgIGlkOiBcInNpZ25hbGstb3Blbi1tZXRlb1wiLFxuICAgIG5hbWU6IFwiU2lnbmFsSyBPcGVuLU1ldGVvIFdlYXRoZXJcIixcbiAgICBkZXNjcmlwdGlvbjogXCJQb3NpdGlvbi1iYXNlZCB3ZWF0aGVyIGFuZCBtYXJpbmUgZm9yZWNhc3QgZGF0YSBmcm9tIE9wZW4tTWV0ZW8gQVBJXCIsXG4gICAgc2NoZW1hOiB7fSxcbiAgICBzdGFydDogKCkgPT4ge30sXG4gICAgc3RvcDogKCkgPT4ge30sXG4gIH07XG5cbiAgY29uc3Qgc3RhdGU6IFBsdWdpblN0YXRlID0ge1xuICAgIGZvcmVjYXN0SW50ZXJ2YWw6IG51bGwsXG4gICAgbmF2aWdhdGlvblN1YnNjcmlwdGlvbnM6IFtdLFxuICAgIGN1cnJlbnRDb25maWc6IHVuZGVmaW5lZCxcbiAgICBjdXJyZW50UG9zaXRpb246IG51bGwsXG4gICAgY3VycmVudEhlYWRpbmc6IG51bGwsXG4gICAgY3VycmVudFNPRzogbnVsbCxcbiAgICBsYXN0Rm9yZWNhc3RVcGRhdGU6IDAsXG4gICAgZm9yZWNhc3RFbmFibGVkOiB0cnVlLFxuICAgIG1vdmluZ0ZvcmVjYXN0RW5nYWdlZDogZmFsc2UsXG4gIH07XG5cbiAgLy8gV01PIFdlYXRoZXIgaW50ZXJwcmV0YXRpb24gY29kZXMgKHVzZWQgYnkgT3Blbi1NZXRlbylcbiAgLy8gaHR0cHM6Ly9vcGVuLW1ldGVvLmNvbS9lbi9kb2NzI3dlYXRoZXJ2YXJpYWJsZXNcbiAgY29uc3Qgd21vQ29kZURlc2NyaXB0aW9uczogUmVjb3JkPG51bWJlciwgc3RyaW5nPiA9IHtcbiAgICAwOiBcIkNsZWFyXCIsXG4gICAgMTogXCJNb3N0bHkgQ2xlYXJcIixcbiAgICAyOiBcIlBhcnRseSBDbG91ZHlcIixcbiAgICAzOiBcIk92ZXJjYXN0XCIsXG4gICAgNDU6IFwiRm9nXCIsXG4gICAgNDg6IFwiRGVwb3NpdGluZyBSaW1lIEZvZ1wiLFxuICAgIDUxOiBcIkxpZ2h0IERyaXp6bGVcIixcbiAgICA1MzogXCJNb2RlcmF0ZSBEcml6emxlXCIsXG4gICAgNTU6IFwiRGVuc2UgRHJpenpsZVwiLFxuICAgIDU2OiBcIkxpZ2h0IEZyZWV6aW5nIERyaXp6bGVcIixcbiAgICA1NzogXCJEZW5zZSBGcmVlemluZyBEcml6emxlXCIsXG4gICAgNjE6IFwiU2xpZ2h0IFJhaW5cIixcbiAgICA2MzogXCJNb2RlcmF0ZSBSYWluXCIsXG4gICAgNjU6IFwiSGVhdnkgUmFpblwiLFxuICAgIDY2OiBcIkxpZ2h0IEZyZWV6aW5nIFJhaW5cIixcbiAgICA2NzogXCJIZWF2eSBGcmVlemluZyBSYWluXCIsXG4gICAgNzE6IFwiU2xpZ2h0IFNub3dcIixcbiAgICA3MzogXCJNb2RlcmF0ZSBTbm93XCIsXG4gICAgNzU6IFwiSGVhdnkgU25vd1wiLFxuICAgIDc3OiBcIlNub3cgR3JhaW5zXCIsXG4gICAgODA6IFwiU2xpZ2h0IFJhaW4gU2hvd2Vyc1wiLFxuICAgIDgxOiBcIk1vZGVyYXRlIFJhaW4gU2hvd2Vyc1wiLFxuICAgIDgyOiBcIlZpb2xlbnQgUmFpbiBTaG93ZXJzXCIsXG4gICAgODU6IFwiU2xpZ2h0IFNub3cgU2hvd2Vyc1wiLFxuICAgIDg2OiBcIkhlYXZ5IFNub3cgU2hvd2Vyc1wiLFxuICAgIDk1OiBcIlRodW5kZXJzdG9ybVwiLFxuICAgIDk2OiBcIlRodW5kZXJzdG9ybSB3aXRoIFNsaWdodCBIYWlsXCIsXG4gICAgOTk6IFwiVGh1bmRlcnN0b3JtIHdpdGggSGVhdnkgSGFpbFwiLFxuICB9O1xuXG4gIGNvbnN0IHdtb0NvZGVMb25nRGVzY3JpcHRpb25zOiBSZWNvcmQ8bnVtYmVyLCBzdHJpbmc+ID0ge1xuICAgIDA6IFwiQ2xlYXIgc2t5IHdpdGggbm8gY2xvdWQgY292ZXJcIixcbiAgICAxOiBcIk1haW5seSBjbGVhciB3aXRoIG1pbmltYWwgY2xvdWQgY292ZXJcIixcbiAgICAyOiBcIlBhcnRseSBjbG91ZHkgd2l0aCBzY2F0dGVyZWQgY2xvdWRzXCIsXG4gICAgMzogXCJPdmVyY2FzdCB3aXRoIGNvbXBsZXRlIGNsb3VkIGNvdmVyXCIsXG4gICAgNDU6IFwiRm9nIHJlZHVjaW5nIHZpc2liaWxpdHlcIixcbiAgICA0ODogXCJEZXBvc2l0aW5nIHJpbWUgZm9nIHdpdGggaWNlIGZvcm1hdGlvblwiLFxuICAgIDUxOiBcIkxpZ2h0IGRyaXp6bGUgd2l0aCBmaW5lIHByZWNpcGl0YXRpb25cIixcbiAgICA1MzogXCJNb2RlcmF0ZSBkcml6emxlIHdpdGggc3RlYWR5IGxpZ2h0IHJhaW5cIixcbiAgICA1NTogXCJEZW5zZSBkcml6emxlIHdpdGggY29udGludW91cyBsaWdodCByYWluXCIsXG4gICAgNTY6IFwiTGlnaHQgZnJlZXppbmcgZHJpenpsZSwgaWNlIHBvc3NpYmxlXCIsXG4gICAgNTc6IFwiRGVuc2UgZnJlZXppbmcgZHJpenpsZSwgaGF6YXJkb3VzIGNvbmRpdGlvbnNcIixcbiAgICA2MTogXCJTbGlnaHQgcmFpbiB3aXRoIGxpZ2h0IHByZWNpcGl0YXRpb25cIixcbiAgICA2MzogXCJNb2RlcmF0ZSByYWluIHdpdGggc3RlYWR5IHByZWNpcGl0YXRpb25cIixcbiAgICA2NTogXCJIZWF2eSByYWluIHdpdGggaW50ZW5zZSBwcmVjaXBpdGF0aW9uXCIsXG4gICAgNjY6IFwiTGlnaHQgZnJlZXppbmcgcmFpbiwgaWNlIGFjY3VtdWxhdGlvbiBwb3NzaWJsZVwiLFxuICAgIDY3OiBcIkhlYXZ5IGZyZWV6aW5nIHJhaW4sIGhhemFyZG91cyBpY2UgY29uZGl0aW9uc1wiLFxuICAgIDcxOiBcIlNsaWdodCBzbm93ZmFsbCB3aXRoIGxpZ2h0IGFjY3VtdWxhdGlvblwiLFxuICAgIDczOiBcIk1vZGVyYXRlIHNub3dmYWxsIHdpdGggc3RlYWR5IGFjY3VtdWxhdGlvblwiLFxuICAgIDc1OiBcIkhlYXZ5IHNub3dmYWxsIHdpdGggc2lnbmlmaWNhbnQgYWNjdW11bGF0aW9uXCIsXG4gICAgNzc6IFwiU25vdyBncmFpbnMsIGZpbmUgaWNlIHBhcnRpY2xlcyBmYWxsaW5nXCIsXG4gICAgODA6IFwiU2xpZ2h0IHJhaW4gc2hvd2VycywgYnJpZWYgbGlnaHQgcmFpblwiLFxuICAgIDgxOiBcIk1vZGVyYXRlIHJhaW4gc2hvd2VycywgaW50ZXJtaXR0ZW50IHJhaW5cIixcbiAgICA4MjogXCJWaW9sZW50IHJhaW4gc2hvd2VycywgaW50ZW5zZSBkb3ducG91cnNcIixcbiAgICA4NTogXCJTbGlnaHQgc25vdyBzaG93ZXJzLCBicmllZiBsaWdodCBzbm93XCIsXG4gICAgODY6IFwiSGVhdnkgc25vdyBzaG93ZXJzLCBpbnRlbnNlIHNub3dmYWxsXCIsXG4gICAgOTU6IFwiVGh1bmRlcnN0b3JtIHdpdGggbGlnaHRuaW5nIGFuZCB0aHVuZGVyXCIsXG4gICAgOTY6IFwiVGh1bmRlcnN0b3JtIHdpdGggc2xpZ2h0IGhhaWxcIixcbiAgICA5OTogXCJUaHVuZGVyc3Rvcm0gd2l0aCBoZWF2eSBoYWlsLCBkYW5nZXJvdXMgY29uZGl0aW9uc1wiLFxuICB9O1xuXG4gIC8vIEhlbHBlciB0byBkZXRlcm1pbmUgaWYgYSBnaXZlbiB0aW1lc3RhbXAgaXMgZHVyaW5nIGRheWxpZ2h0IGhvdXJzXG4gIC8vIENvbnZlcnRzIFVUQyB0aW1lc3RhbXAgdG8gbG9jYWwgdGltZSB1c2luZyB1dGNPZmZzZXRTZWNvbmRzIGJlZm9yZSBjb21wYXJpbmcgdG8gbG9jYWwgc3VucmlzZS9zdW5zZXRcbiAgY29uc3QgaXNEYXl0aW1lID0gKFxuICAgIHRpbWVzdGFtcDogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHN1bnJpc2U6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICBzdW5zZXQ6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICB1dGNPZmZzZXRTZWNvbmRzPzogbnVtYmVyLFxuICApOiBib29sZWFuIHwgdW5kZWZpbmVkID0+IHtcbiAgICBpZiAoIXRpbWVzdGFtcCB8fCAhc3VucmlzZSB8fCAhc3Vuc2V0KSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFBhcnNlIHRoZSBmb3JlY2FzdCB0aW1lc3RhbXBcbiAgICAgIGNvbnN0IGZvcmVjYXN0RGF0ZSA9IG5ldyBEYXRlKHRpbWVzdGFtcCk7XG4gICAgICBpZiAoaXNOYU4oZm9yZWNhc3REYXRlLmdldFRpbWUoKSkpIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICAgIC8vIENvbnZlcnQgVVRDIGZvcmVjYXN0IHRpbWUgdG8gbG9jYWwgdGltZSB1c2luZyB0aGUgb2Zmc2V0XG4gICAgICAvLyB1dGNPZmZzZXRTZWNvbmRzIGlzIHBvc2l0aXZlIGZvciB0aW1lem9uZXMgYWhlYWQgb2YgVVRDIChlLmcuLCArMTgwMDAgZm9yIFVUQys1KVxuICAgICAgY29uc3Qgb2Zmc2V0TXMgPSAodXRjT2Zmc2V0U2Vjb25kcyB8fCAwKSAqIDEwMDA7XG4gICAgICBjb25zdCBsb2NhbFRpbWVNcyA9IGZvcmVjYXN0RGF0ZS5nZXRUaW1lKCkgKyBvZmZzZXRNcztcbiAgICAgIGNvbnN0IGxvY2FsRGF0ZSA9IG5ldyBEYXRlKGxvY2FsVGltZU1zKTtcblxuICAgICAgLy8gRXh0cmFjdCBsb2NhbCBob3VycyBhbmQgbWludXRlc1xuICAgICAgY29uc3QgbG9jYWxIb3VycyA9IGxvY2FsRGF0ZS5nZXRVVENIb3VycygpO1xuICAgICAgY29uc3QgbG9jYWxNaW51dGVzID0gbG9jYWxEYXRlLmdldFVUQ01pbnV0ZXMoKTtcbiAgICAgIGNvbnN0IGZvcmVjYXN0TWludXRlcyA9IGxvY2FsSG91cnMgKiA2MCArIGxvY2FsTWludXRlcztcblxuICAgICAgLy8gRXh0cmFjdCBzdW5yaXNlIHRpbWUgKGFscmVhZHkgaW4gbG9jYWwgdGltZSBmcm9tIEFQSSB3aXRoIHRpbWV6b25lOiBcImF1dG9cIilcbiAgICAgIGNvbnN0IHN1bnJpc2VNYXRjaCA9IHN1bnJpc2UubWF0Y2goL1QoXFxkezJ9KTooXFxkezJ9KS8pO1xuICAgICAgY29uc3Qgc3Vuc2V0TWF0Y2ggPSBzdW5zZXQubWF0Y2goL1QoXFxkezJ9KTooXFxkezJ9KS8pO1xuICAgICAgaWYgKCFzdW5yaXNlTWF0Y2ggfHwgIXN1bnNldE1hdGNoKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBzdW5yaXNlTWludXRlcyA9IHBhcnNlSW50KHN1bnJpc2VNYXRjaFsxXSwgMTApICogNjAgKyBwYXJzZUludChzdW5yaXNlTWF0Y2hbMl0sIDEwKTtcbiAgICAgIGNvbnN0IHN1bnNldE1pbnV0ZXMgPSBwYXJzZUludChzdW5zZXRNYXRjaFsxXSwgMTApICogNjAgKyBwYXJzZUludChzdW5zZXRNYXRjaFsyXSwgMTApO1xuXG4gICAgICAvLyBOb3JtYWwgY2FzZTogc3VucmlzZSBpcyBiZWZvcmUgc3Vuc2V0IChzYW1lIGRheSlcbiAgICAgIGlmIChzdW5yaXNlTWludXRlcyA8IHN1bnNldE1pbnV0ZXMpIHtcbiAgICAgICAgcmV0dXJuIGZvcmVjYXN0TWludXRlcyA+PSBzdW5yaXNlTWludXRlcyAmJiBmb3JlY2FzdE1pbnV0ZXMgPCBzdW5zZXRNaW51dGVzO1xuICAgICAgfVxuXG4gICAgICAvLyBFZGdlIGNhc2U6IHN1bnNldCB3cmFwcyBwYXN0IG1pZG5pZ2h0IChwb2xhciByZWdpb25zKVxuICAgICAgcmV0dXJuIGZvcmVjYXN0TWludXRlcyA+PSBzdW5yaXNlTWludXRlcyB8fCBmb3JlY2FzdE1pbnV0ZXMgPCBzdW5zZXRNaW51dGVzO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH07XG5cbiAgLy8gR2V0IGljb24gbmFtZSBmcm9tIFdNTyBjb2RlXG4gIC8vIFVzZXMgc3VucmlzZS9zdW5zZXQgdG8gY2FsY3VsYXRlIGRheS9uaWdodCBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSBmYWxscyBiYWNrIHRvIGlzRGF5XG4gIGNvbnN0IGdldFdlYXRoZXJJY29uID0gKFxuICAgIHdtb0NvZGU6IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICBpc0RheTogYm9vbGVhbiB8IG51bWJlciB8IHVuZGVmaW5lZCxcbiAgICB0aW1lc3RhbXA/OiBzdHJpbmcsXG4gICAgc3VucmlzZT86IHN0cmluZyxcbiAgICBzdW5zZXQ/OiBzdHJpbmcsXG4gICAgdXRjT2Zmc2V0U2Vjb25kcz86IG51bWJlcixcbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkID0+IHtcbiAgICBpZiAod21vQ29kZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgbGV0IGRheU5pZ2h0OiBzdHJpbmc7XG5cbiAgICAvLyBQcmVmZXIgY2FsY3VsYXRpbmcgZnJvbSBzdW5yaXNlL3N1bnNldCBpZiB3ZSBoYXZlIHRoZSBkYXRhXG4gICAgaWYgKHRpbWVzdGFtcCAmJiBzdW5yaXNlICYmIHN1bnNldCkge1xuICAgICAgY29uc3QgY2FsY3VsYXRlZElzRGF5ID0gaXNEYXl0aW1lKHRpbWVzdGFtcCwgc3VucmlzZSwgc3Vuc2V0LCB1dGNPZmZzZXRTZWNvbmRzKTtcbiAgICAgIGlmIChjYWxjdWxhdGVkSXNEYXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBkYXlOaWdodCA9IGNhbGN1bGF0ZWRJc0RheSA/IFwiZGF5XCIgOiBcIm5pZ2h0XCI7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBGYWxsIGJhY2sgdG8gQVBJJ3MgaXNfZGF5IGZpZWxkXG4gICAgICAgIGRheU5pZ2h0ID0gaXNEYXkgPT09IGZhbHNlIHx8IGlzRGF5ID09PSAwID8gXCJuaWdodFwiIDogXCJkYXlcIjtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRGVmYXVsdCB0byBkYXkgaWYgaXNEYXkgaXMgdW5kZWZpbmVkIChlLmcuLCBkYWlseSBmb3JlY2FzdHMgZG9uJ3QgaGF2ZSBpc19kYXkgZmllbGQpXG4gICAgICBkYXlOaWdodCA9IGlzRGF5ID09PSBmYWxzZSB8fCBpc0RheSA9PT0gMCA/IFwibmlnaHRcIiA6IFwiZGF5XCI7XG4gICAgfVxuXG4gICAgcmV0dXJuIGB3bW9fJHt3bW9Db2RlfV8ke2RheU5pZ2h0fS5zdmdgO1xuICB9O1xuXG4gIGNvbnN0IGdldFdlYXRoZXJEZXNjcmlwdGlvbiA9IChcbiAgICB3bW9Db2RlOiBudW1iZXIgfCB1bmRlZmluZWQsXG4gICAgZmFsbGJhY2s6IHN0cmluZyxcbiAgKTogc3RyaW5nID0+IHtcbiAgICBpZiAod21vQ29kZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsbGJhY2s7XG4gICAgcmV0dXJuIHdtb0NvZGVEZXNjcmlwdGlvbnNbd21vQ29kZV0gfHwgZmFsbGJhY2s7XG4gIH07XG5cbiAgY29uc3QgZ2V0V2VhdGhlckxvbmdEZXNjcmlwdGlvbiA9IChcbiAgICB3bW9Db2RlOiBudW1iZXIgfCB1bmRlZmluZWQsXG4gICAgZmFsbGJhY2s6IHN0cmluZyxcbiAgKTogc3RyaW5nID0+IHtcbiAgICBpZiAod21vQ29kZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsbGJhY2s7XG4gICAgcmV0dXJuIHdtb0NvZGVMb25nRGVzY3JpcHRpb25zW3dtb0NvZGVdIHx8IGZhbGxiYWNrO1xuICB9O1xuXG4gIC8vIENvbmZpZ3VyYXRpb24gc2NoZW1hXG4gIHBsdWdpbi5zY2hlbWEgPSB7XG4gICAgdHlwZTogXCJvYmplY3RcIixcbiAgICByZXF1aXJlZDogW10sXG4gICAgcHJvcGVydGllczoge1xuICAgICAgYXBpS2V5OiB7XG4gICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgIHRpdGxlOiBcIkFQSSBLZXkgKE9wdGlvbmFsKVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgICBcIk9wZW4tTWV0ZW8gQVBJIGtleSBmb3IgY29tbWVyY2lhbCB1c2UuIExlYXZlIGVtcHR5IGZvciBmcmVlIG5vbi1jb21tZXJjaWFsIHVzZS5cIixcbiAgICAgIH0sXG4gICAgICBmb3JlY2FzdEludGVydmFsOiB7XG4gICAgICAgIHR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgIHRpdGxlOiBcIkZvcmVjYXN0IFVwZGF0ZSBJbnRlcnZhbCAobWludXRlcylcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiSG93IG9mdGVuIHRvIGZldGNoIG5ldyBmb3JlY2FzdCBkYXRhXCIsXG4gICAgICAgIGRlZmF1bHQ6IDYwLFxuICAgICAgICBtaW5pbXVtOiAxNSxcbiAgICAgICAgbWF4aW11bTogMTQ0MCxcbiAgICAgIH0sXG4gICAgICBhbHRpdHVkZToge1xuICAgICAgICB0eXBlOiBcIm51bWJlclwiLFxuICAgICAgICB0aXRsZTogXCJEZWZhdWx0IEFsdGl0dWRlIChtZXRlcnMpXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRlZmF1bHQgYWx0aXR1ZGUgZm9yIGVsZXZhdGlvbiBjb3JyZWN0aW9uXCIsXG4gICAgICAgIGRlZmF1bHQ6IDIsXG4gICAgICAgIG1pbmltdW06IDAsXG4gICAgICAgIG1heGltdW06IDEwMDAwLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZVBvc2l0aW9uU3Vic2NyaXB0aW9uOiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgUG9zaXRpb24gU3Vic2NyaXB0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAgIFwiU3Vic2NyaWJlIHRvIG5hdmlnYXRpb24ucG9zaXRpb24gdXBkYXRlcyBmb3IgYXV0b21hdGljIGZvcmVjYXN0IHVwZGF0ZXNcIixcbiAgICAgICAgZGVmYXVsdDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBtYXhGb3JlY2FzdEhvdXJzOiB7XG4gICAgICAgIHR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgIHRpdGxlOiBcIk1heCBGb3JlY2FzdCBIb3Vyc1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIG51bWJlciBvZiBob3VybHkgZm9yZWNhc3RzIHRvIHJldHJpZXZlICgxLTM4NClcIixcbiAgICAgICAgZGVmYXVsdDogNzIsXG4gICAgICAgIG1pbmltdW06IDEsXG4gICAgICAgIG1heGltdW06IDM4NCxcbiAgICAgIH0sXG4gICAgICBtYXhGb3JlY2FzdERheXM6IHtcbiAgICAgICAgdHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgdGl0bGU6IFwiTWF4IEZvcmVjYXN0IERheXNcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBudW1iZXIgb2YgZGFpbHkgZm9yZWNhc3RzIHRvIHJldHJpZXZlICgxLTE2KVwiLFxuICAgICAgICBkZWZhdWx0OiA3LFxuICAgICAgICBtaW5pbXVtOiAxLFxuICAgICAgICBtYXhpbXVtOiAxNixcbiAgICAgIH0sXG4gICAgICBlbmFibGVIb3VybHlXZWF0aGVyOiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgSG91cmx5IFdlYXRoZXJcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRmV0Y2ggaG91cmx5IHdlYXRoZXIgZm9yZWNhc3RzXCIsXG4gICAgICAgIGRlZmF1bHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgZW5hYmxlRGFpbHlXZWF0aGVyOiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgRGFpbHkgV2VhdGhlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJGZXRjaCBkYWlseSB3ZWF0aGVyIGZvcmVjYXN0c1wiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZU1hcmluZUhvdXJseToge1xuICAgICAgICB0eXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgdGl0bGU6IFwiRW5hYmxlIE1hcmluZSBIb3VybHlcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRmV0Y2ggaG91cmx5IG1hcmluZSBmb3JlY2FzdHMgKHdhdmVzLCBjdXJyZW50cywgc2VhIHRlbXBlcmF0dXJlKVwiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZU1hcmluZURhaWx5OiB7XG4gICAgICAgIHR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICB0aXRsZTogXCJFbmFibGUgTWFyaW5lIERhaWx5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkZldGNoIGRhaWx5IG1hcmluZSBmb3JlY2FzdHNcIixcbiAgICAgICAgZGVmYXVsdDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBlbmFibGVDdXJyZW50Q29uZGl0aW9uczoge1xuICAgICAgICB0eXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgdGl0bGU6IFwiRW5hYmxlIEN1cnJlbnQgQ29uZGl0aW9uc1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJGZXRjaCBjdXJyZW50IHdlYXRoZXIgY29uZGl0aW9uc1wiLFxuICAgICAgICBkZWZhdWx0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZUF1dG9Nb3ZpbmdGb3JlY2FzdDoge1xuICAgICAgICB0eXBlOiBcImJvb2xlYW5cIixcbiAgICAgICAgdGl0bGU6IFwiRW5hYmxlIEF1dG8gTW92aW5nIEZvcmVjYXN0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAgIFwiQXV0b21hdGljYWxseSBlbmdhZ2UgbW92aW5nIGZvcmVjYXN0IG1vZGUgd2hlbiB2ZXNzZWwgc3BlZWQgZXhjZWVkcyB0aHJlc2hvbGRcIixcbiAgICAgICAgZGVmYXVsdDogZmFsc2UsXG4gICAgICB9LFxuICAgICAgbW92aW5nU3BlZWRUaHJlc2hvbGQ6IHtcbiAgICAgICAgdHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgdGl0bGU6IFwiTW92aW5nIFNwZWVkIFRocmVzaG9sZCAoa25vdHMpXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICAgIFwiTWluaW11bSBzcGVlZCBpbiBrbm90cyB0byBhdXRvbWF0aWNhbGx5IGVuZ2FnZSBtb3ZpbmcgZm9yZWNhc3QgbW9kZVwiLFxuICAgICAgICBkZWZhdWx0OiAxLjAsXG4gICAgICAgIG1pbmltdW06IDAuMSxcbiAgICAgICAgbWF4aW11bTogMTAuMCxcbiAgICAgIH0sXG4gICAgfSxcbiAgfTtcblxuICAvLyBVdGlsaXR5IGZ1bmN0aW9uc1xuICBjb25zdCBkZWdUb1JhZCA9IChkZWdyZWVzOiBudW1iZXIpOiBudW1iZXIgPT4gZGVncmVlcyAqIChNYXRoLlBJIC8gMTgwKTtcbiAgY29uc3QgcmFkVG9EZWcgPSAocmFkaWFuczogbnVtYmVyKTogbnVtYmVyID0+IHJhZGlhbnMgKiAoMTgwIC8gTWF0aC5QSSk7XG4gIGNvbnN0IGNlbHNpdXNUb0tlbHZpbiA9IChjZWxzaXVzOiBudW1iZXIpOiBudW1iZXIgPT4gY2Vsc2l1cyArIDI3My4xNTtcbiAgY29uc3QgaFBhVG9QQSA9IChoUGE6IG51bWJlcik6IG51bWJlciA9PiBoUGEgKiAxMDA7XG4gIGNvbnN0IG1tVG9NID0gKG1tOiBudW1iZXIpOiBudW1iZXIgPT4gbW0gLyAxMDAwO1xuICBjb25zdCBjbVRvTSA9IChjbTogbnVtYmVyKTogbnVtYmVyID0+IGNtIC8gMTAwO1xuICBjb25zdCBrbVRvTSA9IChrbTogbnVtYmVyKTogbnVtYmVyID0+IGttICogMTAwMDtcbiAgY29uc3Qga21oVG9NcyA9IChrbWg6IG51bWJlcik6IG51bWJlciA9PiBrbWggLyAzLjY7XG4gIGNvbnN0IHBlcmNlbnRUb1JhdGlvID0gKHBlcmNlbnQ6IG51bWJlcik6IG51bWJlciA9PiBwZXJjZW50IC8gMTAwO1xuXG4gIC8vIEZpZWxkIG5hbWUgdHJhbnNsYXRpb246IE9wZW4tTWV0ZW8gQVBJIG5hbWVzIOKGkiBTaWduYWxLLWFsaWduZWQgbmFtZXMgKGZvbGxvd2luZyBzaWduYWxrLXdlYXRoZXJmbG93IGNvbnZlbnRpb24pXG4gIGNvbnN0IGZpZWxkTmFtZU1hcDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAvLyBUZW1wZXJhdHVyZSBmaWVsZHNcbiAgICB0ZW1wZXJhdHVyZV8ybTogXCJhaXJUZW1wZXJhdHVyZVwiLFxuICAgIGFwcGFyZW50X3RlbXBlcmF0dXJlOiBcImZlZWxzTGlrZVwiLFxuICAgIGRld19wb2ludF8ybTogXCJkZXdQb2ludFwiLFxuICAgIHRlbXBlcmF0dXJlXzJtX21heDogXCJhaXJUZW1wSGlnaFwiLFxuICAgIHRlbXBlcmF0dXJlXzJtX21pbjogXCJhaXJUZW1wTG93XCIsXG4gICAgYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWF4OiBcImZlZWxzTGlrZUhpZ2hcIixcbiAgICBhcHBhcmVudF90ZW1wZXJhdHVyZV9taW46IFwiZmVlbHNMaWtlTG93XCIsXG4gICAgc2VhX3N1cmZhY2VfdGVtcGVyYXR1cmU6IFwic2VhU3VyZmFjZVRlbXBlcmF0dXJlXCIsXG5cbiAgICAvLyBXaW5kIGZpZWxkc1xuICAgIHdpbmRfc3BlZWRfMTBtOiBcIndpbmRBdmdcIixcbiAgICB3aW5kX2RpcmVjdGlvbl8xMG06IFwid2luZERpcmVjdGlvblwiLFxuICAgIHdpbmRfZ3VzdHNfMTBtOiBcIndpbmRHdXN0XCIsXG4gICAgd2luZF9zcGVlZF8xMG1fbWF4OiBcIndpbmRBdmdNYXhcIixcbiAgICB3aW5kX2d1c3RzXzEwbV9tYXg6IFwid2luZEd1c3RNYXhcIixcbiAgICB3aW5kX2RpcmVjdGlvbl8xMG1fZG9taW5hbnQ6IFwid2luZERpcmVjdGlvbkRvbWluYW50XCIsXG5cbiAgICAvLyBQcmVzc3VyZSBmaWVsZHNcbiAgICBwcmVzc3VyZV9tc2w6IFwic2VhTGV2ZWxQcmVzc3VyZVwiLFxuICAgIHN1cmZhY2VfcHJlc3N1cmU6IFwic3RhdGlvblByZXNzdXJlXCIsXG5cbiAgICAvLyBIdW1pZGl0eSBmaWVsZHNcbiAgICByZWxhdGl2ZV9odW1pZGl0eV8ybTogXCJyZWxhdGl2ZUh1bWlkaXR5XCIsXG5cbiAgICAvLyBQcmVjaXBpdGF0aW9uIGZpZWxkc1xuICAgIHByZWNpcGl0YXRpb246IFwicHJlY2lwXCIsXG4gICAgcHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eTogXCJwcmVjaXBQcm9iYWJpbGl0eVwiLFxuICAgIHByZWNpcGl0YXRpb25fc3VtOiBcInByZWNpcFN1bVwiLFxuICAgIHByZWNpcGl0YXRpb25fcHJvYmFiaWxpdHlfbWF4OiBcInByZWNpcFByb2JhYmlsaXR5TWF4XCIsXG4gICAgcHJlY2lwaXRhdGlvbl9ob3VyczogXCJwcmVjaXBIb3Vyc1wiLFxuICAgIHJhaW46IFwicmFpblwiLFxuICAgIHJhaW5fc3VtOiBcInJhaW5TdW1cIixcbiAgICBzaG93ZXJzOiBcInNob3dlcnNcIixcbiAgICBzaG93ZXJzX3N1bTogXCJzaG93ZXJzU3VtXCIsXG4gICAgc25vd2ZhbGw6IFwic25vd2ZhbGxcIixcbiAgICBzbm93ZmFsbF9zdW06IFwic25vd2ZhbGxTdW1cIixcblxuICAgIC8vIENsb3VkIGNvdmVyIGZpZWxkc1xuICAgIGNsb3VkX2NvdmVyOiBcImNsb3VkQ292ZXJcIixcbiAgICBjbG91ZF9jb3Zlcl9sb3c6IFwibG93Q2xvdWRDb3ZlclwiLFxuICAgIGNsb3VkX2NvdmVyX21pZDogXCJtaWRDbG91ZENvdmVyXCIsXG4gICAgY2xvdWRfY292ZXJfaGlnaDogXCJoaWdoQ2xvdWRDb3ZlclwiLFxuXG4gICAgLy8gU29sYXIvVVYgZmllbGRzXG4gICAgdXZfaW5kZXg6IFwidXZJbmRleFwiLFxuICAgIHV2X2luZGV4X21heDogXCJ1dkluZGV4TWF4XCIsXG4gICAgc2hvcnR3YXZlX3JhZGlhdGlvbjogXCJzb2xhclJhZGlhdGlvblwiLFxuICAgIHNob3J0d2F2ZV9yYWRpYXRpb25fc3VtOiBcInNvbGFyUmFkaWF0aW9uU3VtXCIsXG4gICAgZGlyZWN0X3JhZGlhdGlvbjogXCJkaXJlY3RSYWRpYXRpb25cIixcbiAgICBkaWZmdXNlX3JhZGlhdGlvbjogXCJkaWZmdXNlUmFkaWF0aW9uXCIsXG4gICAgZGlyZWN0X25vcm1hbF9pcnJhZGlhbmNlOiBcImlycmFkaWFuY2VEaXJlY3ROb3JtYWxcIixcbiAgICBzdW5zaGluZV9kdXJhdGlvbjogXCJzdW5zaGluZUR1cmF0aW9uXCIsXG4gICAgZGF5bGlnaHRfZHVyYXRpb246IFwiZGF5bGlnaHREdXJhdGlvblwiLFxuXG4gICAgLy8gTWFyaW5lL1dhdmUgZmllbGRzXG4gICAgd2F2ZV9oZWlnaHQ6IFwic2lnbmlmaWNhbnRXYXZlSGVpZ2h0XCIsXG4gICAgd2F2ZV9oZWlnaHRfbWF4OiBcInNpZ25pZmljYW50V2F2ZUhlaWdodE1heFwiLFxuICAgIHdhdmVfZGlyZWN0aW9uOiBcIm1lYW5XYXZlRGlyZWN0aW9uXCIsXG4gICAgd2F2ZV9kaXJlY3Rpb25fZG9taW5hbnQ6IFwibWVhbldhdmVEaXJlY3Rpb25Eb21pbmFudFwiLFxuICAgIHdhdmVfcGVyaW9kOiBcIm1lYW5XYXZlUGVyaW9kXCIsXG4gICAgd2F2ZV9wZXJpb2RfbWF4OiBcIm1lYW5XYXZlUGVyaW9kTWF4XCIsXG4gICAgd2luZF93YXZlX2hlaWdodDogXCJ3aW5kV2F2ZUhlaWdodFwiLFxuICAgIHdpbmRfd2F2ZV9oZWlnaHRfbWF4OiBcIndpbmRXYXZlSGVpZ2h0TWF4XCIsXG4gICAgd2luZF93YXZlX2RpcmVjdGlvbjogXCJ3aW5kV2F2ZURpcmVjdGlvblwiLFxuICAgIHdpbmRfd2F2ZV9kaXJlY3Rpb25fZG9taW5hbnQ6IFwid2luZFdhdmVEaXJlY3Rpb25Eb21pbmFudFwiLFxuICAgIHdpbmRfd2F2ZV9wZXJpb2Q6IFwid2luZFdhdmVQZXJpb2RcIixcbiAgICB3aW5kX3dhdmVfcGVyaW9kX21heDogXCJ3aW5kV2F2ZVBlcmlvZE1heFwiLFxuICAgIHdpbmRfd2F2ZV9wZWFrX3BlcmlvZDogXCJ3aW5kV2F2ZVBlYWtQZXJpb2RcIixcbiAgICB3aW5kX3dhdmVfcGVha19wZXJpb2RfbWF4OiBcIndpbmRXYXZlUGVha1BlcmlvZE1heFwiLFxuICAgIHN3ZWxsX3dhdmVfaGVpZ2h0OiBcInN3ZWxsU2lnbmlmaWNhbnRIZWlnaHRcIixcbiAgICBzd2VsbF93YXZlX2hlaWdodF9tYXg6IFwic3dlbGxTaWduaWZpY2FudEhlaWdodE1heFwiLFxuICAgIHN3ZWxsX3dhdmVfZGlyZWN0aW9uOiBcInN3ZWxsTWVhbkRpcmVjdGlvblwiLFxuICAgIHN3ZWxsX3dhdmVfZGlyZWN0aW9uX2RvbWluYW50OiBcInN3ZWxsTWVhbkRpcmVjdGlvbkRvbWluYW50XCIsXG4gICAgc3dlbGxfd2F2ZV9wZXJpb2Q6IFwic3dlbGxNZWFuUGVyaW9kXCIsXG4gICAgc3dlbGxfd2F2ZV9wZXJpb2RfbWF4OiBcInN3ZWxsTWVhblBlcmlvZE1heFwiLFxuICAgIHN3ZWxsX3dhdmVfcGVha19wZXJpb2Q6IFwic3dlbGxQZWFrUGVyaW9kXCIsXG4gICAgc3dlbGxfd2F2ZV9wZWFrX3BlcmlvZF9tYXg6IFwic3dlbGxQZWFrUGVyaW9kTWF4XCIsXG4gICAgb2NlYW5fY3VycmVudF92ZWxvY2l0eTogXCJjdXJyZW50VmVsb2NpdHlcIixcbiAgICBvY2Vhbl9jdXJyZW50X2RpcmVjdGlvbjogXCJjdXJyZW50RGlyZWN0aW9uXCIsXG5cbiAgICAvLyBPdGhlciBmaWVsZHNcbiAgICB2aXNpYmlsaXR5OiBcInZpc2liaWxpdHlcIixcbiAgICBpc19kYXk6IFwiaXNEYXlsaWdodFwiLFxuICAgIHdlYXRoZXJfY29kZTogXCJ3ZWF0aGVyQ29kZVwiLFxuICAgIGNhcGU6IFwiY2FwZVwiLFxuICAgIHN1bnJpc2U6IFwic3VucmlzZVwiLFxuICAgIHN1bnNldDogXCJzdW5zZXRcIixcbiAgfTtcblxuICAvLyBUcmFuc2xhdGUgT3Blbi1NZXRlbyBmaWVsZCBuYW1lIHRvIFNpZ25hbEstYWxpZ25lZCBuYW1lXG4gIGNvbnN0IHRyYW5zbGF0ZUZpZWxkTmFtZSA9IChvcGVuTWV0ZW9OYW1lOiBzdHJpbmcpOiBzdHJpbmcgPT4ge1xuICAgIHJldHVybiBmaWVsZE5hbWVNYXBbb3Blbk1ldGVvTmFtZV0gfHwgb3Blbk1ldGVvTmFtZTtcbiAgfTtcblxuICAvLyBSZXZlcnNlIGxvb2t1cDogU2lnbmFsSyBuYW1lIHRvIE9wZW4tTWV0ZW8gbmFtZSAoZm9yIHJlYWRpbmcgYmFjayBmcm9tIFNpZ25hbEspXG4gIGNvbnN0IHJldmVyc2VGaWVsZE5hbWVNYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSBPYmplY3QuZW50cmllcyhcbiAgICBmaWVsZE5hbWVNYXAsXG4gICkucmVkdWNlKFxuICAgIChhY2MsIFtvcGVuTWV0ZW8sIHNpZ25hbGtdKSA9PiB7XG4gICAgICBhY2Nbc2lnbmFsa10gPSBvcGVuTWV0ZW87XG4gICAgICByZXR1cm4gYWNjO1xuICAgIH0sXG4gICAge30gYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgKTtcblxuICAvLyBDYWxjdWxhdGUgZnV0dXJlIHBvc2l0aW9uIGJhc2VkIG9uIGN1cnJlbnQgaGVhZGluZyBhbmQgc3BlZWRcbiAgY29uc3QgY2FsY3VsYXRlRnV0dXJlUG9zaXRpb24gPSAoXG4gICAgY3VycmVudFBvczogUG9zaXRpb24sXG4gICAgaGVhZGluZ1JhZDogbnVtYmVyLFxuICAgIHNvZ01wczogbnVtYmVyLFxuICAgIGhvdXJzQWhlYWQ6IG51bWJlcixcbiAgKTogUG9zaXRpb24gPT4ge1xuICAgIGNvbnN0IGRpc3RhbmNlTWV0ZXJzID0gc29nTXBzICogaG91cnNBaGVhZCAqIDM2MDA7XG4gICAgY29uc3QgZWFydGhSYWRpdXMgPSA2MzcxMDAwO1xuXG4gICAgY29uc3QgbGF0MSA9IGRlZ1RvUmFkKGN1cnJlbnRQb3MubGF0aXR1ZGUpO1xuICAgIGNvbnN0IGxvbjEgPSBkZWdUb1JhZChjdXJyZW50UG9zLmxvbmdpdHVkZSk7XG5cbiAgICBjb25zdCBsYXQyID0gTWF0aC5hc2luKFxuICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLmNvcyhkaXN0YW5jZU1ldGVycyAvIGVhcnRoUmFkaXVzKSArXG4gICAgICAgIE1hdGguY29zKGxhdDEpICpcbiAgICAgICAgICBNYXRoLnNpbihkaXN0YW5jZU1ldGVycyAvIGVhcnRoUmFkaXVzKSAqXG4gICAgICAgICAgTWF0aC5jb3MoaGVhZGluZ1JhZCksXG4gICAgKTtcblxuICAgIGNvbnN0IGxvbjIgPVxuICAgICAgbG9uMSArXG4gICAgICBNYXRoLmF0YW4yKFxuICAgICAgICBNYXRoLnNpbihoZWFkaW5nUmFkKSAqXG4gICAgICAgICAgTWF0aC5zaW4oZGlzdGFuY2VNZXRlcnMgLyBlYXJ0aFJhZGl1cykgKlxuICAgICAgICAgIE1hdGguY29zKGxhdDEpLFxuICAgICAgICBNYXRoLmNvcyhkaXN0YW5jZU1ldGVycyAvIGVhcnRoUmFkaXVzKSAtXG4gICAgICAgICAgTWF0aC5zaW4obGF0MSkgKiBNYXRoLnNpbihsYXQyKSxcbiAgICAgICk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgbGF0aXR1ZGU6IHJhZFRvRGVnKGxhdDIpLFxuICAgICAgbG9uZ2l0dWRlOiByYWRUb0RlZyhsb24yKSxcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoRGF0ZS5ub3coKSArIGhvdXJzQWhlYWQgKiAzNjAwMDAwKSxcbiAgICB9O1xuICB9O1xuXG4gIC8vIENoZWNrIGlmIHZlc3NlbCBpcyBtb3ZpbmcgYWJvdmUgdGhyZXNob2xkXG4gIGNvbnN0IGlzVmVzc2VsTW92aW5nID0gKFxuICAgIHNvZ01wczogbnVtYmVyLFxuICAgIHRocmVzaG9sZEtub3RzOiBudW1iZXIgPSAxLjAsXG4gICk6IGJvb2xlYW4gPT4ge1xuICAgIGNvbnN0IHRocmVzaG9sZE1wcyA9IHRocmVzaG9sZEtub3RzICogMC41MTQ0NDQ7XG4gICAgcmV0dXJuIHNvZ01wcyA+IHRocmVzaG9sZE1wcztcbiAgfTtcblxuICAvLyBCdWlsZCBPcGVuLU1ldGVvIFdlYXRoZXIgQVBJIFVSTFxuICBjb25zdCBidWlsZFdlYXRoZXJVcmwgPSAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGNvbnN0IGJhc2VVcmwgPSBjb25maWcuYXBpS2V5XG4gICAgICA/IGBodHRwczovL2N1c3RvbWVyLWFwaS5vcGVuLW1ldGVvLmNvbS92MS9mb3JlY2FzdGBcbiAgICAgIDogYGh0dHBzOi8vYXBpLm9wZW4tbWV0ZW8uY29tL3YxL2ZvcmVjYXN0YDtcblxuICAgIGNvbnN0IHBhcmFtcyA9IG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xuICAgICAgbGF0aXR1ZGU6IHBvc2l0aW9uLmxhdGl0dWRlLnRvU3RyaW5nKCksXG4gICAgICBsb25naXR1ZGU6IHBvc2l0aW9uLmxvbmdpdHVkZS50b1N0cmluZygpLFxuICAgICAgdGltZXpvbmU6IFwiYXV0b1wiLFxuICAgICAgZm9yZWNhc3RfZGF5czogTWF0aC5taW4oY29uZmlnLm1heEZvcmVjYXN0RGF5cywgMTYpLnRvU3RyaW5nKCksXG4gICAgfSk7XG5cbiAgICBpZiAoY29uZmlnLmFwaUtleSkge1xuICAgICAgcGFyYW1zLmFwcGVuZChcImFwaWtleVwiLCBjb25maWcuYXBpS2V5KTtcbiAgICB9XG5cbiAgICAvLyBIb3VybHkgd2VhdGhlciB2YXJpYWJsZXNcbiAgICBpZiAoY29uZmlnLmVuYWJsZUhvdXJseVdlYXRoZXIpIHtcbiAgICAgIGNvbnN0IGhvdXJseVZhcnMgPSBbXG4gICAgICAgIFwidGVtcGVyYXR1cmVfMm1cIixcbiAgICAgICAgXCJyZWxhdGl2ZV9odW1pZGl0eV8ybVwiLFxuICAgICAgICBcImRld19wb2ludF8ybVwiLFxuICAgICAgICBcImFwcGFyZW50X3RlbXBlcmF0dXJlXCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eVwiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25cIixcbiAgICAgICAgXCJyYWluXCIsXG4gICAgICAgIFwic2hvd2Vyc1wiLFxuICAgICAgICBcInNub3dmYWxsXCIsXG4gICAgICAgIFwid2VhdGhlcl9jb2RlXCIsXG4gICAgICAgIFwicHJlc3N1cmVfbXNsXCIsXG4gICAgICAgIFwic3VyZmFjZV9wcmVzc3VyZVwiLFxuICAgICAgICBcImNsb3VkX2NvdmVyXCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJfbG93XCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJfbWlkXCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJfaGlnaFwiLFxuICAgICAgICBcInZpc2liaWxpdHlcIixcbiAgICAgICAgXCJ3aW5kX3NwZWVkXzEwbVwiLFxuICAgICAgICBcIndpbmRfZGlyZWN0aW9uXzEwbVwiLFxuICAgICAgICBcIndpbmRfZ3VzdHNfMTBtXCIsXG4gICAgICAgIFwidXZfaW5kZXhcIixcbiAgICAgICAgXCJpc19kYXlcIixcbiAgICAgICAgXCJzdW5zaGluZV9kdXJhdGlvblwiLFxuICAgICAgICBcImNhcGVcIixcbiAgICAgICAgXCJzaG9ydHdhdmVfcmFkaWF0aW9uXCIsXG4gICAgICAgIFwiZGlyZWN0X3JhZGlhdGlvblwiLFxuICAgICAgICBcImRpZmZ1c2VfcmFkaWF0aW9uXCIsXG4gICAgICAgIFwiZGlyZWN0X25vcm1hbF9pcnJhZGlhbmNlXCIsXG4gICAgICBdO1xuICAgICAgcGFyYW1zLmFwcGVuZChcImhvdXJseVwiLCBob3VybHlWYXJzLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICAvLyBEYWlseSB3ZWF0aGVyIHZhcmlhYmxlc1xuICAgIGlmIChjb25maWcuZW5hYmxlRGFpbHlXZWF0aGVyKSB7XG4gICAgICBjb25zdCBkYWlseVZhcnMgPSBbXG4gICAgICAgIFwid2VhdGhlcl9jb2RlXCIsXG4gICAgICAgIFwidGVtcGVyYXR1cmVfMm1fbWF4XCIsXG4gICAgICAgIFwidGVtcGVyYXR1cmVfMm1fbWluXCIsXG4gICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWF4XCIsXG4gICAgICAgIFwiYXBwYXJlbnRfdGVtcGVyYXR1cmVfbWluXCIsXG4gICAgICAgIFwic3VucmlzZVwiLFxuICAgICAgICBcInN1bnNldFwiLFxuICAgICAgICBcImRheWxpZ2h0X2R1cmF0aW9uXCIsXG4gICAgICAgIFwic3Vuc2hpbmVfZHVyYXRpb25cIixcbiAgICAgICAgXCJ1dl9pbmRleF9tYXhcIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uX3N1bVwiLFxuICAgICAgICBcInJhaW5fc3VtXCIsXG4gICAgICAgIFwic2hvd2Vyc19zdW1cIixcbiAgICAgICAgXCJzbm93ZmFsbF9zdW1cIixcbiAgICAgICAgXCJwcmVjaXBpdGF0aW9uX2hvdXJzXCIsXG4gICAgICAgIFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eV9tYXhcIixcbiAgICAgICAgXCJ3aW5kX3NwZWVkXzEwbV9tYXhcIixcbiAgICAgICAgXCJ3aW5kX2d1c3RzXzEwbV9tYXhcIixcbiAgICAgICAgXCJ3aW5kX2RpcmVjdGlvbl8xMG1fZG9taW5hbnRcIixcbiAgICAgICAgXCJzaG9ydHdhdmVfcmFkaWF0aW9uX3N1bVwiLFxuICAgICAgXTtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJkYWlseVwiLCBkYWlseVZhcnMuam9pbihcIixcIikpO1xuICAgIH1cblxuICAgIC8vIEN1cnJlbnQgY29uZGl0aW9uc1xuICAgIGlmIChjb25maWcuZW5hYmxlQ3VycmVudENvbmRpdGlvbnMpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnRWYXJzID0gW1xuICAgICAgICBcInRlbXBlcmF0dXJlXzJtXCIsXG4gICAgICAgIFwicmVsYXRpdmVfaHVtaWRpdHlfMm1cIixcbiAgICAgICAgXCJhcHBhcmVudF90ZW1wZXJhdHVyZVwiLFxuICAgICAgICBcImlzX2RheVwiLFxuICAgICAgICBcInByZWNpcGl0YXRpb25cIixcbiAgICAgICAgXCJyYWluXCIsXG4gICAgICAgIFwic2hvd2Vyc1wiLFxuICAgICAgICBcInNub3dmYWxsXCIsXG4gICAgICAgIFwid2VhdGhlcl9jb2RlXCIsXG4gICAgICAgIFwiY2xvdWRfY292ZXJcIixcbiAgICAgICAgXCJwcmVzc3VyZV9tc2xcIixcbiAgICAgICAgXCJzdXJmYWNlX3ByZXNzdXJlXCIsXG4gICAgICAgIFwid2luZF9zcGVlZF8xMG1cIixcbiAgICAgICAgXCJ3aW5kX2RpcmVjdGlvbl8xMG1cIixcbiAgICAgICAgXCJ3aW5kX2d1c3RzXzEwbVwiLFxuICAgICAgXTtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJjdXJyZW50XCIsIGN1cnJlbnRWYXJzLmpvaW4oXCIsXCIpKTtcbiAgICB9XG5cbiAgICAvLyBSZXF1ZXN0IHdpbmQgc3BlZWQgaW4gbS9zIGZvciBTaWduYWxLIGNvbXBhdGliaWxpdHlcbiAgICBwYXJhbXMuYXBwZW5kKFwid2luZF9zcGVlZF91bml0XCIsIFwibXNcIik7XG5cbiAgICByZXR1cm4gYCR7YmFzZVVybH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gO1xuICB9O1xuXG4gIC8vIEJ1aWxkIE9wZW4tTWV0ZW8gTWFyaW5lIEFQSSBVUkxcbiAgY29uc3QgYnVpbGRNYXJpbmVVcmwgPSAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBzdHJpbmcgPT4ge1xuICAgIGNvbnN0IGJhc2VVcmwgPSBjb25maWcuYXBpS2V5XG4gICAgICA/IGBodHRwczovL2N1c3RvbWVyLW1hcmluZS1hcGkub3Blbi1tZXRlby5jb20vdjEvbWFyaW5lYFxuICAgICAgOiBgaHR0cHM6Ly9tYXJpbmUtYXBpLm9wZW4tbWV0ZW8uY29tL3YxL21hcmluZWA7XG5cbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcbiAgICAgIGxhdGl0dWRlOiBwb3NpdGlvbi5sYXRpdHVkZS50b1N0cmluZygpLFxuICAgICAgbG9uZ2l0dWRlOiBwb3NpdGlvbi5sb25naXR1ZGUudG9TdHJpbmcoKSxcbiAgICAgIHRpbWV6b25lOiBcImF1dG9cIixcbiAgICAgIGZvcmVjYXN0X2RheXM6IE1hdGgubWluKGNvbmZpZy5tYXhGb3JlY2FzdERheXMsIDgpLnRvU3RyaW5nKCksIC8vIE1hcmluZSBBUEkgbWF4IGlzIDggZGF5c1xuICAgIH0pO1xuXG4gICAgaWYgKGNvbmZpZy5hcGlLZXkpIHtcbiAgICAgIHBhcmFtcy5hcHBlbmQoXCJhcGlrZXlcIiwgY29uZmlnLmFwaUtleSk7XG4gICAgfVxuXG4gICAgLy8gSG91cmx5IG1hcmluZSB2YXJpYWJsZXNcbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZUhvdXJseSkge1xuICAgICAgY29uc3QgaG91cmx5VmFycyA9IFtcbiAgICAgICAgXCJ3YXZlX2hlaWdodFwiLFxuICAgICAgICBcIndhdmVfZGlyZWN0aW9uXCIsXG4gICAgICAgIFwid2F2ZV9wZXJpb2RcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfaGVpZ2h0XCIsXG4gICAgICAgIFwid2luZF93YXZlX2RpcmVjdGlvblwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9wZXJpb2RcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfcGVha19wZXJpb2RcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX2hlaWdodFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfZGlyZWN0aW9uXCIsXG4gICAgICAgIFwic3dlbGxfd2F2ZV9wZXJpb2RcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX3BlYWtfcGVyaW9kXCIsXG4gICAgICAgIFwib2NlYW5fY3VycmVudF92ZWxvY2l0eVwiLFxuICAgICAgICBcIm9jZWFuX2N1cnJlbnRfZGlyZWN0aW9uXCIsXG4gICAgICAgIFwic2VhX3N1cmZhY2VfdGVtcGVyYXR1cmVcIixcbiAgICAgIF07XG4gICAgICBwYXJhbXMuYXBwZW5kKFwiaG91cmx5XCIsIGhvdXJseVZhcnMuam9pbihcIixcIikpO1xuICAgIH1cblxuICAgIC8vIERhaWx5IG1hcmluZSB2YXJpYWJsZXNcbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZURhaWx5KSB7XG4gICAgICBjb25zdCBkYWlseVZhcnMgPSBbXG4gICAgICAgIFwid2F2ZV9oZWlnaHRfbWF4XCIsXG4gICAgICAgIFwid2F2ZV9kaXJlY3Rpb25fZG9taW5hbnRcIixcbiAgICAgICAgXCJ3YXZlX3BlcmlvZF9tYXhcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfaGVpZ2h0X21heFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9kaXJlY3Rpb25fZG9taW5hbnRcIixcbiAgICAgICAgXCJ3aW5kX3dhdmVfcGVyaW9kX21heFwiLFxuICAgICAgICBcIndpbmRfd2F2ZV9wZWFrX3BlcmlvZF9tYXhcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX2hlaWdodF9tYXhcIixcbiAgICAgICAgXCJzd2VsbF93YXZlX2RpcmVjdGlvbl9kb21pbmFudFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfcGVyaW9kX21heFwiLFxuICAgICAgICBcInN3ZWxsX3dhdmVfcGVha19wZXJpb2RfbWF4XCIsXG4gICAgICBdO1xuICAgICAgcGFyYW1zLmFwcGVuZChcImRhaWx5XCIsIGRhaWx5VmFycy5qb2luKFwiLFwiKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGAke2Jhc2VVcmx9PyR7cGFyYW1zLnRvU3RyaW5nKCl9YDtcbiAgfTtcblxuICAvLyBGZXRjaCB3ZWF0aGVyIGRhdGEgZnJvbSBPcGVuLU1ldGVvXG4gIGNvbnN0IGZldGNoV2VhdGhlckRhdGEgPSBhc3luYyAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBQcm9taXNlPE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSB8IG51bGw+ID0+IHtcbiAgICBjb25zdCB1cmwgPSBidWlsZFdlYXRoZXJVcmwocG9zaXRpb24sIGNvbmZpZyk7XG4gICAgYXBwLmRlYnVnKGBGZXRjaGluZyB3ZWF0aGVyIGZyb206ICR7dXJsfWApO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2godXJsKTtcbiAgICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgICAgY29uc3QgZXJyb3JUZXh0ID0gYXdhaXQgcmVzcG9uc2UudGV4dCgpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke2Vycm9yVGV4dH1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiAoYXdhaXQgcmVzcG9uc2UuanNvbigpKSBhcyBPcGVuTWV0ZW9XZWF0aGVyUmVzcG9uc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGFwcC5lcnJvcihcbiAgICAgICAgYEZhaWxlZCB0byBmZXRjaCB3ZWF0aGVyIGRhdGE6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9O1xuXG4gIC8vIEZldGNoIG1hcmluZSBkYXRhIGZyb20gT3Blbi1NZXRlb1xuICBjb25zdCBmZXRjaE1hcmluZURhdGEgPSBhc3luYyAoXG4gICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgIGNvbmZpZzogUGx1Z2luQ29uZmlnLFxuICApOiBQcm9taXNlPE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbD4gPT4ge1xuICAgIGNvbnN0IHVybCA9IGJ1aWxkTWFyaW5lVXJsKHBvc2l0aW9uLCBjb25maWcpO1xuICAgIGFwcC5kZWJ1ZyhgRmV0Y2hpbmcgbWFyaW5lIGRhdGEgZnJvbTogJHt1cmx9YCk7XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwpO1xuICAgICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgICBjb25zdCBlcnJvclRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7ZXJyb3JUZXh0fWApO1xuICAgICAgfVxuICAgICAgcmV0dXJuIChhd2FpdCByZXNwb25zZS5qc29uKCkpIGFzIE9wZW5NZXRlb01hcmluZVJlc3BvbnNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBhcHAuZXJyb3IoXG4gICAgICAgIGBGYWlsZWQgdG8gZmV0Y2ggbWFyaW5lIGRhdGE6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9O1xuXG4gIC8vIEdldCBzb3VyY2UgbGFiZWwgZm9yIFNpZ25hbEsgKGZvbGxvd2luZyB3ZWF0aGVyZmxvdy9tZXRlbyBwYXR0ZXJuKVxuICBjb25zdCBnZXRTb3VyY2VMYWJlbCA9IChwYWNrYWdlVHlwZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICByZXR1cm4gYG9wZW5tZXRlby0ke3BhY2thZ2VUeXBlfS1hcGlgO1xuICB9O1xuXG4gIC8vIEdldCBwYXJhbWV0ZXIgbWV0YWRhdGEgZm9yIFNpZ25hbEsgKHVzaW5nIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcylcbiAgY29uc3QgZ2V0UGFyYW1ldGVyTWV0YWRhdGEgPSAocGFyYW1ldGVyTmFtZTogc3RyaW5nKTogYW55ID0+IHtcbiAgICBjb25zdCBtZXRhZGF0YU1hcDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgIC8vIFRlbXBlcmF0dXJlIHBhcmFtZXRlcnMgKFNpZ25hbEsgY29tcGxpYW50IC0gS2VsdmluKVxuICAgICAgYWlyVGVtcGVyYXR1cmU6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBaXIgdGVtcGVyYXR1cmUgYXQgMm0gaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgZmVlbHNMaWtlOiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRmVlbHMgTGlrZSBUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBcHBhcmVudCB0ZW1wZXJhdHVyZSBjb25zaWRlcmluZyB3aW5kIGFuZCBodW1pZGl0eVwiLFxuICAgICAgfSxcbiAgICAgIGRld1BvaW50OiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGV3IFBvaW50XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRldyBwb2ludCB0ZW1wZXJhdHVyZSBhdCAybSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBzZWFTdXJmYWNlVGVtcGVyYXR1cmU6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTZWEgU3VyZmFjZSBUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTZWEgc3VyZmFjZSB0ZW1wZXJhdHVyZVwiLFxuICAgICAgfSxcbiAgICAgIGFpclRlbXBIaWdoOiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiSGlnaCBUZW1wZXJhdHVyZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIGFpciB0ZW1wZXJhdHVyZVwiLFxuICAgICAgfSxcbiAgICAgIGFpclRlbXBMb3c6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJMb3cgVGVtcGVyYXR1cmVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWluaW11bSBhaXIgdGVtcGVyYXR1cmVcIixcbiAgICAgIH0sXG4gICAgICBmZWVsc0xpa2VIaWdoOiB7XG4gICAgICAgIHVuaXRzOiBcIktcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRmVlbHMgTGlrZSBIaWdoXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gYXBwYXJlbnQgdGVtcGVyYXR1cmVcIixcbiAgICAgIH0sXG4gICAgICBmZWVsc0xpa2VMb3c6IHtcbiAgICAgICAgdW5pdHM6IFwiS1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJGZWVscyBMaWtlIExvd1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNaW5pbXVtIGFwcGFyZW50IHRlbXBlcmF0dXJlXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBXaW5kIHBhcmFtZXRlcnMgKFNpZ25hbEsgY29tcGxpYW50IC0gbS9zLCByYWRpYW5zKVxuICAgICAgd2luZEF2Zzoge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBTcGVlZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kIHNwZWVkIGF0IDEwbSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kR3VzdDoge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBHdXN0c1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJXaW5kIGd1c3Qgc3BlZWQgYXQgMTBtIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHdpbmREaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQgZGlyZWN0aW9uIGF0IDEwbSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kQXZnTWF4OiB7XG4gICAgICAgIHVuaXRzOiBcIm0vc1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2luZCBTcGVlZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIHdpbmQgc3BlZWRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kR3VzdE1heDoge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTWF4IFdpbmQgR3VzdHNcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSB3aW5kIGd1c3Qgc3BlZWRcIixcbiAgICAgIH0sXG4gICAgICB3aW5kRGlyZWN0aW9uRG9taW5hbnQ6IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRvbWluYW50IFdpbmQgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRvbWluYW50IHdpbmQgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuXG4gICAgICAvLyBQcmVzc3VyZSBwYXJhbWV0ZXJzIChTaWduYWxLIGNvbXBsaWFudCAtIFBhc2NhbClcbiAgICAgIHNlYUxldmVsUHJlc3N1cmU6IHtcbiAgICAgICAgdW5pdHM6IFwiUGFcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU2VhIExldmVsIFByZXNzdXJlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkF0bW9zcGhlcmljIHByZXNzdXJlIGF0IG1lYW4gc2VhIGxldmVsXCIsXG4gICAgICB9LFxuICAgICAgc3RhdGlvblByZXNzdXJlOiB7XG4gICAgICAgIHVuaXRzOiBcIlBhXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN1cmZhY2UgUHJlc3N1cmVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiQXRtb3NwaGVyaWMgcHJlc3N1cmUgYXQgc3VyZmFjZVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gSHVtaWRpdHkgKFNpZ25hbEsgY29tcGxpYW50IC0gcmF0aW8gMC0xKVxuICAgICAgcmVsYXRpdmVIdW1pZGl0eToge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJSZWxhdGl2ZSBIdW1pZGl0eVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJSZWxhdGl2ZSBodW1pZGl0eSBhdCAybSBoZWlnaHQgKDAtMSlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIENsb3VkIGNvdmVyIChTaWduYWxLIGNvbXBsaWFudCAtIHJhdGlvIDAtMSlcbiAgICAgIGNsb3VkQ292ZXI6IHtcbiAgICAgICAgdW5pdHM6IFwicmF0aW9cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ2xvdWQgQ292ZXJcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVG90YWwgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBsb3dDbG91ZENvdmVyOiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkxvdyBDbG91ZCBDb3ZlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJMb3cgYWx0aXR1ZGUgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBtaWRDbG91ZENvdmVyOiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1pZCBDbG91ZCBDb3ZlclwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNaWQgYWx0aXR1ZGUgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBoaWdoQ2xvdWRDb3Zlcjoge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJIaWdoIENsb3VkIENvdmVyXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkhpZ2ggYWx0aXR1ZGUgY2xvdWQgY292ZXIgKDAtMSlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFByZWNpcGl0YXRpb24gKFNpZ25hbEsgY29tcGxpYW50IC0gbWV0ZXJzKVxuICAgICAgcHJlY2lwOiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiUHJlY2lwaXRhdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJQcmVjaXBpdGF0aW9uIGFtb3VudFwiLFxuICAgICAgfSxcbiAgICAgIHJhaW46IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJSYWluXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlJhaW4gYW1vdW50XCIsXG4gICAgICB9LFxuICAgICAgc25vd2ZhbGw6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTbm93ZmFsbFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTbm93ZmFsbCBhbW91bnRcIixcbiAgICAgIH0sXG4gICAgICBwcmVjaXBQcm9iYWJpbGl0eToge1xuICAgICAgICB1bml0czogXCJyYXRpb1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJQcmVjaXBpdGF0aW9uIFByb2JhYmlsaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlByb2JhYmlsaXR5IG9mIHByZWNpcGl0YXRpb24gKDAtMSlcIixcbiAgICAgIH0sXG4gICAgICBwcmVjaXBTdW06IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJQcmVjaXBpdGF0aW9uIFN1bVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJUb3RhbCBwcmVjaXBpdGF0aW9uIGFtb3VudFwiLFxuICAgICAgfSxcbiAgICAgIHByZWNpcFByb2JhYmlsaXR5TWF4OiB7XG4gICAgICAgIHVuaXRzOiBcInJhdGlvXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBQcmVjaXBpdGF0aW9uIFByb2JhYmlsaXR5XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gcHJvYmFiaWxpdHkgb2YgcHJlY2lwaXRhdGlvbiAoMC0xKVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gVmlzaWJpbGl0eSAoU2lnbmFsSyBjb21wbGlhbnQgLSBtZXRlcnMpXG4gICAgICB2aXNpYmlsaXR5OiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiVmlzaWJpbGl0eVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJIb3Jpem9udGFsIHZpc2liaWxpdHlcIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFdhdmUgcGFyYW1ldGVycyAobWV0ZXJzLCBzZWNvbmRzLCByYWRpYW5zKVxuICAgICAgc2lnbmlmaWNhbnRXYXZlSGVpZ2h0OiB7XG4gICAgICAgIHVuaXRzOiBcIm1cIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2F2ZSBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU2lnbmlmaWNhbnQgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBzaWduaWZpY2FudFdhdmVIZWlnaHRNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2F2ZSBIZWlnaHRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWF4aW11bSBzaWduaWZpY2FudCB3YXZlIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIG1lYW5XYXZlUGVyaW9kOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2F2ZSBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWVhbiB3YXZlIHBlcmlvZFwiLFxuICAgICAgfSxcbiAgICAgIG1lYW5XYXZlUGVyaW9kTWF4OiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiTWF4IFdhdmUgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gd2F2ZSBwZXJpb2RcIixcbiAgICAgIH0sXG4gICAgICBtZWFuV2F2ZURpcmVjdGlvbjoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2F2ZSBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiTWVhbiB3YXZlIGRpcmVjdGlvblwiLFxuICAgICAgfSxcbiAgICAgIG1lYW5XYXZlRGlyZWN0aW9uRG9taW5hbnQ6IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIkRvbWluYW50IFdhdmUgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRvbWluYW50IHdhdmUgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVIZWlnaHQ6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXaW5kIFdhdmUgSGVpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQtZ2VuZXJhdGVkIHdhdmUgaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVIZWlnaHRNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggV2luZCBXYXZlIEhlaWdodFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIHdpbmQtZ2VuZXJhdGVkIHdhdmUgaGVpZ2h0XCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVQZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJXaW5kIFdhdmUgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldpbmQtZ2VuZXJhdGVkIHdhdmUgcGVyaW9kXCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVEaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIldpbmQgV2F2ZSBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2luZC1nZW5lcmF0ZWQgd2F2ZSBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG4gICAgICB3aW5kV2F2ZURpcmVjdGlvbkRvbWluYW50OiB7XG4gICAgICAgIHVuaXRzOiBcInJhZFwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEb21pbmFudCBXaW5kIFdhdmUgRGlyZWN0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRvbWluYW50IHdpbmQtZ2VuZXJhdGVkIHdhdmUgZGlyZWN0aW9uXCIsXG4gICAgICB9LFxuICAgICAgd2luZFdhdmVQZWFrUGVyaW9kOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2luZCBXYXZlIFBlYWsgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlBlYWsgcGVyaW9kIG9mIHdpbmQtZ2VuZXJhdGVkIHdhdmVzXCIsXG4gICAgICB9LFxuICAgICAgc3dlbGxTaWduaWZpY2FudEhlaWdodDoge1xuICAgICAgICB1bml0czogXCJtXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIEhlaWdodFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTd2VsbCB3YXZlIGhlaWdodFwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsU2lnbmlmaWNhbnRIZWlnaHRNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwibVwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggU3dlbGwgSGVpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gc3dlbGwgd2F2ZSBoZWlnaHRcIixcbiAgICAgIH0sXG4gICAgICBzd2VsbE1lYW5QZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTd2VsbCBQZXJpb2RcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU3dlbGwgd2F2ZSBwZXJpb2RcIixcbiAgICAgIH0sXG4gICAgICBzd2VsbE1lYW5QZXJpb2RNYXg6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJNYXggU3dlbGwgUGVyaW9kXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIk1heGltdW0gc3dlbGwgd2F2ZSBwZXJpb2RcIixcbiAgICAgIH0sXG4gICAgICBzd2VsbE1lYW5EaXJlY3Rpb246IHtcbiAgICAgICAgdW5pdHM6IFwicmFkXCIsXG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIlN3ZWxsIERpcmVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJTd2VsbCB3YXZlIGRpcmVjdGlvblwiLFxuICAgICAgfSxcbiAgICAgIHN3ZWxsTWVhbkRpcmVjdGlvbkRvbWluYW50OiB7XG4gICAgICAgIHVuaXRzOiBcInJhZFwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEb21pbmFudCBTd2VsbCBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRG9taW5hbnQgc3dlbGwgd2F2ZSBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG4gICAgICBzd2VsbFBlYWtQZXJpb2Q6IHtcbiAgICAgICAgdW5pdHM6IFwic1wiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTd2VsbCBQZWFrIFBlcmlvZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJQZWFrIHBlcmlvZCBvZiBzd2VsbCB3YXZlc1wiLFxuICAgICAgfSxcblxuICAgICAgLy8gT2NlYW4gY3VycmVudHNcbiAgICAgIGN1cnJlbnRWZWxvY2l0eToge1xuICAgICAgICB1bml0czogXCJtL3NcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ3VycmVudCBTcGVlZFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJPY2VhbiBjdXJyZW50IHZlbG9jaXR5XCIsXG4gICAgICB9LFxuICAgICAgY3VycmVudERpcmVjdGlvbjoge1xuICAgICAgICB1bml0czogXCJyYWRcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ3VycmVudCBEaXJlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiT2NlYW4gY3VycmVudCBkaXJlY3Rpb25cIixcbiAgICAgIH0sXG5cbiAgICAgIC8vIFNvbGFyIHJhZGlhdGlvblxuICAgICAgc29sYXJSYWRpYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwiVy9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJTb2xhciBSYWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU2hvcnR3YXZlIHNvbGFyIHJhZGlhdGlvblwiLFxuICAgICAgfSxcbiAgICAgIHNvbGFyUmFkaWF0aW9uU3VtOiB7XG4gICAgICAgIHVuaXRzOiBcIkovbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiVG90YWwgU29sYXIgUmFkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlRvdGFsIHNob3J0d2F2ZSBzb2xhciByYWRpYXRpb25cIixcbiAgICAgIH0sXG4gICAgICBkaXJlY3RSYWRpYXRpb246IHtcbiAgICAgICAgdW5pdHM6IFwiVy9tMlwiLFxuICAgICAgICBkaXNwbGF5TmFtZTogXCJEaXJlY3QgUmFkaWF0aW9uXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRpcmVjdCBzb2xhciByYWRpYXRpb25cIixcbiAgICAgIH0sXG4gICAgICBkaWZmdXNlUmFkaWF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcIlcvbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGlmZnVzZSBSYWRpYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRGlmZnVzZSBzb2xhciByYWRpYXRpb25cIixcbiAgICAgIH0sXG4gICAgICBpcnJhZGlhbmNlRGlyZWN0Tm9ybWFsOiB7XG4gICAgICAgIHVuaXRzOiBcIlcvbTJcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGlyZWN0IE5vcm1hbCBJcnJhZGlhbmNlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkRpcmVjdCBub3JtYWwgc29sYXIgaXJyYWRpYW5jZVwiLFxuICAgICAgfSxcblxuICAgICAgLy8gT3RoZXJcbiAgICAgIHV2SW5kZXg6IHtcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiVVYgSW5kZXhcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVVYgaW5kZXhcIixcbiAgICAgIH0sXG4gICAgICB1dkluZGV4TWF4OiB7XG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIk1heCBVViBJbmRleFwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJNYXhpbXVtIFVWIGluZGV4XCIsXG4gICAgICB9LFxuICAgICAgd2VhdGhlckNvZGU6IHtcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiV2VhdGhlciBDb2RlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldNTyB3ZWF0aGVyIGludGVycHJldGF0aW9uIGNvZGVcIixcbiAgICAgIH0sXG4gICAgICBpc0RheWxpZ2h0OiB7XG4gICAgICAgIGRpc3BsYXlOYW1lOiBcIklzIERheWxpZ2h0XCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIldoZXRoZXIgaXQgaXMgZGF5ICgxKSBvciBuaWdodCAoMClcIixcbiAgICAgIH0sXG4gICAgICBzdW5zaGluZUR1cmF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiU3Vuc2hpbmUgRHVyYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRHVyYXRpb24gb2Ygc3Vuc2hpbmVcIixcbiAgICAgIH0sXG4gICAgICBkYXlsaWdodER1cmF0aW9uOiB7XG4gICAgICAgIHVuaXRzOiBcInNcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiRGF5bGlnaHQgRHVyYXRpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiRHVyYXRpb24gb2YgZGF5bGlnaHRcIixcbiAgICAgIH0sXG4gICAgICBjYXBlOiB7XG4gICAgICAgIHVuaXRzOiBcIkova2dcIixcbiAgICAgICAgZGlzcGxheU5hbWU6IFwiQ0FQRVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJDb252ZWN0aXZlIEF2YWlsYWJsZSBQb3RlbnRpYWwgRW5lcmd5XCIsXG4gICAgICB9LFxuICAgICAgc3VucmlzZToge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJTdW5yaXNlXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIlN1bnJpc2UgdGltZVwiLFxuICAgICAgfSxcbiAgICAgIHN1bnNldDoge1xuICAgICAgICBkaXNwbGF5TmFtZTogXCJTdW5zZXRcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiU3Vuc2V0IHRpbWVcIixcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGlmIChtZXRhZGF0YU1hcFtwYXJhbWV0ZXJOYW1lXSkge1xuICAgICAgcmV0dXJuIG1ldGFkYXRhTWFwW3BhcmFtZXRlck5hbWVdO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIGZvciB1bmtub3duIHBhcmFtZXRlcnNcbiAgICBsZXQgdW5pdHMgPSBcIlwiO1xuICAgIGxldCBkZXNjcmlwdGlvbiA9IGAke3BhcmFtZXRlck5hbWV9IGZvcmVjYXN0IHBhcmFtZXRlcmA7XG5cbiAgICBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlRlbXBcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInRlbXBlcmF0dXJlXCIpKSB7XG4gICAgICB1bml0cyA9IFwiS1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlRlbXBlcmF0dXJlIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwid2luZFwiKSAmJiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIkF2Z1wiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiR3VzdFwiKSkpIHtcbiAgICAgIHVuaXRzID0gXCJtL3NcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJXaW5kIHNwZWVkIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiVmVsb2NpdHlcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInZlbG9jaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwibS9zXCI7XG4gICAgICBkZXNjcmlwdGlvbiA9IFwiU3BlZWQgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJQcmVzc3VyZVwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwicHJlc3N1cmVcIikpIHtcbiAgICAgIHVuaXRzID0gXCJQYVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlByZXNzdXJlIGZvcmVjYXN0XCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiSHVtaWRpdHlcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcImh1bWlkaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwicmF0aW9cIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJIdW1pZGl0eSBmb3JlY2FzdCAoMC0xKVwiO1xuICAgIH0gZWxzZSBpZiAocGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInByZWNpcFwiKSAmJiAhcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcIlByb2JhYmlsaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwibVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlByZWNpcGl0YXRpb24gZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJQcm9iYWJpbGl0eVwiKSB8fCBwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiQ292ZXJcIikpIHtcbiAgICAgIHVuaXRzID0gXCJyYXRpb1wiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlJhdGlvIGZvcmVjYXN0ICgwLTEpXCI7XG4gICAgfSBlbHNlIGlmIChwYXJhbWV0ZXJOYW1lLmluY2x1ZGVzKFwiRGlyZWN0aW9uXCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJkaXJlY3Rpb25cIikpIHtcbiAgICAgIHVuaXRzID0gXCJyYWRcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJEaXJlY3Rpb24gZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJ2aXNpYmlsaXR5XCIpIHx8IHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJWaXNpYmlsaXR5XCIpKSB7XG4gICAgICB1bml0cyA9IFwibVwiO1xuICAgICAgZGVzY3JpcHRpb24gPSBcIlZpc2liaWxpdHkgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJIZWlnaHRcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcImhlaWdodFwiKSkge1xuICAgICAgdW5pdHMgPSBcIm1cIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJIZWlnaHQgZm9yZWNhc3RcIjtcbiAgICB9IGVsc2UgaWYgKHBhcmFtZXRlck5hbWUuaW5jbHVkZXMoXCJQZXJpb2RcIikgfHwgcGFyYW1ldGVyTmFtZS5pbmNsdWRlcyhcInBlcmlvZFwiKSkge1xuICAgICAgdW5pdHMgPSBcInNcIjtcbiAgICAgIGRlc2NyaXB0aW9uID0gXCJQZXJpb2QgZm9yZWNhc3RcIjtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgdW5pdHMsXG4gICAgICBkaXNwbGF5TmFtZTogcGFyYW1ldGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uLFxuICAgIH07XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBob3VybHkgd2VhdGhlciBmb3JlY2FzdFxuICBjb25zdCBwcm9jZXNzSG91cmx5V2VhdGhlckZvcmVjYXN0ID0gKFxuICAgIGRhdGE6IE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSxcbiAgICBtYXhIb3VyczogbnVtYmVyLFxuICApOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdID0gW107XG4gICAgY29uc3QgaG91cmx5ID0gZGF0YS5ob3VybHk7XG4gICAgaWYgKCFob3VybHkgfHwgIWhvdXJseS50aW1lKSByZXR1cm4gZm9yZWNhc3RzO1xuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCBzdGFydEluZGV4ID0gaG91cmx5LnRpbWUuZmluZEluZGV4KFxuICAgICAgKHQpID0+IG5ldyBEYXRlKHQpID49IG5vdyxcbiAgICApO1xuICAgIGlmIChzdGFydEluZGV4ID09PSAtMSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IGNvdW50ID0gTWF0aC5taW4obWF4SG91cnMsIGhvdXJseS50aW1lLmxlbmd0aCAtIHN0YXJ0SW5kZXgpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICBjb25zdCBkYXRhSW5kZXggPSBzdGFydEluZGV4ICsgaTtcbiAgICAgIGNvbnN0IGZvcmVjYXN0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgICB0aW1lc3RhbXA6IGhvdXJseS50aW1lW2RhdGFJbmRleF0sXG4gICAgICAgIHJlbGF0aXZlSG91cjogaSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFByb2Nlc3MgZWFjaCBmaWVsZCB3aXRoIHVuaXQgY29udmVyc2lvbnMgYW5kIHRyYW5zbGF0ZSBmaWVsZCBuYW1lc1xuICAgICAgT2JqZWN0LmVudHJpZXMoaG91cmx5KS5mb3JFYWNoKChbZmllbGQsIHZhbHVlc10pID0+IHtcbiAgICAgICAgaWYgKGZpZWxkID09PSBcInRpbWVcIiB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZXMpKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHZhbHVlID0gdmFsdWVzW2RhdGFJbmRleF07XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSByZXR1cm47XG5cbiAgICAgICAgLy8gVHJhbnNsYXRlIGZpZWxkIG5hbWUgdG8gU2lnbmFsSy1hbGlnbmVkIG5hbWVcbiAgICAgICAgY29uc3QgdHJhbnNsYXRlZEZpZWxkID0gdHJhbnNsYXRlRmllbGROYW1lKGZpZWxkKTtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZC5pbmNsdWRlcyhcInRlbXBlcmF0dXJlXCIpIHx8IGZpZWxkID09PSBcImRld19wb2ludF8ybVwiIHx8IGZpZWxkID09PSBcImFwcGFyZW50X3RlbXBlcmF0dXJlXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gY2Vsc2l1c1RvS2VsdmluKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQuaW5jbHVkZXMoXCJkaXJlY3Rpb25cIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gZGVnVG9SYWQodmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gXCJwcmVjaXBpdGF0aW9uXCIgfHwgZmllbGQgPT09IFwicmFpblwiIHx8IGZpZWxkID09PSBcInNob3dlcnNcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBtbVRvTSh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInNub3dmYWxsXCIpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gY21Ub00odmFsdWUgYXMgbnVtYmVyKTsgLy8gU25vd2ZhbGwgaXMgaW4gY21cbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcInByZXNzdXJlXCIpKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGhQYVRvUEEodmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImh1bWlkaXR5XCIpIHx8IGZpZWxkLmluY2x1ZGVzKFwiY2xvdWRfY292ZXJcIikgfHwgZmllbGQgPT09IFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHBlcmNlbnRUb1JhdGlvKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwidmlzaWJpbGl0eVwiKSB7XG4gICAgICAgICAgLy8gVmlzaWJpbGl0eSBpcyBhbHJlYWR5IGluIG1ldGVycyBmcm9tIE9wZW4tTWV0ZW9cbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gdmFsdWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgZm9yZWNhc3RzLnB1c2goZm9yZWNhc3QpO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gUHJvY2VzcyBkYWlseSB3ZWF0aGVyIGZvcmVjYXN0XG4gIGNvbnN0IHByb2Nlc3NEYWlseVdlYXRoZXJGb3JlY2FzdCA9IChcbiAgICBkYXRhOiBPcGVuTWV0ZW9XZWF0aGVyUmVzcG9uc2UsXG4gICAgbWF4RGF5czogbnVtYmVyLFxuICApOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdID0gW107XG4gICAgY29uc3QgZGFpbHkgPSBkYXRhLmRhaWx5O1xuICAgIGlmICghZGFpbHkgfHwgIWRhaWx5LnRpbWUpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKG1heERheXMsIGRhaWx5LnRpbWUubGVuZ3RoKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgY29uc3QgZm9yZWNhc3Q6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgIGRhdGU6IGRhaWx5LnRpbWVbaV0sXG4gICAgICAgIGRheUluZGV4OiBpLFxuICAgICAgfTtcblxuICAgICAgLy8gUHJvY2VzcyBlYWNoIGZpZWxkIHdpdGggdW5pdCBjb252ZXJzaW9ucyBhbmQgdHJhbnNsYXRlIGZpZWxkIG5hbWVzXG4gICAgICBPYmplY3QuZW50cmllcyhkYWlseSkuZm9yRWFjaCgoW2ZpZWxkLCB2YWx1ZXNdKSA9PiB7XG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJ0aW1lXCIgfHwgIUFycmF5LmlzQXJyYXkodmFsdWVzKSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHZhbHVlc1tpXTtcbiAgICAgICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybjtcblxuICAgICAgICAvLyBUcmFuc2xhdGUgZmllbGQgbmFtZSB0byBTaWduYWxLLWFsaWduZWQgbmFtZVxuICAgICAgICBjb25zdCB0cmFuc2xhdGVkRmllbGQgPSB0cmFuc2xhdGVGaWVsZE5hbWUoZmllbGQpO1xuXG4gICAgICAgIC8vIEFwcGx5IHVuaXQgY29udmVyc2lvbnNcbiAgICAgICAgaWYgKGZpZWxkLmluY2x1ZGVzKFwidGVtcGVyYXR1cmVcIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gY2Vsc2l1c1RvS2VsdmluKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQuaW5jbHVkZXMoXCJkaXJlY3Rpb25cIikpIHtcbiAgICAgICAgICBmb3JlY2FzdFt0cmFuc2xhdGVkRmllbGRdID0gZGVnVG9SYWQodmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PT0gXCJwcmVjaXBpdGF0aW9uX3N1bVwiIHx8IGZpZWxkID09PSBcInJhaW5fc3VtXCIgfHwgZmllbGQgPT09IFwic2hvd2Vyc19zdW1cIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBtbVRvTSh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcInNub3dmYWxsX3N1bVwiKSB7XG4gICAgICAgICAgZm9yZWNhc3RbdHJhbnNsYXRlZEZpZWxkXSA9IGNtVG9NKHZhbHVlIGFzIG51bWJlcik7XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09IFwicHJlY2lwaXRhdGlvbl9wcm9iYWJpbGl0eV9tYXhcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBwZXJjZW50VG9SYXRpbyh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgaG91cmx5IG1hcmluZSBmb3JlY2FzdFxuICBjb25zdCBwcm9jZXNzSG91cmx5TWFyaW5lRm9yZWNhc3QgPSAoXG4gICAgZGF0YTogT3Blbk1ldGVvTWFyaW5lUmVzcG9uc2UsXG4gICAgbWF4SG91cnM6IG51bWJlcixcbiAgKTogUmVjb3JkPHN0cmluZywgYW55PltdID0+IHtcbiAgICBjb25zdCBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuICAgIGNvbnN0IGhvdXJseSA9IGRhdGEuaG91cmx5O1xuICAgIGlmICghaG91cmx5IHx8ICFob3VybHkudGltZSkgcmV0dXJuIGZvcmVjYXN0cztcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgY29uc3Qgc3RhcnRJbmRleCA9IGhvdXJseS50aW1lLmZpbmRJbmRleChcbiAgICAgICh0KSA9PiBuZXcgRGF0ZSh0KSA+PSBub3csXG4gICAgKTtcbiAgICBpZiAoc3RhcnRJbmRleCA9PT0gLTEpIHJldHVybiBmb3JlY2FzdHM7XG5cbiAgICBjb25zdCBjb3VudCA9IE1hdGgubWluKG1heEhvdXJzLCBob3VybHkudGltZS5sZW5ndGggLSBzdGFydEluZGV4KTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgY29uc3QgZGF0YUluZGV4ID0gc3RhcnRJbmRleCArIGk7XG4gICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBob3VybHkudGltZVtkYXRhSW5kZXhdLFxuICAgICAgICByZWxhdGl2ZUhvdXI6IGksXG4gICAgICB9O1xuXG4gICAgICAvLyBQcm9jZXNzIGVhY2ggZmllbGQgd2l0aCB1bml0IGNvbnZlcnNpb25zIGFuZCB0cmFuc2xhdGUgZmllbGQgbmFtZXNcbiAgICAgIE9iamVjdC5lbnRyaWVzKGhvdXJseSkuZm9yRWFjaCgoW2ZpZWxkLCB2YWx1ZXNdKSA9PiB7XG4gICAgICAgIGlmIChmaWVsZCA9PT0gXCJ0aW1lXCIgfHwgIUFycmF5LmlzQXJyYXkodmFsdWVzKSkgcmV0dXJuO1xuICAgICAgICBjb25zdCB2YWx1ZSA9IHZhbHVlc1tkYXRhSW5kZXhdO1xuICAgICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuO1xuXG4gICAgICAgIC8vIFRyYW5zbGF0ZSBmaWVsZCBuYW1lIHRvIFNpZ25hbEstYWxpZ25lZCBuYW1lXG4gICAgICAgIGNvbnN0IHRyYW5zbGF0ZWRGaWVsZCA9IHRyYW5zbGF0ZUZpZWxkTmFtZShmaWVsZCk7XG5cbiAgICAgICAgLy8gQXBwbHkgdW5pdCBjb252ZXJzaW9uc1xuICAgICAgICBpZiAoZmllbGQgPT09IFwic2VhX3N1cmZhY2VfdGVtcGVyYXR1cmVcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBjZWxzaXVzVG9LZWx2aW4odmFsdWUgYXMgbnVtYmVyKTtcbiAgICAgICAgfSBlbHNlIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBkZWdUb1JhZCh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSBcIm9jZWFuX2N1cnJlbnRfdmVsb2NpdHlcIikge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBrbWhUb01zKHZhbHVlIGFzIG51bWJlcik7IC8vIEN1cnJlbnQgdmVsb2NpdHkgaXMgaW4ga20vaFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIFdhdmUgaGVpZ2h0cywgcGVyaW9kcyBhcmUgYWxyZWFkeSBpbiBtZXRlcnMvc2Vjb25kc1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFByb2Nlc3MgZGFpbHkgbWFyaW5lIGZvcmVjYXN0XG4gIGNvbnN0IHByb2Nlc3NEYWlseU1hcmluZUZvcmVjYXN0ID0gKFxuICAgIGRhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlLFxuICAgIG1heERheXM6IG51bWJlcixcbiAgKTogUmVjb3JkPHN0cmluZywgYW55PltdID0+IHtcbiAgICBjb25zdCBmb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuICAgIGNvbnN0IGRhaWx5ID0gZGF0YS5kYWlseTtcbiAgICBpZiAoIWRhaWx5IHx8ICFkYWlseS50aW1lKSByZXR1cm4gZm9yZWNhc3RzO1xuXG4gICAgY29uc3QgY291bnQgPSBNYXRoLm1pbihtYXhEYXlzLCBkYWlseS50aW1lLmxlbmd0aCk7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgIGNvbnN0IGZvcmVjYXN0OiBSZWNvcmQ8c3RyaW5nLCBhbnk+ID0ge1xuICAgICAgICBkYXRlOiBkYWlseS50aW1lW2ldLFxuICAgICAgICBkYXlJbmRleDogaSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFByb2Nlc3MgZWFjaCBmaWVsZCB3aXRoIHVuaXQgY29udmVyc2lvbnMgYW5kIHRyYW5zbGF0ZSBmaWVsZCBuYW1lc1xuICAgICAgT2JqZWN0LmVudHJpZXMoZGFpbHkpLmZvckVhY2goKFtmaWVsZCwgdmFsdWVzXSkgPT4ge1xuICAgICAgICBpZiAoZmllbGQgPT09IFwidGltZVwiIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykpIHJldHVybjtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB2YWx1ZXNbaV07XG4gICAgICAgIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSByZXR1cm47XG5cbiAgICAgICAgLy8gVHJhbnNsYXRlIGZpZWxkIG5hbWUgdG8gU2lnbmFsSy1hbGlnbmVkIG5hbWVcbiAgICAgICAgY29uc3QgdHJhbnNsYXRlZEZpZWxkID0gdHJhbnNsYXRlRmllbGROYW1lKGZpZWxkKTtcblxuICAgICAgICAvLyBBcHBseSB1bml0IGNvbnZlcnNpb25zXG4gICAgICAgIGlmIChmaWVsZC5pbmNsdWRlcyhcImRpcmVjdGlvblwiKSkge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSBkZWdUb1JhZCh2YWx1ZSBhcyBudW1iZXIpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvcmVjYXN0W3RyYW5zbGF0ZWRGaWVsZF0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIFB1Ymxpc2ggaG91cmx5IGZvcmVjYXN0cyBmb3IgYSBzaW5nbGUgcGFja2FnZSAod2VhdGhlciBvciBtYXJpbmUpXG4gIGNvbnN0IHB1Ymxpc2hIb3VybHlQYWNrYWdlID0gKFxuICAgIGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdLFxuICAgIHBhY2thZ2VUeXBlOiBzdHJpbmcsXG4gICk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IHNvdXJjZUxhYmVsID0gZ2V0U291cmNlTGFiZWwoYGhvdXJseS0ke3BhY2thZ2VUeXBlfWApO1xuXG4gICAgZm9yZWNhc3RzLmZvckVhY2goKGZvcmVjYXN0LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgdmFsdWVzOiB7IHBhdGg6IHN0cmluZzsgdmFsdWU6IGFueSB9W10gPSBbXTtcbiAgICAgIGNvbnN0IG1ldGE6IHsgcGF0aDogc3RyaW5nOyB2YWx1ZTogYW55IH1bXSA9IFtdO1xuXG4gICAgICBPYmplY3QuZW50cmllcyhmb3JlY2FzdCkuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICAgIGlmIChrZXkgPT09IFwidGltZXN0YW1wXCIgfHwga2V5ID09PSBcInJlbGF0aXZlSG91clwiKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHBhdGggPSBgZW52aXJvbm1lbnQub3V0c2lkZS5vcGVubWV0ZW8uZm9yZWNhc3QuaG91cmx5LiR7a2V5fS4ke2luZGV4fWA7XG4gICAgICAgIGNvbnN0IG1ldGFkYXRhID0gZ2V0UGFyYW1ldGVyTWV0YWRhdGEoa2V5KTtcbiAgICAgICAgdmFsdWVzLnB1c2goeyBwYXRoLCB2YWx1ZSB9KTtcbiAgICAgICAgbWV0YS5wdXNoKHsgcGF0aCwgdmFsdWU6IG1ldGFkYXRhIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIGlmICh2YWx1ZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGRlbHRhOiBTaWduYWxLRGVsdGEgPSB7XG4gICAgICAgIGNvbnRleHQ6IFwidmVzc2Vscy5zZWxmXCIsXG4gICAgICAgIHVwZGF0ZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAkc291cmNlOiBzb3VyY2VMYWJlbCxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3QudGltZXN0YW1wIHx8IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIHZhbHVlcyxcbiAgICAgICAgICAgIG1ldGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGFwcC5oYW5kbGVNZXNzYWdlKHBsdWdpbi5pZCwgZGVsdGEpO1xuICAgIH0pO1xuXG4gICAgYXBwLmRlYnVnKGBQdWJsaXNoZWQgJHtmb3JlY2FzdHMubGVuZ3RofSBob3VybHkgJHtwYWNrYWdlVHlwZX0gZm9yZWNhc3RzYCk7XG4gIH07XG5cbiAgLy8gUHVibGlzaCBkYWlseSBmb3JlY2FzdHMgZm9yIGEgc2luZ2xlIHBhY2thZ2UgKHdlYXRoZXIgb3IgbWFyaW5lKVxuICBjb25zdCBwdWJsaXNoRGFpbHlQYWNrYWdlID0gKFxuICAgIGZvcmVjYXN0czogUmVjb3JkPHN0cmluZywgYW55PltdLFxuICAgIHBhY2thZ2VUeXBlOiBzdHJpbmcsXG4gICk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IHNvdXJjZUxhYmVsID0gZ2V0U291cmNlTGFiZWwoYGRhaWx5LSR7cGFja2FnZVR5cGV9YCk7XG5cbiAgICBmb3JlY2FzdHMuZm9yRWFjaCgoZm9yZWNhc3QsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZXM6IHsgcGF0aDogc3RyaW5nOyB2YWx1ZTogYW55IH1bXSA9IFtdO1xuICAgICAgY29uc3QgbWV0YTogeyBwYXRoOiBzdHJpbmc7IHZhbHVlOiBhbnkgfVtdID0gW107XG5cbiAgICAgIE9iamVjdC5lbnRyaWVzKGZvcmVjYXN0KS5mb3JFYWNoKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCJkYXRlXCIgfHwga2V5ID09PSBcImRheUluZGV4XCIpIHJldHVybjtcbiAgICAgICAgY29uc3QgcGF0aCA9IGBlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby5mb3JlY2FzdC5kYWlseS4ke2tleX0uJHtpbmRleH1gO1xuICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGdldFBhcmFtZXRlck1ldGFkYXRhKGtleSk7XG4gICAgICAgIHZhbHVlcy5wdXNoKHsgcGF0aCwgdmFsdWUgfSk7XG4gICAgICAgIG1ldGEucHVzaCh7IHBhdGgsIHZhbHVlOiBtZXRhZGF0YSB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodmFsdWVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBkZWx0YTogU2lnbmFsS0RlbHRhID0ge1xuICAgICAgICBjb250ZXh0OiBcInZlc3NlbHMuc2VsZlwiLFxuICAgICAgICB1cGRhdGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgJHNvdXJjZTogc291cmNlTGFiZWwsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIHZhbHVlcyxcbiAgICAgICAgICAgIG1ldGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG5cbiAgICAgIGFwcC5oYW5kbGVNZXNzYWdlKHBsdWdpbi5pZCwgZGVsdGEpO1xuICAgIH0pO1xuXG4gICAgYXBwLmRlYnVnKGBQdWJsaXNoZWQgJHtmb3JlY2FzdHMubGVuZ3RofSBkYWlseSAke3BhY2thZ2VUeXBlfSBmb3JlY2FzdHNgKTtcbiAgfTtcblxuICAvLyBGZXRjaCBmb3JlY2FzdHMgZm9yIGEgbW92aW5nIHZlc3NlbCAocG9zaXRpb24tc3BlY2lmaWMgZm9yZWNhc3RzIGFsb25nIHByZWRpY3RlZCByb3V0ZSlcbiAgY29uc3QgZmV0Y2hGb3JlY2FzdEZvck1vdmluZ1Zlc3NlbCA9IGFzeW5jIChcbiAgICBjb25maWc6IFBsdWdpbkNvbmZpZyxcbiAgKTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgaWYgKFxuICAgICAgIXN0YXRlLmN1cnJlbnRQb3NpdGlvbiB8fFxuICAgICAgIXN0YXRlLmN1cnJlbnRIZWFkaW5nIHx8XG4gICAgICAhc3RhdGUuY3VycmVudFNPRyB8fFxuICAgICAgIWlzVmVzc2VsTW92aW5nKHN0YXRlLmN1cnJlbnRTT0csIGNvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZCkgfHxcbiAgICAgICFzdGF0ZS5tb3ZpbmdGb3JlY2FzdEVuZ2FnZWRcbiAgICApIHtcbiAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgXCJWZXNzZWwgbm90IG1vdmluZywgbWlzc2luZyBuYXZpZ2F0aW9uIGRhdGEsIG9yIG1vdmluZyBmb3JlY2FzdCBub3QgZW5nYWdlZCwgZmFsbGluZyBiYWNrIHRvIHN0YXRpb25hcnkgZm9yZWNhc3RcIixcbiAgICAgICk7XG4gICAgICByZXR1cm4gZmV0Y2hBbmRQdWJsaXNoRm9yZWNhc3RzKGNvbmZpZyk7XG4gICAgfVxuXG4gICAgYXBwLmRlYnVnKFxuICAgICAgYFZlc3NlbCBtb3ZpbmcgYXQgJHsoc3RhdGUuY3VycmVudFNPRyAqIDEuOTQzODQ0KS50b0ZpeGVkKDEpfSBrbm90cyAodGhyZXNob2xkOiAke2NvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZH0ga25vdHMpLCBoZWFkaW5nICR7cmFkVG9EZWcoc3RhdGUuY3VycmVudEhlYWRpbmcpLnRvRml4ZWQoMSl9wrBgLFxuICAgICk7XG4gICAgYXBwLmRlYnVnKFxuICAgICAgYEZldGNoaW5nIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0cyBmb3IgJHtjb25maWcubWF4Rm9yZWNhc3RIb3Vyc30gaG91cnNgLFxuICAgICk7XG5cbiAgICAvLyBDYXB0dXJlIHZhbGlkYXRlZCBzdGF0ZSBmb3IgdXNlIGluIGhlbHBlciBmdW5jdGlvbnNcbiAgICBjb25zdCBjdXJyZW50UG9zaXRpb24gPSBzdGF0ZS5jdXJyZW50UG9zaXRpb24hO1xuICAgIGNvbnN0IGN1cnJlbnRIZWFkaW5nID0gc3RhdGUuY3VycmVudEhlYWRpbmchO1xuICAgIGNvbnN0IGN1cnJlbnRTT0cgPSBzdGF0ZS5jdXJyZW50U09HITtcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgY29uc3QgY3VycmVudEhvdXIgPSBuZXcgRGF0ZShcbiAgICAgIG5vdy5nZXRGdWxsWWVhcigpLFxuICAgICAgbm93LmdldE1vbnRoKCksXG4gICAgICBub3cuZ2V0RGF0ZSgpLFxuICAgICAgbm93LmdldEhvdXJzKCksXG4gICAgICAwLFxuICAgICAgMCxcbiAgICAgIDAsXG4gICAgKTtcblxuICAgIC8vIEhlbHBlciBmdW5jdGlvbiB0byBmZXRjaCBmb3JlY2FzdCBmb3IgYSBzaW5nbGUgaG91clxuICAgIGNvbnN0IGZldGNoSG91ckZvcmVjYXN0ID0gYXN5bmMgKGhvdXI6IG51bWJlcik6IFByb21pc2U8e1xuICAgICAgaG91cjogbnVtYmVyO1xuICAgICAgcHJlZGljdGVkUG9zOiBQb3NpdGlvbjtcbiAgICAgIHRhcmdldFRpbWU6IERhdGU7XG4gICAgICB3ZWF0aGVyRGF0YTogT3Blbk1ldGVvV2VhdGhlclJlc3BvbnNlIHwgbnVsbDtcbiAgICAgIG1hcmluZURhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbDtcbiAgICB9IHwgbnVsbD4gPT4ge1xuICAgICAgY29uc3QgcHJlZGljdGVkUG9zID0gY2FsY3VsYXRlRnV0dXJlUG9zaXRpb24oXG4gICAgICAgIGN1cnJlbnRQb3NpdGlvbixcbiAgICAgICAgY3VycmVudEhlYWRpbmcsXG4gICAgICAgIGN1cnJlbnRTT0csXG4gICAgICAgIGhvdXIsXG4gICAgICApO1xuICAgICAgY29uc3QgdGFyZ2V0VGltZSA9IG5ldyBEYXRlKGN1cnJlbnRIb3VyLmdldFRpbWUoKSArIGhvdXIgKiAzNjAwMDAwKTtcblxuICAgICAgYXBwLmRlYnVnKFxuICAgICAgICBgSG91ciAke2hvdXJ9OiBGZXRjaGluZyB3ZWF0aGVyIGZvciBwb3NpdGlvbiAke3ByZWRpY3RlZFBvcy5sYXRpdHVkZS50b0ZpeGVkKDYpfSwgJHtwcmVkaWN0ZWRQb3MubG9uZ2l0dWRlLnRvRml4ZWQoNil9YCxcbiAgICAgICk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHdlYXRoZXJEYXRhID0gYXdhaXQgZmV0Y2hXZWF0aGVyRGF0YShwcmVkaWN0ZWRQb3MsIGNvbmZpZyk7XG4gICAgICAgIGNvbnN0IG1hcmluZURhdGEgPVxuICAgICAgICAgIGNvbmZpZy5lbmFibGVNYXJpbmVIb3VybHkgfHwgY29uZmlnLmVuYWJsZU1hcmluZURhaWx5XG4gICAgICAgICAgICA/IGF3YWl0IGZldGNoTWFyaW5lRGF0YShwcmVkaWN0ZWRQb3MsIGNvbmZpZylcbiAgICAgICAgICAgIDogbnVsbDtcblxuICAgICAgICByZXR1cm4geyBob3VyLCBwcmVkaWN0ZWRQb3MsIHRhcmdldFRpbWUsIHdlYXRoZXJEYXRhLCBtYXJpbmVEYXRhIH07XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgYXBwLmRlYnVnKGBIb3VyICR7aG91cn06IEZldGNoIGZhaWxlZCAtICR7ZXJyfWApO1xuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIEZldGNoIGZvcmVjYXN0cyBpbiBwYXJhbGxlbCBiYXRjaGVzICg1IGNvbmN1cnJlbnQgcmVxdWVzdHMpXG4gICAgICBjb25zdCBCQVRDSF9TSVpFID0gNTtcbiAgICAgIGNvbnN0IEJBVENIX0RFTEFZX01TID0gMjAwO1xuXG4gICAgICBjb25zdCBhbGxSZXN1bHRzOiBBcnJheTx7XG4gICAgICAgIGhvdXI6IG51bWJlcjtcbiAgICAgICAgcHJlZGljdGVkUG9zOiBQb3NpdGlvbjtcbiAgICAgICAgdGFyZ2V0VGltZTogRGF0ZTtcbiAgICAgICAgd2VhdGhlckRhdGE6IE9wZW5NZXRlb1dlYXRoZXJSZXNwb25zZSB8IG51bGw7XG4gICAgICAgIG1hcmluZURhdGE6IE9wZW5NZXRlb01hcmluZVJlc3BvbnNlIHwgbnVsbDtcbiAgICAgIH0+ID0gW107XG5cbiAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgYEZldGNoaW5nICR7Y29uZmlnLm1heEZvcmVjYXN0SG91cnN9IGhvdXJseSBmb3JlY2FzdHMgaW4gYmF0Y2hlcyBvZiAke0JBVENIX1NJWkV9YCxcbiAgICAgICk7XG5cbiAgICAgIGZvciAoXG4gICAgICAgIGxldCBiYXRjaFN0YXJ0ID0gMDtcbiAgICAgICAgYmF0Y2hTdGFydCA8IGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzO1xuICAgICAgICBiYXRjaFN0YXJ0ICs9IEJBVENIX1NJWkVcbiAgICAgICkge1xuICAgICAgICBjb25zdCBiYXRjaEVuZCA9IE1hdGgubWluKFxuICAgICAgICAgIGJhdGNoU3RhcnQgKyBCQVRDSF9TSVpFLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzLFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBiYXRjaEhvdXJzID0gQXJyYXkuZnJvbShcbiAgICAgICAgICB7IGxlbmd0aDogYmF0Y2hFbmQgLSBiYXRjaFN0YXJ0IH0sXG4gICAgICAgICAgKF8sIGkpID0+IGJhdGNoU3RhcnQgKyBpLFxuICAgICAgICApO1xuXG4gICAgICAgIGFwcC5kZWJ1ZyhgRmV0Y2hpbmcgYmF0Y2g6IGhvdXJzICR7YmF0Y2hTdGFydH0tJHtiYXRjaEVuZCAtIDF9YCk7XG5cbiAgICAgICAgY29uc3QgYmF0Y2hSZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgYmF0Y2hIb3Vycy5tYXAoKGhvdXIpID0+IGZldGNoSG91ckZvcmVjYXN0KGhvdXIpKSxcbiAgICAgICAgKTtcblxuICAgICAgICBiYXRjaFJlc3VsdHMuZm9yRWFjaCgocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgYWxsUmVzdWx0cy5wdXNoKHJlc3VsdCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoYmF0Y2hFbmQgPCBjb25maWcubWF4Rm9yZWNhc3RIb3Vycykge1xuICAgICAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIEJBVENIX0RFTEFZX01TKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUHJvY2VzcyBhbmQgcHVibGlzaCB3ZWF0aGVyIGhvdXJseSBmb3JlY2FzdHNcbiAgICAgIGlmIChjb25maWcuZW5hYmxlSG91cmx5V2VhdGhlcikge1xuICAgICAgICBjb25zdCBob3VybHlXZWF0aGVyRm9yZWNhc3RzOiBSZWNvcmQ8c3RyaW5nLCBhbnk+W10gPSBbXTtcblxuICAgICAgICBhbGxSZXN1bHRzLmZvckVhY2goKHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChyZXN1bHQud2VhdGhlckRhdGE/LmhvdXJseSkge1xuICAgICAgICAgICAgY29uc3QgaG91cmx5RGF0YSA9IHJlc3VsdC53ZWF0aGVyRGF0YS5ob3VybHk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRIb3VyID0gcmVzdWx0LnRhcmdldFRpbWUuZ2V0SG91cnMoKTtcblxuICAgICAgICAgICAgLy8gRmluZCBtYXRjaGluZyBob3VyIGluIHRoZSByZXNwb25zZVxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSBob3VybHlEYXRhLnRpbWUgfHwgW107XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGZvcmVjYXN0VGltZSA9IG5ldyBEYXRlKHRpbWVzW2ldKTtcbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZvcmVjYXN0VGltZS5nZXRGdWxsWWVhcigpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXRGdWxsWWVhcigpICYmXG4gICAgICAgICAgICAgICAgZm9yZWNhc3RUaW1lLmdldE1vbnRoKCkgPT09IHJlc3VsdC50YXJnZXRUaW1lLmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0RGF0ZSgpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0SG91cnMoKSA9PT0gdGFyZ2V0SG91clxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3RUaW1lLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwcmVkaWN0ZWRMYXRpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHByZWRpY3RlZExvbmdpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sb25naXR1ZGUsXG4gICAgICAgICAgICAgICAgICB2ZXNzZWxNb3Zpbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgYWxsIGhvdXJseSBmaWVsZHMgZm9yIHRoaXMgdGltZSBpbmRleFxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKGhvdXJseURhdGEpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gXCJ0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsdWVzID0gKGhvdXJseURhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55Pilba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWVzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIGZvcmVjYXN0W2tleV0gPSB2YWx1ZXNbaV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGhvdXJseVdlYXRoZXJGb3JlY2FzdHMucHVzaChmb3JlY2FzdCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChob3VybHlXZWF0aGVyRm9yZWNhc3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBwdWJsaXNoSG91cmx5UGFja2FnZShob3VybHlXZWF0aGVyRm9yZWNhc3RzLCBcIndlYXRoZXJcIik7XG4gICAgICAgICAgYXBwLmRlYnVnKFxuICAgICAgICAgICAgYFB1Ymxpc2hlZCAke2hvdXJseVdlYXRoZXJGb3JlY2FzdHMubGVuZ3RofSBwb3NpdGlvbi1zcGVjaWZpYyB3ZWF0aGVyIGZvcmVjYXN0c2AsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBQcm9jZXNzIGFuZCBwdWJsaXNoIG1hcmluZSBob3VybHkgZm9yZWNhc3RzXG4gICAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZUhvdXJseSkge1xuICAgICAgICBjb25zdCBob3VybHlNYXJpbmVGb3JlY2FzdHM6IFJlY29yZDxzdHJpbmcsIGFueT5bXSA9IFtdO1xuXG4gICAgICAgIGFsbFJlc3VsdHMuZm9yRWFjaCgocmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5tYXJpbmVEYXRhPy5ob3VybHkpIHtcbiAgICAgICAgICAgIGNvbnN0IGhvdXJseURhdGEgPSByZXN1bHQubWFyaW5lRGF0YS5ob3VybHk7XG4gICAgICAgICAgICBjb25zdCB0YXJnZXRIb3VyID0gcmVzdWx0LnRhcmdldFRpbWUuZ2V0SG91cnMoKTtcblxuICAgICAgICAgICAgY29uc3QgdGltZXMgPSBob3VybHlEYXRhLnRpbWUgfHwgW107XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRpbWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGZvcmVjYXN0VGltZSA9IG5ldyBEYXRlKHRpbWVzW2ldKTtcbiAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgIGZvcmVjYXN0VGltZS5nZXRGdWxsWWVhcigpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXRGdWxsWWVhcigpICYmXG4gICAgICAgICAgICAgICAgZm9yZWNhc3RUaW1lLmdldE1vbnRoKCkgPT09IHJlc3VsdC50YXJnZXRUaW1lLmdldE1vbnRoKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0RGF0ZSgpID09PSByZXN1bHQudGFyZ2V0VGltZS5nZXREYXRlKCkgJiZcbiAgICAgICAgICAgICAgICBmb3JlY2FzdFRpbWUuZ2V0SG91cnMoKSA9PT0gdGFyZ2V0SG91clxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBjb25zdCBmb3JlY2FzdDogUmVjb3JkPHN0cmluZywgYW55PiA9IHtcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogZm9yZWNhc3RUaW1lLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgICAgICBwcmVkaWN0ZWRMYXRpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHByZWRpY3RlZExvbmdpdHVkZTogcmVzdWx0LnByZWRpY3RlZFBvcy5sb25naXR1ZGUsXG4gICAgICAgICAgICAgICAgICB2ZXNzZWxNb3Zpbmc6IHRydWUsXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKGhvdXJseURhdGEpLmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgICAgaWYgKGtleSAhPT0gXCJ0aW1lXCIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmFsdWVzID0gKGhvdXJseURhdGEgYXMgUmVjb3JkPHN0cmluZywgYW55Pilba2V5XTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWVzKSkge1xuICAgICAgICAgICAgICAgICAgICAgIGZvcmVjYXN0W2tleV0gPSB2YWx1ZXNbaV07XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGhvdXJseU1hcmluZUZvcmVjYXN0cy5wdXNoKGZvcmVjYXN0KTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGhvdXJseU1hcmluZUZvcmVjYXN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcHVibGlzaEhvdXJseVBhY2thZ2UoaG91cmx5TWFyaW5lRm9yZWNhc3RzLCBcIm1hcmluZVwiKTtcbiAgICAgICAgICBhcHAuZGVidWcoXG4gICAgICAgICAgICBgUHVibGlzaGVkICR7aG91cmx5TWFyaW5lRm9yZWNhc3RzLmxlbmd0aH0gcG9zaXRpb24tc3BlY2lmaWMgbWFyaW5lIGZvcmVjYXN0c2AsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBEYWlseSBmb3JlY2FzdHMgc3RpbGwgdXNlIGN1cnJlbnQgcG9zaXRpb25cbiAgICAgIGlmIChjb25maWcuZW5hYmxlRGFpbHlXZWF0aGVyICYmIGFsbFJlc3VsdHNbMF0/LndlYXRoZXJEYXRhKSB7XG4gICAgICAgIGNvbnN0IGRhaWx5V2VhdGhlciA9IHByb2Nlc3NEYWlseVdlYXRoZXJGb3JlY2FzdChcbiAgICAgICAgICBhbGxSZXN1bHRzWzBdLndlYXRoZXJEYXRhLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdERheXMsXG4gICAgICAgICk7XG4gICAgICAgIGlmIChkYWlseVdlYXRoZXIubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHB1Ymxpc2hEYWlseVBhY2thZ2UoZGFpbHlXZWF0aGVyLCBcIndlYXRoZXJcIik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGNvbmZpZy5lbmFibGVNYXJpbmVEYWlseSAmJiBhbGxSZXN1bHRzWzBdPy5tYXJpbmVEYXRhKSB7XG4gICAgICAgIGNvbnN0IGRhaWx5TWFyaW5lID0gcHJvY2Vzc0RhaWx5TWFyaW5lRm9yZWNhc3QoXG4gICAgICAgICAgYWxsUmVzdWx0c1swXS5tYXJpbmVEYXRhLFxuICAgICAgICAgIGNvbmZpZy5tYXhGb3JlY2FzdERheXMsXG4gICAgICAgICk7XG4gICAgICAgIGlmIChkYWlseU1hcmluZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcHVibGlzaERhaWx5UGFja2FnZShkYWlseU1hcmluZSwgXCJtYXJpbmVcIik7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgc3RhdGUubGFzdEZvcmVjYXN0VXBkYXRlID0gRGF0ZS5ub3coKTtcbiAgICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJBY3RpdmUgLSBNb3ZpbmcgdmVzc2VsIGZvcmVjYXN0cyB1cGRhdGVkXCIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlcnJvck1zZyA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgIGFwcC5lcnJvcihgRmFpbGVkIHRvIGZldGNoIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0czogJHtlcnJvck1zZ31gKTtcbiAgICAgIGFwcC5kZWJ1ZyhcIkZhbGxpbmcgYmFjayB0byBzdGF0aW9uYXJ5IGZvcmVjYXN0XCIpO1xuICAgICAgcmV0dXJuIGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhjb25maWcpO1xuICAgIH1cbiAgfTtcblxuICAvLyBGZXRjaCBhbmQgcHVibGlzaCBhbGwgZm9yZWNhc3RzXG4gIGNvbnN0IGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyA9IGFzeW5jIChjb25maWc6IFBsdWdpbkNvbmZpZykgPT4ge1xuICAgIGlmICghc3RhdGUuY3VycmVudFBvc2l0aW9uKSB7XG4gICAgICBhcHAuZGVidWcoXCJObyBwb3NpdGlvbiBhdmFpbGFibGUsIHNraXBwaW5nIGZvcmVjYXN0IGZldGNoXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBvc2l0aW9uID0gc3RhdGUuY3VycmVudFBvc2l0aW9uO1xuXG4gICAgLy8gRmV0Y2ggd2VhdGhlciBhbmQgbWFyaW5lIGRhdGEgaW4gcGFyYWxsZWxcbiAgICBjb25zdCBuZWVkc01hcmluZSA9IGNvbmZpZy5lbmFibGVNYXJpbmVIb3VybHkgfHwgY29uZmlnLmVuYWJsZU1hcmluZURhaWx5O1xuICAgIGNvbnN0IFt3ZWF0aGVyRGF0YSwgbWFyaW5lRGF0YV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICBmZXRjaFdlYXRoZXJEYXRhKHBvc2l0aW9uLCBjb25maWcpLFxuICAgICAgbmVlZHNNYXJpbmUgPyBmZXRjaE1hcmluZURhdGEocG9zaXRpb24sIGNvbmZpZykgOiBQcm9taXNlLnJlc29sdmUobnVsbCksXG4gICAgXSk7XG5cbiAgICBpZiAoIXdlYXRoZXJEYXRhICYmICFtYXJpbmVEYXRhKSB7XG4gICAgICBhcHAuZXJyb3IoXCJGYWlsZWQgdG8gZmV0Y2ggYW55IGZvcmVjYXN0IGRhdGFcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gU3RvcmUgdGhlIFVUQyBvZmZzZXQgZm9yIHRpbWV6b25lIGNvbnZlcnNpb24gKHVzZWQgZm9yIGRheS9uaWdodCBpY29uIGNhbGN1bGF0aW9uKVxuICAgIGlmICh3ZWF0aGVyRGF0YT8udXRjX29mZnNldF9zZWNvbmRzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGRlbHRhOiBTaWduYWxLRGVsdGEgPSB7XG4gICAgICAgIGNvbnRleHQ6IFwidmVzc2Vscy5zZWxmXCIsXG4gICAgICAgIHVwZGF0ZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAkc291cmNlOiBnZXRTb3VyY2VMYWJlbChcIndlYXRoZXJcIiksXG4gICAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIHZhbHVlczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgcGF0aDogXCJlbnZpcm9ubWVudC5vdXRzaWRlLm9wZW5tZXRlby51dGNPZmZzZXRTZWNvbmRzXCIsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHdlYXRoZXJEYXRhLnV0Y19vZmZzZXRfc2Vjb25kcyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH07XG4gICAgICBhcHAuaGFuZGxlTWVzc2FnZShwbHVnaW4uaWQsIGRlbHRhKTtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGFuZCBwdWJsaXNoIGhvdXJseSBmb3JlY2FzdHMgLSBzZXBhcmF0ZSBwYWNrYWdlcyBsaWtlIG1ldGVvYmx1ZVxuICAgIGlmIChjb25maWcuZW5hYmxlSG91cmx5V2VhdGhlciAmJiB3ZWF0aGVyRGF0YSkge1xuICAgICAgY29uc3QgaG91cmx5V2VhdGhlciA9IHByb2Nlc3NIb3VybHlXZWF0aGVyRm9yZWNhc3Qod2VhdGhlckRhdGEsIGNvbmZpZy5tYXhGb3JlY2FzdEhvdXJzKTtcbiAgICAgIGlmIChob3VybHlXZWF0aGVyLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcHVibGlzaEhvdXJseVBhY2thZ2UoaG91cmx5V2VhdGhlciwgXCJ3ZWF0aGVyXCIpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb25maWcuZW5hYmxlTWFyaW5lSG91cmx5ICYmIG1hcmluZURhdGEpIHtcbiAgICAgIGNvbnN0IGhvdXJseU1hcmluZSA9IHByb2Nlc3NIb3VybHlNYXJpbmVGb3JlY2FzdChtYXJpbmVEYXRhLCBjb25maWcubWF4Rm9yZWNhc3RIb3Vycyk7XG4gICAgICBpZiAoaG91cmx5TWFyaW5lLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcHVibGlzaEhvdXJseVBhY2thZ2UoaG91cmx5TWFyaW5lLCBcIm1hcmluZVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGFuZCBwdWJsaXNoIGRhaWx5IGZvcmVjYXN0cyAtIHNlcGFyYXRlIHBhY2thZ2VzIGxpa2UgbWV0ZW9ibHVlXG4gICAgaWYgKGNvbmZpZy5lbmFibGVEYWlseVdlYXRoZXIgJiYgd2VhdGhlckRhdGEpIHtcbiAgICAgIGNvbnN0IGRhaWx5V2VhdGhlciA9IHByb2Nlc3NEYWlseVdlYXRoZXJGb3JlY2FzdCh3ZWF0aGVyRGF0YSwgY29uZmlnLm1heEZvcmVjYXN0RGF5cyk7XG4gICAgICBpZiAoZGFpbHlXZWF0aGVyLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcHVibGlzaERhaWx5UGFja2FnZShkYWlseVdlYXRoZXIsIFwid2VhdGhlclwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLmVuYWJsZU1hcmluZURhaWx5ICYmIG1hcmluZURhdGEpIHtcbiAgICAgIGNvbnN0IGRhaWx5TWFyaW5lID0gcHJvY2Vzc0RhaWx5TWFyaW5lRm9yZWNhc3QobWFyaW5lRGF0YSwgY29uZmlnLm1heEZvcmVjYXN0RGF5cyk7XG4gICAgICBpZiAoZGFpbHlNYXJpbmUubGVuZ3RoID4gMCkge1xuICAgICAgICBwdWJsaXNoRGFpbHlQYWNrYWdlKGRhaWx5TWFyaW5lLCBcIm1hcmluZVwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBzdGF0ZS5sYXN0Rm9yZWNhc3RVcGRhdGUgPSBEYXRlLm5vdygpO1xuICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJBY3RpdmUgLSBGb3JlY2FzdHMgdXBkYXRlZFwiKTtcbiAgfTtcblxuICAvLyBXZWF0aGVyIEFQSSBwcm92aWRlciBpbXBsZW1lbnRhdGlvbiAodXNpbmcgU2lnbmFsSy1hbGlnbmVkIGZpZWxkIG5hbWVzKVxuICBjb25zdCBjb252ZXJ0VG9XZWF0aGVyQVBJRm9yZWNhc3QgPSAoXG4gICAgZm9yZWNhc3REYXRhOiBhbnksXG4gICAgdHlwZTogV2VhdGhlckZvcmVjYXN0VHlwZSxcbiAgKTogV2VhdGhlckRhdGEgPT4ge1xuICAgIHJldHVybiB7XG4gICAgICBkYXRlOiBmb3JlY2FzdERhdGEudGltZXN0YW1wIHx8IGZvcmVjYXN0RGF0YS5kYXRlIHx8IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIHR5cGUsXG4gICAgICBkZXNjcmlwdGlvbjogZ2V0V2VhdGhlckRlc2NyaXB0aW9uKFxuICAgICAgICBmb3JlY2FzdERhdGEud2VhdGhlckNvZGUsXG4gICAgICAgIFwiT3Blbi1NZXRlbyB3ZWF0aGVyXCIsXG4gICAgICApLFxuICAgICAgbG9uZ0Rlc2NyaXB0aW9uOiBnZXRXZWF0aGVyTG9uZ0Rlc2NyaXB0aW9uKFxuICAgICAgICBmb3JlY2FzdERhdGEud2VhdGhlckNvZGUsXG4gICAgICAgIFwiT3Blbi1NZXRlbyB3ZWF0aGVyIGZvcmVjYXN0XCIsXG4gICAgICApLFxuICAgICAgaWNvbjogZ2V0V2VhdGhlckljb24oXG4gICAgICAgIGZvcmVjYXN0RGF0YS53ZWF0aGVyQ29kZSxcbiAgICAgICAgZm9yZWNhc3REYXRhLmlzRGF5bGlnaHQsXG4gICAgICAgIGZvcmVjYXN0RGF0YS50aW1lc3RhbXAgfHwgZm9yZWNhc3REYXRhLmRhdGUsXG4gICAgICAgIGZvcmVjYXN0RGF0YS5zdW5yaXNlLFxuICAgICAgICBmb3JlY2FzdERhdGEuc3Vuc2V0LFxuICAgICAgICBmb3JlY2FzdERhdGEudXRjT2Zmc2V0U2Vjb25kcyxcbiAgICAgICksXG4gICAgICBvdXRzaWRlOiB7XG4gICAgICAgIHRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEuYWlyVGVtcGVyYXR1cmUsXG4gICAgICAgIG1heFRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEuYWlyVGVtcEhpZ2gsXG4gICAgICAgIG1pblRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEuYWlyVGVtcExvdyxcbiAgICAgICAgZmVlbHNMaWtlVGVtcGVyYXR1cmU6IGZvcmVjYXN0RGF0YS5mZWVsc0xpa2UgfHwgZm9yZWNhc3REYXRhLmZlZWxzTGlrZUhpZ2gsXG4gICAgICAgIHByZXNzdXJlOiBmb3JlY2FzdERhdGEuc2VhTGV2ZWxQcmVzc3VyZSxcbiAgICAgICAgcmVsYXRpdmVIdW1pZGl0eTogZm9yZWNhc3REYXRhLnJlbGF0aXZlSHVtaWRpdHksXG4gICAgICAgIHV2SW5kZXg6IGZvcmVjYXN0RGF0YS51dkluZGV4IHx8IGZvcmVjYXN0RGF0YS51dkluZGV4TWF4LFxuICAgICAgICBjbG91ZENvdmVyOiBmb3JlY2FzdERhdGEuY2xvdWRDb3ZlcixcbiAgICAgICAgcHJlY2lwaXRhdGlvblZvbHVtZTogZm9yZWNhc3REYXRhLnByZWNpcCB8fCBmb3JlY2FzdERhdGEucHJlY2lwU3VtLFxuICAgICAgICBkZXdQb2ludFRlbXBlcmF0dXJlOiBmb3JlY2FzdERhdGEuZGV3UG9pbnQsXG4gICAgICAgIGhvcml6b250YWxWaXNpYmlsaXR5OiBmb3JlY2FzdERhdGEudmlzaWJpbGl0eSxcbiAgICAgICAgcHJlY2lwaXRhdGlvblByb2JhYmlsaXR5OiBmb3JlY2FzdERhdGEucHJlY2lwUHJvYmFiaWxpdHkgfHwgZm9yZWNhc3REYXRhLnByZWNpcFByb2JhYmlsaXR5TWF4LFxuICAgICAgICBsb3dDbG91ZENvdmVyOiBmb3JlY2FzdERhdGEubG93Q2xvdWRDb3ZlcixcbiAgICAgICAgbWlkQ2xvdWRDb3ZlcjogZm9yZWNhc3REYXRhLm1pZENsb3VkQ292ZXIsXG4gICAgICAgIGhpZ2hDbG91ZENvdmVyOiBmb3JlY2FzdERhdGEuaGlnaENsb3VkQ292ZXIsXG4gICAgICAgIHNvbGFyUmFkaWF0aW9uOiBmb3JlY2FzdERhdGEuc29sYXJSYWRpYXRpb24gfHwgZm9yZWNhc3REYXRhLnNvbGFyUmFkaWF0aW9uU3VtLFxuICAgICAgICBkaXJlY3ROb3JtYWxJcnJhZGlhbmNlOiBmb3JlY2FzdERhdGEuaXJyYWRpYW5jZURpcmVjdE5vcm1hbCxcbiAgICAgICAgZGlmZnVzZUhvcml6b250YWxJcnJhZGlhbmNlOiBmb3JlY2FzdERhdGEuZGlmZnVzZVJhZGlhdGlvbixcbiAgICAgIH0sXG4gICAgICB3YXRlcjoge1xuICAgICAgICB0ZW1wZXJhdHVyZTogZm9yZWNhc3REYXRhLnNlYVN1cmZhY2VUZW1wZXJhdHVyZSxcbiAgICAgICAgd2F2ZVNpZ25pZmljYW50SGVpZ2h0OiBmb3JlY2FzdERhdGEuc2lnbmlmaWNhbnRXYXZlSGVpZ2h0IHx8IGZvcmVjYXN0RGF0YS5zaWduaWZpY2FudFdhdmVIZWlnaHRNYXgsXG4gICAgICAgIHdhdmVQZXJpb2Q6IGZvcmVjYXN0RGF0YS5tZWFuV2F2ZVBlcmlvZCB8fCBmb3JlY2FzdERhdGEubWVhbldhdmVQZXJpb2RNYXgsXG4gICAgICAgIHdhdmVEaXJlY3Rpb246IGZvcmVjYXN0RGF0YS5tZWFuV2F2ZURpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEubWVhbldhdmVEaXJlY3Rpb25Eb21pbmFudCxcbiAgICAgICAgd2luZFdhdmVIZWlnaHQ6IGZvcmVjYXN0RGF0YS53aW5kV2F2ZUhlaWdodCB8fCBmb3JlY2FzdERhdGEud2luZFdhdmVIZWlnaHRNYXgsXG4gICAgICAgIHdpbmRXYXZlUGVyaW9kOiBmb3JlY2FzdERhdGEud2luZFdhdmVQZXJpb2QgfHwgZm9yZWNhc3REYXRhLndpbmRXYXZlUGVyaW9kTWF4LFxuICAgICAgICB3aW5kV2F2ZURpcmVjdGlvbjogZm9yZWNhc3REYXRhLndpbmRXYXZlRGlyZWN0aW9uIHx8IGZvcmVjYXN0RGF0YS53aW5kV2F2ZURpcmVjdGlvbkRvbWluYW50LFxuICAgICAgICBzd2VsbEhlaWdodDogZm9yZWNhc3REYXRhLnN3ZWxsU2lnbmlmaWNhbnRIZWlnaHQgfHwgZm9yZWNhc3REYXRhLnN3ZWxsU2lnbmlmaWNhbnRIZWlnaHRNYXgsXG4gICAgICAgIHN3ZWxsUGVyaW9kOiBmb3JlY2FzdERhdGEuc3dlbGxNZWFuUGVyaW9kIHx8IGZvcmVjYXN0RGF0YS5zd2VsbE1lYW5QZXJpb2RNYXgsXG4gICAgICAgIHN3ZWxsRGlyZWN0aW9uOiBmb3JlY2FzdERhdGEuc3dlbGxNZWFuRGlyZWN0aW9uIHx8IGZvcmVjYXN0RGF0YS5zd2VsbE1lYW5EaXJlY3Rpb25Eb21pbmFudCxcbiAgICAgICAgc3VyZmFjZUN1cnJlbnRTcGVlZDogZm9yZWNhc3REYXRhLmN1cnJlbnRWZWxvY2l0eSxcbiAgICAgICAgc3VyZmFjZUN1cnJlbnREaXJlY3Rpb246IGZvcmVjYXN0RGF0YS5jdXJyZW50RGlyZWN0aW9uLFxuICAgICAgICBzd2VsbFBlYWtQZXJpb2Q6IGZvcmVjYXN0RGF0YS5zd2VsbFBlYWtQZXJpb2QgfHwgZm9yZWNhc3REYXRhLnN3ZWxsUGVha1BlcmlvZE1heCxcbiAgICAgICAgd2luZFdhdmVQZWFrUGVyaW9kOiBmb3JlY2FzdERhdGEud2luZFdhdmVQZWFrUGVyaW9kIHx8IGZvcmVjYXN0RGF0YS53aW5kV2F2ZVBlYWtQZXJpb2RNYXgsXG4gICAgICB9LFxuICAgICAgd2luZDoge1xuICAgICAgICBzcGVlZFRydWU6IGZvcmVjYXN0RGF0YS53aW5kQXZnIHx8IGZvcmVjYXN0RGF0YS53aW5kQXZnTWF4LFxuICAgICAgICBkaXJlY3Rpb25UcnVlOiBmb3JlY2FzdERhdGEud2luZERpcmVjdGlvbiB8fCBmb3JlY2FzdERhdGEud2luZERpcmVjdGlvbkRvbWluYW50LFxuICAgICAgICBndXN0OiBmb3JlY2FzdERhdGEud2luZEd1c3QgfHwgZm9yZWNhc3REYXRhLndpbmRHdXN0TWF4LFxuICAgICAgfSxcbiAgICAgIHN1bjoge1xuICAgICAgICBzdW5yaXNlOiBmb3JlY2FzdERhdGEuc3VucmlzZSxcbiAgICAgICAgc3Vuc2V0OiBmb3JlY2FzdERhdGEuc3Vuc2V0LFxuICAgICAgICBzdW5zaGluZUR1cmF0aW9uOiBmb3JlY2FzdERhdGEuc3Vuc2hpbmVEdXJhdGlvbixcbiAgICAgICAgLy8gaXNEYXlsaWdodDogdHJ1ZSBpZiAxL3RydWUsIGZhbHNlIGlmIDAvZmFsc2UsIHVuZGVmaW5lZCBpZiBub3QgcHJlc2VudCAoZGFpbHkgZm9yZWNhc3RzKVxuICAgICAgICBpc0RheWxpZ2h0OiBmb3JlY2FzdERhdGEuaXNEYXlsaWdodCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyBmb3JlY2FzdERhdGEuaXNEYXlsaWdodCA9PT0gMSB8fCBmb3JlY2FzdERhdGEuaXNEYXlsaWdodCA9PT0gdHJ1ZVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgfSxcbiAgICB9O1xuICB9O1xuXG4gIC8vIEdldCBob3VybHkgZm9yZWNhc3RzIGZyb20gU2lnbmFsSyB0cmVlICh1c2luZyBTaWduYWxLLWFsaWduZWQgZmllbGQgbmFtZXMpXG4gIGNvbnN0IGdldEhvdXJseUZvcmVjYXN0cyA9IChtYXhDb3VudDogbnVtYmVyKTogV2VhdGhlckRhdGFbXSA9PiB7XG4gICAgY29uc3QgZm9yZWNhc3RzOiBXZWF0aGVyRGF0YVtdID0gW107XG5cbiAgICB0cnkge1xuICAgICAgLy8gUmVhZCB0aGUgVVRDIG9mZnNldCBmb3IgdGltZXpvbmUgY29udmVyc2lvblxuICAgICAgY29uc3QgdXRjT2Zmc2V0RGF0YSA9IGFwcC5nZXRTZWxmUGF0aChcImVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLnV0Y09mZnNldFNlY29uZHNcIik7XG4gICAgICBjb25zdCB1dGNPZmZzZXRTZWNvbmRzID0gdXRjT2Zmc2V0RGF0YT8udmFsdWUgYXMgbnVtYmVyIHwgdW5kZWZpbmVkO1xuXG4gICAgICAvLyBGaXJzdCwgcmVhZCBzdW5yaXNlL3N1bnNldCBmcm9tIGRhaWx5IGZvcmVjYXN0cyB0byB1c2UgZm9yIGRheS9uaWdodCBjYWxjdWxhdGlvblxuICAgICAgLy8gQnVpbGQgYSBtYXAgb2YgZGF0ZSAtPiB7c3VucmlzZSwgc3Vuc2V0fVxuICAgICAgY29uc3Qgc3VuVGltZXM6IE1hcDxzdHJpbmcsIHsgc3VucmlzZTogc3RyaW5nOyBzdW5zZXQ6IHN0cmluZyB9PiA9IG5ldyBNYXAoKTtcbiAgICAgIGZvciAobGV0IGRheUluZGV4ID0gMDsgZGF5SW5kZXggPCAxNjsgZGF5SW5kZXgrKykge1xuICAgICAgICBjb25zdCBzdW5yaXNlRGF0YSA9IGFwcC5nZXRTZWxmUGF0aChcbiAgICAgICAgICBgZW52aXJvbm1lbnQub3V0c2lkZS5vcGVubWV0ZW8uZm9yZWNhc3QuZGFpbHkuc3VucmlzZS4ke2RheUluZGV4fWAsXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IHN1bnNldERhdGEgPSBhcHAuZ2V0U2VsZlBhdGgoXG4gICAgICAgICAgYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmRhaWx5LnN1bnNldC4ke2RheUluZGV4fWAsXG4gICAgICAgICk7XG4gICAgICAgIGlmIChzdW5yaXNlRGF0YT8udmFsdWUgJiYgc3Vuc2V0RGF0YT8udmFsdWUpIHtcbiAgICAgICAgICAvLyBFeHRyYWN0IHRoZSBkYXRlIHBhcnQgZnJvbSBzdW5yaXNlIChmb3JtYXQ6IFlZWVktTU0tREQgb3IgSVNPIHRpbWVzdGFtcClcbiAgICAgICAgICBjb25zdCBzdW5yaXNlU3RyID0gU3RyaW5nKHN1bnJpc2VEYXRhLnZhbHVlKTtcbiAgICAgICAgICBjb25zdCBkYXRlS2V5ID0gc3VucmlzZVN0ci5zdWJzdHJpbmcoMCwgMTApOyAvLyBHZXQgWVlZWS1NTS1ERFxuICAgICAgICAgIHN1blRpbWVzLnNldChkYXRlS2V5LCB7XG4gICAgICAgICAgICBzdW5yaXNlOiBzdW5yaXNlU3RyLFxuICAgICAgICAgICAgc3Vuc2V0OiBTdHJpbmcoc3Vuc2V0RGF0YS52YWx1ZSksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gUmVhZCBmb3JlY2FzdCBkYXRhIGZyb20gU2lnbmFsSyB0cmVlIHVzaW5nIHRyYW5zbGF0ZWQgZmllbGQgbmFtZXNcbiAgICAgIGxldCBmb3JlY2FzdENvdW50ID0gMDtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbWF4Q291bnQgKyAxMDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IHRlbXAgPSBhcHAuZ2V0U2VsZlBhdGgoXG4gICAgICAgICAgYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmhvdXJseS5haXJUZW1wZXJhdHVyZS4ke2l9YCxcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKHRlbXAgJiYgdGVtcC52YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZm9yZWNhc3RDb3VudCA9IGkgKyAxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGFjdHVhbENvdW50ID0gTWF0aC5taW4oZm9yZWNhc3RDb3VudCwgbWF4Q291bnQpO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFjdHVhbENvdW50OyBpKyspIHtcbiAgICAgICAgY29uc3QgZm9yZWNhc3REYXRhOiBhbnkgPSB7fTtcbiAgICAgICAgLy8gVXNlIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcyAodHJhbnNsYXRlZCBuYW1lcylcbiAgICAgICAgY29uc3QgZmllbGRzID0gW1xuICAgICAgICAgIFwiYWlyVGVtcGVyYXR1cmVcIixcbiAgICAgICAgICBcInJlbGF0aXZlSHVtaWRpdHlcIixcbiAgICAgICAgICBcImRld1BvaW50XCIsXG4gICAgICAgICAgXCJmZWVsc0xpa2VcIixcbiAgICAgICAgICBcInByZWNpcFByb2JhYmlsaXR5XCIsXG4gICAgICAgICAgXCJwcmVjaXBcIixcbiAgICAgICAgICBcIndlYXRoZXJDb2RlXCIsXG4gICAgICAgICAgXCJzZWFMZXZlbFByZXNzdXJlXCIsXG4gICAgICAgICAgXCJjbG91ZENvdmVyXCIsXG4gICAgICAgICAgXCJsb3dDbG91ZENvdmVyXCIsXG4gICAgICAgICAgXCJtaWRDbG91ZENvdmVyXCIsXG4gICAgICAgICAgXCJoaWdoQ2xvdWRDb3ZlclwiLFxuICAgICAgICAgIFwidmlzaWJpbGl0eVwiLFxuICAgICAgICAgIFwid2luZEF2Z1wiLFxuICAgICAgICAgIFwid2luZERpcmVjdGlvblwiLFxuICAgICAgICAgIFwid2luZEd1c3RcIixcbiAgICAgICAgICBcInV2SW5kZXhcIixcbiAgICAgICAgICBcImlzRGF5bGlnaHRcIixcbiAgICAgICAgICBcInN1bnNoaW5lRHVyYXRpb25cIixcbiAgICAgICAgICBcInNvbGFyUmFkaWF0aW9uXCIsXG4gICAgICAgICAgXCJkaXJlY3RSYWRpYXRpb25cIixcbiAgICAgICAgICBcImRpZmZ1c2VSYWRpYXRpb25cIixcbiAgICAgICAgICBcImlycmFkaWFuY2VEaXJlY3ROb3JtYWxcIixcbiAgICAgICAgICBcInNpZ25pZmljYW50V2F2ZUhlaWdodFwiLFxuICAgICAgICAgIFwibWVhbldhdmVEaXJlY3Rpb25cIixcbiAgICAgICAgICBcIm1lYW5XYXZlUGVyaW9kXCIsXG4gICAgICAgICAgXCJ3aW5kV2F2ZUhlaWdodFwiLFxuICAgICAgICAgIFwid2luZFdhdmVEaXJlY3Rpb25cIixcbiAgICAgICAgICBcIndpbmRXYXZlUGVyaW9kXCIsXG4gICAgICAgICAgXCJzd2VsbFNpZ25pZmljYW50SGVpZ2h0XCIsXG4gICAgICAgICAgXCJzd2VsbE1lYW5EaXJlY3Rpb25cIixcbiAgICAgICAgICBcInN3ZWxsTWVhblBlcmlvZFwiLFxuICAgICAgICAgIFwiY3VycmVudFZlbG9jaXR5XCIsXG4gICAgICAgICAgXCJjdXJyZW50RGlyZWN0aW9uXCIsXG4gICAgICAgICAgXCJzZWFTdXJmYWNlVGVtcGVyYXR1cmVcIixcbiAgICAgICAgXTtcblxuICAgICAgICBmaWVsZHMuZm9yRWFjaCgoZmllbGQpID0+IHtcbiAgICAgICAgICBjb25zdCBkYXRhID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgICAgYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmhvdXJseS4ke2ZpZWxkfS4ke2l9YCxcbiAgICAgICAgICApO1xuICAgICAgICAgIGlmIChkYXRhICYmIGRhdGEudmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZm9yZWNhc3REYXRhW2ZpZWxkXSA9IGRhdGEudmFsdWU7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoT2JqZWN0LmtleXMoZm9yZWNhc3REYXRhKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKCk7XG4gICAgICAgICAgZGF0ZS5zZXRIb3VycyhkYXRlLmdldEhvdXJzKCkgKyBpKTtcbiAgICAgICAgICBmb3JlY2FzdERhdGEudGltZXN0YW1wID0gZGF0ZS50b0lTT1N0cmluZygpO1xuXG4gICAgICAgICAgLy8gTG9vayB1cCBzdW5yaXNlL3N1bnNldCBmb3IgdGhpcyBmb3JlY2FzdCdzIGRhdGVcbiAgICAgICAgICBjb25zdCBkYXRlS2V5ID0gZGF0ZS50b0lTT1N0cmluZygpLnN1YnN0cmluZygwLCAxMCk7IC8vIFlZWVktTU0tRERcbiAgICAgICAgICBjb25zdCBzdW5EYXRhID0gc3VuVGltZXMuZ2V0KGRhdGVLZXkpO1xuICAgICAgICAgIGlmIChzdW5EYXRhKSB7XG4gICAgICAgICAgICBmb3JlY2FzdERhdGEuc3VucmlzZSA9IHN1bkRhdGEuc3VucmlzZTtcbiAgICAgICAgICAgIGZvcmVjYXN0RGF0YS5zdW5zZXQgPSBzdW5EYXRhLnN1bnNldDtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBBZGQgVVRDIG9mZnNldCBmb3IgdGltZXpvbmUgY29udmVyc2lvbiBpbiBkYXkvbmlnaHQgY2FsY3VsYXRpb25cbiAgICAgICAgICBpZiAodXRjT2Zmc2V0U2Vjb25kcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3JlY2FzdERhdGEudXRjT2Zmc2V0U2Vjb25kcyA9IHV0Y09mZnNldFNlY29uZHM7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZm9yZWNhc3RzLnB1c2goY29udmVydFRvV2VhdGhlckFQSUZvcmVjYXN0KGZvcmVjYXN0RGF0YSwgXCJwb2ludFwiKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXBwLmVycm9yKFxuICAgICAgICBgRXJyb3IgcmVhZGluZyBob3VybHkgZm9yZWNhc3RzOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9yZWNhc3RzO1xuICB9O1xuXG4gIC8vIEdldCBkYWlseSBmb3JlY2FzdHMgZnJvbSBTaWduYWxLIHRyZWUgKHVzaW5nIFNpZ25hbEstYWxpZ25lZCBmaWVsZCBuYW1lcylcbiAgY29uc3QgZ2V0RGFpbHlGb3JlY2FzdHMgPSAobWF4Q291bnQ6IG51bWJlcik6IFdlYXRoZXJEYXRhW10gPT4ge1xuICAgIGNvbnN0IGZvcmVjYXN0czogV2VhdGhlckRhdGFbXSA9IFtdO1xuXG4gICAgdHJ5IHtcbiAgICAgIGxldCBmb3JlY2FzdENvdW50ID0gMDtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbWF4Q291bnQgKyAyOyBpKyspIHtcbiAgICAgICAgY29uc3QgdGVtcCA9IGFwcC5nZXRTZWxmUGF0aChcbiAgICAgICAgICBgZW52aXJvbm1lbnQub3V0c2lkZS5vcGVubWV0ZW8uZm9yZWNhc3QuZGFpbHkuYWlyVGVtcEhpZ2guJHtpfWAsXG4gICAgICAgICk7XG4gICAgICAgIGlmICh0ZW1wICYmIHRlbXAudmFsdWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGZvcmVjYXN0Q291bnQgPSBpICsgMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBhY3R1YWxDb3VudCA9IE1hdGgubWluKGZvcmVjYXN0Q291bnQsIG1heENvdW50KTtcblxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBhY3R1YWxDb3VudDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGZvcmVjYXN0RGF0YTogYW55ID0ge307XG4gICAgICAgIC8vIFVzZSBTaWduYWxLLWFsaWduZWQgZmllbGQgbmFtZXMgKHRyYW5zbGF0ZWQgbmFtZXMpXG4gICAgICAgIGNvbnN0IGZpZWxkcyA9IFtcbiAgICAgICAgICBcIndlYXRoZXJDb2RlXCIsXG4gICAgICAgICAgXCJhaXJUZW1wSGlnaFwiLFxuICAgICAgICAgIFwiYWlyVGVtcExvd1wiLFxuICAgICAgICAgIFwiZmVlbHNMaWtlSGlnaFwiLFxuICAgICAgICAgIFwiZmVlbHNMaWtlTG93XCIsXG4gICAgICAgICAgXCJzdW5yaXNlXCIsXG4gICAgICAgICAgXCJzdW5zZXRcIixcbiAgICAgICAgICBcInN1bnNoaW5lRHVyYXRpb25cIixcbiAgICAgICAgICBcInV2SW5kZXhNYXhcIixcbiAgICAgICAgICBcInByZWNpcFN1bVwiLFxuICAgICAgICAgIFwicHJlY2lwUHJvYmFiaWxpdHlNYXhcIixcbiAgICAgICAgICBcIndpbmRBdmdNYXhcIixcbiAgICAgICAgICBcIndpbmRHdXN0TWF4XCIsXG4gICAgICAgICAgXCJ3aW5kRGlyZWN0aW9uRG9taW5hbnRcIixcbiAgICAgICAgICBcInNpZ25pZmljYW50V2F2ZUhlaWdodE1heFwiLFxuICAgICAgICAgIFwibWVhbldhdmVEaXJlY3Rpb25Eb21pbmFudFwiLFxuICAgICAgICAgIFwibWVhbldhdmVQZXJpb2RNYXhcIixcbiAgICAgICAgICBcInN3ZWxsU2lnbmlmaWNhbnRIZWlnaHRNYXhcIixcbiAgICAgICAgICBcInN3ZWxsTWVhbkRpcmVjdGlvbkRvbWluYW50XCIsXG4gICAgICAgICAgXCJzd2VsbE1lYW5QZXJpb2RNYXhcIixcbiAgICAgICAgXTtcblxuICAgICAgICBmaWVsZHMuZm9yRWFjaCgoZmllbGQpID0+IHtcbiAgICAgICAgICBjb25zdCBkYXRhID0gYXBwLmdldFNlbGZQYXRoKFxuICAgICAgICAgICAgYGVudmlyb25tZW50Lm91dHNpZGUub3Blbm1ldGVvLmZvcmVjYXN0LmRhaWx5LiR7ZmllbGR9LiR7aX1gLFxuICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKGRhdGEgJiYgZGF0YS52YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3JlY2FzdERhdGFbZmllbGRdID0gZGF0YS52YWx1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChPYmplY3Qua2V5cyhmb3JlY2FzdERhdGEpLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoKTtcbiAgICAgICAgICBkYXRlLnNldERhdGUoZGF0ZS5nZXREYXRlKCkgKyBpKTtcbiAgICAgICAgICBmb3JlY2FzdERhdGEuZGF0ZSA9IGRhdGUudG9JU09TdHJpbmcoKS5zcGxpdChcIlRcIilbMF07XG4gICAgICAgICAgZm9yZWNhc3RzLnB1c2goY29udmVydFRvV2VhdGhlckFQSUZvcmVjYXN0KGZvcmVjYXN0RGF0YSwgXCJkYWlseVwiKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXBwLmVycm9yKFxuICAgICAgICBgRXJyb3IgcmVhZGluZyBkYWlseSBmb3JlY2FzdHM6ICR7ZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpfWAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JlY2FzdHM7XG4gIH07XG5cbiAgLy8gV2VhdGhlciBBUEkgcHJvdmlkZXJcbiAgY29uc3Qgd2VhdGhlclByb3ZpZGVyOiBXZWF0aGVyUHJvdmlkZXIgPSB7XG4gICAgbmFtZTogXCJPcGVubWV0ZW8gV2VhdGhlclwiLFxuICAgIG1ldGhvZHM6IHtcbiAgICAgIHBsdWdpbklkOiBwbHVnaW4uaWQsXG4gICAgICBnZXRPYnNlcnZhdGlvbnM6IGFzeW5jIChcbiAgICAgICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgICAgICBvcHRpb25zPzogV2VhdGhlclJlcVBhcmFtcyxcbiAgICAgICk6IFByb21pc2U8V2VhdGhlckRhdGFbXT4gPT4ge1xuICAgICAgICAvLyBSZXR1cm4gY3VycmVudCBjb25kaXRpb25zIGFzIG9ic2VydmF0aW9uXG4gICAgICAgIGNvbnN0IGZvcmVjYXN0cyA9IGdldEhvdXJseUZvcmVjYXN0cygxKTtcbiAgICAgICAgaWYgKGZvcmVjYXN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgZm9yZWNhc3RzWzBdLnR5cGUgPSBcIm9ic2VydmF0aW9uXCI7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZvcmVjYXN0cztcbiAgICAgIH0sXG4gICAgICBnZXRGb3JlY2FzdHM6IGFzeW5jIChcbiAgICAgICAgcG9zaXRpb246IFBvc2l0aW9uLFxuICAgICAgICB0eXBlOiBXZWF0aGVyRm9yZWNhc3RUeXBlLFxuICAgICAgICBvcHRpb25zPzogV2VhdGhlclJlcVBhcmFtcyxcbiAgICAgICk6IFByb21pc2U8V2VhdGhlckRhdGFbXT4gPT4ge1xuICAgICAgICBjb25zdCBtYXhDb3VudCA9IG9wdGlvbnM/Lm1heENvdW50IHx8ICh0eXBlID09PSBcImRhaWx5XCIgPyA3IDogNzIpO1xuXG4gICAgICAgIGlmICh0eXBlID09PSBcImRhaWx5XCIpIHtcbiAgICAgICAgICByZXR1cm4gZ2V0RGFpbHlGb3JlY2FzdHMobWF4Q291bnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBnZXRIb3VybHlGb3JlY2FzdHMobWF4Q291bnQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgZ2V0V2FybmluZ3M6IGFzeW5jIChwb3NpdGlvbjogUG9zaXRpb24pOiBQcm9taXNlPFdlYXRoZXJXYXJuaW5nW10+ID0+IHtcbiAgICAgICAgLy8gT3Blbi1NZXRlbyBkb2Vzbid0IHByb3ZpZGUgd2VhdGhlciB3YXJuaW5nc1xuICAgICAgICByZXR1cm4gW107XG4gICAgICB9LFxuICAgIH0sXG4gIH07XG5cbiAgLy8gU2V0dXAgcG9zaXRpb24gc3Vic2NyaXB0aW9uXG4gIGNvbnN0IHNldHVwUG9zaXRpb25TdWJzY3JpcHRpb24gPSAoY29uZmlnOiBQbHVnaW5Db25maWcpID0+IHtcbiAgICBpZiAoIWNvbmZpZy5lbmFibGVQb3NpdGlvblN1YnNjcmlwdGlvbikge1xuICAgICAgYXBwLmRlYnVnKFwiUG9zaXRpb24gc3Vic2NyaXB0aW9uIGRpc2FibGVkXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGFwcC5kZWJ1ZyhcIlNldHRpbmcgdXAgcG9zaXRpb24gc3Vic2NyaXB0aW9uXCIpO1xuXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uOiBTdWJzY3JpcHRpb25SZXF1ZXN0ID0ge1xuICAgICAgY29udGV4dDogXCJ2ZXNzZWxzLnNlbGZcIixcbiAgICAgIHN1YnNjcmliZTogW1xuICAgICAgICB7IHBhdGg6IFwibmF2aWdhdGlvbi5wb3NpdGlvblwiLCBwZXJpb2Q6IDYwMDAwIH0sXG4gICAgICAgIHsgcGF0aDogXCJuYXZpZ2F0aW9uLmNvdXJzZU92ZXJHcm91bmRUcnVlXCIsIHBlcmlvZDogNjAwMDAgfSxcbiAgICAgICAgeyBwYXRoOiBcIm5hdmlnYXRpb24uc3BlZWRPdmVyR3JvdW5kXCIsIHBlcmlvZDogNjAwMDAgfSxcbiAgICAgIF0sXG4gICAgfTtcblxuICAgIGFwcC5zdWJzY3JpcHRpb25tYW5hZ2VyLnN1YnNjcmliZShcbiAgICAgIHN1YnNjcmlwdGlvbixcbiAgICAgIHN0YXRlLm5hdmlnYXRpb25TdWJzY3JpcHRpb25zLFxuICAgICAgKGVycikgPT4ge1xuICAgICAgICBhcHAuZXJyb3IoYE5hdmlnYXRpb24gc3Vic2NyaXB0aW9uIGVycm9yOiAke2Vycn1gKTtcbiAgICAgIH0sXG4gICAgICAoZGVsdGEpID0+IHtcbiAgICAgICAgZGVsdGEudXBkYXRlcz8uZm9yRWFjaCgodXBkYXRlKSA9PiB7XG4gICAgICAgICAgdXBkYXRlLnZhbHVlcz8uZm9yRWFjaCgodikgPT4ge1xuICAgICAgICAgICAgaWYgKHYucGF0aCA9PT0gXCJuYXZpZ2F0aW9uLnBvc2l0aW9uXCIgJiYgdi52YWx1ZSkge1xuICAgICAgICAgICAgICBjb25zdCBwb3MgPSB2LnZhbHVlIGFzIHsgbGF0aXR1ZGU6IG51bWJlcjsgbG9uZ2l0dWRlOiBudW1iZXIgfTtcbiAgICAgICAgICAgICAgaWYgKHBvcy5sYXRpdHVkZSAmJiBwb3MubG9uZ2l0dWRlKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmV3UG9zaXRpb246IFBvc2l0aW9uID0ge1xuICAgICAgICAgICAgICAgICAgbGF0aXR1ZGU6IHBvcy5sYXRpdHVkZSxcbiAgICAgICAgICAgICAgICAgIGxvbmdpdHVkZTogcG9zLmxvbmdpdHVkZSxcbiAgICAgICAgICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKSxcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgaWYgKCFzdGF0ZS5jdXJyZW50UG9zaXRpb24pIHtcbiAgICAgICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRQb3NpdGlvbiA9IG5ld1Bvc2l0aW9uO1xuICAgICAgICAgICAgICAgICAgYXBwLmRlYnVnKFxuICAgICAgICAgICAgICAgICAgICBgSW5pdGlhbCBwb3NpdGlvbjogJHtwb3MubGF0aXR1ZGV9LCAke3Bvcy5sb25naXR1ZGV9YCxcbiAgICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgICAgICAvLyBUcmlnZ2VyIGluaXRpYWwgZm9yZWNhc3QgZmV0Y2ggKHVzZSBtb3ZpbmcgdmVzc2VsIGlmIGFwcHJvcHJpYXRlKVxuICAgICAgICAgICAgICAgICAgaWYgKHN0YXRlLmN1cnJlbnRDb25maWcpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRTT0cgJiZcbiAgICAgICAgICAgICAgICAgICAgICBpc1Zlc3NlbE1vdmluZyhzdGF0ZS5jdXJyZW50U09HLCBzdGF0ZS5jdXJyZW50Q29uZmlnLm1vdmluZ1NwZWVkVGhyZXNob2xkKSAmJlxuICAgICAgICAgICAgICAgICAgICAgIHN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZFxuICAgICAgICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICAgICAgICBmZXRjaEZvcmVjYXN0Rm9yTW92aW5nVmVzc2VsKHN0YXRlLmN1cnJlbnRDb25maWcpO1xuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgIGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhzdGF0ZS5jdXJyZW50Q29uZmlnKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50UG9zaXRpb24gPSBuZXdQb3NpdGlvbjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSBpZiAodi5wYXRoID09PSBcIm5hdmlnYXRpb24uY291cnNlT3Zlckdyb3VuZFRydWVcIiAmJiB2LnZhbHVlICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgIHN0YXRlLmN1cnJlbnRIZWFkaW5nID0gdi52YWx1ZSBhcyBudW1iZXI7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHYucGF0aCA9PT0gXCJuYXZpZ2F0aW9uLnNwZWVkT3Zlckdyb3VuZFwiICYmIHYudmFsdWUgIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgc3RhdGUuY3VycmVudFNPRyA9IHYudmFsdWUgYXMgbnVtYmVyO1xuXG4gICAgICAgICAgICAgIC8vIEF1dG8tZW5nYWdlIG1vdmluZyBmb3JlY2FzdCBpZiBlbmFibGVkIGFuZCBzcGVlZCBleGNlZWRzIHRocmVzaG9sZFxuICAgICAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAgICAgc3RhdGUuY3VycmVudENvbmZpZz8uZW5hYmxlQXV0b01vdmluZ0ZvcmVjYXN0ICYmXG4gICAgICAgICAgICAgICAgaXNWZXNzZWxNb3ZpbmcoXG4gICAgICAgICAgICAgICAgICBzdGF0ZS5jdXJyZW50U09HLFxuICAgICAgICAgICAgICAgICAgc3RhdGUuY3VycmVudENvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZCxcbiAgICAgICAgICAgICAgICApICYmXG4gICAgICAgICAgICAgICAgIXN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZFxuICAgICAgICAgICAgICApIHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5tb3ZpbmdGb3JlY2FzdEVuZ2FnZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGFwcC5kZWJ1ZyhcbiAgICAgICAgICAgICAgICAgIGBBdXRvLWVuYWJsZWQgbW92aW5nIGZvcmVjYXN0IGR1ZSB0byB2ZXNzZWwgbW92ZW1lbnQgZXhjZWVkaW5nICR7c3RhdGUuY3VycmVudENvbmZpZy5tb3ZpbmdTcGVlZFRocmVzaG9sZH0ga25vdHNgLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICk7XG4gIH07XG5cbiAgLy8gUGx1Z2luIHN0YXJ0XG4gIHBsdWdpbi5zdGFydCA9IChvcHRpb25zOiBQYXJ0aWFsPFBsdWdpbkNvbmZpZz4pID0+IHtcbiAgICBjb25zdCBjb25maWc6IFBsdWdpbkNvbmZpZyA9IHtcbiAgICAgIGFwaUtleTogb3B0aW9ucy5hcGlLZXkgfHwgXCJcIixcbiAgICAgIGZvcmVjYXN0SW50ZXJ2YWw6IG9wdGlvbnMuZm9yZWNhc3RJbnRlcnZhbCB8fCA2MCxcbiAgICAgIGFsdGl0dWRlOiBvcHRpb25zLmFsdGl0dWRlIHx8IDIsXG4gICAgICBlbmFibGVQb3NpdGlvblN1YnNjcmlwdGlvbjogb3B0aW9ucy5lbmFibGVQb3NpdGlvblN1YnNjcmlwdGlvbiAhPT0gZmFsc2UsXG4gICAgICBtYXhGb3JlY2FzdEhvdXJzOiBvcHRpb25zLm1heEZvcmVjYXN0SG91cnMgfHwgNzIsXG4gICAgICBtYXhGb3JlY2FzdERheXM6IG9wdGlvbnMubWF4Rm9yZWNhc3REYXlzIHx8IDcsXG4gICAgICBlbmFibGVIb3VybHlXZWF0aGVyOiBvcHRpb25zLmVuYWJsZUhvdXJseVdlYXRoZXIgIT09IGZhbHNlLFxuICAgICAgZW5hYmxlRGFpbHlXZWF0aGVyOiBvcHRpb25zLmVuYWJsZURhaWx5V2VhdGhlciAhPT0gZmFsc2UsXG4gICAgICBlbmFibGVNYXJpbmVIb3VybHk6IG9wdGlvbnMuZW5hYmxlTWFyaW5lSG91cmx5ICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZU1hcmluZURhaWx5OiBvcHRpb25zLmVuYWJsZU1hcmluZURhaWx5ICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZUN1cnJlbnRDb25kaXRpb25zOiBvcHRpb25zLmVuYWJsZUN1cnJlbnRDb25kaXRpb25zICE9PSBmYWxzZSxcbiAgICAgIGVuYWJsZUF1dG9Nb3ZpbmdGb3JlY2FzdDogb3B0aW9ucy5lbmFibGVBdXRvTW92aW5nRm9yZWNhc3QgfHwgZmFsc2UsXG4gICAgICBtb3ZpbmdTcGVlZFRocmVzaG9sZDogb3B0aW9ucy5tb3ZpbmdTcGVlZFRocmVzaG9sZCB8fCAxLjAsXG4gICAgfTtcblxuICAgIHN0YXRlLmN1cnJlbnRDb25maWcgPSBjb25maWc7XG5cbiAgICBhcHAuZGVidWcoXCJTdGFydGluZyBPcGVuLU1ldGVvIHBsdWdpblwiKTtcbiAgICBhcHAuc2V0UGx1Z2luU3RhdHVzKFwiSW5pdGlhbGl6aW5nLi4uXCIpO1xuXG4gICAgLy8gUmVnaXN0ZXIgYXMgV2VhdGhlciBBUEkgcHJvdmlkZXJcbiAgICB0cnkge1xuICAgICAgYXBwLnJlZ2lzdGVyV2VhdGhlclByb3ZpZGVyKHdlYXRoZXJQcm92aWRlcik7XG4gICAgICBhcHAuZGVidWcoXCJTdWNjZXNzZnVsbHkgcmVnaXN0ZXJlZCBhcyBXZWF0aGVyIEFQSSBwcm92aWRlclwiKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgYXBwLmVycm9yKFxuICAgICAgICBgRmFpbGVkIHRvIHJlZ2lzdGVyIFdlYXRoZXIgQVBJIHByb3ZpZGVyOiAke2Vycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKX1gLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBTZXR1cCBwb3NpdGlvbiBzdWJzY3JpcHRpb25cbiAgICBzZXR1cFBvc2l0aW9uU3Vic2NyaXB0aW9uKGNvbmZpZyk7XG5cbiAgICAvLyBIZWxwZXIgdG8gZGV0ZXJtaW5lIHdoaWNoIGZldGNoIGZ1bmN0aW9uIHRvIHVzZVxuICAgIGNvbnN0IGRvRm9yZWNhc3RGZXRjaCA9IGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChcbiAgICAgICAgc3RhdGUuY3VycmVudFNPRyAmJlxuICAgICAgICBpc1Zlc3NlbE1vdmluZyhzdGF0ZS5jdXJyZW50U09HLCBjb25maWcubW92aW5nU3BlZWRUaHJlc2hvbGQpICYmXG4gICAgICAgIHN0YXRlLm1vdmluZ0ZvcmVjYXN0RW5nYWdlZFxuICAgICAgKSB7XG4gICAgICAgIGFwcC5kZWJ1ZyhcIlVzaW5nIHBvc2l0aW9uLXNwZWNpZmljIGZvcmVjYXN0aW5nIGZvciBtb3ZpbmcgdmVzc2VsXCIpO1xuICAgICAgICBhd2FpdCBmZXRjaEZvcmVjYXN0Rm9yTW92aW5nVmVzc2VsKGNvbmZpZyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhcHAuZGVidWcoXCJVc2luZyBzdGFuZGFyZCBmb3JlY2FzdGluZyBmb3Igc3RhdGlvbmFyeSB2ZXNzZWxcIik7XG4gICAgICAgIGF3YWl0IGZldGNoQW5kUHVibGlzaEZvcmVjYXN0cyhjb25maWcpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBTZXR1cCBmb3JlY2FzdCBpbnRlcnZhbFxuICAgIGNvbnN0IGludGVydmFsTXMgPSBjb25maWcuZm9yZWNhc3RJbnRlcnZhbCAqIDYwICogMTAwMDtcbiAgICBzdGF0ZS5mb3JlY2FzdEludGVydmFsID0gc2V0SW50ZXJ2YWwoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHN0YXRlLmZvcmVjYXN0RW5hYmxlZCAmJiBzdGF0ZS5jdXJyZW50UG9zaXRpb24pIHtcbiAgICAgICAgYXdhaXQgZG9Gb3JlY2FzdEZldGNoKCk7XG4gICAgICB9XG4gICAgfSwgaW50ZXJ2YWxNcyk7XG5cbiAgICAvLyBJbml0aWFsIGZldGNoIGlmIHBvc2l0aW9uIGlzIGF2YWlsYWJsZVxuICAgIHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHN0YXRlLmN1cnJlbnRQb3NpdGlvbikge1xuICAgICAgICBhd2FpdCBkb0ZvcmVjYXN0RmV0Y2goKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGFwcC5kZWJ1ZyhcIk5vIHBvc2l0aW9uIGF2YWlsYWJsZSB5ZXQsIHdhaXRpbmcgZm9yIHBvc2l0aW9uIHN1YnNjcmlwdGlvblwiKTtcbiAgICAgICAgYXBwLnNldFBsdWdpblN0YXR1cyhcIldhaXRpbmcgZm9yIHBvc2l0aW9uLi4uXCIpO1xuICAgICAgfVxuICAgIH0sIDEwMDApO1xuICB9O1xuXG4gIC8vIFBsdWdpbiBzdG9wXG4gIHBsdWdpbi5zdG9wID0gKCkgPT4ge1xuICAgIGFwcC5kZWJ1ZyhcIlN0b3BwaW5nIE9wZW4tTWV0ZW8gcGx1Z2luXCIpO1xuXG4gICAgLy8gQ2xlYXIgZm9yZWNhc3QgaW50ZXJ2YWxcbiAgICBpZiAoc3RhdGUuZm9yZWNhc3RJbnRlcnZhbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbChzdGF0ZS5mb3JlY2FzdEludGVydmFsKTtcbiAgICAgIHN0YXRlLmZvcmVjYXN0SW50ZXJ2YWwgPSBudWxsO1xuICAgIH1cblxuICAgIC8vIFVuc3Vic2NyaWJlIGZyb20gbmF2aWdhdGlvblxuICAgIHN0YXRlLm5hdmlnYXRpb25TdWJzY3JpcHRpb25zLmZvckVhY2goKHVuc3ViKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICB1bnN1YigpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBJZ25vcmUgdW5zdWJzY3JpYmUgZXJyb3JzXG4gICAgICB9XG4gICAgfSk7XG4gICAgc3RhdGUubmF2aWdhdGlvblN1YnNjcmlwdGlvbnMgPSBbXTtcblxuICAgIC8vIFJlc2V0IHN0YXRlXG4gICAgc3RhdGUuY3VycmVudFBvc2l0aW9uID0gbnVsbDtcbiAgICBzdGF0ZS5jdXJyZW50SGVhZGluZyA9IG51bGw7XG4gICAgc3RhdGUuY3VycmVudFNPRyA9IG51bGw7XG4gICAgc3RhdGUubGFzdEZvcmVjYXN0VXBkYXRlID0gMDtcbiAgICBzdGF0ZS5tb3ZpbmdGb3JlY2FzdEVuZ2FnZWQgPSBmYWxzZTtcblxuICAgIGFwcC5zZXRQbHVnaW5TdGF0dXMoXCJTdG9wcGVkXCIpO1xuICB9O1xuXG4gIHJldHVybiBwbHVnaW47XG59O1xuIl19