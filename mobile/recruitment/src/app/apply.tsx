import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { CandidateForm } from '../components/candidate-form';
import { CVField } from '../components/cv-field';
import { Icon } from '../components/icon';
import { PhotoField } from '../components/photo-field';
import { Button, Card, colors, EmptyState, ErrorState, ErrorText, Loading, Monogram, Page, styles } from '../components/ui';
import { ApiError, errorMessage, request } from '../lib/api';
import { CandidateAccess, useCandidateSession } from '../lib/candidate-session';
import { confirm } from '../lib/confirm';
import { CVUpload, useDocuments } from '../lib/documents';
import { Account, ApplicationReceipt, Experience, fetchOffer, formToProfile, FormValues, logoUri, newRequestId, OfferDetail, profileToForm, validateForm } from '../lib/emploi';
import { useServer } from '../lib/server';
import { useLoad } from '../lib/use-load';

export default function Apply() {
  const params = useLocalSearchParams<{ offerId?: string }>();
  const { mode, retry } = useServer();
  const { ready, session, access } = useCandidateSession();
  const [enteredAt] = useState(() => Date.now());
  const offerId = params.offerId ? Number(params.offerId) : null;
  if (mode === 'loading' || !ready) return <Loading />;
  if (mode === 'offline') return <ErrorState message="Connexion indisponible. Vérifiez votre réseau puis réessayez." onRetry={retry} />;
  const identify = <Redirect href={{ pathname: '/identify', params: { next: 'apply', ...(params.offerId ? { offerId: params.offerId } : {}) } }} />;
  if (mode === 'emploi') return session ? <SpaceApply offerId={offerId} /> : identify;
  // Service des annonces absent : parcours de candidature spontanée déjà en service.
  return access && access.expiresAt > enteredAt ? <DirectApply access={access} /> : identify;
}

function Consent({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={styles.row}>
      <View style={[form.check, value && form.checked]}>{value && <Icon name="check" size={18} color={colors.white} />}</View>
      <Text style={[styles.subtitle, { flex: 1 }]}>J’accepte que les informations transmises soient traitées par IRON Global pour ma candidature.</Text>
    </Pressable>
  );
}

function SpaceApply({ offerId }: { offerId: number | null }) {
  const { call, session } = useCandidateSession();
  const account = useLoad(signal => call<Account>('/public/emploi/me', { signal }), 'me');
  const offer = useLoad<OfferDetail | null>(signal => offerId === null ? Promise.resolve(null) : fetchOffer(offerId, signal), `apply-offer:${offerId}`);
  const [closed, setClosed] = useState(false);

  if (!session) return <Redirect href={{ pathname: '/identify', params: { next: 'apply', ...(offerId !== null ? { offerId: String(offerId) } : {}) } }} />;
  if (closed || (offerId !== null && !offer.data && offer.status === 404)) {
    return (
      <View style={{ padding: 18 }}>
        <Card><EmptyState icon="clock" title="Cette offre n’accepte plus de candidature" text="Elle vient d’être clôturée par la société. Votre profil et vos documents restent enregistrés."
          action="Voir les autres offres" onAction={() => { router.dismissAll(); router.navigate('/offers'); }} /></Card>
      </View>
    );
  }
  if ((!account.data && account.loading) || (offerId !== null && !offer.data && offer.loading)) return <Loading label="Préparation de votre candidature…" />;
  if (!account.data) return <ErrorState message={account.error} onRetry={account.reload} />;
  if (offerId !== null && !offer.data) return <ErrorState message={offer.error} onRetry={offer.reload} />;
  return <SpaceForm account={account.data} offer={offer.data} onClosed={() => setClosed(true)} />;
}

function SpaceForm({ account, offer, onClosed }: { account: Account; offer: OfferDetail | null; onClosed: () => void }) {
  const { call } = useCandidateSession();
  const { saveCv, savePhoto, loadPhoto } = useDocuments();
  const [initial] = useState(() => profileToForm(account.profile, account));
  const [values, setValues] = useState<FormValues>(initial.values), [experience, setExperience] = useState<Experience[]>(initial.experience);
  // undefined : document inchangé ; valeur : nouveau document ; null ou '' : document retiré.
  const [cv, setCv] = useState<CVUpload | null>(), [savedCv, setSavedCv] = useState(account.cv), [photo, setPhoto] = useState<string>(), [savedPhoto, setSavedPhoto] = useState('');
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false), requestId = useRef(newRequestId());

  useEffect(() => {
    if (!account.has_photo) return;
    const controller = new AbortController();
    loadPhoto(controller.signal).then(setSavedPhoto).catch(() => {});
    return () => controller.abort();
  }, [account.has_photo, loadPhoto]);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (cv !== undefined) { setSavedCv(await saveCv(cv)); setCv(undefined); }
      if (photo !== undefined) { await savePhoto(photo); setSavedPhoto(photo); setPhoto(undefined); }
      const receipt = await call<ApplicationReceipt>('/public/emploi/applications', { body: {
        offer_id: offer ? offer.id : null, request_id: requestId.current, consent: true, profile: formToProfile(values, experience),
        desired_position: offer ? null : (values.desired_position || '').trim() } });
      router.replace({ pathname: '/confirmation', params: { reference: receipt.reference, id: String(receipt.application_id), already: receipt.already_applied ? '1' : '',
        title: offer?.title || (values.desired_position || '').trim(), company: offer?.company.name || '' } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && offer && /clôturée/.test(e.message)) onClosed();
      else if (e instanceof ApiError) setError(e.message);
      // Réponse perdue : le même envoi peut être relancé sans créer de doublon (identifiant d'envoi conservé).
      else setError(errorMessage(e) + ' Vous pouvez relancer l’envoi : il ne sera enregistré qu’une seule fois.');
    } finally { submitting.current = false; setBusy(false); }
  }

  function review() {
    const problem = validateForm(values, experience, { needPosition: !offer });
    if (problem) { setError(problem); return; }
    if (!consent) { setError('Votre consentement est nécessaire pour transmettre le dossier.'); return; }
    confirm('Transmettre le dossier ?', offer ? `Votre candidature au poste « ${offer.title} » sera envoyée à ${offer.company.name}.` : 'Votre candidature spontanée sera envoyée au service recrutement.', 'Transmettre', submit);
  }

  return (
    <Page title={offer ? 'Postuler à cette offre' : 'Candidature spontanée'}
      subtitle="Vos informations sont préremplies depuis votre profil. Vérifiez-les : elles seront enregistrées pour vos prochaines candidatures.">
      {offer && (
        <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Monogram name={offer.company.name} uri={logoUri(offer.company)} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={form.offerTitle}>{offer.title}</Text>
            <Text style={form.offerMeta}>{[offer.company.name, offer.wilaya, offer.contract_type].filter(Boolean).join(' · ')}</Text>
          </View>
        </Card>
      )}
      <CandidateForm lockedIdentity hidden={offer ? ['desired_position'] : []} values={values} onChange={setValues} experience={experience} onExperience={setExperience}
        photo={<PhotoField value={photo ?? savedPhoto} onChange={setPhoto} onError={setError} />} />
      <Card><CVField value={cv} existing={savedCv || undefined} onChange={setCv} onError={setError} disabled={busy} /></Card>
      <Card>
        <Consent value={consent} onChange={setConsent} />
        <ErrorText message={error} />
        <Button title="Transmettre ma candidature" icon="send" busy={busy} disabled={!consent} onPress={review} />
      </Card>
    </Page>
  );
}

function DirectApply({ access }: { access: CandidateAccess }) {
  const { setAccess } = useCandidateSession();
  const [values, setValues] = useState<FormValues>({ ...access.identity }), [experience, setExperience] = useState<Experience[]>([]);
  const [photo, setPhoto] = useState<string>(), [cv, setCv] = useState<CVUpload | null>(), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const config = await request<{ version: number }>('/public/candidates/form-config').catch(e => { if (e instanceof ApiError && e.status === 404) throw new Error('Le serveur recrutement doit être mis à jour avant l’envoi de cette fiche complète.'); throw e; });
      if (config.version < 4) throw new Error('Mise à jour du serveur nécessaire pour conserver tous les champs.');
      const profile = formToProfile(values, experience);
      const result = await request<{ reference: string }>('/public/mobile/candidates', { token: access.token, body: {
        ...profile, first_name: values.first_name, last_name: values.last_name, phone: values.phone, desired_position: (values.desired_position || '').trim(),
        cv: cv || null, photo_data: photo || null, consent: true } });
      router.replace({ pathname: '/confirmation', params: { reference: result.reference, title: (values.desired_position || '').trim(), direct: '1' } });
    } catch (e) { setError(errorMessage(e) + ' Si la connexion a été interrompue après l’envoi, vérifiez auprès du recrutement avant de déposer à nouveau.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  function review() {
    const problem = validateForm(values, experience, { needPosition: true });
    if (problem) { setError(problem); return; }
    if (!consent) { setError('Votre consentement est nécessaire pour transmettre le dossier.'); return; }
    confirm('Transmettre le dossier ?', 'Votre candidature sera envoyée au service recrutement.', 'Transmettre', submit);
  }

  return (
    <Page title="Candidature spontanée" subtitle="Le poste souhaité est obligatoire. Votre nom, prénom et téléphone sont ceux que vous venez de vérifier.">
      <CandidateForm lockedIdentity photo={<PhotoField value={photo || ''} onChange={setPhoto} onError={setError} />} values={values} onChange={setValues} experience={experience} onExperience={setExperience} />
      <Card><CVField value={cv} onChange={setCv} onError={setError} disabled={busy} /></Card>
      <Card>
        <Consent value={consent} onChange={setConsent} />
        <ErrorText message={error} />
        {!!error && <Button title="Vérifier à nouveau mon téléphone" secondary onPress={() => { setAccess(null); router.replace({ pathname: '/identify', params: { next: 'apply' } }); }} />}
        <Button title="Transmettre ma candidature" icon="send" busy={busy} disabled={!consent} onPress={review} />
      </Card>
    </Page>
  );
}

const form = StyleSheet.create({
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checked: { backgroundColor: colors.navy }, offerTitle: { fontSize: 16, fontWeight: '700', color: colors.ink }, offerMeta: { fontSize: 13, color: colors.muted },
});
