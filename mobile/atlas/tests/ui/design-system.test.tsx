import { render, screen } from '@testing-library/react-native';

import { presenceRate } from '@/api/domains/attendance';
import { fetchDrhDashboard } from '@/api/domains/drh';
import type { ApiClient } from '@/api/client';
import { BarChart, Banner, Distribution, EmployeePhoto, EmployeeRow, KpiCard, RingGauge, SiteRow } from '@/components/ui';
import { percent, shortDate, weekdayKey } from '@/features/cockpit/presentation';
import { isIncidentOpen } from '@/features/cockpit/useCockpitInsights';
import { employeeStatusTone } from '@/features/status';

let mockToken: string | null = null;
let mockApiUrl: string | null = 'https://atlas.example.test';

jest.mock('@/auth/session', () => ({ getSessionToken: () => mockToken }));
jest.mock('@/config/env', () => ({
  get env() {
    return { apiUrl: mockApiUrl, variant: 'staging', features: {}, storeUrls: { ios: null, android: null } };
  },
  isFeatureEnabled: () => false,
}));

beforeEach(() => {
  mockToken = null;
  mockApiUrl = 'https://atlas.example.test';
});

describe('indicateurs : jamais de valeur inventée', () => {
  it("une carte en erreur n'affiche aucun chiffre et le dit", async () => {
    await render(<KpiCard testID="kpi" label="Présents" value={null} state="error" unavailableLabel="Indisponible" />);
    expect(screen.getByTestId('kpi')).toHaveTextContent(/Indisponible/);
    expect(screen.getByTestId('kpi')).not.toHaveTextContent(/\d/);
    expect(screen.getByTestId('kpi').props.accessibilityLabel).toBe('Présents : Indisponible');
  });

  it("une carte en chargement n'affiche ni chiffre ni tiret", async () => {
    await render(<KpiCard testID="kpi" label="Présents" value={null} state="loading" />);
    expect(screen.getByTestId('kpi')).not.toHaveTextContent(/\d|—/);
  });

  it('une carte prête affiche sa valeur et reste lisible par un lecteur d’écran', async () => {
    await render(<KpiCard testID="kpi" label="Sites actifs" value={24} onPress={() => undefined} />);
    expect(screen.getByTestId('kpi')).toHaveTextContent(/24/);
    expect(screen.getByTestId('kpi').props.accessibilityLabel).toBe('Sites actifs : 24');
    expect(screen.getByTestId('kpi').props.accessibilityRole).toBe('button');
  });

  it('le taux de présence est inconnu quand personne n’est attendu', () => {
    expect(presenceRate({ expected: 0, present: 0 })).toBeNull();
    expect(presenceRate(null)).toBeNull();
    expect(presenceRate({ expected: 10, present: 9 })).toBe(0.9);
    expect(presenceRate({ expected: 10, present: 14 })).toBe(1);
    expect(percent(null)).toBe('—');
    expect(percent(0.956)).toBe('96 %');
  });
});

describe('graphiques simples', () => {
  it('une barre sans valeur affiche un tiret, pas un zéro', async () => {
    await render(
      <BarChart
        testID="bars"
        unit="%"
        data={[
          { key: 'a', label: 'Lun', value: 92 },
          { key: 'b', label: 'Mar', value: null },
          { key: 'c', label: 'Mer', value: 0 },
        ]}
      />,
    );
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it("l'anneau affiche le taux, ou un tiret s'il est inconnu", async () => {
    const view = await render(<RingGauge testID="ring" ratio={0.87} />);
    expect(screen.getByTestId('ring')).toHaveTextContent(/87 %/);
    await view.rerender(<RingGauge testID="ring" ratio={null} />);
    expect(screen.getByTestId('ring')).toHaveTextContent(/—/);
    expect(screen.getByTestId('ring')).not.toHaveTextContent(/\d/);
  });

  it('la répartition donne la valeur et la part de chaque segment', async () => {
    await render(
      <Distribution
        testID="split"
        segments={[
          { key: 'a', label: 'Site Nord', value: 30 },
          { key: 'b', label: 'Site Sud', value: 10 },
        ]}
      />,
    );
    expect(screen.getByTestId('split')).toHaveTextContent(/Site Nord30.*75 %/);
    expect(screen.getByTestId('split')).toHaveTextContent(/Site Sud10.*25 %/);
  });

  it('une répartition vide ne calcule aucune part', async () => {
    await render(<Distribution testID="split" segments={[{ key: 'a', label: 'Site Nord', value: 0 }]} />);
    expect(screen.getByTestId('split')).toHaveTextContent(/—/);
    expect(screen.getByTestId('split')).not.toHaveTextContent(/%/);
  });
});

describe('photo employé', () => {
  it('sans session, les initiales remplacent la photo et aucun appel ne part', async () => {
    await render(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" />);
    expect(screen.queryByTestId('photo', { includeHiddenElements: true })).toBeNull();
    // La photo est décorative : elle est masquée aux lecteurs d'écran, le nom est porté par la ligne.
    expect(screen.getByText('BK', { includeHiddenElements: true })).toBeTruthy();
  });

  it("avec une session, la photo est demandée à l'hôte ATLAS configuré, sur la route du portrait", async () => {
    mockToken = 'jeton-de-test';
    await render(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" />);
    const source = screen.getByTestId('photo', { includeHiddenElements: true }).props.source;
    expect(source.uri).toBe('https://atlas.example.test/api/drh/employees/5/portrait');
    expect(source.headers).toEqual({ Authorization: 'Bearer jeton-de-test' });
  });

  it.each([null, undefined, 0, -3, 2.5])('un identifiant inutilisable (%p) ne déclenche aucune requête', async (id) => {
    mockToken = 'jeton-de-test';
    await render(<EmployeePhoto testID="photo" employeeId={id} name="BENALI Karim" />);
    expect(screen.queryByTestId('photo', { includeHiddenElements: true })).toBeNull();
  });

  it("sans URL d'API, aucune photo n'est demandée", async () => {
    mockToken = 'jeton-de-test';
    mockApiUrl = null;
    await render(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" />);
    expect(screen.queryByTestId('photo', { includeHiddenElements: true })).toBeNull();
  });
});

describe('lignes de liste', () => {
  it('une ligne employé montre nom, matricule, fonction et statut ; elle n’est un bouton que si elle ouvre quelque chose', async () => {
    const view = await render(<EmployeeRow testID="row" employeeId={null} name="BENALI Karim" code="AGT005" position="Agent" detail="Site Nord" />);
    expect(screen.getByTestId('row')).toHaveTextContent(/BENALI Karim.*AGT005.*Agent · Site Nord/);
    expect(screen.getByTestId('row').props.accessibilityRole).not.toBe('button');
    await view.rerender(<EmployeeRow testID="row" employeeId={null} name="BENALI Karim" onPress={() => undefined} />);
    expect(screen.getByTestId('row').props.accessibilityRole).toBe('button');
  });

  it("une ligne de site n'affiche un effectif que s'il est connu", async () => {
    const view = await render(<SiteRow testID="site" name="Site Sud" staff={null} staffLabel="0 prévus" />);
    expect(screen.getByTestId('site')).not.toHaveTextContent(/prévus/);
    await view.rerender(<SiteRow testID="site" name="Site Sud" staff={12} staffLabel="12 prévus" />);
    expect(screen.getByTestId('site')).toHaveTextContent(/12 prévus/);
  });

  it('un bandeau porte son message sans que l’icône ne le pollue', async () => {
    await render(<Banner testID="banner" tone="danger" message="Identifiant ou mot de passe incorrect." />);
    expect(screen.getByTestId('banner')).toHaveTextContent('Identifiant ou mot de passe incorrect.');
  });
});

describe('règles de présentation', () => {
  it('un incident reste ouvert tant que son statut ne dit pas le contraire', () => {
    for (const status of ['ouvert', 'en cours', 'nouveau', '']) expect(isIncidentOpen({ status })).toBe(true);
    for (const status of ['clos', 'Clôturé', 'résolu', 'resolu', 'fermé', 'traité', 'terminé']) expect(isIncidentOpen({ status })).toBe(false);
  });

  it('un statut RH inconnu reste neutre', () => {
    expect(employeeStatusTone('actif')).toBe('success');
    expect(employeeStatusTone('suspendu')).toBe('danger');
    expect(employeeStatusTone('sortant')).toBe('warning');
    expect(employeeStatusTone('statut_inconnu')).toBe('neutral');
  });

  it('les jours de la semaine ne dépendent pas de la locale du moteur', () => {
    expect(weekdayKey('2026-10-07')).toBe('day.wed');
    expect(weekdayKey('2026-10-11')).toBe('day.sun');
    expect(shortDate('2026-10-07')).toBe('07/10');
  });
});

describe('synthèse RH', () => {
  const client = (payload: unknown) => ({ get: jest.fn(async () => payload) }) as unknown as ApiClient;

  it('reprend les chiffres du backend, triés, sans en ajouter', async () => {
    const dashboard = await fetchDrhDashboard(
      client({
        employees_total: 42,
        employees_by_status: { sortant: 2, actif: 38, suspendu: 2, vide: 0 },
        candidates_by_status: { nouvelle: 5, reserve: 1 },
        leaves_pending: 3,
        trial_periods: [{ id: 7, code: 'AGT007', name: 'SAADI Lina', trial_end_date: '2026-11-01' }, { id: 0 }],
        employees_by_site: [{ site: 'Site Nord', count: 30 }, { site: '', count: 4 }, { site: 'Site Sud', count: 0 }],
        employees_without_site: 4,
      }),
      'Societe A',
    );
    expect(dashboard.employeesTotal).toBe(42);
    expect(dashboard.byStatus.map((entry) => entry.status)).toEqual(['actif', 'sortant', 'suspendu']);
    expect(dashboard.candidatesTotal).toBe(6);
    expect(dashboard.leavesPending).toBe(3);
    expect(dashboard.trialPeriods).toEqual([{ id: 7, code: 'AGT007', name: 'SAADI Lina', endDate: '2026-11-01' }]);
    expect(dashboard.bySite).toEqual([{ site: 'Site Nord', count: 30 }]);
    expect(dashboard.withoutSite).toBe(4);
  });

  it('une réponse vide ou inattendue donne des zéros, jamais une erreur', async () => {
    const dashboard = await fetchDrhDashboard(client(null));
    expect(dashboard).toEqual({
      employeesTotal: 0, byStatus: [], candidatesByStatus: [], candidatesTotal: 0, leavesPending: 0, trialPeriods: [], bySite: [], withoutSite: 0,
    });
  });
});
