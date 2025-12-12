// SignalK App and Plugin interfaces
export interface SignalKApp {
  debug: (msg: string) => void;
  error: (msg: string) => void;
  handleMessage: (pluginId: string, delta: SignalKDelta) => void;
  savePluginOptions: (
    options: Record<string, unknown>,
    callback: (err?: unknown) => void,
  ) => void;
  setProviderStatus: (msg: string) => void;
  setPluginStatus: (msg: string) => void;
  getDataDirPath: () => string;
  getSelfPath: (path: string) => any;
  subscriptionmanager: {
    subscribe: (
      subscription: SubscriptionRequest,
      unsubscribes: Array<() => void>,
      subscriptionError: (err: unknown) => void,
      dataCallback: (delta: SignalKDelta) => void,
    ) => void;
  };
  registerPutHandler: (
    context: string,
    path: string,
    handler: (
      context: string,
      path: string,
      value: unknown,
      callback?: (result: { state: string; statusCode?: number }) => void,
    ) => { state: string; statusCode?: number },
    source?: string,
  ) => void;
  registerWeatherProvider: (provider: WeatherProvider) => void;
}

export interface SignalKPlugin {
  id: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
  start: (options: Partial<PluginConfig>, restartPlugin?: () => void) => void;
  stop: () => void;
  registerWithRouter?: (router: any) => void;
  config?: PluginConfig;
}

// Plugin configuration
export interface PluginConfig {
  apiKey?: string; // Optional - Open-Meteo has free tier
  forecastInterval: number;
  altitude: number;
  enablePositionSubscription: boolean;
  maxForecastHours: number;
  maxForecastDays: number;
  // Open-Meteo Products
  enableHourlyWeather: boolean;
  enableDailyWeather: boolean;
  enableMarineHourly: boolean;
  enableMarineDaily: boolean;
  enableCurrentConditions: boolean;
  // Moving forecast settings
  enableAutoMovingForecast: boolean;
  movingSpeedThreshold: number;
}

// Plugin state
export interface PluginState {
  forecastInterval: ReturnType<typeof setInterval> | null;
  navigationSubscriptions: Array<() => void>;
  currentConfig?: PluginConfig;
  currentPosition: Position | null;
  currentHeading: number | null; // radians, true heading
  currentSOG: number | null; // m/s, speed over ground
  lastForecastUpdate: number;
  forecastEnabled: boolean;
  movingForecastEngaged: boolean;
}

// Position data
export interface Position {
  latitude: number;
  longitude: number;
  timestamp: Date;
}

// Predicted position for future forecast hours
export interface PredictedPosition extends Position {
  hour: number; // relative hour (0 = now, 1 = +1 hour, etc.)
  distanceFromCurrent: number; // nautical miles from current position
}

// Open-Meteo Weather API response types
export interface OpenMeteoWeatherResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  current_units?: OpenMeteoUnits;
  current?: OpenMeteoCurrent;
  hourly_units?: OpenMeteoUnits;
  hourly?: OpenMeteoHourlyWeather;
  daily_units?: OpenMeteoUnits;
  daily?: OpenMeteoDailyWeather;
}

// Open-Meteo Marine API response types
export interface OpenMeteoMarineResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  hourly_units?: OpenMeteoUnits;
  hourly?: OpenMeteoHourlyMarine;
  daily_units?: OpenMeteoUnits;
  daily?: OpenMeteoDailyMarine;
}

export interface OpenMeteoUnits {
  time?: string;
  [key: string]: string | undefined;
}

export interface OpenMeteoCurrent {
  time: string;
  interval: number;
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  is_day?: number;
  precipitation?: number;
  rain?: number;
  showers?: number;
  snowfall?: number;
  weather_code?: number;
  cloud_cover?: number;
  pressure_msl?: number;
  surface_pressure?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
  wind_gusts_10m?: number;
}

export interface OpenMeteoHourlyWeather {
  time: string[];
  temperature_2m?: number[];
  relative_humidity_2m?: number[];
  dew_point_2m?: number[];
  apparent_temperature?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  rain?: number[];
  showers?: number[];
  snowfall?: number[];
  snow_depth?: number[];
  weather_code?: number[];
  pressure_msl?: number[];
  surface_pressure?: number[];
  cloud_cover?: number[];
  cloud_cover_low?: number[];
  cloud_cover_mid?: number[];
  cloud_cover_high?: number[];
  visibility?: number[];
  evapotranspiration?: number[];
  et0_fao_evapotranspiration?: number[];
  vapour_pressure_deficit?: number[];
  wind_speed_10m?: number[];
  wind_speed_80m?: number[];
  wind_speed_120m?: number[];
  wind_speed_180m?: number[];
  wind_direction_10m?: number[];
  wind_direction_80m?: number[];
  wind_direction_120m?: number[];
  wind_direction_180m?: number[];
  wind_gusts_10m?: number[];
  temperature_80m?: number[];
  temperature_120m?: number[];
  temperature_180m?: number[];
  uv_index?: number[];
  uv_index_clear_sky?: number[];
  is_day?: number[];
  sunshine_duration?: number[];
  cape?: number[];
  lifted_index?: number[];
  convective_inhibition?: number[];
  // Solar radiation
  shortwave_radiation?: number[];
  direct_radiation?: number[];
  diffuse_radiation?: number[];
  direct_normal_irradiance?: number[];
  global_tilted_irradiance?: number[];
  terrestrial_radiation?: number[];
}

export interface OpenMeteoDailyWeather {
  time: string[];
  weather_code?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  apparent_temperature_max?: number[];
  apparent_temperature_min?: number[];
  sunrise?: string[];
  sunset?: string[];
  daylight_duration?: number[];
  sunshine_duration?: number[];
  uv_index_max?: number[];
  uv_index_clear_sky_max?: number[];
  precipitation_sum?: number[];
  rain_sum?: number[];
  showers_sum?: number[];
  snowfall_sum?: number[];
  precipitation_hours?: number[];
  precipitation_probability_max?: number[];
  wind_speed_10m_max?: number[];
  wind_gusts_10m_max?: number[];
  wind_direction_10m_dominant?: number[];
  shortwave_radiation_sum?: number[];
  et0_fao_evapotranspiration?: number[];
}

export interface OpenMeteoHourlyMarine {
  time: string[];
  wave_height?: number[];
  wave_direction?: number[];
  wave_period?: number[];
  wind_wave_height?: number[];
  wind_wave_direction?: number[];
  wind_wave_period?: number[];
  wind_wave_peak_period?: number[];
  swell_wave_height?: number[];
  swell_wave_direction?: number[];
  swell_wave_period?: number[];
  swell_wave_peak_period?: number[];
  ocean_current_velocity?: number[];
  ocean_current_direction?: number[];
  sea_surface_temperature?: number[];
}

export interface OpenMeteoDailyMarine {
  time: string[];
  wave_height_max?: number[];
  wave_direction_dominant?: number[];
  wave_period_max?: number[];
  wind_wave_height_max?: number[];
  wind_wave_direction_dominant?: number[];
  wind_wave_period_max?: number[];
  wind_wave_peak_period_max?: number[];
  swell_wave_height_max?: number[];
  swell_wave_direction_dominant?: number[];
  swell_wave_period_max?: number[];
  swell_wave_peak_period_max?: number[];
}

// SignalK Delta message types
export interface SignalKDelta {
  context: string;
  updates: SignalKUpdate[];
}

export interface SignalKUpdate {
  $source: string;
  timestamp: string;
  values: SignalKValue[];
  meta?: SignalKMeta[];
}

export interface SignalKMeta {
  path: string;
  value: {
    units?: string;
    displayName: string;
    description: string;
  };
}

export interface SignalKValue {
  path: string;
  value: unknown;
}

// Subscription types
export interface SubscriptionRequest {
  context: string;
  subscribe: SubscriptionItem[];
}

export interface SubscriptionItem {
  path: string;
  period?: number;
  format?: string;
  policy?: string;
  minPeriod?: number;
}

export interface SubscriptionValue {
  path: string;
  value: unknown;
  timestamp: string;
  source?: string;
}

// Weather API types
export interface WeatherProvider {
  name: string;
  methods: WeatherProviderMethods;
}

export interface WeatherProviderMethods {
  pluginId?: string;
  getObservations: (
    position: Position,
    options?: WeatherReqParams,
  ) => Promise<WeatherData[]>;
  getForecasts: (
    position: Position,
    type: WeatherForecastType,
    options?: WeatherReqParams,
  ) => Promise<WeatherData[]>;
  getWarnings: (position: Position) => Promise<WeatherWarning[]>;
}

export interface WeatherReqParams {
  maxCount?: number;
  startDate?: string;
}

export type WeatherForecastType = "daily" | "point";
export type WeatherDataType = WeatherForecastType | "observation";

export interface WeatherData {
  description?: string;
  longDescription?: string;
  icon?: string;
  date: string;
  type: WeatherDataType;
  current?: {
    drift?: number;
    set?: number;
  };
  outside?: {
    minTemperature?: number;
    maxTemperature?: number;
    feelsLikeTemperature?: number;
    precipitationVolume?: number;
    absoluteHumidity?: number;
    horizontalVisibility?: number;
    uvIndex?: number;
    cloudCover?: number;
    temperature?: number;
    dewPointTemperature?: number;
    pressure?: number;
    pressureTendency?: TendencyKind;
    relativeHumidity?: number;
    precipitationType?: PrecipitationKind;
    // Solar radiation fields
    solarRadiation?: number;
    directNormalIrradiance?: number;
    diffuseHorizontalIrradiance?: number;
    globalHorizontalIrradiance?: number;
    extraterrestrialSolarRadiation?: number;
    // Enhanced cloud data
    totalCloudCover?: number;
    lowCloudCover?: number;
    midCloudCover?: number;
    highCloudCover?: number;
    cloudBaseHeight?: number;
    cloudTopHeight?: number;
    horizontalVisibilityOverRange?: boolean;
    precipitationProbability?: number;
  };
  water?: {
    temperature?: number;
    level?: number;
    levelTendency?: TendencyKind;
    surfaceCurrentSpeed?: number;
    surfaceCurrentDirection?: number;
    salinity?: number;
    waveSignificantHeight?: number;
    wavePeriod?: number;
    waveDirection?: number;
    swellHeight?: number;
    swellPeriod?: number;
    swellDirection?: number;
    // Enhanced marine data
    seaState?: number;
    surfaceWaveHeight?: number;
    windWaveHeight?: number;
    windWavePeriod?: number;
    windWaveDirection?: number;
    swellPeakPeriod?: number;
    windWavePeakPeriod?: number;
    waveSteepness?: number;
    ice?: boolean;
  };
  wind?: {
    speedTrue?: number;
    directionTrue?: number;
    gust?: number;
    gustDirection?: number;
    averageSpeed?: number;
    gustDirectionTrue?: number;
  };
  sun?: {
    sunrise?: string;
    sunset?: string;
    sunshineDuration?: number;
    isDaylight?: boolean;
  };
}

export interface WeatherWarning {
  startTime: string;
  endTime: string;
  details: string;
  source: string;
  type: string;
}

export type TendencyKind =
  | "steady"
  | "decreasing"
  | "increasing"
  | "not available";

export type PrecipitationKind =
  | "reserved"
  | "rain"
  | "thunderstorm"
  | "freezing rain"
  | "mixed/ice"
  | "snow"
  | "reserved"
  | "not available";
