import { useRef, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { CVField, CVUpload } from '../components/cv-field';
import { PhotoField } from '../components/photo-field';
import { Redirect, router } from 'expo-router';
import { Button, Card, ErrorText, Page, styles } from '../components/ui';
import { CandidateForm, Experience, FormValues } from '../components/candidate-form';
import { CandidateAccess, useCandidateSession } from '../lib/candidate-session';
import { ApiError, errorMessage, request } from '../lib/api';
export default function Apply() {
  const {access}=useCandidateSession();
  const [enteredAt]=useState(()=>Date.now());
  return access && access.expiresAt > enteredAt ? <VerifiedApply access={access}/> : <Redirect href="/identify"/>;
}
function VerifiedApply({access}:{access:CandidateAccess}) {
  const {setAccess}=useCandidateSession();
  const [form, setForm] = useState<FormValues>({...access.identity});
  const [experience, setExperience] = useState<Experience[]>([]);
  const [photo, setPhoto] = useState<string>(), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [reference, setReference] = useState('');
  const [cv, setCv] = useState<CVUpload | null>();
  const submitting = useRef(false);
  async function submit() {
    if (submitting.current) return;
    if ((form.first_name || '').trim().length < 2 || (form.last_name || '').trim().length < 2 || (form.desired_position || '').trim().length < 2) {setError('Renseignez votre nom, prénom et poste souhaité (au moins deux caractères).'); return;}
    if (!(form.phone || '').trim() && !(form.email || '').trim()) {setError('Renseignez au moins un téléphone ou un email.'); return;}
    if (!consent) {setError('Votre consentement est nécessaire pour transmettre le dossier.'); return;}
    const salary = form.expected_salary ? Number(form.expected_salary.replace(/\s/g, '').replace(',', '.')) : null;
    if (salary !== null && (!Number.isFinite(salary) || salary < 0)) {setError('Le salaire doit être un montant positif.'); return;}
    for (const [key,label] of [['children_count','Nombre d’enfants'],['height','Taille'],['shoe_size','Pointure']]) {if (form[key] && (!Number.isFinite(Number(form[key])) || Number(form[key]) < 0)) {setError(label + ' : valeur invalide.'); return;}}
    const dates = [form.birth_date, ...experience.flatMap(x => [x.start_date,x.end_date])].filter(Boolean);
    if (dates.some(v => !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v)) {setError('Renseignez les dates au format AAAA-MM-JJ.'); return;}
    submitting.current = true; setBusy(true); setError('');
    try {
      const config = await request<{version: number}>('/public/candidates/form-config').catch(e => {if (e instanceof ApiError && e.status === 404) throw new Error('Le serveur recrutement doit être mis à jour avant l’envoi de cette fiche complète.'); throw e;});
      if (config.version < 4) throw new Error('Mise à jour du serveur nécessaire pour conserver tous les champs.');
      const result = await request<{reference: string}>('/public/mobile/candidates', {token:access.token, body: {...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null])), children_count: Number(form.children_count || 0), expected_salary: form.expected_salary ? Number(form.expected_salary.replace(/\s/g, '').replace(',', '.')) : null, height: form.height ? Number(form.height) : null, shoe_size: form.shoe_size ? Number(form.shoe_size) : null, languages: (form.languages || '').split(',').map(v => v.trim()).filter(Boolean), experience, cv: cv || null, photo_data: photo || null, consent: true}});
      setReference(result.reference); setPhoto(undefined); setCv(undefined);
      setForm({first_name: '', last_name: '', phone: '', email: '', desired_position: '', wilaya: '', address: '', availability: ''});
    } catch(e) {setError(errorMessage(e) + ' Si la connexion a été interrompue après l’envoi, vérifiez auprès du recrutement avant de déposer à nouveau.');}
    finally {submitting.current = false; setBusy(false);}
  }
  if (reference) return <Page title="Candidature reçue" subtitle="Conservez cette référence pour consulter votre suivi."><Card><Text selectable style={styles.heading}>{reference}</Text><Text style={styles.subtitle}>Votre dossier a été transmis au service recrutement.</Text><Button title="Consulter mon suivi" onPress={() => router.replace({pathname: '/tracking', params: {reference}})}/></Card></Page>;
  return <Page title="Rejoignez IRON Global" subtitle="Les champs nom, prénom et poste sont obligatoires, ainsi qu’un téléphone ou un email."><CandidateForm lockedIdentity photo={<PhotoField value={photo || ''} onChange={setPhoto} onError={setError}/>} values={form} onChange={setForm} experience={experience} onExperience={setExperience}/><Card><CVField value={cv} onChange={setCv} onError={setError} disabled={busy}/></Card><Card><Pressable accessibilityRole="checkbox" accessibilityState={{checked: consent}} onPress={() => setConsent(!consent)} style={styles.row}><Text style={styles.badge}>{consent ? '✓' : '○'}</Text><Text style={[styles.subtitle, {flex: 1}]}>J’accepte que les informations transmises soient traitées par IRON Global pour ma candidature.</Text></Pressable><ErrorText message={error}/>{error && <Button title="Vérifier à nouveau mon téléphone" secondary onPress={()=>{setAccess(null);router.replace('/identify');}}/>}<Button title="Transmettre ma candidature" busy={busy} disabled={!consent} onPress={() => Alert.alert('Transmettre le dossier ?', 'Votre candidature sera envoyée au service recrutement.', [{text: 'Annuler', style: 'cancel'}, {text: 'Transmettre', onPress: submit}])}/></Card></Page>;
}
