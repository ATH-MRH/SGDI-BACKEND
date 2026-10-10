import { TabStack } from '../../../components/tab-stack';

// Détail d'offre et page entreprise portent leur propre bannière, sans en-tête.
export default function Layout() { return <TabStack plain={['[id]', 'company/[id]']} />; }
