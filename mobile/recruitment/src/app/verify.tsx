import { useEffect, useRef, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Text } from 'react-native';
import { Button, Card, ErrorText, Field, Page, styles } from '../components/ui';
import { errorMessage, request } from '../lib/api';
import { CandidateIdentity, PendingCode, useCandidateSession } from '../lib/candidate-session';
export default function Verify(){const {pending}=useCandidateSession();return pending?<CodeForm pending={pending}/>:<Redirect href="/identify"/>;}
function CodeForm({pending}:{pending:PendingCode}){
 const {setPending,setAccess}=useCandidateSession();const [code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(()=>Date.now());const guard=useRef(false);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const wait=Math.max(0,Math.ceil((pending.resendAt-now)/1000));
 async function verify(){if(guard.current)return;if(!/^\d{6}$/.test(code)){setError('Saisissez les six chiffres reçus par SMS.');return;}guard.current=true;setBusy(true);setError('');
  try{const result=await request<{access_token:string;expires_in:number;identity:CandidateIdentity}>('/public/mobile/verify-code',{body:{challenge_id:pending.challengeId,code}});setAccess({identity:result.identity,token:result.access_token,expiresAt:Date.now()+result.expires_in*1000});router.replace('/apply');}
  catch(e){setError(errorMessage(e));}finally{guard.current=false;setBusy(false);}
 }
 async function resend(){if(guard.current||wait)return;guard.current=true;setBusy(true);setError('');
  try{const result=await request<{challenge_id:string;phone:string;expires_in:number;resend_after:number}>('/public/mobile/request-code',{body:pending.identity});setPending({...pending,identity:{...pending.identity,phone:result.phone},challengeId:result.challenge_id,expiresAt:Date.now()+result.expires_in*1000,resendAt:Date.now()+result.resend_after*1000});setCode('');}
  catch(e){setError(errorMessage(e));}finally{guard.current=false;setBusy(false);}
 }
 return <Page title="Vérifiez votre téléphone" subtitle={`Un code a été demandé pour le ${pending.identity.phone}. Il vous parviendra par SMS.`}><Card><Text style={styles.subtitle}>{now>=pending.expiresAt?'Le code a expiré. Demandez un nouveau code.':'Le code est valable cinq minutes.'}</Text><Field label="Code de validation" value={code} onChangeText={v=>setCode(v.replace(/\D/g,''))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} editable={!busy}/><ErrorText message={error}/><Button title="Valider et accéder au formulaire" busy={busy} disabled={now>=pending.expiresAt} onPress={verify}/><Button title={wait?`Renvoyer le code dans ${wait} s`:'Renvoyer le code'} secondary disabled={busy||wait>0} onPress={resend}/><Button title="Modifier mon numéro" secondary disabled={busy} onPress={()=>router.replace('/identify')}/></Card></Page>;
}
