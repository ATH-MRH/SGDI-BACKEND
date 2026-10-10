/**
 * Tokens ATLAS MOBILE — alignés sur app/static/design-system/tokens.css
 * (ATLAS Design System V1) pour garder une identité commune web / mobile.
 */
export const colors = {
  primary: '#165DDE',
  primaryPressed: '#114BB5',
  primarySoft: '#EAF2FF',
  onPrimary: '#FFFFFF',
  navy: '#0A2D6B',
  navyDeep: '#021738',
  background: '#F3F7FC',
  surface: '#FFFFFF',
  surfaceSecondary: '#F8FAFD',
  text: '#172B4D',
  textSecondary: '#51627C',
  textMuted: '#61748F',
  border: '#DDE7F3',
  borderStrong: '#B9CBE2',
  success: '#117647',
  successSoft: '#E7F6EF',
  warning: '#9F580A',
  warningSoft: '#FFF3DF',
  danger: '#BB303E',
  dangerSoft: '#FFF0F1',
  info: '#126A9D',
  infoSoft: '#E9F6FD',
  overlay: '#172B4D66',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const;

export const typography = {
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
} as const;

/** Cible tactile minimale (Apple HIG 44 pt, Material 48 dp). */
export const touchTarget = 48;

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.textSecondary, bg: colors.surfaceSecondary },
  info: { fg: colors.info, bg: colors.infoSoft },
  success: { fg: colors.success, bg: colors.successSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};
