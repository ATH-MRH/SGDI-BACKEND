import { Badge } from './ui';
import { ApplicationState, stateTone } from '../lib/emploi';

export const StateBadge = ({ state }: { state: ApplicationState }) => <Badge label={state.label} tone={stateTone(state.status)} />;
