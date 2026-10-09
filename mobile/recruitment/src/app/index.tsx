import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, colors, styles } from '../components/ui';
export default function Home() {
  return <SafeAreaView style={{flex:1,backgroundColor:colors.background}}><View style={{flex:1,padding:28,justifyContent:'center',gap:22}}><Text style={styles.eyebrow}>IRON GLOBAL · RECRUTEMENT</Text><View style={{height:5,width:50,backgroundColor:colors.gold,borderRadius:5}}/><Text style={styles.title}>Votre avenir commence ici.</Text><Text style={styles.subtitle}>Rejoignez les équipes IRON Global.</Text><Button title="Postuler / Déposer ma candidature" onPress={()=>router.push('/identify')}/></View><Pressable accessibilityRole="link" accessibilityLabel="Accès administration" onPress={()=>router.push('/login')} style={{alignItems:'center',padding:18}}><Text style={{fontSize:12,color:colors.muted}}>Accès adm.</Text></Pressable></SafeAreaView>;
}
