import { useEffect, useRef, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { CandidateForm } from '../../../components/candidate-form';
import { PhotoField } from '../../../components/photo-field';
import { Button, Card, ErrorState, ErrorText, Loading, Page } from '../../../components/ui';
import { errorMessage } from '../../../lib/api';
import { useCandidateSession } from '../../../lib/candidate-session';
import { useDocuments } from '../../../lib/documents';
import { Account, Experience, formToProfile, FormValues, profileToForm, validateForm } from '../../../lib/emploi';
import { useLoad } from '../../../lib/use-load';

export default function ProfileEdit() {
  const { call, session, ready } = useCandidateSession();
  const account = useLoad(signal => call<Account>('/public/emploi/me', { signal }), 'me', !!session);
  if (!ready) return <Loading />;
  if (ready && !session) return <Redirect href={{ pathname: '/identify', params: { next: 'profile' } }} />;
  if (!account.data && account.loading) return <Loading />;
  if (!account.data) return <ErrorState message={account.error} onRetry={account.reload} />;
  return <Editor account={account.data} />;
}

function Editor({ account }: { account: Account }) {
  const { call } = useCandidateSession();
  const { savePhoto, loadPhoto } = useDocuments();
  const [initial] = useState(() => profileToForm(account.profile, account));
  const [values, setValues] = useState<FormValues>(initial.values), [experience, setExperience] = useState<Experience[]>(initial.experience);
  const [photo, setPhoto] = useState<string>(), [savedPhoto, setSavedPhoto] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saving = useRef(false);

  useEffect(() => {
    if (!account.has_photo) return;
    const controller = new AbortController();
    loadPhoto(controller.signal).then(setSavedPhoto).catch(() => {});
    return () => controller.abort();
  }, [account.has_photo, loadPhoto]);

  async function save() {
    if (saving.current) return;
    const problem = validateForm(values, experience, { needPosition: false });
    if (problem) { setError(problem); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      await call('/public/emploi/me/profile', { method: 'PUT', body: formToProfile(values, experience, account.profile) });
      if (photo !== undefined) await savePhoto(photo);
      router.back();
    } catch (e) { setError(errorMessage(e)); }
    finally { saving.current = false; setBusy(false); }
  }

  return (
    <Page title="Mes informations" subtitle="Ces informations préremplissent vos candidatures. Votre nom, prénom et téléphone sont ceux vérifiés par SMS.">
      <CandidateForm lockedIdentity values={values} onChange={setValues} experience={experience} onExperience={setExperience}
        photo={<PhotoField value={photo ?? savedPhoto} onChange={setPhoto} onError={setError} />} />
      <Card>
        <ErrorText message={error} />
        <Button title="Enregistrer mon profil" busy={busy} onPress={save} />
      </Card>
    </Page>
  );
}
