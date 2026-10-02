import type { WeatherIconName } from '@/components/ui';
import type { IssueSeverity } from './types';

/** The weather choices. The label is what is filed, so the web app shows the same words. */
export const WEATHER: { label: string; icon: WeatherIconName }[] = [
  { label: 'Sunny', icon: 'weather-sunny' },
  { label: 'Cloudy', icon: 'weather-cloudy' },
  { label: 'Rain', icon: 'weather-rainy' },
  { label: 'Heavy rain', icon: 'weather-pouring' },
  { label: 'Windy', icon: 'weather-windy' },
];

export function weatherIcon(label: string | undefined): WeatherIconName {
  return WEATHER.find((w) => w.label.toLowerCase() === label?.toLowerCase())?.icon ?? 'weather-partly-cloudy';
}

/** The trades most sites log every day; anything else can be typed. */
export const TRADES = ['Mason', 'Carpenter', 'Bar bender', 'Electrician', 'Plumber', 'Helper', 'Painter', 'Welder', 'Supervisor'];

export const SEVERITY: { value: IssueSeverity; label: string; tone: 'good' | 'warning' | 'critical' }[] = [
  { value: 'low', label: 'Low', tone: 'good' },
  { value: 'medium', label: 'Medium', tone: 'warning' },
  { value: 'high', label: 'High', tone: 'critical' },
];

export function severityTone(s: IssueSeverity): 'good' | 'warning' | 'critical' {
  return SEVERITY.find((x) => x.value === s)?.tone ?? 'warning';
}

export function severityLabel(s: IssueSeverity): string {
  return SEVERITY.find((x) => x.value === s)?.label ?? s;
}
