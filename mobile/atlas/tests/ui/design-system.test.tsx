import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { presenceRate } from '@/api/domains/attendance';
import { fetchDrhDashboard } from '@/api/domains/drh';
import type { ApiClient } from '@/api/client';
import { ApiError } from '@/api/errors';
import { BarChart, Banner, Distribution, EmployeeHeader, EmployeePhoto, EmployeeRow, InfoGrid, KpiCard, MetricStrip, RingGauge, SiteRow, TabStrip } from '@/components/ui';
import { percent, shortDate, weekdayKey } from '@/features/cockpit/presentation';
import { isIncidentOpen } from '@/features/cockpit/useCockpitInsights';
import { portraitKey } from '@/features/employees/usePortrait';
import { employeeStatusTone } from '@/features/status';

const JPEG = 'data:image/jpeg;base64,/9j/AAAA';
const mockGetImage = jest.fn<Promise<string>, [string]>();

jest.mock('@/api', () => ({ ...jest.requireActual('@/api/errors'), api: { getImage: (path: string) => mockGetImage(path) } }));

let client: QueryClient;

/** Rendu avec un cache de données neuf, comme après une ouverture de session. */
async function show(ui: ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const hidden = { includeHiddenElements: true } as const;

// Sans cela, les minuteries de purge du cache retiennent le processus de test.
afterEach(() => client.clear());

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockGetImage.mockReset();
  mockGetImage.mockResolvedValue(JPEG);
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
  it('200 : la photo est chargée par une requête authentifiée, puis affichée depuis la mémoire', async () => {
    // La réponse est retenue : sans cela, sur une machine lente, l'image arrive avant le contrôle des initiales.
    let deliver: (uri: string) => void = () => undefined;
    mockGetImage.mockReturnValue(new Promise<string>((resolve) => (deliver = resolve)));
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" hasPhoto />);
    // Pendant le chargement : les initiales.
    expect(screen.getByText('BK', hidden)).toBeTruthy();
    await act(async () => deliver(JPEG));
    const photo = await screen.findByTestId('photo', hidden);
    expect(mockGetImage).toHaveBeenCalledWith('/api/drh/employees/5/portrait');
    // <Image> ne reçoit ni l'adresse du backend ni le jeton.
    expect(photo.props.source).toEqual({ uri: JPEG });
    expect(screen.queryByText('BK', hidden)).toBeNull();
  });

  it('404 : initiales, et la cause est transmise à l’écran', async () => {
    mockGetImage.mockRejectedValue(new ApiError({ kind: 'not_found', status: 404 }));
    const onUnavailable = jest.fn();
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" hasPhoto onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith({ kind: 'none', status: 404, reason: 'not_found' }));
    expect(screen.queryByTestId('photo', hidden)).toBeNull();
    expect(screen.getByText('BK', hidden)).toBeTruthy();
    // Réponse définitive : elle est mise en cache, la photo n'est pas redemandée à chaque ligne.
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" hasPhoto />);
    expect(mockGetImage).toHaveBeenCalledTimes(1);
  });

  it('403 : initiales, sans autre effet', async () => {
    mockGetImage.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403 }));
    const onUnavailable = jest.fn();
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith({ kind: 'forbidden', status: 403, reason: 'forbidden' }));
    expect(screen.queryByTestId('photo', hidden)).toBeNull();
    expect(screen.getByText('BK', hidden)).toBeTruthy();
  });

  it.each([
    ['session refusée', new ApiError({ kind: 'unauthorized', status: 401 }), { kind: 'error', status: 401, reason: 'unauthorized' }],
    ['réseau indisponible', new ApiError({ kind: 'network' }), { kind: 'error', status: null, reason: 'network' }],
    ['erreur serveur', new ApiError({ kind: 'server', status: 500 }), { kind: 'error', status: 500, reason: 'server' }],
    ['réponse qui n’est pas une image', new ApiError({ kind: 'invalid_response', status: 200 }), { kind: 'error', status: 200, reason: 'invalid_response' }],
  ])('%s : initiales et diagnostic précis', async (_label, error, expected) => {
    mockGetImage.mockRejectedValue(error);
    const onUnavailable = jest.fn();
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" hasPhoto onUnavailable={onUnavailable} />);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith(expected));
    expect(screen.queryByTestId('photo', hidden)).toBeNull();
    expect(screen.getByText('BK', hidden)).toBeTruthy();
  });

  it('une image reçue mais illisible par la plateforme retombe sur les initiales', async () => {
    const onUnavailable = jest.fn();
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" onUnavailable={onUnavailable} />);
    await fireEvent(await screen.findByTestId('photo', hidden), 'error');
    expect(onUnavailable).toHaveBeenCalledWith({ kind: 'error', status: 200, reason: 'undecodable' });
    expect(screen.queryByTestId('photo', hidden)).toBeNull();
    expect(screen.getByText('BK', hidden)).toBeTruthy();
  });

  it("une fiche sans photo n'envoie aucune requête", async () => {
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" hasPhoto={false} />);
    await act(async () => undefined);
    expect(mockGetImage).not.toHaveBeenCalled();
    expect(screen.getByText('BK', hidden)).toBeTruthy();
  });

  it.each([null, undefined, 0, -3, 2.5])('un identifiant inutilisable (%p) ne déclenche aucune requête', async (id) => {
    await show(<EmployeePhoto testID="photo" employeeId={id} name="BENALI Karim" />);
    await act(async () => undefined);
    expect(mockGetImage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('photo', hidden)).toBeNull();
  });

  it('le cache est par employé : la même photo n’est demandée qu’une fois, celle d’un autre employé à part', async () => {
    mockGetImage.mockImplementation(async (path) => `${JPEG}#${path}`);
    await show(
      <>
        <EmployeePhoto testID="a" employeeId={5} name="BENALI Karim" />
        <EmployeePhoto testID="a-bis" employeeId={5} name="BENALI Karim" />
        <EmployeePhoto testID="b" employeeId={6} name="SAADI Lina" />
      </>,
    );
    const first = await screen.findByTestId('a', hidden);
    expect(first.props.source.uri).toBe(`${JPEG}#/api/drh/employees/5/portrait`);
    expect(screen.getByTestId('a-bis', hidden).props.source.uri).toBe(first.props.source.uri);
    expect((await screen.findByTestId('b', hidden)).props.source.uri).toBe(`${JPEG}#/api/drh/employees/6/portrait`);
    expect(mockGetImage).toHaveBeenCalledTimes(2);
  });

  it('fermeture de session : le cache est vidé et la photo d’un compte ne sert jamais à un autre', async () => {
    mockGetImage.mockResolvedValueOnce(`${JPEG}#compte-a`);
    const view = await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" />);
    expect((await screen.findByTestId('photo', hidden)).props.source.uri).toBe(`${JPEG}#compte-a`);
    expect(client.getQueryData(portraitKey(5))).toEqual({ uri: `${JPEG}#compte-a`, issue: null });
    await view.unmount();

    // Ce que fait AuthProvider à chaque fermeture de session (déconnexion, session refusée).
    client.clear();
    expect(client.getQueryData(portraitKey(5))).toBeUndefined();

    // Le compte suivant n'a pas accès à cet employé : il ne voit jamais l'ancienne image.
    mockGetImage.mockRejectedValue(new ApiError({ kind: 'forbidden', status: 403 }));
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" />);
    await waitFor(() => expect(mockGetImage).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('photo', hidden)).toBeNull();
    expect(screen.getByText('BK', hidden)).toBeTruthy();
  });

  it('le portrait est montré au format 3:4, sans recadrage carré', async () => {
    await show(<EmployeePhoto testID="photo" employeeId={5} name="BENALI Karim" size={66} portrait />);
    expect((await screen.findByTestId('photo', hidden)).props.style).toMatchObject({ width: 66, height: 88 });
  });
});

describe('lignes de liste', () => {
  it('une ligne employé montre nom, matricule, fonction et statut ; elle n’est un bouton que si elle ouvre quelque chose', async () => {
    const view = await show(<EmployeeRow testID="row" employeeId={null} name="BENALI Karim" code="AGT005" position="Agent" detail="Site Nord" />);
    expect(screen.getByTestId('row')).toHaveTextContent(/BENALI Karim.*AGT005 · Agent.*Site Nord/);
    expect(screen.getByTestId('row').props.accessibilityRole).not.toBe('button');
    await view.rerender(
      <QueryClientProvider client={client}>
        <EmployeeRow testID="row" employeeId={null} name="BENALI Karim" onPress={() => undefined} />
      </QueryClientProvider>,
    );
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

describe('fiche employé compacte', () => {
  const LONG_NAME = 'BENABDERRAHMANE-BOUKHALFA Mohammed Abdelkader Seif-Eddine';

  it("l'en-tête garde un nom très long sur deux lignes, sans réduction de police, avec matricule, fonction, société et site", async () => {
    await show(
      <EmployeeHeader
        testID="header"
        employeeId={null}
        name={LONG_NAME}
        code="IGS-2025-000123-AGT"
        position="Chef de poste de sécurité incendie et d’assistance à personnes"
        society="Iron Global Sécurité et Services"
        site="Site Hassi Messaoud — Base de vie Nord"
        hasPhoto={false}
      />,
    );
    const heading = screen.getByTestId('employee-name-heading');
    expect(heading).toHaveTextContent(LONG_NAME);
    expect(heading.props.numberOfLines).toBe(2);
    expect(heading.props.adjustsFontSizeToFit).toBeUndefined();
    const header = screen.getByTestId('header');
    expect(header).toHaveTextContent(/IGS-2025-000123-AGT/);
    expect(header).toHaveTextContent(/Chef de poste de sécurité incendie/);
    expect(header).toHaveTextContent(/Iron Global Sécurité et Services/);
    expect(header).toHaveTextContent(/Site Hassi Messaoud/);
    // Sans photo : initiales, et aucune image demandée.
    expect(screen.queryByTestId('employee-photo', hidden)).toBeNull();
    expect(screen.getByText('BS', hidden)).toBeTruthy();
  });

  it("l'en-tête n'affiche ni société ni site quand ils sont inconnus", async () => {
    await show(<EmployeeHeader testID="header" employeeId={null} name="BENALI Karim" hasPhoto={false} />);
    expect(screen.getByTestId('header')).toHaveTextContent('BKBENALI Karim');
  });

  it('les onglets remplissent la ligne à largeur égale : aucun titre ne dépasse du bord', async () => {
    const onChange = jest.fn();
    await render(
      <TabStrip
        fill
        testID="tabs"
        value="overview"
        onChange={onChange}
        options={[
          { value: 'overview', label: 'Aperçu' },
          { value: 'position', label: 'Position' },
          { value: 'attendance', label: 'Pointage' },
          { value: 'planning', label: 'Planning' },
          { value: 'documents', label: 'Documents' },
        ]}
      />,
    );
    for (const key of ['overview', 'position', 'attendance', 'planning', 'documents']) {
      const tab = screen.getByTestId(`tabs-${key}`);
      expect(tab.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flex: 1 })]));
      expect(tab.props.accessibilityState.selected).toBe(key === 'overview');
    }
    // Pas de défilement horizontal en mode rempli.
    expect(screen.getByTestId('tabs').type).toBe('View');
    await fireEvent.press(screen.getByTestId('tabs-planning'));
    expect(onChange).toHaveBeenCalledWith('planning');
  });

  it('le bandeau tient trois indicateurs sur une ligne', async () => {
    await render(
      <MetricStrip
        testID="strip"
        caption="Sur les 14 derniers jours enregistrés"
        metrics={[
          { key: 'a', label: 'Présence', value: '12/14', tone: 'success' },
          { key: 'b', label: 'Absences', value: '1', tone: 'danger' },
          { key: 'c', label: 'Non pointés', value: '1', tone: 'warning' },
        ]}
      />,
    );
    expect(screen.getByTestId('strip')).toHaveTextContent('12/14Présence1Absences1Non pointésSur les 14 derniers jours enregistrés');
  });

  it('la grille annonce chaque couple libellé / valeur', async () => {
    await render(<InfoGrid testID="grid" cells={[{ key: 'a', label: 'Contrat', value: 'CDD' }, { key: 'b', label: 'Département', value: 'Non disponible', muted: true, wide: true }]} />);
    expect(screen.getByLabelText('Contrat : CDD')).toBeTruthy();
    expect(screen.getByLabelText('Département : Non disponible')).toBeTruthy();
  });
});
