/**
 * Design tokens for the site app.
 *
 * The colours and the two typefaces are Realytica's own identity, the same as
 * the web app's, so a project looks like the same project on a phone: calm
 * grey pages, white cards, near-black actions, teal for links and selection,
 * rose for anything waiting on a person's decision. The sizes are not the
 * web's: this app is used outdoors, in sunlight, often with gloves on, so type
 * is a step larger and nothing you can press is smaller than 48 points.
 */
import { isLoaded } from 'expo-font';
import { Platform, useColorScheme, type TextStyle } from 'react-native';

export interface Palette {
  /** Screen background. */
  page: string;
  /** Cards and grouped rows: white on the grey page. */
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
  /** The one thing a screen is for: Log today, Save entry, Pair phone. */
  action: string;
  actionPressed: string;
  /** Text and icons drawn on the action colour. */
  actionInk: string;
  /** Links, selection and focus. */
  brand: string;
  brandStrong: string;
  brandSoft: string;
  /** Text and icons drawn on the brand colour. */
  brandInk: string;
  /** Waiting on a person's decision (and, on the web, anything a model wrote). */
  ai: string;
  aiSoft: string;
  aiText: string;
  good: string;
  goodText: string;
  goodSoft: string;
  /** Amber works as a fill and is unreadable as text, hence warningText. */
  warning: string;
  warningText: string;
  warningSoft: string;
  serious: string;
  seriousText: string;
  seriousSoft: string;
  critical: string;
  criticalText: string;
  criticalSoft: string;
  overlay: string;
}

export const light: Palette = {
  page: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceRaised: '#FAFAFB',
  sunken: '#EEF0F3',
  hairline: '#E3E5EA',
  text: '#15171A',
  textSecondary: '#4A4F57',
  textMuted: '#646A73',
  textInverse: '#FFFFFF',
  action: '#15171A',
  actionPressed: '#2B2F35',
  actionInk: '#FFFFFF',
  brand: 'rgb(11,100,100)',
  brandStrong: '#084C4C',
  brandSoft: '#E2F1F0',
  brandInk: '#FFFFFF',
  ai: '#B0245A',
  aiSoft: '#FBEAF1',
  aiText: '#9A1F4F',
  good: '#16794A',
  goodText: '#16794A',
  goodSoft: 'rgba(22,121,74,0.10)',
  warning: '#E0A100',
  warningText: '#7C4E00',
  warningSoft: 'rgba(224,161,0,0.15)',
  serious: '#D8692F',
  seriousText: '#9A3F12',
  seriousSoft: 'rgba(216,105,47,0.12)',
  critical: '#B42318',
  criticalText: '#B42318',
  criticalSoft: 'rgba(180,35,24,0.10)',
  overlay: 'rgba(21,23,26,0.45)',
};

export const dark: Palette = {
  page: '#0E0F12',
  surface: '#17191D',
  surfaceRaised: '#1D2025',
  sunken: '#111317',
  hairline: '#2A2D33',
  text: '#F3F4F6',
  textSecondary: '#B9BEC7',
  textMuted: '#8D939D',
  textInverse: '#0E0F12',
  action: '#F3F4F6',
  // Lifts to white under the thumb, as the web's action does under the pointer.
  actionPressed: '#FFFFFF',
  actionInk: '#0E0F12',
  brand: 'rgb(86,190,184)',
  brandStrong: '#8FD9D3',
  brandSoft: '#102E2D',
  brandInk: '#0E0F12',
  ai: 'rgb(232,112,160)',
  aiSoft: '#3A1626',
  aiText: '#F19BBF',
  good: 'rgb(74,196,128)',
  goodText: '#6AD39B',
  goodSoft: 'rgba(74,196,128,0.14)',
  warning: 'rgb(240,182,46)',
  warningText: 'rgb(240,182,46)',
  warningSoft: 'rgba(240,182,46,0.14)',
  serious: 'rgb(240,132,76)',
  seriousText: '#F3A072',
  seriousSoft: 'rgba(240,132,76,0.14)',
  critical: 'rgb(240,90,76)',
  // Lifted the way seriousText is, so small red text still clears 4.5:1 on its own soft fill.
  criticalText: '#F37B70',
  criticalSoft: 'rgba(240,90,76,0.16)',
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

/** Cards are `lg`; buttons and inputs `md`; sheets open with `xl` corners. */
export const radius = { sm: 8, md: 12, lg: 14, xl: 22, pill: 999 } as const;

/** The smallest thing a gloved thumb can reliably hit. */
export const TOUCH = 48;

/**
 * The widest a screen's column of cards and fields gets.
 *
 * A phone uses its whole width. An iPad ignores the portrait lock (it runs in
 * any orientation and in Split View), and so does a large Android screen, so
 * the app also has to make sense at 1,366 points across: there the column
 * stops here and sits in the middle, rather than stretching a card into a
 * strip with its words at one end and its chevron at the other.
 */
export const CONTENT_MAX = 720;

/** A sheet, a toast or the row of tabs on a wide screen keeps roughly a phone's proportions. */
export const PANEL_MAX = 560;

/**
 * The type scale, in Schibsted Grotesk. Headings run slightly tight (about
 * -0.01em); body text keeps the face's own spacing for reading in glare.
 */
export const type = {
  display: { fontSize: 40, lineHeight: 46, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  /** Small capitals over a group: "ON SITE". */
  eyebrow: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
};

export type TypeVariant = keyof typeof type;

/** The font files, by the family name each is registered under. Loaded once in the root layout. */
export const FONT = {
  regular: 'SchibstedGrotesk_400Regular',
  medium: 'SchibstedGrotesk_500Medium',
  semibold: 'SchibstedGrotesk_600SemiBold',
  bold: 'SchibstedGrotesk_700Bold',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
} as const;

const SYSTEM_MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

let brandFonts = false;
function brandFontsIn(): boolean {
  // Checked until the files are in, then remembered. Nothing draws before then
  // (the splash screen waits), so this only matters if loading ever failed.
  if (!brandFonts) brandFonts = isLoaded(FONT.regular);
  return brandFonts;
}

function numericWeight(weight: TextStyle['fontWeight']): number {
  if (weight === 'bold') return 700;
  if (weight == null || weight === 'normal') return 400;
  return Number(weight) || 400;
}

/**
 * The face for a weight. Each weight of a loaded font is its own family on
 * iOS, Android and the web, so the weight is chosen by family name and
 * `fontWeight` is reset — left in place, Android and browsers would embolden
 * an already-bold face a second time. Words are Schibsted Grotesk; figures,
 * codes, percentages and counts (`mono`) are DM Mono. Should the files ever
 * fail to load, this falls back to the system face at the asked weight.
 */
export function face(weight?: TextStyle['fontWeight'], mono = false): TextStyle {
  if (!brandFontsIn()) return mono ? { fontFamily: SYSTEM_MONO, fontWeight: weight } : { fontWeight: weight };
  const w = numericWeight(weight);
  if (mono) return { fontFamily: w >= 500 ? FONT.monoMedium : FONT.mono, fontWeight: 'normal' };
  return { fontFamily: w >= 700 ? FONT.bold : w >= 600 ? FONT.semibold : w >= 500 ? FONT.medium : FONT.regular, fontWeight: 'normal' };
}

/** Soft shadows for light mode. Dark mode relies on hairlines and lighter surfaces instead. */
export interface Shadows {
  /** Cards resting on the page. */
  card: string | undefined;
  /** Things floating over content: toasts, the tab bar's edge, a sheet. */
  raised: string | undefined;
}

const LIGHT_SHADOWS: Shadows = {
  card: '0px 1px 2px rgba(21, 23, 26, 0.04), 0px 2px 8px rgba(21, 23, 26, 0.04)',
  raised: '0px 10px 30px rgba(21, 23, 26, 0.14), 0px 2px 6px rgba(21, 23, 26, 0.06)',
};

const DARK_SHADOWS: Shadows = {
  card: undefined,
  raised: '0px 12px 32px rgba(0, 0, 0, 0.5)',
};

export interface Theme {
  isDark: boolean;
  colors: Palette;
  shadow: Shadows;
}

export function useTheme(): Theme {
  const isDark = useColorScheme() === 'dark';
  return { isDark, colors: isDark ? dark : light, shadow: isDark ? DARK_SHADOWS : LIGHT_SHADOWS };
}
