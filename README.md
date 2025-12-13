# SignalK Open-Meteo Weather Plugin

A SignalK plugin that provides position-based weather and marine forecast data from the [Open-Meteo API](https://open-meteo.com/). Compliant with the SignalK Weather API v2.

## Features

- **Weather Forecasts**: Hourly and daily weather forecasts up to 16 days
- **Marine Forecasts**: Wave height, period, direction, swell, currents, and sea surface temperature
- **Current Conditions**: Real-time weather observations
- **Position-Based**: Automatically updates forecasts based on vessel position
- **Free Tier**: No API key required for non-commercial use
- **SignalK Weather API**: Full compliance with Weather API v2 specification
- **Consistent Naming**: Follows signalk-weatherflow naming conventions for cross-plugin compatibility

## Installation

### From npm

```bash
npm install signalk-open-meteo
```

### From source

```bash
cd ~/.signalk/node_modules
git clone https://github.com/motamman/signalk-open-meteo.git
cd signalk-open-meteo
npm install
npm run build
```

Then restart SignalK server.

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| API Key | Optional API key for commercial use | (empty) |
| Forecast Update Interval | How often to fetch new data (minutes) | 60 |
| Default Altitude | Elevation correction (meters) | 2 |
| Enable Position Subscription | Auto-update on position change | true |
| Max Forecast Hours | Hourly forecasts to retrieve (1-384) | 72 |
| Max Forecast Days | Daily forecasts to retrieve (1-16) | 7 |
| Enable Hourly Weather | Fetch hourly weather data | true |
| Enable Daily Weather | Fetch daily weather data | true |
| Enable Marine Hourly | Fetch hourly marine data | true |
| Enable Marine Daily | Fetch daily marine data | true |
| Enable Current Conditions | Fetch current weather | true |

## SignalK Weather API

This plugin registers as a Weather API provider. Access forecasts via:

### List Providers

```
GET /signalk/v2/api/weather/_providers
```

### Get Forecasts

```
GET /signalk/v2/api/weather/forecasts/point?provider=signalk-open-meteo
GET /signalk/v2/api/weather/forecasts/daily?provider=signalk-open-meteo
```

### Get Observations

```
GET /signalk/v2/api/weather/observations?provider=signalk-open-meteo
```

## SignalK Data Paths

All data is published under `environment.outside.openmeteo.forecast.*` using SignalK-aligned camelCase field names (following signalk-weatherflow conventions):

### Hourly Weather Data

| Path | Description | Units |
|------|-------------|-------|
| `hourly.airTemperature.{n}` | Air temperature at 2m | K |
| `hourly.relativeHumidity.{n}` | Relative humidity | ratio (0-1) |
| `hourly.dewPoint.{n}` | Dew point temperature | K |
| `hourly.feelsLike.{n}` | Feels like temperature | K |
| `hourly.precipProbability.{n}` | Precipitation probability | ratio (0-1) |
| `hourly.precip.{n}` | Precipitation amount | m |
| `hourly.weatherCode.{n}` | WMO weather code | - |
| `hourly.seaLevelPressure.{n}` | Sea level pressure | Pa |
| `hourly.cloudCover.{n}` | Total cloud cover | ratio (0-1) |
| `hourly.lowCloudCover.{n}` | Low cloud cover | ratio (0-1) |
| `hourly.midCloudCover.{n}` | Mid cloud cover | ratio (0-1) |
| `hourly.highCloudCover.{n}` | High cloud cover | ratio (0-1) |
| `hourly.visibility.{n}` | Horizontal visibility | m |
| `hourly.windAvg.{n}` | Wind speed at 10m | m/s |
| `hourly.windDirection.{n}` | Wind direction | rad |
| `hourly.windGust.{n}` | Wind gusts | m/s |
| `hourly.uvIndex.{n}` | UV index | - |
| `hourly.isDaylight.{n}` | Day/night indicator | 0/1 |
| `hourly.sunshineDuration.{n}` | Sunshine duration | s |
| `hourly.solarRadiation.{n}` | Solar radiation | W/m2 |

### Hourly Marine Data

| Path | Description | Units |
|------|-------------|-------|
| `hourly.significantWaveHeight.{n}` | Significant wave height | m |
| `hourly.meanWaveDirection.{n}` | Wave direction | rad |
| `hourly.meanWavePeriod.{n}` | Wave period | s |
| `hourly.windWaveHeight.{n}` | Wind wave height | m |
| `hourly.windWaveDirection.{n}` | Wind wave direction | rad |
| `hourly.windWavePeriod.{n}` | Wind wave period | s |
| `hourly.swellSignificantHeight.{n}` | Swell height | m |
| `hourly.swellMeanDirection.{n}` | Swell direction | rad |
| `hourly.swellMeanPeriod.{n}` | Swell period | s |
| `hourly.currentVelocity.{n}` | Current speed | m/s |
| `hourly.currentDirection.{n}` | Current direction | rad |
| `hourly.seaSurfaceTemperature.{n}` | Sea surface temp | K |

### Daily Weather Data

| Path | Description | Units |
|------|-------------|-------|
| `daily.weatherCode.{n}` | WMO weather code | - |
| `daily.airTempHigh.{n}` | Maximum temperature | K |
| `daily.airTempLow.{n}` | Minimum temperature | K |
| `daily.feelsLikeHigh.{n}` | Max feels like | K |
| `daily.feelsLikeLow.{n}` | Min feels like | K |
| `daily.sunrise.{n}` | Sunrise time | ISO8601 |
| `daily.sunset.{n}` | Sunset time | ISO8601 |
| `daily.precipSum.{n}` | Total precipitation | m |
| `daily.precipProbabilityMax.{n}` | Max precip probability | ratio (0-1) |
| `daily.windAvgMax.{n}` | Maximum wind speed | m/s |
| `daily.windGustMax.{n}` | Maximum wind gusts | m/s |
| `daily.windDirectionDominant.{n}` | Dominant wind direction | rad |
| `daily.uvIndexMax.{n}` | Maximum UV index | - |

### Daily Marine Data

| Path | Description | Units |
|------|-------------|-------|
| `daily.significantWaveHeightMax.{n}` | Maximum wave height | m |
| `daily.meanWaveDirectionDominant.{n}` | Dominant wave direction | rad |
| `daily.meanWavePeriodMax.{n}` | Maximum wave period | s |
| `daily.swellSignificantHeightMax.{n}` | Maximum swell height | m |
| `daily.swellMeanDirectionDominant.{n}` | Dominant swell direction | rad |
| `daily.swellMeanPeriodMax.{n}` | Maximum swell period | s |

### Field Name Mapping

This plugin translates Open-Meteo API field names to SignalK-aligned camelCase names for consistency with other SignalK weather plugins:

| Open-Meteo API | SignalK Path |
|----------------|--------------|
| `temperature_2m` | `airTemperature` |
| `wind_speed_10m` | `windAvg` |
| `wind_direction_10m` | `windDirection` |
| `pressure_msl` | `seaLevelPressure` |
| `relative_humidity_2m` | `relativeHumidity` |
| `precipitation` | `precip` |
| `precipitation_probability` | `precipProbability` |
| `wave_height` | `significantWaveHeight` |
| `swell_wave_height` | `swellSignificantHeight` |
| `ocean_current_velocity` | `currentVelocity` |

## WMO Weather Codes

The `weatherCode` field uses WMO 4677 codes:

| Code | Description |
|------|-------------|
| 0 | Clear sky |
| 1 | Mainly clear |
| 2 | Partly cloudy |
| 3 | Overcast |
| 45 | Fog |
| 48 | Depositing rime fog |
| 51 | Light drizzle |
| 53 | Moderate drizzle |
| 55 | Dense drizzle |
| 56 | Light freezing drizzle |
| 57 | Dense freezing drizzle |
| 61 | Slight rain |
| 63 | Moderate rain |
| 65 | Heavy rain |
| 66 | Light freezing rain |
| 67 | Heavy freezing rain |
| 71 | Slight snow |
| 73 | Moderate snow |
| 75 | Heavy snow |
| 77 | Snow grains |
| 80 | Slight rain showers |
| 81 | Moderate rain showers |
| 82 | Violent rain showers |
| 85 | Slight snow showers |
| 86 | Heavy snow showers |
| 95 | Thunderstorm |
| 96 | Thunderstorm with slight hail |
| 99 | Thunderstorm with heavy hail |

## Unit Conversions

All data is converted to SignalK base units:

| Source | SignalK | Conversion |
|--------|---------|------------|
| Celsius | Kelvin | +273.15 |
| hPa | Pascal | ×100 |
| mm | meters | ÷1000 |
| cm (snow) | meters | ÷100 |
| km | meters | ×1000 |
| km/h | m/s | ÷3.6 |
| degrees | radians | ×π/180 |
| percent | ratio | ÷100 |

## API Rate Limits

Open-Meteo offers generous free tier:
- No API key required for non-commercial use
- No strict rate limits documented
- Commercial use requires API key

## Data Sources

Open-Meteo aggregates data from multiple weather models:
- ECMWF
- NOAA GFS
- Météo-France
- DWD ICON
- And 40+ more models

The API automatically selects the best model for your location.

## License

MIT

## Author

Maurice Tamman

## Links

- [Open-Meteo Documentation](https://open-meteo.com/en/docs)
- [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api)
- [SignalK Weather API Specification](https://signalk.org/specification/1.5.0/doc/weather_api.html)
