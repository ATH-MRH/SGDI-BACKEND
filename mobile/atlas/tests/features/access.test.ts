import { access } from '@/features/access';
import { moduleEntries } from '@/features/entries';
import { ALERT_STATUS, incidentSeverity, leaveStatus, presenceStatus, SEVERITY } from '@/features/status';
import { alertPriority, buildTasks } from '@/features/tasks/model';
import { dictionaries } from '@/i18n';

import { makeUser } from '../helpers';

const user = (modules: string[], actions: string[] = []) => makeUser({ effective_modules: modules, authorized_actions: actions });

describe('règles d\'accès par fonction', () => {
  it('refuse tout sans profil', () => {
    for (const rule of Object.values(access)) expect(rule(null)).toBe(false);
  });

  it('réserve les alertes aux profils OPS ou DRH', () => {
    expect(access.alerts(user(['ops']))).toBe(true);
    expect(access.alerts(user(['drh']))).toBe(true);
    expect(access.alerts(user(['pointage']))).toBe(false);
    expect(access.alerts(user(['brq']))).toBe(false);
  });

  it("n'autorise à traiter une alerte qu'avec une action explicite", () => {
    expect(access.actOnAlerts(user(['ops']))).toBe(false);
    expect(access.actOnAlerts(user(['ops'], ['read']))).toBe(false);
    expect(access.actOnAlerts(user(['ops'], ['update']))).toBe(true);
    expect(access.actOnAlerts(user(['drh'], ['validate']))).toBe(true);
    expect(access.actOnAlerts(user(['brq'], ['admin']))).toBe(false);
  });

  it('aligne pointage et abandons sur les modules exigés par le backend', () => {
    expect(access.attendance(user(['pointage']))).toBe(true);
    expect(access.attendance(user(['brq']))).toBe(false);
    expect(access.abandons(user(['pointage']))).toBe(false);
    expect(access.abandons(user(['ops']))).toBe(true);
    expect(access.declareAbandon(user(['ops'], ['create']))).toBe(false);
    expect(access.declareAbandon(user(['pointage']))).toBe(false);
    expect(access.declareAbandon(user(['pointage'], ['create']))).toBe(true);
    expect(access.declareAbandon(user(['pointeur'], ['admin']))).toBe(true);
  });

  it('sépare consultation et écriture pour les incidents et les congés', () => {
    expect(access.incidents(user(['ops']))).toBe(true);
    expect(access.createIncident(user(['ops']))).toBe(false);
    expect(access.createIncident(user(['ops'], ['create']))).toBe(true);
    expect(access.incidents(user(['drh'], ['admin']))).toBe(false);
    expect(access.leaves(user(['conges']))).toBe(true);
    expect(access.decideLeaves(user(['conges']))).toBe(false);
    expect(access.decideLeaves(user(['conges'], ['validate']))).toBe(true);
    expect(access.decideLeaves(user(['ops'], ['validate']))).toBe(false);
  });

  it('ouvre chaque domaine à ses seuls modules', () => {
    expect(access.sites(user(['ops']))).toBe(true);
    expect(access.sites(user(['drh']))).toBe(false);
    expect(access.brq(user(['brq']))).toBe(true);
    expect(access.brq(user(['ops']))).toBe(false);
    expect(access.employees(user(['drh']))).toBe(true);
    expect(access.employees(user(['recrute']))).toBe(false);
    expect(access.candidates(user(['recrute']))).toBe(true);
    expect(access.candidates(user(['ops']))).toBe(false);
  });
});

describe('entrées de module', () => {
  const keys = (modules: string[], module: Parameters<typeof moduleEntries>[1]) => moduleEntries(user(modules), module).map((entry) => entry.key);

  it('ne propose que les fonctions ouvertes au profil', () => {
    expect(keys(['ops'], 'ops')).toEqual(['sites', 'attendance', 'incidents', 'abandons']);
    expect(keys(['pointage'], 'pointage')).toEqual(['attendance']);
    expect(keys(['drh'], 'drh')).toEqual(['employees', 'leaves', 'attendance', 'candidates']);
    expect(keys(['conges'], 'conges')).toEqual(['leaves']);
    expect(keys(['brq'], 'brq')).toEqual(['brq']);
    expect(keys(['site_workforce'], 'site_workforce')).toEqual([]);
    expect(moduleEntries(null, 'ops')).toEqual([]);
  });

  it('a un libellé traduit pour chaque entrée', () => {
    for (const module of ['ops', 'pointage', 'drh', 'conges', 'brq', 'recrute'] as const) {
      for (const entry of moduleEntries(makeUser({ module_access_global: true }), module)) {
        expect(dictionaries.fr[entry.title]).toBeTruthy();
        expect(entry.route.startsWith('/')).toBe(true);
      }
    }
  });
});

describe('statuts', () => {
  it('traduit les statuts connus et laisse les inconnus tels quels', () => {
    expect(presenceStatus('present')).toEqual({ label: 'status.present', tone: 'success' });
    expect(presenceStatus('non_pointe')?.tone).toBe('warning');
    expect(presenceStatus('statut_inconnu:x')).toBeNull();
    expect(leaveStatus('instance')?.label).toBe('leaves.status.pending');
    expect(leaveStatus('annule')).toBeNull();
    expect(incidentSeverity('critique')?.tone).toBe('danger');
    expect(incidentSeverity('')).toBeNull();
    for (const entry of [...Object.values(SEVERITY), ...Object.values(ALERT_STATUS)]) expect(dictionaries.fr[entry.label]).toBeTruthy();
  });
});

describe('mes tâches', () => {
  const alert = (id: number, severity: 'info' | 'warning' | 'critical', status = 'open', date = '2026-10-07T10:00:00') =>
    ({ id, ruleKey: 'r', society: 'Societe A', siteId: 3, status, severity, title: `Alerte ${id}`, summary: null, lastDetectedAt: date, occurrenceCount: 1, assignedUserId: null }) as never;
  const leave = (id: number, status = 'instance') =>
    ({ id, employeeId: 5, type: 'conge', startDate: '2026-10-10', endDate: '2026-10-12', reason: null, status, createdAt: '2026-10-01' }) as never;

  it('ne retient que ce qui attend une action et pointe vers l\'objet d\'origine', () => {
    const tasks = buildTasks({ alerts: [alert(1, 'info'), alert(2, 'critical'), alert(3, 'warning', 'treated'), alert(4, 'warning', 'assigned')], leaves: [leave(7), leave(8, 'approuve')] });
    expect(tasks.map((task) => task.id)).toEqual(['alert-2', 'alert-4', 'alert-1', 'leave-7']);
    expect(tasks[0]).toMatchObject({ type: 'alert', priority: 'critical', route: '/alerts/2', society: 'Societe A', siteId: 3 });
    expect(tasks[3]).toMatchObject({ type: 'leave', priority: 'normal', route: '/drh/leaves' });
  });

  it('trie par priorité puis par date', () => {
    const tasks = buildTasks({ alerts: [alert(1, 'warning', 'open', '2026-10-07T12:00:00'), alert(2, 'warning', 'open', '2026-10-07T08:00:00')] });
    expect(tasks.map((task) => task.id)).toEqual(['alert-2', 'alert-1']);
    expect(alertPriority('critical')).toBe('critical');
    expect(alertPriority('warning')).toBe('high');
    expect(alertPriority('info')).toBe('normal');
    expect(buildTasks({})).toEqual([]);
  });
});
