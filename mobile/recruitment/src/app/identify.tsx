import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, ErrorText, Field, Page, styles } from '../components/ui';
import { errorMessage, request } from '../lib/api';
import { CandidateAccess, CandidateIdentity, PendingCode, useCandidateSession } from '../lib/candidate-session';
import { useServer } from '../lib/server';

type Params = { next?: string; offerId?: string };
type Challenge = { challenge_id: string; phone: string; expires_in: number; resend_after: number };
const toPending = (identity: CandidateIdentity, result: Challenge): PendingCode =>
  ({ identity: { ...identity, phone: result.phone }, challengeId: result.challenge_id, expiresAt: Date.now() + result.expires_in * 1000, resendAt: Date.now() + result.resend_after * 1000 });

// Identité puis code SMS sur un seul écran de la pile : à la fin, il est remplacé par la suite du parcours.
export default function Identify() {
  const { pending } = useCandidateSession();
  return pending ? <CodeForm pending={pending} /> : <IdentityForm />;
}

function IdentityForm() {
  const { session, setPending, setAccess } = useCandidateSession();
  const [form, setForm] = useState(session?.identity || { first_name: '', last_name: '', phone: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const guard = useRef(false);
  async function send() {
    if (guard.current) return;
    const identity = { first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone.trim() };
    if (identity.first_name.length < 2 || identity.last_name.length < 2) { setError('Renseignez votre nom et prénom (au moins deux caractères).'); return; }
    if (!identity.phone) { setError('Renseignez votre numéro de téléphone.'); return; }
    guard.current = true; setBusy(true); setError('');
    try {
      const result = await request<Challenge>('/public/mobile/request-code', { body: identity });
      setAccess(null); setPending(toPending(identity, result));
    } catch (e) { setError(errorMessage(e)); } finally { guard.current = false; setBusy(false); }
  }
  return (
    <Page title="Votre accès candidat" subtitle="Indiquez votre identité. Nous vérifions votre numéro de téléphone par SMS : il protège votre espace et vos candidatures.">
      <Card>
        <Field label="Nom" value={form.last_name} editable={!busy} maxLength={100} autoComplete="family-name" textContentType="familyName" onChangeText={v => setForm({ ...form, last_name: v })} />
        <Field label="Prénom" value={form.first_name} editable={!busy} maxLength={100} autoComplete="given-name" textContentType="givenName" onChangeText={v => setForm({ ...form, first_name: v })} />
        <Field label="Numéro de téléphone" value={form.phone} editable={!busy} keyboardType="phone-pad" maxLength={30} placeholder="05, 06 ou 07…" autoComplete="tel" textContentType="telephoneNumber"
          returnKeyType="done" onSubmitEditing={send} onChangeText={v => setForm({ ...form, phone: v })} />
        <ErrorText message={error} />
        <Button title="Recevoir le code par SMS" icon="phone" busy={busy} onPress={send} />
      </Card>
    </Page>
  );
}

function CodeForm({ pending }: { pending: PendingCode }) {
  const params = useLocalSearchParams<Params>();
  const { mode } = useServer();
  const { setPending, setAccess, openSession } = useCandidateSession();
  const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [now, setNow] = useState(() => Date.now());
  const guard = useRef(false), [verified, setVerified] = useState<CandidateAccess | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const wait = Math.max(0, Math.ceil((pending.resendAt - now) / 1000));

  function proceed() {
    // Les onglets personnels retrouvent simplement leur contenu ; sinon cet écran laisse sa place à la candidature.
    if (params.next === 'applications' || params.next === 'profile') router.back();
    else router.replace({ pathname: '/apply', params: params.offerId ? { offerId: params.offerId } : {} });
    setPending(null);
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
    } catch (e) { setError(errorMessage(e)); } finally { guard.current = false; setBusy(false); }
  }

  async function resend() {
    if (guard.current || wait) return;
    guard.current = true; setBusy(true); setError('');
    try { setPending(toPending(pending.identity, await request<Challenge>('/public/mobile/request-code', { body: pending.identity }))); setCode(''); }
    catch (e) { setError(errorMessage(e)); } finally { guard.current = false; setBusy(false); }
  }

  const done = !!verified, expired = !done && now >= pending.expiresAt;
  return (
    <Page title="Vérifiez votre téléphone" subtitle={`Un code a été demandé pour le ${pending.identity.phone}. Il vous parviendra par SMS.`}>
      <Card>
        <Text style={styles.subtitle}>{done ? 'Votre numéro est vérifié.' : expired ? 'Le code a expiré. Demandez un nouveau code.' : 'Le code est valable cinq minutes.'}</Text>
        {!done && <Field label="Code de validation" value={code} onChangeText={v => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp"
          maxLength={6} editable={!busy} returnKeyType="done" onSubmitEditing={verify} />}
        <ErrorText message={error} />
        <Button title={done ? 'Réessayer' : 'Valider mon accès'} busy={busy} disabled={expired} onPress={verify} />
        {!done && <Button title={wait ? `Renvoyer le code dans ${wait} s` : 'Renvoyer le code'} secondary disabled={busy || wait > 0} onPress={resend} />}
        <Button title="Modifier mon identité ou mon numéro" secondary disabled={busy} onPress={() => { setPending(null); setAccess(null); }} />
      </Card>
    </Page>
  );
}
