import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Icon } from '../components/icon';
import { OtpInput } from '../components/otp-input';
import { Button, colors, ErrorText, fonts, styles } from '../components/ui';
import { errorMessage, request } from '../lib/api';
import { CandidateAccess, CandidateIdentity, PendingCode, useCandidateSession } from '../lib/candidate-session';
import { useServer } from '../lib/server';
import { useSummary } from '../lib/summary';

type Params = { next?: string; offerId?: string };
type Challenge = { challenge_id: string; phone: string; expires_in: number; resend_after: number };
const toPending = (identity: CandidateIdentity, result: Challenge): PendingCode =>
  ({ identity: { ...identity, phone: result.phone }, challengeId: result.challenge_id, expiresAt: Date.now() + result.expires_in * 1000, resendAt: Date.now() + result.resend_after * 1000 });
/** Numéro saisi sans indicatif (l'écran affiche +213) ; un numéro complet collé est accepté tel quel. */
const fullPhone = (local: string) => { const digits = local.replace(/[^\d+]/g, ''); return digits.startsWith('+') || digits.startsWith('00') ? digits : '0' + digits.replace(/^0/, ''); };
const localPhone = (phone: string) => phone.replace(/^\+213/, '').replace(/^0/, '');

// Identité puis code SMS sur un seul écran : l'étape du code n'apparaît qu'une fois le code demandé.
export default function Identify() {
  const { pending, session } = useCandidateSession();
  const [form, setForm] = useState(() => { const known = pending?.identity || session?.identity; return { last_name: known?.last_name || '', first_name: known?.first_name || '', phone: known ? localPhone(known.phone) : '' }; });
  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={screen.content}>
        <View style={screen.icon}><Icon name="phone" size={34} color={colors.navy} /><View style={screen.iconBadge}><Icon name="chat" size={11} color={colors.white} /></View></View>
        <Text accessibilityRole="header" style={[styles.title, { textAlign: 'center' }]}>Votre accès candidat</Text>
        <Text style={[styles.subtitle, { textAlign: 'center' }]}>Créez votre espace en quelques secondes avec votre numéro de téléphone.</Text>
        <Line label="Nom" value={form.last_name} editable={!pending} onChange={v => setForm({ ...form, last_name: v })} autoComplete="family-name" textContentType="familyName" />
        <Line label="Prénom" value={form.first_name} editable={!pending} onChange={v => setForm({ ...form, first_name: v })} autoComplete="given-name" textContentType="givenName" />
        <Line label="Téléphone" value={form.phone} editable={!pending} onChange={v => setForm({ ...form, phone: v })} phone />
        {pending ? <CodeStep pending={pending} /> : <RequestStep form={form} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Line({ label, value, onChange, editable, phone = false, autoComplete, textContentType }: { label: string; value: string; onChange: (value: string) => void; editable: boolean; phone?: boolean;
  autoComplete?: 'family-name' | 'given-name'; textContentType?: 'familyName' | 'givenName' }) {
  return (
    <View style={screen.line}>
      <Text style={screen.lineLabel}>{label}</Text>
      <View style={[screen.lineField, !editable && { backgroundColor: colors.surface }]}>
        {phone && <><View accessibilityLabel="Algérie" style={screen.flag}><View style={{ flex: 1, backgroundColor: '#1E8E4E' }} /><View style={{ flex: 1, backgroundColor: colors.white }} /></View><Text style={screen.prefix}>+213</Text><View style={screen.bar} /></>}
        <TextInput accessibilityLabel={phone ? 'Numéro de téléphone, sans l’indicatif' : label} value={value} editable={editable} onChangeText={onChange} maxLength={phone ? 20 : 100}
          keyboardType={phone ? 'phone-pad' : 'default'} autoComplete={phone ? 'tel-national' : autoComplete} textContentType={phone ? 'telephoneNumber' : textContentType}
          placeholder={phone ? '5, 6 ou 7…' : undefined} placeholderTextColor={colors.soft} style={[screen.lineInput, !editable && { color: colors.muted }]} />
      </View>
    </View>
  );
}

function RequestStep({ form }: { form: { last_name: string; first_name: string; phone: string } }) {
  const { setPending, setAccess } = useCandidateSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const guard = useRef(false);
  async function send() {
    if (guard.current) return;
    const identity = { first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: fullPhone(form.phone) };
    if (identity.first_name.length < 2 || identity.last_name.length < 2) { setError('Renseignez votre nom et prénom (au moins deux caractères).'); return; }
    if (identity.phone.replace(/\D/g, '').length < 9) { setError('Renseignez votre numéro de téléphone mobile.'); return; }
    guard.current = true; setBusy(true); setError('');
    try { const result = await request<Challenge>('/public/mobile/request-code', { body: identity }); setAccess(null); setPending(toPending(identity, result)); }
    catch (e) { setError(errorMessage(e)); } finally { guard.current = false; setBusy(false); }
  }
  return (
    <View style={{ gap: 14, marginTop: 6 }}>
      <ErrorText message={error} />
      <Button title="Recevoir le code par SMS" busy={busy} onPress={send} />
      <Text style={screen.helper}>Un code à six chiffres vous sera envoyé par SMS pour vérifier ce numéro.</Text>
    </View>
  );
}

function CodeStep({ pending }: { pending: PendingCode }) {
  const params = useLocalSearchParams<Params>();
  const { mode } = useServer();
  const { refresh } = useSummary();
  const { setPending, setAccess, openSession } = useCandidateSession();
  const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [now, setNow] = useState(() => Date.now());
  const guard = useRef(false), [verified, setVerified] = useState<CandidateAccess | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const wait = Math.max(0, Math.ceil((pending.resendAt - now) / 1000));

  function proceed() {
    // Retour à l'action voulue : la candidature en cours, ou l'écran personnel d'où l'on vient.
    router.back();
    if (!params.next || params.next === 'apply') router.push({ pathname: '/offers/apply', params: params.offerId ? { offerId: params.offerId } : {} });
    setPending(null); refresh();
  }

  async function verify() {
    if (guard.current) return;
    if (!verified && !/^\d{6}$/.test(code)) { setError('Saisissez les six chiffres reçus par SMS.'); return; }
    guard.current = true; setBusy(true); setError('');
    try {
      // Le code n'est valable qu'une fois : après validation, seule l'ouverture de l'espace est retentée.
      let access = verified;
      if (!access) {
        const result = await request<{ access_token: string; expires_in: number; identity: CandidateIdentity }>('/public/mobile/verify-code', { body: { challenge_id: pending.challengeId, code } });
        access = { identity: result.identity, token: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
        setVerified(access); setAccess(access);
      }
      if (mode === 'emploi') await openSession(access);
      proceed();
    } catch (e) { setError(errorMessage(e)); setCode(''); } finally { guard.current = false; setBusy(false); }
  }

  async function resend() {
    if (guard.current || wait) return;
    guard.current = true; setBusy(true); setError('');
    try { setPending(toPending(pending.identity, await request<Challenge>('/public/mobile/request-code', { body: pending.identity }))); setCode(''); }
    catch (e) { setError(errorMessage(e)); } finally { guard.current = false; setBusy(false); }
  }

  const done = !!verified, expired = !done && now >= pending.expiresAt;
  return (
    <View style={{ gap: 12, marginTop: 6 }}>
      {!done && <>
        <Text style={styles.label}>Code reçu par SMS</Text>
        <OtpInput value={code} onChange={setCode} onComplete={verify} editable={!busy && !expired} />
        <Text style={screen.helper}>{expired ? 'Ce code a expiré. Demandez-en un nouveau.' : 'Entrez le code à 6 chiffres reçu sur votre téléphone. Il est valable cinq minutes.'}</Text>
      </>}
      {done && <Text style={screen.helper}>Votre numéro est vérifié.</Text>}
      <ErrorText message={error} />
      <Button title={done ? 'Réessayer' : 'Valider mon accès'} busy={busy} disabled={expired || (!done && code.length < 6)} onPress={verify} />
      {!done && (
        <View style={screen.resend}>
          <Text style={screen.helper}>Vous n’avez pas reçu le code ?</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={wait ? `Renvoyer le code, disponible dans ${wait} secondes` : 'Renvoyer le code'} accessibilityState={{ disabled: busy || wait > 0 }}
            disabled={busy || wait > 0} onPress={resend} hitSlop={10} style={{ minHeight: 32, justifyContent: 'center' }}>
            <Text style={[styles.link, (busy || wait > 0) && { color: colors.soft }]}>{wait ? `Renvoyer dans ${wait} s` : 'Renvoyer'}</Text>
          </Pressable>
        </View>
      )}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setPending(null); setAccess(null); }} hitSlop={8} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}>
        <Text style={screen.modify}>Modifier mon identité ou mon numéro</Text>
      </Pressable>
    </View>
  );
}

const screen = StyleSheet.create({
  content: { padding: 22, gap: 12, paddingBottom: 40 },
  icon: { alignSelf: 'center', width: 60, height: 60, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  iconBadge: { position: 'absolute', top: 10, right: 6, width: 20, height: 20, borderRadius: 6, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }, lineLabel: { width: 82, fontSize: 16, fontFamily: fonts.sans, color: colors.ink },
  lineField: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: 12, gap: 8 },
  lineInput: { flex: 1, fontSize: 17.5, fontFamily: fonts.sans, color: colors.ink, paddingVertical: 10 },
  flag: { width: 20, height: 14, borderRadius: 2, overflow: 'hidden', flexDirection: 'row', borderWidth: 0.5, borderColor: colors.border }, prefix: { fontSize: 17, fontFamily: fonts.sans, color: colors.ink },
  bar: { width: 1, height: 20, backgroundColor: colors.border },
  helper: { fontSize: 14, lineHeight: 20, fontFamily: fonts.sans, color: colors.muted }, resend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  modify: { fontSize: 14.5, fontFamily: fonts.medium, color: colors.muted, textDecorationLine: 'underline' },
});
