import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CandidateForm, Select } from '../../../components/candidate-form';
import { CvCard } from '../../../components/cv-card';
import { OfferMeta } from '../../../components/offer-card';
import locations from '../../../lib/locations.json';
import { CVField } from '../../../components/cv-field';
import { Icon } from '../../../components/icon';
import { PhotoField } from '../../../components/photo-field';
import { Button, Card, colors, EmptyState, ErrorState, ErrorText, fonts, Loading, Page, shadow, styles } from '../../../components/ui';
import { ApiError, errorMessage, request } from '../../../lib/api';
import { CandidateAccess, useCandidateSession } from '../../../lib/candidate-session';
import { confirm } from '../../../lib/confirm';
import { CVUpload, useDocuments } from '../../../lib/documents';
import { Account, ApplicationReceipt, Experience, fetchOffer, formToProfile, FormValues, newRequestId, OfferDetail, profileToForm, validateForm } from '../../../lib/emploi';
import { useServer } from '../../../lib/server';
import { useLoad } from '../../../lib/use-load';

export default function Apply() {
  const params = useLocalSearchParams<{ offerId?: string }>();
  const { mode, retry } = useServer();
  const { ready, session, access } = useCandidateSession();
  const [enteredAt] = useState(() => Date.now());
  const offerId = params.offerId ? Number(params.offerId) : null;
  if (mode === 'loading' || !ready) return <Loading />;
  if (mode === 'offline') return <ErrorState message="Connexion indisponible. Vérifiez votre réseau puis réessayez." onRetry={retry} />;
  const identify = () => router.push({ pathname: '/identify', params: { next: 'none' } });
  const prompt = (
    <View style={{ padding: 18 }}>
      <Card><EmptyState icon="phone" title="Identifiez-vous pour postuler" text="Votre numéro de téléphone, vérifié par SMS, protège votre candidature et vous permet d’en suivre l’état." action="M’identifier" onAction={identify} /></Card>
    </View>
  );
  if (mode === 'emploi') return session ? <SpaceApply offerId={offerId} /> : prompt;
  // Service des annonces absent : parcours de candidature spontanée déjà en service.
  return access && access.expiresAt > enteredAt ? <DirectApply access={access} /> : prompt;
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

  if (!session) return null;
  if (closed || (offerId !== null && !offer.data && offer.status === 404)) {
    return (
      <View style={{ padding: 18 }}>
        <Card><EmptyState icon="clock" title="Cette offre n’accepte plus de candidature" text="Elle vient d’être clôturée par la société. Votre profil et vos documents restent enregistrés."
          action="Voir les autres offres" onAction={() => { if (router.canDismiss()) router.dismissAll(); router.navigate('/offers'); }} /></Card>
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
  // Première candidature : les renseignements d'abord. Ensuite ils sont déjà enregistrés et restent modifiables.
  const [step, setStep] = useState<'info' | 'send'>(Object.keys(account.profile).length ? 'send' : 'info');
  // undefined : document inchangé ; valeur : nouveau document ; null ou '' : document retiré.
  const [cv, setCv] = useState<(CVUpload & { size?: number }) | null>(), [savedCv, setSavedCv] = useState(account.cv), [photo, setPhoto] = useState<string>(), [savedPhoto, setSavedPhoto] = useState('');
  const [message, setMessage] = useState(''), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false), requestId = useRef(newRequestId());

  useEffect(() => {
    if (!account.has_photo) return;
    const controller = new AbortController();
    loadPhoto(controller.signal).then(setSavedPhoto).catch(() => {});
    return () => controller.abort();
  }, [account.has_photo, loadPhoto]);

  async function saveInfo() {
    if (submitting.current) return;
    const problem = validateForm(values, experience, { needPosition: false });
    if (problem) { setError(problem); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      await call('/public/emploi/me/profile', { method: 'PUT', body: formToProfile(values, experience, account.profile) });
      if (photo !== undefined) { await savePhoto(photo); setSavedPhoto(photo); setPhoto(undefined); }
      setStep('send');
    } catch (e) { setError(errorMessage(e)); } finally { submitting.current = false; setBusy(false); }
  }

  async function submit() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (cv !== undefined) { setSavedCv(await saveCv(cv ? { name: cv.name, mime_type: cv.mime_type, data_base64: cv.data_base64 } : null)); setCv(undefined); }
      const receipt = await call<ApplicationReceipt>('/public/emploi/applications', { body: {
        offer_id: offer ? offer.id : null, request_id: requestId.current, consent: true, message: message.trim() || null,
        profile: formToProfile(values, experience, account.profile), desired_position: offer ? null : (values.desired_position || '').trim() } });
      router.replace({ pathname: '/offers/confirmation', params: { reference: receipt.reference, id: String(receipt.application_id), already: receipt.already_applied ? '1' : '',
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
    confirm('Envoyer la candidature ?', offer ? `Votre candidature au poste « ${offer.title} » sera envoyée à ${offer.company.name}.` : 'Votre candidature spontanée sera envoyée au service recrutement.', 'Envoyer', submit);
  }

  if (step === 'info') {
    return (
      <Page title="Mes renseignements" subtitle="Étape 1 sur 2. Ces informations sont demandées une seule fois : elles sont enregistrées dans votre profil pour vos prochaines candidatures.">
        <CandidateForm lockedIdentity hidden={offer ? ['desired_position'] : []} values={values} onChange={setValues} experience={experience} onExperience={setExperience}
          photo={<PhotoField value={photo ?? savedPhoto} onChange={setPhoto} onError={setError} />} />
        <ErrorText message={error} />
        <Button title="Continuer" busy={busy} onPress={saveInfo} />
      </Page>
    );
  }

  return (
    <Page title="Votre candidature">
      {offer ? (
        <View style={form.summary}>
          {/* Photographie d'illustration (assets/photos/SOURCES.md). */}
          <Image accessibilityIgnoresInvertColors source={require('../../../../assets/photos/offre.jpg')} style={form.thumb} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={form.offerTitle}>{offer.title}</Text>
            <Text style={form.offerMeta}>{offer.company.name}</Text>
            <OfferMeta wilaya={offer.wilaya} contract={offer.contract_type} />
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={styles.subtitle}>Candidature spontanée : elle est étudiée par le service recrutement du groupe, sans annonce précise.</Text>
          <Select label="Poste souhaité" value={values.desired_position || ''} onChange={value => setValues({ ...values, desired_position: value })}
            options={[{ value: '', label: '— Choisir —' }, ...locations.positions.map(value => ({ value, label: value }))]} />
        </View>
      )}
      <Text accessibilityRole="header" style={styles.heading}>Votre CV</Text>
      <CvCard value={cv} existing={savedCv} onChange={setCv} onError={setError} disabled={busy} />
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Message (optionnel)</Text>
        <TextInput accessibilityLabel="Message au recruteur, optionnel" value={message} onChangeText={setMessage} multiline maxLength={1500} editable={!busy}
          placeholder="Quelques mots au recruteur…" placeholderTextColor={colors.soft} textAlignVertical="top" style={form.message} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Vérifier ou modifier mes renseignements" onPress={() => { setError(''); setStep('info'); }} style={form.info}>
        <Icon name="user" size={20} color={colors.navy} />
        <View style={{ flex: 1 }}><Text style={form.infoTitle}>Mes renseignements</Text><Text style={form.offerMeta}>Enregistrés dans votre profil · vérifier ou modifier</Text></View>
        <Icon name="chevronRight" size={18} color={colors.soft} />
      </Pressable>
      <Consent value={consent} onChange={setConsent} />
      <ErrorText message={error} />
      <Button title="Envoyer ma candidature" busy={busy} disabled={!consent} onPress={review} />
      {offer && (
        <Pressable accessibilityRole="link" onPress={() => router.replace('/offers/apply')} hitSlop={8} style={{ alignSelf: 'center', minHeight: 36, justifyContent: 'center' }}>
          <Text style={styles.link}>Candidature spontanée</Text>
        </Pressable>
      )}
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
      router.replace({ pathname: '/offers/confirmation', params: { reference: result.reference, title: (values.desired_position || '').trim(), direct: '1' } });
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
        {!!error && <Button title="Vérifier à nouveau mon téléphone" secondary onPress={() => { setAccess(null); router.push({ pathname: '/identify', params: { next: 'none' } }); }} />}
        <Button title="Transmettre ma candidature" icon="send" busy={busy} disabled={!consent} onPress={review} />
      </Card>
    </Page>
  );
}

const form = StyleSheet.create({
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.navy, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checked: { backgroundColor: colors.navy }, offerTitle: { fontSize: 17.5, fontFamily: fonts.bold, color: colors.ink }, offerMeta: { fontSize: 14.5, fontFamily: fonts.sans, color: colors.muted },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 }, thumb: { width: 76, height: 60, borderRadius: 8, backgroundColor: colors.surface },
  message: { minHeight: 92, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 17, lineHeight: 23.5, fontFamily: fonts.sans, color: colors.ink, backgroundColor: colors.white },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, backgroundColor: colors.white, ...shadow }, infoTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
});
