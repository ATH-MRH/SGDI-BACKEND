import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Button, Card, ErrorText, Field, Page } from '../components/ui';
import { useSession } from '../lib/session';
import { errorMessage } from '../lib/api';
export default function Login() {
  const {login, token, ready} = useSession();
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (ready && token) return <Redirect href="/staff"/>;
  async function submit() { setBusy(true); setError(''); try { await login(username, password); setPassword(''); router.replace('/staff'); } catch (e) { setError(errorMessage(e)); } finally {setBusy(false);} }
  return <Page title="Connexion RH" subtitle="Utilisez votre compte recrutement existant."><Card><Field label="Identifiant" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username"/><Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"/><ErrorText message={error}/><Button title="Se connecter" onPress={submit} busy={busy} disabled={!ready || !username.trim() || !password}/></Card></Page>;
}
