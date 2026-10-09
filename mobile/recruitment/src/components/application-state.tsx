import { Badge } from './ui';
import { ApplicationState } from '../lib/emploi';

// Les libellés viennent du serveur ; seule la couleur est choisie ici, à partir du code d'état.
const TONES: Record<string, 'neutral' | 'gold' | 'green' | 'red'> = {
  review: 'neutral', reserve: 'neutral', invited: 'gold', interviewed: 'gold', accepted: 'green', transmitted_drh: 'green', recruited: 'green', declined: 'red',
};
export const StateBadge = ({ state }: { state: ApplicationState }) => <Badge label={state.label} tone={TONES[state.status] || 'neutral'} />;
