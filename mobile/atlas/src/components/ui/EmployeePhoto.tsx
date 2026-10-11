import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { usePortrait, type PortraitIssue } from '@/features/employees/usePortrait';
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
  /** La photo a été demandée et n'a pas pu être affichée ; `issue` dit pourquoi. */
  onUnavailable?: (issue: PortraitIssue) => void;
  testID?: string;
};

const UNREADABLE: PortraitIssue = { kind: 'error', status: 200, reason: 'undecodable' };

/**
 * Portrait d'un employé. L'image est chargée par une requête authentifiée (voir usePortrait)
 * et affichée depuis la mémoire : <Image> ne reçoit jamais l'adresse du backend ni le jeton.
 * Sans photo, hors périmètre, hors connexion ou pendant le chargement, les initiales sont
 * affichées : jamais d'image de remplacement.
 */
export function EmployeePhoto({ employeeId, name, size = 44, square = false, portrait = false, hasPhoto, onUnavailable, testID }: Props) {
  const { uri, issue } = usePortrait(employeeId, hasPhoto !== false);
  // Image reçue mais illisible par la plateforme : on retombe sur les initiales.
  const [brokenUri, setBrokenUri] = useState<string | null>(null);
  const broken = uri !== null && brokenUri === uri;

  useEffect(() => {
    if (issue) onUnavailable?.(issue);
    // Signalé une fois par changement d'état du portrait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.kind, issue?.status, issue?.reason]);

  const height = portrait ? Math.round((size * 4) / 3) : size;
  const borderRadius = square || portrait ? Math.round(size * 0.18) : size / 2;
  if (!uri || broken) {
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
        source={{ uri }}
        onError={() => {
          setBrokenUri(uri);
          onUnavailable?.(UNREADABLE);
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
