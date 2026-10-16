import { fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/api/errors';
import { BottomSheet, ChoiceGroup, ErrorState, HeaderAction, KpiCard, KpiGrid, ModuleTile } from '@/components/ui';
import { dayOverDay, rateTone, share } from '@/features/cockpit/presentation';
import { activeNavItem, isTabRoute, navItems, openRoute } from '@/features/navigation';
import { buildTasks } from '@/features/tasks/model';

import { makeUser } from '../helpers';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }) };
});

describe('évolution et proportions : calculées, jamais supposées', () => {
  it("mesure l'écart d'hier à aujourd'hui seulement quand les deux journées sont connues", () => {
    expect(dayOverDay(10, 13, 'vs hier', true)).toEqual({ value: 3, label: 'vs hier', upIsGood: true });
    expect(dayOverDay(null, 13, 'vs hier', true)).toBeNull();
    expect(dayOverDay(10, undefined, 'vs hier', true)).toBeNull();
  });

  it('colore un taux selon les seuils du web et refuse une division par zéro', () => {
    expect(rateTone(0.95)).toBe('success');
    expect(rateTone(0.8)).toBe('warning');
    expect(rateTone(0.5)).toBe('danger');
    expect(rateTone(null)).toBe('neutral');
    expect(share(3, 0)).toBeNull();
    expect(share(3, 12)).toBe(0.25);
  });

  it('une tuile compacte affiche la hausse des absents comme une mauvaise nouvelle', async () => {
    await render(<KpiCard testID="kpi" variant="compact" label="Absents" value={18} delta={{ value: 2, label: 'vs hier', upIsGood: false }} />);
    expect(screen.getByTestId('kpi')).toHaveTextContent(/18.*Absents.*\+2 vs hier/);
  });

  it("une tuile compacte en chargement n'affiche ni chiffre ni évolution", async () => {
    await render(<KpiCard testID="kpi" variant="compact" label="Présents" value={null} state="loading" delta={{ value: 2, upIsGood: true }} />);
    expect(screen.getByTestId('kpi')).not.toHaveTextContent(/\d/);
  });

  it('la grille garde quatre colonnes de largeur fixe, même incomplètes', async () => {
    await render(
      <KpiGrid testID="grid">
        <KpiCard variant="compact" label="A" value={1} />
        <KpiCard variant="compact" label="B" value={2} />
        {null}
        <KpiCard variant="compact" label="C" value={3} />
      </KpiGrid>,
    );
    const cells = screen.getByTestId('grid').props.children as { props: { style: { width: string }[] } }[];
    expect(cells).toHaveLength(3);
    for (const cell of cells) expect(cell.props.style[1]).toEqual({ width: '25%' });
  });
});

describe('composants de la refonte', () => {
  it("la cloche affiche le nombre d'alertes critiques et l'annonce", async () => {
    const onPress = jest.fn();
    const view = await render(<HeaderAction testID="bell" icon="notifications-outline" label="Alertes" badge={3} onPress={onPress} />);
    expect(screen.getByTestId('bell-count')).toHaveTextContent('3');
    expect(screen.getByTestId('bell').props.accessibilityLabel).toBe('Alertes (3)');
    await view.rerender(<HeaderAction testID="bell" icon="notifications-outline" label="Alertes" badge={0} onPress={onPress} />);
    expect(screen.queryByTestId('bell-count')).toBeNull();
  });

  it("une tuile de module sans écran est grisée et n'est pas un bouton", async () => {
    await render(<ModuleTile testID="soon" label="Badges" caption="Sur ATLAS Web" icon="id-card-outline" />);
    expect(screen.getByTestId('soon').props.accessibilityRole).toBeUndefined();
    expect(screen.getByTestId('soon').props.accessibilityState).toEqual({ disabled: true });
  });

  it('une tuile de module montre son compteur réel, plafonné à 99+', async () => {
    const onPress = jest.fn();
    await render(<ModuleTile testID="alerts" label="Alertes" icon="notifications-outline" count={140} urgent onPress={onPress} />);
    expect(screen.getByTestId('alerts')).toHaveTextContent(/99\+/);
    await fireEvent.press(screen.getByTestId('alerts'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('la feuille de filtres applique un choix, se réinitialise et se ferme', async () => {
    const onChange = jest.fn();
    const onReset = jest.fn();
    const onClose = jest.fn();
    await render(
      <BottomSheet testID="sheet" visible title="Filtres" onClose={onClose} resetLabel="Réinitialiser" onReset={onReset} actionLabel="Appliquer" onAction={onClose}>
        <ChoiceGroup testID="status" label="Statut" value="all" onChange={onChange} options={[{ value: 'all', label: 'Tous' }, { value: 'absent', label: 'Absents' }]} />
      </BottomSheet>,
    );
    expect(screen.getByTestId('status-all').props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByTestId('status-absent'));
    expect(onChange).toHaveBeenCalledWith('absent');
    await fireEvent.press(screen.getByTestId('sheet-reset'));
    expect(onReset).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('sheet-apply'));
    // Le fond assombri ferme la feuille ; il est masqué aux lecteurs d'écran, qui ont le bouton Fermer.
    await fireEvent.press(screen.getByTestId('sheet-backdrop', { includeHiddenElements: true }));
    await fireEvent.press(screen.getByTestId('sheet-close'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['network', 'Hors connexion'],
    ['unauthorized', 'Session expirée'],
    ['server', 'Serveur indisponible'],
    ['forbidden', 'Accès refusé'],
  ] as const)("l'erreur %s a son titre propre", async (kind, title) => {
    await render(<ErrorState error={new ApiError({ kind })} testID="error" />);
    expect(screen.getByTestId('error')).toHaveTextContent(new RegExp(title));
  });
});

describe('navigation basse', () => {
  it('ne montre Pointage et Employés qu’aux comptes qui y ont droit', () => {
    expect(navItems(makeUser({ effective_modules: ['ops'] })).map((item) => item.name)).toEqual(['index', 'stats', 'attendance', 'modules']);
    expect(navItems(makeUser({ effective_modules: ['drh'] })).map((item) => item.name)).toEqual(['index', 'stats', 'attendance', 'employees', 'modules']);
    expect(navItems(makeUser({ effective_modules: ['brq'] })).map((item) => item.name)).toEqual(['index', 'stats', 'modules']);
  });

  it('allume Modules pour les écrans ouverts depuis Modules', () => {
    expect(activeNavItem('attendance')).toBe('attendance');
    expect(activeNavItem('ops')).toBe('modules');
    expect(activeNavItem('profile')).toBe('modules');
  });

  it('revient aux onglets pour une rubrique de la barre, empile tout autre écran', () => {
    const router = { push: jest.fn(), dismissTo: jest.fn() };
    expect(isTabRoute('/attendance?site_id=3')).toBe(true);
    expect(isTabRoute('/(tabs)/tasks')).toBe(true);
    expect(isTabRoute('/drh/employees/5')).toBe(false);
    openRoute(router, '/attendance?site_id=3');
    openRoute(router, '/ops/sites/4');
    expect(router.dismissTo).toHaveBeenCalledWith('/attendance?site_id=3');
    expect(router.push).toHaveBeenCalledWith('/ops/sites/4');
  });
});

describe('tâches', () => {
  it('distingue « à faire » et « en cours » à partir du statut réel des alertes', () => {
    const alert = (id: number, status: 'open' | 'assigned') => ({
      id,
      status,
      severity: 'warning' as const,
      title: `A${id}`,
      summary: null,
      lastDetectedAt: '2026-10-07T08:00:00',
      society: 'S',
      siteId: null,
    });
    const tasks = buildTasks({ alerts: [alert(1, 'open'), alert(2, 'assigned')] as never });
    expect(tasks.map((task) => [task.id, task.status])).toEqual([
      ['alert-1', 'todo'],
      ['alert-2', 'inProgress'],
    ]);
  });
});
