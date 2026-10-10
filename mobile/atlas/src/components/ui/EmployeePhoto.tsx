import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { getSessionToken } from '@/auth/session';
import { env } from '@/config/env';
import { colors } from '@/theme/tokens';

import { Avatar } from './Avatar';

type Props = { employeeId: number | null | undefined; name: string; size?: number; square?: boolean; testID?: string };

/**
 * Portrait d'un employé, servi par le backend ATLAS (GET /api/drh/employees/{id}/portrait).
 *
 * Le jeton n'est envoyé qu'à l'hôte ATLAS configuré, sur ce chemin fixe. Sans photo, sans
 * droit ou hors connexion, les initiales sont affichées : jamais d'image de remplacement.
 */
export function EmployeePhoto({ employeeId, name, size = 44, square = false, testID }: Props) {
  const [failed, setFailed] = useState(false);
  const token = getSessionToken();
  const usable = Boolean(env.apiUrl) && Boolean(token) && typeof employeeId === 'number' && Number.isInteger(employeeId) && employeeId > 0;
  if (!usable || failed) return <Avatar name={name} size={size} square={square} />;
  const borderRadius = square ? Math.round(size * 0.22) : size / 2;
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius }]} accessibilityElementsHidden importantForAccessibility="no">
      <Image
        testID={testID}
        source={{ uri: `${env.apiUrl}/api/drh/employees/${employeeId}/portrait`, headers: { Authorization: `Bearer ${token}` } }}
        onError={() => setFailed(true)}
        resizeMode="cover"
        style={{ width: size, height: size, borderRadius }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: colors.primarySoft, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
});
