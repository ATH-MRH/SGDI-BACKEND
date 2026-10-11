import type { ReactNode } from 'react';

import { AtlasHeader } from './AtlasHeader';

type Props = { title: string; subtitle?: string; trailing?: ReactNode };

/** En-tête d'un écran de détail : retour, titre, contexte. */
export function ScreenHeader({ title, subtitle, trailing }: Props) {
  return <AtlasHeader back title={title} subtitle={subtitle} trailing={trailing} />;
}
