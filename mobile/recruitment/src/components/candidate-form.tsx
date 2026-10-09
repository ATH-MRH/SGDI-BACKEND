import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Field, styles } from './ui';
import { request } from '../lib/api';
import schema from '../lib/form-schema.json';
import locations from '../lib/locations.json';
export type FormValues = Record<string,string>;
export type Experience = Record<'society'|'position'|'start_date'|'end_date'|'departure_reason',string>;
export function Select({label,value,options,onChange}:{label:string;value:string;options:{value:string;label:string}[];onChange:(v:string)=>void}) {
 const [open,setOpen]=useState(false),[search,setSearch]=useState('');
 return <View style={styles.field}><Text style={styles.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.input} onPress={()=>{setSearch('');setOpen(true);}}><Text>{options.find(o=>o.value===value)?.label||value||'— Choisir —'} ▾</Text></Pressable><Modal visible={open} onRequestClose={()=>setOpen(false)} animationType="slide"><View style={{flex:1,padding:24,paddingTop:64,gap:12}}><Text style={styles.heading}>{label}</Text><Field label="Rechercher" value={search} onChangeText={setSearch}/><Button title="Fermer" secondary onPress={()=>setOpen(false)}/><ScrollView keyboardShouldPersistTaps="handled">{options.filter(o=>o.label.toLowerCase().includes(search.toLowerCase())).map(o=><Pressable key={o.value} style={{padding:16}} onPress={()=>{onChange(o.value);setOpen(false);}}><Text style={styles.subtitle}>{o.label}</Text></Pressable>)}</ScrollView></View></Modal></View>;
}
export function CandidateForm({values,onChange,experience,onExperience,staff=false,token,photo,lockedIdentity=false,hidden=[]}:{values:FormValues;onChange:(v:FormValues)=>void;experience:Experience[];onExperience:(v:Experience[])=>void;staff?:boolean;token?:string;photo?:React.ReactNode;lockedIdentity?:boolean;hidden?:string[]}) {
 const [positions,setPositions]=useState(locations.positions);
 // Le référentiel des postes est réservé aux comptes RH : un candidat utilise la liste embarquée.
 useEffect(()=>{if(!token)return;const controller=new AbortController();request<{name:string}[]>('/irongs/positions',{token,signal:controller.signal}).then(rows=>{if(!controller.signal.aborted&&Array.isArray(rows)&&rows.length)setPositions([...new Set(rows.map(r=>r.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')));}).catch(()=>{});return()=>controller.abort();},[token]);
 const set=(key:string,value:string)=>onChange({...values,[key]:value,...(key==='wilaya'?{commune:''}:{})});
 return <>{schema.filter((_,i)=>staff||i<3).map((section,i)=><Card key={section.title}><Text style={styles.heading}>{section.title}</Text>{i===0&&photo}{section.fields.filter(f=>(staff||f.key!=='notes')&&!hidden.includes(f.key)).map(f=>{
 let options=f.options;
 if(f.key==='desired_position')options=[{value:'',label:'— Choisir —'},...positions.map(value=>({value,label:value}))];
 if(f.key==='wilaya')options=[{value:'',label:'— Choisir —'},...locations.wilayas.map(([code,value])=>({value,label:`${code} - ${value}`}))];
 if(f.key==='commune'){const code=locations.wilayas.find(([,name])=>name===values.wilaya)?.[0];const communes=locations.communes as Record<string,string[]>;options=[{value:'',label:'— Choisir —'},...(communes[code||'']||[]).map(value=>({value,label:value}))];}
 return options.length?<Select key={f.key} label={f.label} value={values[f.key]||''} options={options} onChange={v=>set(f.key,v)}/>:<Field key={f.key} editable={!(lockedIdentity&&['first_name','last_name','phone'].includes(f.key))} label={f.label+(f.date?' (AAAA-MM-JJ)':'')} value={values[f.key]||''} onChangeText={v=>set(f.key,v)} multiline={f.multiline} maxLength={f.maxLength||(f.date?10:undefined)} keyboardType={f.numeric?'decimal-pad':f.key.includes('phone')?'phone-pad':f.key==='email'?'email-address':'default'} autoCapitalize={f.key==='email'?'none':'sentences'}/>;
 })}{i===2&&<><Text style={styles.heading}>Expérience professionnelle</Text>{experience.map((row,index)=><View key={index} style={{gap:12}}>{([['society','Société'],['position','Poste'],['start_date','Du (AAAA-MM-JJ)'],['end_date','Au (AAAA-MM-JJ)'],['departure_reason','Motif du départ']] as const).map(([key,label])=><Field key={key} label={label} value={row[key]} onChangeText={v=>onExperience(experience.map((x,j)=>j===index?{...x,[key]:v}:x))}/>)}<Button title="Retirer cette expérience" secondary onPress={()=>onExperience(experience.filter((_,j)=>j!==index))}/></View>)}<Button title="+ Ajouter une ligne" secondary disabled={experience.length>=20} onPress={()=>onExperience([...experience,{society:'',position:'',start_date:'',end_date:'',departure_reason:''}])}/></>}</Card>)}</>;
}
