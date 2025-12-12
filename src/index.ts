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
  const getWeatherIcon = (
    wmoCode: number | undefined,
    isDay: boolean | number | undefined,
  ): string | undefined => {
    if (wmoCode === undefined) return undefined;
    const dayNight = isDay === true || isDay === 1 ? "day" : "night";
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
  const celsiusToKelvin = (celsius: number): number => celsius + 273.15;
  const hPaToPA = (hPa: number): number => hPa * 100;
  const mmToM = (mm: number): number => mm / 1000;
  const cmToM = (cm: number): number => cm / 100;
  const kmToM = (km: number): number => km * 1000;
  const kmhToMs = (kmh: number): number => kmh / 3.6;
  const percentToRatio = (percent: number): number => percent / 100;

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

  // Get source label for SignalK
  const getSourceLabel = (dataType: string): string => {
    return `open-meteo.${dataType}`;
  };

  // Get parameter metadata for SignalK
  const getParameterMetadata = (parameterName: string): any => {
    const metadataMap: Record<string, any> = {
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
    } else if (parameterName.includes("speed") || parameterName.includes("velocity")) {
      units = "m/s";
      description = "Speed forecast";
    } else if (parameterName.includes("pressure")) {
      units = "Pa";
      description = "Pressure forecast";
    } else if (parameterName.includes("humidity")) {
      units = "ratio";
      description = "Humidity forecast (0-1)";
    } else if (parameterName.includes("precipitation") && !parameterName.includes("probability") && !parameterName.includes("hours")) {
      units = "m";
      description = "Precipitation forecast";
    } else if (parameterName.includes("probability")) {
      units = "ratio";
      description = "Probability forecast (0-1)";
    } else if (parameterName.includes("direction")) {
      units = "rad";
      description = "Direction forecast";
    } else if (parameterName.includes("visibility")) {
      units = "m";
      description = "Visibility forecast";
    } else if (parameterName.includes("height")) {
      units = "m";
      description = "Height forecast";
    } else if (parameterName.includes("period")) {
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

      // Process each field with unit conversions
      Object.entries(hourly).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[dataIndex];
        if (value === undefined || value === null) return;

        // Apply unit conversions
        if (field.includes("temperature") || field === "dew_point_2m" || field === "apparent_temperature") {
          forecast[field] = celsiusToKelvin(value as number);
        } else if (field.includes("direction")) {
          forecast[field] = degToRad(value as number);
        } else if (field === "precipitation" || field === "rain" || field === "showers") {
          forecast[field] = mmToM(value as number);
        } else if (field === "snowfall") {
          forecast[field] = cmToM(value as number); // Snowfall is in cm
        } else if (field.includes("pressure")) {
          forecast[field] = hPaToPA(value as number);
        } else if (field.includes("humidity") || field.includes("cloud_cover") || field === "precipitation_probability") {
          forecast[field] = percentToRatio(value as number);
        } else if (field === "visibility") {
          // Visibility is already in meters from Open-Meteo
          forecast[field] = value;
        } else {
          forecast[field] = value;
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

      // Process each field with unit conversions
      Object.entries(daily).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[i];
        if (value === undefined || value === null) return;

        // Apply unit conversions
        if (field.includes("temperature")) {
          forecast[field] = celsiusToKelvin(value as number);
        } else if (field.includes("direction")) {
          forecast[field] = degToRad(value as number);
        } else if (field === "precipitation_sum" || field === "rain_sum" || field === "showers_sum") {
          forecast[field] = mmToM(value as number);
        } else if (field === "snowfall_sum") {
          forecast[field] = cmToM(value as number);
        } else if (field === "precipitation_probability_max") {
          forecast[field] = percentToRatio(value as number);
        } else {
          forecast[field] = value;
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

      // Process each field with unit conversions
      Object.entries(hourly).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[dataIndex];
        if (value === undefined || value === null) return;

        // Apply unit conversions
        if (field === "sea_surface_temperature") {
          forecast[field] = celsiusToKelvin(value as number);
        } else if (field.includes("direction")) {
          forecast[field] = degToRad(value as number);
        } else if (field === "ocean_current_velocity") {
          forecast[field] = kmhToMs(value as number); // Current velocity is in km/h
        } else {
          // Wave heights, periods are already in meters/seconds
          forecast[field] = value;
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

      // Process each field with unit conversions
      Object.entries(daily).forEach(([field, values]) => {
        if (field === "time" || !Array.isArray(values)) return;
        const value = values[i];
        if (value === undefined || value === null) return;

        // Apply unit conversions
        if (field.includes("direction")) {
          forecast[field] = degToRad(value as number);
        } else {
          forecast[field] = value;
        }
      });

      forecasts.push(forecast);
    }

    return forecasts;
  };

  // Publish hourly forecasts for a single package (weather or marine)
  const publishHourlyPackage = async (
    forecasts: Record<string, any>[],
    packageType: string,
  ): Promise<void> => {
    const sourceLabel = getSourceLabel(`hourly-${packageType}`);

    for (let index = 0; index < forecasts.length; index++) {
      const forecast = forecasts[index];
      const values: { path: string; value: any }[] = [];
      const meta: { path: string; value: any }[] = [];

      Object.entries(forecast).forEach(([key, value]) => {
        if (key === "timestamp" || key === "relativeHour") return;
        const path = `environment.outside.openmeteo.forecast.hourly.${key}.${index}`;
        const metadata = getParameterMetadata(key);
        values.push({ path, value });
        meta.push({ path, value: metadata });
      });

      if (values.length === 0) continue;

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

      // Yield to event loop every 10 messages to prevent blocking
      if (index % 10 === 9) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

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

  // Fetch and publish all forecasts
  const fetchAndPublishForecasts = async (config: PluginConfig) => {
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
  const convertToWeatherAPIForecast = (
    forecastData: any,
    type: WeatherForecastType,
  ): WeatherData => {
    const isDaily = type === "daily";

    return {
      date: forecastData.timestamp || forecastData.date || new Date().toISOString(),
      type,
      description: getWeatherDescription(
        forecastData.weather_code,
        "Open-Meteo weather",
      ),
      longDescription: getWeatherLongDescription(
        forecastData.weather_code,
        "Open-Meteo weather forecast",
      ),
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
  const getHourlyForecasts = (maxCount: number): WeatherData[] => {
    const forecasts: WeatherData[] = [];

    try {
      // Read forecast data from SignalK tree
      let forecastCount = 0;
      for (let i = 0; i < maxCount + 10; i++) {
        const temp = app.getSelfPath(
          `environment.outside.openmeteo.forecast.hourly.temperature_2m.${i}`,
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

  // Get daily forecasts from SignalK tree
  const getDailyForecasts = (maxCount: number): WeatherData[] => {
    const forecasts: WeatherData[] = [];

    try {
      let forecastCount = 0;
      for (let i = 0; i < maxCount + 2; i++) {
        const temp = app.getSelfPath(
          `environment.outside.openmeteo.forecast.daily.temperature_2m_max.${i}`,
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
    name: "signalk-open-meteo",
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
                  // Trigger initial forecast fetch
                  if (state.currentConfig) {
                    fetchAndPublishForecasts(state.currentConfig);
                  }
                } else {
                  state.currentPosition = newPosition;
                }
              }
            } else if (v.path === "navigation.courseOverGroundTrue" && v.value !== null) {
              state.currentHeading = v.value as number;
            } else if (v.path === "navigation.speedOverGround" && v.value !== null) {
              state.currentSOG = v.value as number;
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
