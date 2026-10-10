import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { ensureAccessToken } from '@/api';
import { getSessionToken, onSessionRenewed } from '@/auth/session';
import { env } from '@/config/env';
import { colors } from '@/theme/tokens';

import { Avatar } from './Avatar';

type Props = {
  employeeId: number | null | undefined;
  name: string;
  /** Largeur. La hauteur est la même, sauf en format portrait. */
  size?: number;
  square?: boolean;
  /** Format 3:4 du portrait servi par le backend : la photo est montrée entière, sans recadrage. */
  portrait?: boolean;
  /** false : la fiche n'a aucune photo, rien n'est demandé. Inconnu (undefined) : la photo est tentée. */
  hasPhoto?: boolean;
  /** La photo a été demandée et n'a pas pu être affichée. */
  onUnavailable?: () => void;
  testID?: string;
};

/**
 * Portrait d'un employé, servi par le backend ATLAS (GET /api/drh/employees/{id}/portrait).
 *
 * La route est authentifiée : le jeton n'est envoyé qu'à l'hôte ATLAS configuré, sur ce chemin
 * fixe. Un jeton expiré est renouvelé avant la demande, et la photo est redemandée quand la
 * session est renouvelée. Sans photo, sans droit ou hors connexion, les initiales sont
 * affichées : jamais d'image de remplacement.
 */
export function EmployeePhoto({ employeeId, name, size = 44, square = false, portrait = false, hasPhoto, onUnavailable, testID }: Props) {
  const wanted = hasPhoto !== false && Boolean(env.apiUrl) && typeof employeeId === 'number' && Number.isInteger(employeeId) && employeeId > 0;
  // Jeton obtenu après un renouvellement ; le jeton courant de la session est toujours préféré.
  const [renewedToken, setRenewedToken] = useState<string | null>(null);
  // Employé dont la photo a échoué : changer d'employé relance une tentative.
  const [failedFor, setFailedFor] = useState<number | null>(null);
  const token = wanted ? (getSessionToken() ?? renewedToken) : null;
  const failed = failedFor !== null && failedFor === employeeId;

  useEffect(() => {
    if (!wanted) return undefined;
    let active = true;
    // Jeton d'accès expiré : il est renouvelé ici, sinon la photo ne serait jamais demandée.
    if (!getSessionToken()) {
      void ensureAccessToken().then((fresh) => {
        if (active && fresh) setRenewedToken(fresh);
      });
    }
    const unsubscribe = onSessionRenewed((session) => {
      if (!active) return;
      setRenewedToken(session.token);
      setFailedFor(null);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [wanted, employeeId]);

  const height = portrait ? Math.round((size * 4) / 3) : size;
  const borderRadius = square || portrait ? Math.round(size * 0.18) : size / 2;
  if (!wanted || !token || failed) {
    return (
      <View style={portrait ? [styles.center, { width: size, height }] : undefined}>
        <Avatar name={name} size={size} square={square || portrait} />
      </View>
    );
  }
  return (
    <View style={[styles.frame, { width: size, height, borderRadius }]} accessibilityElementsHidden importantForAccessibility="no">
      <Image
        testID={testID}
        source={{ uri: `${env.apiUrl}/api/drh/employees/${employeeId}/portrait`, headers: { Authorization: `Bearer ${token}` } }}
        onError={() => {
          setFailedFor(employeeId ?? null);
          onUnavailable?.();
        }}
        resizeMode="cover"
        style={{ width: size, height, borderRadius }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: colors.primarySoft, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong },
  center: { alignItems: 'center', justifyContent: 'center' },
});
