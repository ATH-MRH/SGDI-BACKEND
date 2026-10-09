import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Button, styles } from './ui';
import { API, errorMessage } from '../lib/api';
export type CVUpload = {name:string;mime_type:string;data_base64:string};
export type CVMetadata = {name:string;mime_type:string;size:number};
const MAX_BYTES=5*1024*1024;
const types:Record<string,string>={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'};
export function CVField({value,existing,onChange,onError,candidateId,token,disabled=false}:{value?:CVUpload|null;existing?:CVMetadata;onChange:(v:CVUpload|null)=>void;onError:(message:string)=>void;candidateId?:number;token?:string;disabled?:boolean}) {
 const [busy,setBusy]=useState(false);
 async function pick() {
  setBusy(true);
  try {const result=await DocumentPicker.getDocumentAsync({type:['application/pdf','image/jpeg','image/png'],copyToCacheDirectory:true,multiple:false});if(result.canceled)return;
   const asset=result.assets[0];const mime=types[asset.name.split('.').pop()?.toLowerCase()||''];if(!mime||(asset.mimeType && asset.mimeType!=='application/octet-stream' && asset.mimeType!==mime))throw new Error('Choisissez un CV PDF, JPG ou PNG.');
   if(asset.size!==undefined&&(asset.size===0||asset.size>MAX_BYTES))throw new Error('Le CV doit être non vide et faire au maximum 5 Mo.');
   let base64:string;
   if(Platform.OS==='web' && asset.file){const bytes=new Uint8Array(await asset.file.arrayBuffer());if(bytes.length>MAX_BYTES)throw new Error('Le CV dépasse 5 Mo.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));base64=btoa(binary);}
   else {const file=new File(asset.uri);if(!file.size||file.size>MAX_BYTES)throw new Error('Le CV doit être non vide et faire au maximum 5 Mo.');base64=await file.base64();}
   if(base64.length>Math.ceil(MAX_BYTES/3)*4)throw new Error('Le CV dépasse 5 Mo.');onChange({name:asset.name.slice(0,180),mime_type:mime,data_base64:base64});
  }catch(e){onError(errorMessage(e));}finally{setBusy(false);}
 }
 async function open() {
  if(!candidateId||!token||!existing)return;setBusy(true);
  try {const response=await fetch(`${API}/drh/candidates/${candidateId}/cv`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error('Impossible de télécharger le CV. Vérifiez votre connexion et vos droits.');
   if(Platform.OS==='web'){const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download=existing.name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
   else {if(!(await Sharing.isAvailableAsync()))throw new Error('L’ouverture de fichiers est indisponible sur cet appareil.');const ext=Object.entries(types).find(([,mime])=>mime===existing.mime_type)?.[0]||'pdf';const file=new File(Paths.cache,`CV-${candidateId}-${Date.now()}.${ext}`);file.create();file.write(new Uint8Array(await response.arrayBuffer()));await Sharing.shareAsync(file.uri,{mimeType:existing.mime_type,dialogTitle:'Ouvrir ou enregistrer le CV'});}
  }catch(e){onError(errorMessage(e));}finally{setBusy(false);}
 }
 const name=value?.name || (value===null?'':existing?.name);
 return <View style={{gap:12}}><Text style={styles.heading}>Curriculum vitae (CV)</Text><Text style={styles.subtitle}>Facultatif · PDF, JPG ou PNG · 5 Mo maximum</Text>{!!name&&<Text selectable style={styles.label}>{name}</Text>}<Button title={name?'Remplacer le CV':'Joindre mon CV'} secondary busy={busy} disabled={disabled} onPress={pick}/>{!!name&&<Button title="Retirer le CV" secondary disabled={busy||disabled} onPress={()=>onChange(null)}/>} {!!existing&&value!==null&&candidateId&&<Button title="Ouvrir / enregistrer le CV joint" secondary disabled={busy} onPress={open}/>}</View>;
}
