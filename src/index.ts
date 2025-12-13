import fetch from "node-fetch";
import {
  SignalKApp,
  SignalKPlugin,
  PluginConfig,
  PluginState,
  Position,
  OpenMeteoWeatherResponse,
  OpenMeteoMarineResponse,
  SignalKDelta,
  SubscriptionRequest,
  WeatherProvider,
  WeatherData,
  WeatherWarning,
  WeatherReqParams,
  WeatherForecastType,
} from "./types";

export = function (app: SignalKApp): SignalKPlugin {
  const plugin: SignalKPlugin = {
    id: "signalk-open-meteo",
    name: "SignalK Open-Meteo Weather",
    description: "Position-based weather and marine forecast data from Open-Meteo API",
    schema: {},
    start: () => {},
    stop: () => {},
  };

  const state: PluginState = {
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
  const wmoCodeDescriptions: Record<number, string> = {
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

  const wmoCodeLongDescriptions: Record<number, string> = {
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
  const getWeatherIcon = (
    wmoCode: number | undefined,
    isDay: boolean | number | undefined,
  ): string | undefined => {
    if (wmoCode === undefined) return undefined;
    // Default to day if isDay is undefined (e.g., daily forecasts don't have is_day field)
    const dayNight = isDay === false || isDay === 0 ? "night" : "day";
    return `wmo_${wmoCode}_${dayNight}.svg`;
  };

  const getWeatherDescription = (
    wmoCode: number | undefined,
    fallback: string,
  ): string => {
    if (wmoCode === undefined) return fallback;
    return wmoCodeDescriptions[wmoCode] || fallback;
  };

  const getWeatherLongDescription = (
    wmoCode: number | undefined,
    fallback: string,
  ): string => {
    if (wmoCode === undefined) return fallback;
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
        description:
          "Open-Meteo API key for commercial use. Leave empty for free non-commercial use.",
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
        description:
          "Subscribe to navigation.position updates for automatic forecast updates",
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
        description:
          "Automatically engage moving forecast mode when vessel speed exceeds threshold",
        default: false,
      },
      movingSpeedThreshold: {
        type: "number",
        title: "Moving Speed Threshold (knots)",
        description:
          "Minimum speed in knots to automatically engage moving forecast mode",
        default: 1.0,
        minimum: 0.1,
        maximum: 10.0,
      },
    },
  };

  // Utility functions
  const degToRad = (degrees: number): number => degrees * (Math.PI / 180);
  const radToDeg = (radians: number): number => radians * (180 / Math.PI);
  const celsiusToKelvin = (celsius: number): number => celsius + 273.15;
  const hPaToPA = (hPa: number): number => hPa * 100;
  const mmToM = (mm: number): number => mm / 1000;
  const cmToM = (cm: number): number => cm / 100;
  const kmToM = (km: number): number => km * 1000;
  const kmhToMs = (kmh: number): number => kmh / 3.6;
  const percentToRatio = (percent: number): number => percent / 100;

  // Field name translation: Open-Meteo API names → SignalK-aligned names (following signalk-weatherflow convention)
  const fieldNameMap: Record<string, string> = {
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
  const translateFieldName = (openMeteoName: string): string => {
    return fieldNameMap[openMeteoName] || openMeteoName;
  };

  // Reverse lookup: SignalK name to Open-Meteo name (for reading back from SignalK)
  const reverseFieldNameMap: Record<string, string> = Object.entries(
    fieldNameMap,
  ).reduce(
    (acc, [openMeteo, signalk]) => {
      acc[signalk] = openMeteo;
      return acc;
    },
    {} as Record<string, string>,
  );

  // Calculate future position based on current heading and speed
  const calculateFuturePosition = (
    currentPos: Position,
    headingRad: number,
    sogMps: number,
    hoursAhead: number,
  ): Position => {
    const distanceMeters = sogMps * hoursAhead * 3600;
    const earthRadius = 6371000;

    const lat1 = degToRad(currentPos.latitude);
    const lon1 = degToRad(currentPos.longitude);

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceMeters / earthRadius) +
        Math.cos(lat1) *
          Math.sin(distanceMeters / earthRadius) *
          Math.cos(headingRad),
    );

    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(headingRad) *
          Math.sin(distanceMeters / earthRadius) *
          Math.cos(lat1),
        Math.cos(distanceMeters / earthRadius) -
          Math.sin(lat1) * Math.sin(lat2),
      );

    return {
      latitude: radToDeg(lat2),
      longitude: radToDeg(lon2),
      timestamp: new Date(Date.now() + hoursAhead * 3600000),
    };
  };

  // Check if vessel is moving above threshold
  const isVesselMoving = (
    sogMps: number,
    thresholdKnots: number = 1.0,
  ): boolean => {
    const thresholdMps = thresholdKnots * 0.514444;
    return sogMps > thresholdMps;
  };

  // Build Open-Meteo Weather API URL
  const buildWeatherUrl = (
    position: Position,
    config: PluginConfig,
  ): string => {
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
  const buildMarineUrl = (
    position: Position,
    config: PluginConfig,
  ): string => {
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
  const fetchWeatherData = async (
    position: Position,
    config: PluginConfig,
  ): Promise<OpenMeteoWeatherResponse | null> => {
    const url = buildWeatherUrl(position, config);
    app.debug(`Fetching weather from: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      return (await response.json()) as OpenMeteoWeatherResponse;
    } catch (error) {
      app.error(
        `Failed to fetch weather data: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  // Fetch marine data from Open-Meteo
  const fetchMarineData = async (
    position: Position,
    config: PluginConfig,
  ): Promise<OpenMeteoMarineResponse | null> => {
    const url = buildMarineUrl(position, config);
    app.debug(`Fetching marine data from: ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      return (await response.json()) as OpenMeteoMarineResponse;
    } catch (error) {
      app.error(
        `Failed to fetch marine data: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  };

  // Get source label for SignalK (following weatherflow/meteo pattern)
  const getSourceLabel = (packageType: string): string => {
    return `openmeteo-${packageType}-api`;
  };

  // Get parameter metadata for SignalK (using SignalK-aligned field names)
  const getParameterMetadata = (parameterName: string): any => {
    const metadataMap: Record<string, any> = {
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
    } else if (parameterName.includes("wind") && (parameterName.includes("Avg") || parameterName.includes("Gust"))) {
      units = "m/s";
      description = "Wind speed forecast";
    } else if (parameterName.includes("Velocity") || parameterName.includes("velocity")) {
      units = "m/s";
      description = "Speed forecast";
    } else if (parameterName.includes("Pressure") || parameterName.includes("pressure")) {
      units = "Pa";
      description = "Pressure forecast";
    } else if (parameterName.includes("Humidity") || parameterName.includes("humidity")) {
      units = "ratio";
      description = "Humidity forecast (0-1)";
    } else if (parameterName.includes("precip") && !parameterName.includes("Probability")) {
      units = "m";
      description = "Precipitation forecast";
    } else if (parameterName.includes("Probability") || parameterName.includes("Cover")) {
      units = "ratio";
      description = "Ratio forecast (0-1)";
    } else if (parameterName.includes("Direction") || parameterName.includes("direction")) {
      units = "rad";
      description = "Direction forecast";
    } else if (parameterName.includes("visibility") || parameterName.includes("Visibility")) {
      units = "m";
      description = "Visibility forecast";
    } else if (parameterName.includes("Height") || parameterName.includes("height")) {
      units = "m";
      description = "Height forecast";
    } else if (parameterName.includes("Period") || parameterName.includes("period")) {
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
  const processHourlyWeatherForecast = (
    data: OpenMeteoWeatherResponse,
    maxHours: number,
  ): Record<string, any>[] => {
    const forecasts: Record<string, any>[] = [];
    const hourly = data.hourly;
    if (!hourly || !hourly.time) return forecasts;

    const now = new Date();
    const startIndex = hourly.time.findIndex(
      (t) => new Date(t) >= now,
    );
    if (startIndex === -1) return forecasts;

    const count = Math.min(maxHours, hourly.time.length - startIndex);

    for (let i = 0; i < count; i++) {
      const dataIndex = startIndex + i;
      const forecast: Record<string, any> = {
        timestamp: hourly.time[dataIndex],
        relativeHour: i,
      };

      // Process each field with unit conversions and translate field names
      Object.entries(hourly).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[dataIndex];
        if (value === undefined || value === null) return;

        // Translate field name to SignalK-aligned name
        const translatedField = translateFieldName(field);

        // Apply unit conversions
        if (field.includes("temperature") || field === "dew_point_2m" || field === "apparent_temperature") {
          forecast[translatedField] = celsiusToKelvin(value as number);
        } else if (field.includes("direction")) {
          forecast[translatedField] = degToRad(value as number);
        } else if (field === "precipitation" || field === "rain" || field === "showers") {
          forecast[translatedField] = mmToM(value as number);
        } else if (field === "snowfall") {
          forecast[translatedField] = cmToM(value as number); // Snowfall is in cm
        } else if (field.includes("pressure")) {
          forecast[translatedField] = hPaToPA(value as number);
        } else if (field.includes("humidity") || field.includes("cloud_cover") || field === "precipitation_probability") {
          forecast[translatedField] = percentToRatio(value as number);
        } else if (field === "visibility") {
          // Visibility is already in meters from Open-Meteo
          forecast[translatedField] = value;
        } else {
          forecast[translatedField] = value;
        }
      });

      forecasts.push(forecast);
    }

    return forecasts;
  };

  // Process daily weather forecast
  const processDailyWeatherForecast = (
    data: OpenMeteoWeatherResponse,
    maxDays: number,
  ): Record<string, any>[] => {
    const forecasts: Record<string, any>[] = [];
    const daily = data.daily;
    if (!daily || !daily.time) return forecasts;

    const count = Math.min(maxDays, daily.time.length);

    for (let i = 0; i < count; i++) {
      const forecast: Record<string, any> = {
        date: daily.time[i],
        dayIndex: i,
      };

      // Process each field with unit conversions and translate field names
      Object.entries(daily).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[i];
        if (value === undefined || value === null) return;

        // Translate field name to SignalK-aligned name
        const translatedField = translateFieldName(field);

        // Apply unit conversions
        if (field.includes("temperature")) {
          forecast[translatedField] = celsiusToKelvin(value as number);
        } else if (field.includes("direction")) {
          forecast[translatedField] = degToRad(value as number);
        } else if (field === "precipitation_sum" || field === "rain_sum" || field === "showers_sum") {
          forecast[translatedField] = mmToM(value as number);
        } else if (field === "snowfall_sum") {
          forecast[translatedField] = cmToM(value as number);
        } else if (field === "precipitation_probability_max") {
          forecast[translatedField] = percentToRatio(value as number);
        } else {
          forecast[translatedField] = value;
        }
      });

      forecasts.push(forecast);
    }

    return forecasts;
  };

  // Process hourly marine forecast
  const processHourlyMarineForecast = (
    data: OpenMeteoMarineResponse,
    maxHours: number,
  ): Record<string, any>[] => {
    const forecasts: Record<string, any>[] = [];
    const hourly = data.hourly;
    if (!hourly || !hourly.time) return forecasts;

    const now = new Date();
    const startIndex = hourly.time.findIndex(
      (t) => new Date(t) >= now,
    );
    if (startIndex === -1) return forecasts;

    const count = Math.min(maxHours, hourly.time.length - startIndex);

    for (let i = 0; i < count; i++) {
      const dataIndex = startIndex + i;
      const forecast: Record<string, any> = {
        timestamp: hourly.time[dataIndex],
        relativeHour: i,
      };

      // Process each field with unit conversions and translate field names
      Object.entries(hourly).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[dataIndex];
        if (value === undefined || value === null) return;

        // Translate field name to SignalK-aligned name
        const translatedField = translateFieldName(field);

        // Apply unit conversions
        if (field === "sea_surface_temperature") {
          forecast[translatedField] = celsiusToKelvin(value as number);
        } else if (field.includes("direction")) {
          forecast[translatedField] = degToRad(value as number);
        } else if (field === "ocean_current_velocity") {
          forecast[translatedField] = kmhToMs(value as number); // Current velocity is in km/h
        } else {
          // Wave heights, periods are already in meters/seconds
          forecast[translatedField] = value;
        }
      });

      forecasts.push(forecast);
    }

    return forecasts;
  };

  // Process daily marine forecast
  const processDailyMarineForecast = (
    data: OpenMeteoMarineResponse,
    maxDays: number,
  ): Record<string, any>[] => {
    const forecasts: Record<string, any>[] = [];
    const daily = data.daily;
    if (!daily || !daily.time) return forecasts;

    const count = Math.min(maxDays, daily.time.length);

    for (let i = 0; i < count; i++) {
      const forecast: Record<string, any> = {
        date: daily.time[i],
        dayIndex: i,
      };

      // Process each field with unit conversions and translate field names
      Object.entries(daily).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[i];
        if (value === undefined || value === null) return;

        // Translate field name to SignalK-aligned name
        const translatedField = translateFieldName(field);

        // Apply unit conversions
        if (field.includes("direction")) {
          forecast[translatedField] = degToRad(value as number);
        } else {
          forecast[translatedField] = value;
        }
      });

      forecasts.push(forecast);
    }

    return forecasts;
  };

  // Publish hourly forecasts for a single package (weather or marine)
  const publishHourlyPackage = (
    forecasts: Record<string, any>[],
    packageType: string,
  ): void => {
    const sourceLabel = getSourceLabel(`hourly-${packageType}`);

    forecasts.forEach((forecast, index) => {
      const values: { path: string; value: any }[] = [];
      const meta: { path: string; value: any }[] = [];

      Object.entries(forecast).forEach(([key, value]) => {
        if (key === "timestamp" || key === "relativeHour") return;
        const path = `environment.outside.openmeteo.forecast.hourly.${key}.${index}`;
        const metadata = getParameterMetadata(key);
        values.push({ path, value });
        meta.push({ path, value: metadata });
      });

      if (values.length === 0) return;

      const delta: SignalKDelta = {
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
  const publishDailyPackage = (
    forecasts: Record<string, any>[],
    packageType: string,
  ): void => {
    const sourceLabel = getSourceLabel(`daily-${packageType}`);

    forecasts.forEach((forecast, index) => {
      const values: { path: string; value: any }[] = [];
      const meta: { path: string; value: any }[] = [];

      Object.entries(forecast).forEach(([key, value]) => {
        if (key === "date" || key === "dayIndex") return;
        const path = `environment.outside.openmeteo.forecast.daily.${key}.${index}`;
        const metadata = getParameterMetadata(key);
        values.push({ path, value });
        meta.push({ path, value: metadata });
      });

      if (values.length === 0) return;

      const delta: SignalKDelta = {
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
  const fetchForecastForMovingVessel = async (
    config: PluginConfig,
  ): Promise<void> => {
    if (
      !state.currentPosition ||
      !state.currentHeading ||
      !state.currentSOG ||
      !isVesselMoving(state.currentSOG, config.movingSpeedThreshold) ||
      !state.movingForecastEngaged
    ) {
      app.debug(
        "Vessel not moving, missing navigation data, or moving forecast not engaged, falling back to stationary forecast",
      );
      return fetchAndPublishForecasts(config);
    }

    app.debug(
      `Vessel moving at ${(state.currentSOG * 1.943844).toFixed(1)} knots (threshold: ${config.movingSpeedThreshold} knots), heading ${radToDeg(state.currentHeading).toFixed(1)}°`,
    );
    app.debug(
      `Fetching position-specific forecasts for ${config.maxForecastHours} hours`,
    );

    // Capture validated state for use in helper functions
    const currentPosition = state.currentPosition!;
    const currentHeading = state.currentHeading!;
    const currentSOG = state.currentSOG!;

    const now = new Date();
    const currentHour = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0,
    );

    // Helper function to fetch forecast for a single hour
    const fetchHourForecast = async (hour: number): Promise<{
      hour: number;
      predictedPos: Position;
      targetTime: Date;
      weatherData: OpenMeteoWeatherResponse | null;
      marineData: OpenMeteoMarineResponse | null;
    } | null> => {
      const predictedPos = calculateFuturePosition(
        currentPosition,
        currentHeading,
        currentSOG,
        hour,
      );
      const targetTime = new Date(currentHour.getTime() + hour * 3600000);

      app.debug(
        `Hour ${hour}: Fetching weather for position ${predictedPos.latitude.toFixed(6)}, ${predictedPos.longitude.toFixed(6)}`,
      );

      try {
        const weatherData = await fetchWeatherData(predictedPos, config);
        const marineData =
          config.enableMarineHourly || config.enableMarineDaily
            ? await fetchMarineData(predictedPos, config)
            : null;

        return { hour, predictedPos, targetTime, weatherData, marineData };
      } catch (err) {
        app.debug(`Hour ${hour}: Fetch failed - ${err}`);
        return null;
      }
    };

    try {
      // Fetch forecasts in parallel batches (5 concurrent requests)
      const BATCH_SIZE = 5;
      const BATCH_DELAY_MS = 200;

      const allResults: Array<{
        hour: number;
        predictedPos: Position;
        targetTime: Date;
        weatherData: OpenMeteoWeatherResponse | null;
        marineData: OpenMeteoMarineResponse | null;
      }> = [];

      app.debug(
        `Fetching ${config.maxForecastHours} hourly forecasts in batches of ${BATCH_SIZE}`,
      );

      for (
        let batchStart = 0;
        batchStart < config.maxForecastHours;
        batchStart += BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + BATCH_SIZE,
          config.maxForecastHours,
        );
        const batchHours = Array.from(
          { length: batchEnd - batchStart },
          (_, i) => batchStart + i,
        );

        app.debug(`Fetching batch: hours ${batchStart}-${batchEnd - 1}`);

        const batchResults = await Promise.all(
          batchHours.map((hour) => fetchHourForecast(hour)),
        );

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
        const hourlyWeatherForecasts: Record<string, any>[] = [];

        allResults.forEach((result) => {
          if (result.weatherData?.hourly) {
            const hourlyData = result.weatherData.hourly;
            const targetHour = result.targetTime.getHours();

            // Find matching hour in the response
            const times = hourlyData.time || [];
            for (let i = 0; i < times.length; i++) {
              const forecastTime = new Date(times[i]);
              if (
                forecastTime.getFullYear() === result.targetTime.getFullYear() &&
                forecastTime.getMonth() === result.targetTime.getMonth() &&
                forecastTime.getDate() === result.targetTime.getDate() &&
                forecastTime.getHours() === targetHour
              ) {
                const forecast: Record<string, any> = {
                  timestamp: forecastTime.toISOString(),
                  predictedLatitude: result.predictedPos.latitude,
                  predictedLongitude: result.predictedPos.longitude,
                  vesselMoving: true,
                };

                // Extract all hourly fields for this time index
                Object.keys(hourlyData).forEach((key) => {
                  if (key !== "time") {
                    const values = (hourlyData as Record<string, any>)[key];
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
          app.debug(
            `Published ${hourlyWeatherForecasts.length} position-specific weather forecasts`,
          );
        }
      }

      // Process and publish marine hourly forecasts
      if (config.enableMarineHourly) {
        const hourlyMarineForecasts: Record<string, any>[] = [];

        allResults.forEach((result) => {
          if (result.marineData?.hourly) {
            const hourlyData = result.marineData.hourly;
            const targetHour = result.targetTime.getHours();

            const times = hourlyData.time || [];
            for (let i = 0; i < times.length; i++) {
              const forecastTime = new Date(times[i]);
              if (
                forecastTime.getFullYear() === result.targetTime.getFullYear() &&
                forecastTime.getMonth() === result.targetTime.getMonth() &&
                forecastTime.getDate() === result.targetTime.getDate() &&
                forecastTime.getHours() === targetHour
              ) {
                const forecast: Record<string, any> = {
                  timestamp: forecastTime.toISOString(),
                  predictedLatitude: result.predictedPos.latitude,
                  predictedLongitude: result.predictedPos.longitude,
                  vesselMoving: true,
                };

                Object.keys(hourlyData).forEach((key) => {
                  if (key !== "time") {
                    const values = (hourlyData as Record<string, any>)[key];
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
          app.debug(
            `Published ${hourlyMarineForecasts.length} position-specific marine forecasts`,
          );
        }
      }

      // Daily forecasts still use current position
      if (config.enableDailyWeather && allResults[0]?.weatherData) {
        const dailyWeather = processDailyWeatherForecast(
          allResults[0].weatherData,
          config.maxForecastDays,
        );
        if (dailyWeather.length > 0) {
          publishDailyPackage(dailyWeather, "weather");
        }
      }

      if (config.enableMarineDaily && allResults[0]?.marineData) {
        const dailyMarine = processDailyMarineForecast(
          allResults[0].marineData,
          config.maxForecastDays,
        );
        if (dailyMarine.length > 0) {
          publishDailyPackage(dailyMarine, "marine");
        }
      }

      state.lastForecastUpdate = Date.now();
      app.setPluginStatus("Active - Moving vessel forecasts updated");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      app.error(`Failed to fetch position-specific forecasts: ${errorMsg}`);
      app.debug("Falling back to stationary forecast");
      return fetchAndPublishForecasts(config);
    }
  };

  // Fetch and publish all forecasts
  const fetchAndPublishForecasts = async (config: PluginConfig) => {
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
  const convertToWeatherAPIForecast = (
    forecastData: any,
    type: WeatherForecastType,
  ): WeatherData => {
    return {
      date: forecastData.timestamp || forecastData.date || new Date().toISOString(),
      type,
      description: getWeatherDescription(
        forecastData.weatherCode,
        "Open-Meteo weather",
      ),
      longDescription: getWeatherLongDescription(
        forecastData.weatherCode,
        "Open-Meteo weather forecast",
      ),
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
  const getHourlyForecasts = (maxCount: number): WeatherData[] => {
    const forecasts: WeatherData[] = [];

    try {
      // Read forecast data from SignalK tree using translated field names
      let forecastCount = 0;
      for (let i = 0; i < maxCount + 10; i++) {
        const temp = app.getSelfPath(
          `environment.outside.openmeteo.forecast.hourly.airTemperature.${i}`,
        );
        if (temp && temp.value !== undefined) {
          forecastCount = i + 1;
        } else {
          break;
        }
      }

      const actualCount = Math.min(forecastCount, maxCount);

      for (let i = 0; i < actualCount; i++) {
        const forecastData: any = {};
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
          const data = app.getSelfPath(
            `environment.outside.openmeteo.forecast.hourly.${field}.${i}`,
          );
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
    } catch (error) {
      app.error(
        `Error reading hourly forecasts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return forecasts;
  };

  // Get daily forecasts from SignalK tree (using SignalK-aligned field names)
  const getDailyForecasts = (maxCount: number): WeatherData[] => {
    const forecasts: WeatherData[] = [];

    try {
      let forecastCount = 0;
      for (let i = 0; i < maxCount + 2; i++) {
        const temp = app.getSelfPath(
          `environment.outside.openmeteo.forecast.daily.airTempHigh.${i}`,
        );
        if (temp && temp.value !== undefined) {
          forecastCount = i + 1;
        } else {
          break;
        }
      }

      const actualCount = Math.min(forecastCount, maxCount);

      for (let i = 0; i < actualCount; i++) {
        const forecastData: any = {};
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
          const data = app.getSelfPath(
            `environment.outside.openmeteo.forecast.daily.${field}.${i}`,
          );
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
    } catch (error) {
      app.error(
        `Error reading daily forecasts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return forecasts;
  };

  // Weather API provider
  const weatherProvider: WeatherProvider = {
    name: "Openmeteo Weather",
    methods: {
      pluginId: plugin.id,
      getObservations: async (
        position: Position,
        options?: WeatherReqParams,
      ): Promise<WeatherData[]> => {
        // Return current conditions as observation
        const forecasts = getHourlyForecasts(1);
        if (forecasts.length > 0) {
          forecasts[0].type = "observation";
        }
        return forecasts;
      },
      getForecasts: async (
        position: Position,
        type: WeatherForecastType,
        options?: WeatherReqParams,
      ): Promise<WeatherData[]> => {
        const maxCount = options?.maxCount || (type === "daily" ? 7 : 72);

        if (type === "daily") {
          return getDailyForecasts(maxCount);
        } else {
          return getHourlyForecasts(maxCount);
        }
      },
      getWarnings: async (position: Position): Promise<WeatherWarning[]> => {
        // Open-Meteo doesn't provide weather warnings
        return [];
      },
    },
  };

  // Setup position subscription
  const setupPositionSubscription = (config: PluginConfig) => {
    if (!config.enablePositionSubscription) {
      app.debug("Position subscription disabled");
      return;
    }

    app.debug("Setting up position subscription");

    const subscription: SubscriptionRequest = {
      context: "vessels.self",
      subscribe: [
        { path: "navigation.position", period: 60000 },
        { path: "navigation.courseOverGroundTrue", period: 60000 },
        { path: "navigation.speedOverGround", period: 60000 },
      ],
    };

    app.subscriptionmanager.subscribe(
      subscription,
      state.navigationSubscriptions,
      (err) => {
        app.error(`Navigation subscription error: ${err}`);
      },
      (delta) => {
        delta.updates?.forEach((update) => {
          update.values?.forEach((v) => {
            if (v.path === "navigation.position" && v.value) {
              const pos = v.value as { latitude: number; longitude: number };
              if (pos.latitude && pos.longitude) {
                const newPosition: Position = {
                  latitude: pos.latitude,
                  longitude: pos.longitude,
                  timestamp: new Date(),
                };

                if (!state.currentPosition) {
                  state.currentPosition = newPosition;
                  app.debug(
                    `Initial position: ${pos.latitude}, ${pos.longitude}`,
                  );
                  // Trigger initial forecast fetch (use moving vessel if appropriate)
                  if (state.currentConfig) {
                    if (
                      state.currentSOG &&
                      isVesselMoving(state.currentSOG, state.currentConfig.movingSpeedThreshold) &&
                      state.movingForecastEngaged
                    ) {
                      fetchForecastForMovingVessel(state.currentConfig);
                    } else {
                      fetchAndPublishForecasts(state.currentConfig);
                    }
                  }
                } else {
                  state.currentPosition = newPosition;
                }
              }
            } else if (v.path === "navigation.courseOverGroundTrue" && v.value !== null) {
              state.currentHeading = v.value as number;
            } else if (v.path === "navigation.speedOverGround" && v.value !== null) {
              state.currentSOG = v.value as number;

              // Auto-engage moving forecast if enabled and speed exceeds threshold
              if (
                state.currentConfig?.enableAutoMovingForecast &&
                isVesselMoving(
                  state.currentSOG,
                  state.currentConfig.movingSpeedThreshold,
                ) &&
                !state.movingForecastEngaged
              ) {
                state.movingForecastEngaged = true;
                app.debug(
                  `Auto-enabled moving forecast due to vessel movement exceeding ${state.currentConfig.movingSpeedThreshold} knots`,
                );
              }
            }
          });
        });
      },
    );
  };

  // Plugin start
  plugin.start = (options: Partial<PluginConfig>) => {
    const config: PluginConfig = {
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
    } catch (error) {
      app.error(
        `Failed to register Weather API provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Setup position subscription
    setupPositionSubscription(config);

    // Helper to determine which fetch function to use
    const doForecastFetch = async () => {
      if (
        state.currentSOG &&
        isVesselMoving(state.currentSOG, config.movingSpeedThreshold) &&
        state.movingForecastEngaged
      ) {
        app.debug("Using position-specific forecasting for moving vessel");
        await fetchForecastForMovingVessel(config);
      } else {
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
      } else {
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
      } catch (e) {
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
