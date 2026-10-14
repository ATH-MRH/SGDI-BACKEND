import { Alert, Image, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button, styles } from './ui';
import { errorMessage } from '../lib/api';
export function PhotoField({value,onChange,onError}:{value:string;onChange:(v:string)=>void;onError:(v:string)=>void}) {
 async function pick(camera:boolean) {
  try {if(camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted){Alert.alert('Accès à la caméra','Autorisez la caméra dans les réglages ou choisissez une photo.');return;}
   const options:ImagePicker.ImagePickerOptions={mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:0.35,base64:true};
   const result=camera?await ImagePicker.launchCameraAsync(options):await ImagePicker.launchImageLibraryAsync(options);
   if(!result.canceled && result.assets[0].base64){const photo=`data:image/jpeg;base64,${result.assets[0].base64}`;if(photo.length>2_000_000)throw new Error('Choisissez une photo plus petite.');onChange(photo);}
  }catch(e){onError(errorMessage(e));}
 }
 return <View style={{gap:12}}><Text style={styles.label}>Photo d’identité</Text>{!!value&&<Image source={{uri:value.startsWith('/')?`https://recrute.irongs.com${value}`:value}} style={styles.photo}/>}<Button title="Prendre une photo" secondary onPress={()=>pick(true)}/><Button title="Choisir dans mes photos" secondary onPress={()=>pick(false)}/>{!!value&&<Button title="Retirer la photo" secondary onPress={()=>onChange('')}/>}</View>;
}
