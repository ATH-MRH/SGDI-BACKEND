import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert } from 'react-native';
import { Button, Card, ErrorText, Page } from '../../components/ui';
import { ApiError, Candidate, CandidatePage, errorMessage, request } from '../../lib/api';
import { CandidateForm, Experience, FormValues } from '../../components/candidate-form';
import { CVField, CVMetadata, CVUpload } from '../../components/cv-field';
import { PhotoField } from '../../components/photo-field';
import mapping from '../../lib/form-mapping.json';
import { useSession } from '../../lib/session';
export default function CandidateDetails() {
  const params = useLocalSearchParams<{id: string; page: string; mode: string; q?: string}>();
  const {token, logout} = useSession();
  const [candidate, setCandidate] = useState<Candidate>(), [error, setError] = useState(''), [busy, setBusy] = useState(true), [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<FormValues>({}), [experience, setExperience] = useState<Experience[]>([]), [saving, setSaving] = useState(false);
  const [cv, setCv] = useState<CVUpload | null>();
  useEffect(() => {const controller = new AbortController(); // Reset the previous result before starting this server subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true); setError(''); setCandidate(undefined);
    request<CandidatePage>(`/drh/candidates/page?mode=${encodeURIComponent(params.mode || 'pool')}&page=${Number(params.page) || 1}&page_size=25&q=${encodeURIComponent(params.q || '')}`, {token: token!, signal: controller.signal})
      .then(result => {if (controller.signal.aborted) return; const found = result.items.find(item => item.id === Number(params.id)); if (!found) throw new Error('Ce dossier a changé. Revenez à la liste et actualisez-la.'); setCandidate(found); setCv(undefined); const data = found.data || {}; setForm({...Object.fromEntries(Object.entries(mapping).map(([key,value]) => [key,String(data[value] ?? '')])), first_name: found.first_name, last_name: found.last_name, phone: found.phone || '', email: found.email || '', desired_position: found.desired_position || '', expected_salary: String((found as Candidate & {expected_salary?:number}).expected_salary ?? ''), photo: String(data.photo || ''), languages: Array.isArray(data.langues) ? data.langues.join(', ') : ''}); setExperience(Array.isArray(data.experience) ? data.experience.map((x: Record<string,string>) => ({society:x.societe || '',position:x.poste || '',start_date:x.du || '',end_date:x.au || '',departure_reason:x.motif || ''})) : []);})
      .catch(async e => {if (!controller.signal.aborted) {setError(errorMessage(e)); if (e instanceof ApiError && e.status === 401) await logout();}})
      .finally(() => {if (!controller.signal.aborted) setBusy(false);}); return () => controller.abort();
  }, [params.id, params.page, params.mode, params.q, token, refresh, logout]);
  async function save() {
    if (!candidate || saving) return;
    setSaving(true); setError('');
    try {const salary = form.expected_salary ? Number(form.expected_salary.replace(/\s/g, '').replace(',', '.')) : null; if (salary !== null && (!Number.isFinite(salary) || salary < 0)) throw new Error('Le salaire est invalide.');
      await request(`/drh/candidates/${candidate.id}`, {token: token!, method: 'PUT', body: {first_name: form.first_name.trim(), last_name: form.last_name.trim(), phone: form.phone, email: form.email, desired_position: form.desired_position, society: candidate.society || null, expected_salary: salary, data: {...candidate.data, ...(cv !== undefined ? {cvUpload:cv} : {}), photo:form.photo || '', ...Object.fromEntries(Object.entries(mapping).map(([key,value]) => [value, key === 'children_count' ? Number(form[key] || 0) : form[key] || ''])), nom: form.last_name, prenom: form.first_name, telephone: form.phone, email: form.email, posteSouhaite: form.desired_position, salairePrevu: salary, langues: (form.languages || '').split(',').map(x => x.trim()).filter(Boolean), experience: experience.map(x => ({societe:x.society,poste:x.position,du:x.start_date,au:x.end_date,motif:x.departure_reason}))}}}); Alert.alert('Enregistré', 'Le dossier candidat a été mis à jour.'); setRefresh(v => v + 1);
    } catch(e) {setError(errorMessage(e));} finally {setSaving(false);}
  }
  return <Page title="Fiche de renseignement candidat" subtitle="Même fiche que dans le module recrutement web.">{busy && <ActivityIndicator/>}<ErrorText message={error}/>{error && !candidate && <Button title="Réessayer" onPress={() => setRefresh(v => v + 1)}/>} {candidate && <><CandidateForm photo={<PhotoField value={form.photo || ''} onChange={v => setForm({...form,photo:v})} onError={setError}/>} staff token={token || undefined} values={form} onChange={setForm} experience={experience} onExperience={setExperience}/><Card><CVField value={cv} existing={candidate.data?.cv as CVMetadata | undefined} onChange={setCv} onError={setError} candidateId={candidate.id} token={token || undefined} disabled={saving}/></Card><Button title="Enregistrer" busy={saving} onPress={save}/></>}</Page>;
}
