import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './ui';
import { badgeLabel } from '../lib/notification-count';

/** A count of unread items, never a count of delivered push attempts. */
export function NotificationCount({ count }: { count: number }) {
  const label = badgeLabel(count);
  if (!label) return null;
  return <View accessibilityLabel={`${count} élément${count > 1 ? 's' : ''} non lu${count > 1 ? 's' : ''}`} style={styles.badge}><Text style={styles.text}>{label}</Text></View>;
}
const styles = StyleSheet.create({ badge: { position: 'absolute', right: -3, top: -4, minWidth: 19, height: 19, paddingHorizontal: 4, borderRadius: 10, backgroundColor: '#BF303C', borderWidth: 1.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' }, text: { color: colors.white, fontFamily: fonts.bold, fontSize: 10, lineHeight: 13 } });
