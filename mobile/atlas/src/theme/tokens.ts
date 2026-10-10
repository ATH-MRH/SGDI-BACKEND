import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Design system ATLAS MOBILE.
 *
 * Mêmes teintes que le web (app/static/design-system/tokens.css) : bleu marine pour
 * l'identité, bleu ATLAS pour l'action, gris acier pour le contenu. Le rouge et l'orange
 * sont réservés aux alertes, aux urgences et aux états critiques.
 */
export const colors = {
  // Identité
  navy: '#0A2D6B',
  navyDeep: '#061C44',
  steel: '#3D5A80',
  onNavy: '#FFFFFF',
  onNavyMuted: '#B8C7E0',
  navyTint: '#17407F',
  // Action
  primary: '#165DDE',
  primaryPressed: '#114BB5',
  primarySoft: '#EAF2FF',
  onPrimary: '#FFFFFF',
  // Surfaces
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceSecondary: '#F7F9FC',
  surfacePressed: '#EEF3F9',
  // Texte
  text: '#12233F',
  textSecondary: '#4A5D7A',
  textMuted: '#61748F',
  // Traits
  border: '#E1E8F0',
  borderStrong: '#B9CBE2',
  divider: '#EBF0F6',
  // Statuts
  success: '#117647',
  successSoft: '#E7F6EF',
  warning: '#9F580A',
  warningSoft: '#FFF3DF',
  danger: '#BB303E',
  dangerSoft: '#FFF0F1',
  info: '#126A9D',
  infoSoft: '#E9F6FD',
  overlay: '#0A1B3A99',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.3 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.2 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** Titre de section : petites capitales espacées, comme les en-têtes de panneaux du web. */
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  /** Chiffre d'indicateur : chiffres à chasse fixe pour que les colonnes restent alignées. */
  kpi: { fontSize: 26, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  kpiLarge: { fontSize: 34, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;

/** Cible tactile minimale (Apple HIG 44 pt, Material 48 dp). */
export const touchTarget = 48;

/** Ombres : légères, pour détacher une carte du fond sans alourdir l'écran. */
export const elevation = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: '#0A2D6B', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
    default: { elevation: 1.5 },
  }) as ViewStyle,
  raised: Platform.select<ViewStyle>({
    ios: { shadowColor: '#0A2D6B', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
    default: { elevation: 4 },
  }) as ViewStyle,
} as const;

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const toneColors: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: colors.steel, bg: colors.surfaceSecondary },
  info: { fg: colors.info, bg: colors.infoSoft },
  success: { fg: colors.success, bg: colors.successSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  danger: { fg: colors.danger, bg: colors.dangerSoft },
};
