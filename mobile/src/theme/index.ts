/**
 * Design tokens for the site app.
 *
 * The colours are the web app's own (apps/web/src/index.css), light and dark,
 * so a project looks like the same project on a phone. The sizes are not: this
 * app is used outdoors, in sunlight, often with gloves on, so type is a step
 * larger than the web's and nothing you can press is smaller than 48 points.
 */
import { Platform, useColorScheme } from 'react-native';

export interface Palette {
  /** Screen background. */
  page: string;
  /** Cards and grouped rows. */
  surface: string;
  /** Inputs, sheets and anything that sits on a card. */
  surfaceRaised: string;
  /** Wells and empty tracks: the inside of a progress bar. */
  sunken: string;
  hairline: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  brand: string;
  brandStrong: string;
  brandSoft: string;
  /** Text and icons drawn on the brand colour. */
  brandInk: string;
  good: string;
  goodText: string;
  goodSoft: string;
  /** Amber works as a fill and is unreadable as text, hence warningText. */
  warning: string;
  warningText: string;
  warningSoft: string;
  critical: string;
  criticalText: string;
  criticalSoft: string;
  overlay: string;
}

export const light: Palette = {
  page: '#f9f9f7',
  surface: '#fcfcfb',
  surfaceRaised: '#ffffff',
  sunken: '#f2f1ed',
  hairline: '#e1e0d9',
  text: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#6f6d68',
  textInverse: '#ffffff',
  brand: 'rgb(42,120,214)',
  brandStrong: '#1c5cab',
  brandSoft: 'rgb(232,241,253)',
  brandInk: '#ffffff',
  good: 'rgb(12,163,12)',
  goodText: '#006300',
  goodSoft: 'rgba(12,163,12,0.12)',
  warning: 'rgb(250,178,25)',
  warningText: '#936503',
  warningSoft: 'rgba(250,178,25,0.18)',
  critical: 'rgb(208,59,59)',
  // A step darker than the fill so small red text still clears 4.5:1 on the page.
  criticalText: '#b42f2f',
  criticalSoft: 'rgba(208,59,59,0.12)',
  overlay: 'rgba(11,11,11,0.45)',
};

export const dark: Palette = {
  page: '#0d0d0d',
  surface: '#1a1a19',
  surfaceRaised: '#222220',
  sunken: '#141413',
  hairline: '#2c2c2a',
  text: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#898781',
  textInverse: '#0b0b0b',
  brand: 'rgb(57,135,229)',
  brandStrong: '#86b6ef',
  brandSoft: 'rgb(23,41,63)',
  brandInk: '#ffffff',
  good: 'rgb(12,163,12)',
  goodText: '#0ca30c',
  goodSoft: 'rgba(12,163,12,0.2)',
  warning: 'rgb(250,178,25)',
  warningText: 'rgb(250,178,25)',
  warningSoft: 'rgba(250,178,25,0.16)',
  critical: 'rgb(208,59,59)',
  criticalText: '#e66767',
  criticalSoft: 'rgba(208,59,59,0.22)',
  overlay: 'rgba(0,0,0,0.6)',
};

/** 4-point spacing scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** The smallest thing a gloved thumb can reliably hit. */
export const TOUCH = 48;

export const type = {
  display: { fontSize: 40, lineHeight: 46, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
};

export type TypeVariant = keyof typeof type;

export const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export interface Theme {
  isDark: boolean;
  colors: Palette;
}

export function useTheme(): Theme {
  const isDark = useColorScheme() === 'dark';
  return { isDark, colors: isDark ? dark : light };
}
