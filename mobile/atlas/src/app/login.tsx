import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { ApiError, errorMessageKey } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { Segmented } from '@/components/Segmented';
import { useEmployee } from '@/employee/EmployeeProvider';
import { AppText, Banner, Button, Card, FormField, Screen } from '@/components/ui';
import { VersionLabel } from '@/components/VersionLabel';
import { t } from '@/i18n';
import { colors, radius, spacing, touchTarget } from '@/theme/tokens';

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized') return t('login.invalid');
    // Le backend explique le refus (module, sous-domaine, périmètre) : on le relaie.
    if (error.kind === 'forbidden') return error.serverMessage ?? t('login.forbidden');
    if (error.kind === 'rate_limited') {
      return t('login.rateLimited', { minutes: Math.max(1, Math.ceil((error.retryAfterSeconds ?? 300) / 60)) });
    }
    if (error.kind === 'network') return t('login.offline');
    if (error.kind === 'timeout') return t('login.unavailable');
    if (error.kind === 'server' || error.kind === 'invalid_response') return t('login.server');
  }
  return t(errorMessageKey(error));
}

export default function LoginScreen() {
  const { signIn } = useAuth();
  const employee = useEmployee();
  // Deux familles de comptes, deux routes de connexion : jamais d'essai de l'une sur l'autre.
  const [mode, setMode] = useState<'staff' | 'employee'>('staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    if (submitting) return;
    if (!username.trim() || !password) {
      setMessage(t('login.required'));
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await (mode === 'employee' ? employee.signIn(username, password) : signIn(username, password));
    } catch (error) {
      setPassword('');
      setPasswordVisible(false);
      setMessage(loginErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']} testID="login-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.form}>
        <View style={styles.header}>
          <View style={styles.mark} accessibilityElementsHidden importantForAccessibility="no">
            <AppText style={styles.markLetter}>A</AppText>
            <View style={styles.markAccent} />
          </View>
          <AppText variant="display" color={colors.navy} accessibilityRole="header" style={styles.wordmark}>
            {t('app.name')}
          </AppText>
          <AppText variant="overline" color={colors.steel} style={styles.tagline}>
            {t('login.tagline')}
          </AppText>
        </View>

        <Card style={styles.card}>
          <AppText color={colors.textSecondary}>{t(mode === 'employee' ? 'login.employee.subtitle' : 'login.subtitle')}</AppText>

          {employee.available ? (
            <Segmented
              testID="login-mode"
              value={mode}
              onChange={(next) => {
                setMode(next);
                setMessage(null);
                setPassword('');
              }}
              options={[
                { value: 'staff', label: t('login.mode.staff') },
                { value: 'employee', label: t('login.mode.employee') },
              ]}
            />
          ) : null}

          <FormField
            testID="login-username"
            label={t(mode === 'employee' ? 'login.employee.username' : 'login.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            editable={!submitting}
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <FormField
            ref={passwordRef}
            testID="login-password"
            label={t('login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!passwordVisible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            editable={!submitting}
            onSubmitEditing={() => void submit()}
          />
          <Pressable
            testID="login-toggle-password"
            accessibilityRole="switch"
            accessibilityState={{ checked: passwordVisible }}
            accessibilityLabel={t('login.showPassword')}
            onPress={() => setPasswordVisible((visible) => !visible)}
            style={styles.toggle}>
            <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.primary} />
            <AppText variant="label" color={colors.primary}>
              {t(passwordVisible ? 'login.hidePassword' : 'login.showPassword')}
            </AppText>
          </Pressable>

          {message ? <Banner tone="danger" message={message} testID="login-error" /> : null}

          <Button testID="login-submit" icon="log-in-outline" label={t('login.submit')} loading={submitting} onPress={() => void submit()} />
        </Card>

        <View style={styles.footer}>
          <View style={styles.secure}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} />
            <AppText variant="caption" color={colors.textMuted}>
              {t('login.secure')}
            </AppText>
          </View>
          <VersionLabel />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.xl, paddingTop: spacing.xxl },
  header: { alignItems: 'center', gap: spacing.xs },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  markLetter: { color: colors.onNavy, fontSize: 38, lineHeight: 44, fontWeight: '800' },
  markAccent: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: colors.danger },
  wordmark: { letterSpacing: 1.5 },
  tagline: { textAlign: 'center' },
  card: { gap: spacing.lg, padding: spacing.xl },
  toggle: { minHeight: touchTarget - 8, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  footer: { alignItems: 'center', gap: spacing.sm },
  secure: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
