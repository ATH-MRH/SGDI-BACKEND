import { useRef, useState } from 'react';
import { router } from 'expo-router';
import { Button, Card, ErrorText, Field, Page } from '../components/ui';
import { errorMessage, request } from '../lib/api';
import { useCandidateSession } from '../lib/candidate-session';
export default function Identify(){
 const {pending,setPending,setAccess}=useCandidateSession();
 const [form,setForm]=useState(pending?.identity||{first_name:'',last_name:'',phone:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const guard=useRef(false);
 async function send(){
  if(guard.current)return;
  const identity={first_name:form.first_name.trim(),last_name:form.last_name.trim(),phone:form.phone.trim()};
  if(identity.first_name.length<2||identity.last_name.length<2){setError('Renseignez votre nom et prénom (au moins deux caractères).');return;}
  if(!identity.phone){setError('Renseignez votre numéro de téléphone.');return;}
  guard.current=true;setBusy(true);setError('');
  try{const result=await request<{challenge_id:string;phone:string;expires_in:number;resend_after:number}>('/public/mobile/request-code',{body:identity});
   setAccess(null);setPending({identity:{...identity,phone:result.phone},challengeId:result.challenge_id,expiresAt:Date.now()+result.expires_in*1000,resendAt:Date.now()+result.resend_after*1000});router.push('/verify');
  }catch(e){setError(errorMessage(e));}finally{guard.current=false;setBusy(false);}
 }
 return <Page title="Déposer ma candidature" subtitle="Commencez par votre identité. Nous vérifierons votre numéro de téléphone par SMS."><Card><Field label="Nom" value={form.last_name} editable={!busy} maxLength={100} onChangeText={v=>setForm({...form,last_name:v})}/><Field label="Prénom" value={form.first_name} editable={!busy} maxLength={100} onChangeText={v=>setForm({...form,first_name:v})}/><Field label="Numéro de téléphone" value={form.phone} editable={!busy} keyboardType="phone-pad" maxLength={30} placeholder="05, 06 ou 07…" onChangeText={v=>setForm({...form,phone:v})}/><ErrorText message={error}/><Button title="Recevoir le code par SMS" busy={busy} onPress={send}/></Card></Page>;
}
