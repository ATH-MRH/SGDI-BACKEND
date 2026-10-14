import { Alert, Platform } from 'react-native';

/** Demande de confirmation native ; dans l'aperçu web, la boîte de dialogue du navigateur. */
export function confirm(title: string, message: string, action: string, onConfirm: () => void, destructive = false) {
  if (Platform.OS === 'web') { if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm(); return; }
  Alert.alert(title, message, [{ text: 'Annuler', style: 'cancel' }, { text: action, style: destructive ? 'destructive' : 'default', onPress: onConfirm }]);
}
