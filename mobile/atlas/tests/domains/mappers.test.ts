import type { ApiClient } from '@/api/client';
import { fetchAlert, fetchAlerts, fetchAlertStats } from '@/api/domains/alerts';
import {
  declareAbandon,
  fetchAbandonContext,
  fetchAbandonEvents,
  fetchBoard,
  searchManualEmployees,
} from '@/api/domains/attendance';
import { fetchBrqSituation } from '@/api/domains/brq';
import { decideLeave, fetchCandidatesPage, fetchEmployee, fetchEmployeesPage, fetchLeaves } from '@/api/domains/drh';
import { createIncident, fetchIncidents, validateIncident } from '@/api/domains/incidents';
import { fetchSiteDetail, fetchSitesPage, sameSociety } from '@/api/domains/ops';
import { scopeParams } from '@/api/domains/shared';
import { formatDate, formatDateTime, formatMinutes, formatTime, fullName } from '@/utils/format';

function fake(response: unknown) {
  const get = jest.fn(async (..._args: unknown[]) => response);
  const post = jest.fn(async (..._args: unknown[]) => response);
  return { client: { get, post } as unknown as ApiClient, get, post };
}

describe('pointage', () => {
  it('lit les indicateurs et les lignes calculés par le backend', async () => {
    const { client, get } = fake({
      date: '2026-10-07',
      kpi: { expected: 12, present: 9, absent: 2, not_pointed: 1, late: 1 },
      total: 1,
      page: 1,
      pages: 1,
      page_size: 25,
      items: [
        {
          employee_id: 5, matricule: 'AGT005', nom: 'BENALI Karim', fonction: 'Agent', society: 'Societe A', site_id: 3, site: 'Site Nord',
          planning: { known: true, start_time: '07:00', end_time: '19:00' }, arrival: '07:02', departure: '', status: 'present',
          anomalies: [{ id: 1, type: 'LATE', severity: 'low', message: 'Retard' }], counted: { secret: 'ignoré' },
        },
      ],
    });
    const board = await fetchBoard(client, { site_id: 3, status: 'present' });
    expect(get).toHaveBeenCalledWith('/api/attendance/board', { query: { site_id: 3, status: 'present' } });
    expect(board.kpi).toMatchObject({ expected: 12, present: 9, absent: 2, not_pointed: 1, late: 1, conge: 0, anomalies: 0 });
    expect(board.items[0]).toEqual({
      employeeId: 5, matricule: 'AGT005', name: 'BENALI Karim', position: 'Agent', society: 'Societe A', siteId: 3, site: 'Site Nord',
      status: 'present', arrival: '07:02', departure: '', plannedStart: '07:00', plannedEnd: '19:00', presenceId: null, closed: false,
      anomalies: [{ id: 1, type: 'LATE', message: 'Retard' }],
    });
  });

  it("n'invente aucun chiffre sur une réponse inattendue", async () => {
    const board = await fetchBoard(fake(null).client);
    expect(board.kpi.expected).toBe(0);
    expect(board.items).toEqual([]);
    expect((await fetchBoard(fake({ items: [{}] }).client)).items[0]?.status).toBe('non_pointe');
  });

  it('lit les abandons de poste enregistrés', async () => {
    const { client, get } = fake({
      total: 1, page: 1,
      items: [{
        event_id: 9, employee_id: 5, society: 'Societe A', site_id: 3, actual_departure_at: '2026-10-07T16:30:00+01:00', created_at: '2026-10-07T15:31:00',
        observation: 'Parti sans prévenir',
        details: { employee_name: 'BENALI Karim', matricule: 'AGT005', site_name: 'Site Nord', position: 'Agent', scheduled_end_at: '2026-10-07T19:00:00+01:00', remaining_minutes: 150, recorded_by: 'OPS1' },
      }],
    });
    const events = await fetchAbandonEvents(client, { site_id: 3 });
    expect(get).toHaveBeenCalledWith('/api/attendance/business-events', { query: { site_id: 3, event_type: 'ABANDON_POSTE' } });
    expect(events.items[0]).toMatchObject({ eventId: 9, employeeName: 'BENALI Karim', remainingMinutes: 150, observation: 'Parti sans prévenir', recordedBy: 'OPS1' });
  });

  it("ne cherche un agent qu'à partir de deux caractères", async () => {
    const { client, get } = fake([{ id: 5, matricule: 'AGT005', nom: 'BENALI', prenom: 'Karim', poste: 'Agent', societe: 'Societe A', site: 'Site Nord', photo: 'data:image/jpeg;base64,AAAA' }]);
    expect(await searchManualEmployees(client, { q: ' b ' })).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    const rows = await searchManualEmployees(client, { q: 'be' });
    expect(rows).toEqual([{ id: 5, matricule: 'AGT005', name: 'BENALI Karim', position: 'Agent', society: 'Societe A', site: 'Site Nord' }]);
    expect(JSON.stringify(rows)).not.toContain('base64');
  });

  it("reprend l'applicabilité décidée par le backend, sans la recalculer", async () => {
    const raw = { shift_id: 77, employee_id: 5, employee_name: 'BENALI Karim', matricule: 'AGT005', society: 'Societe A', site_id: 3, site_name: 'Site Nord', position: 'Agent',
      scheduled_start_at: '2026-10-07T07:00:00+01:00', scheduled_end_at: '2026-10-07T19:00:00+01:00', actual_departure_at: '2026-10-07T18:30:00+01:00',
      remaining_minutes: 30, threshold_minutes: 60 };
    // 30 minutes restantes mais le backend dit « applicable » : c'est lui qui fait foi.
    expect((await fetchAbandonContext(fake({ ...raw, applicable: true }).client, 5)).applicable).toBe(true);
    // 500 minutes restantes mais pas de `true` explicite : non déclarable.
    expect((await fetchAbandonContext(fake({ ...raw, remaining_minutes: 500, applicable: 'true' }).client, 5)).applicable).toBe(false);
    expect((await fetchAbandonContext(fake({ ...raw, remaining_minutes: 500 }).client, 5)).applicable).toBe(false);
  });

  it("déclare l'abandon avec la vacation fournie par le backend et le motif nettoyé", async () => {
    const { client, post } = fake({ success: true, duplicate: false, event_id: 9 });
    const result = await declareAbandon(client, { employeeId: 5, siteId: 3, shiftId: 77 }, '  Parti sans prévenir  ');
    expect(post).toHaveBeenCalledWith('/api/portal/attendance-manual/abandon', { employee_id: 5, site_id: 3, shift_id: 77, observation: 'Parti sans prévenir' });
    expect(result).toEqual({ eventId: 9, duplicate: false });
  });
});

describe('alertes', () => {
  const row = { id: 4, rule_key: 'attendance.abandon_poste.ops', society: 'Societe A', site_id: 3, status: 'open', severity: 'critical', title: 'Abandon de poste', summary: null, last_detected_at: '2026-10-07T15:31:00', occurrence_count: 2, assigned_user_id: null };

  it('lit une page, les compteurs et le détail', async () => {
    const page = await fetchAlerts(fake({ items: [row], total: 1, page: 1, page_size: 25, pages: 1 }).client, { status: 'open' });
    expect(page.items[0]).toMatchObject({ id: 4, status: 'open', severity: 'critical', title: 'Abandon de poste', occurrenceCount: 2 });
    expect(await fetchAlertStats(fake({ total_open: 5, critical: 1, unacknowledged: 3, assigned_to_me: 0 }).client)).toEqual({ totalOpen: 5, critical: 1, unacknowledged: 3, assignedToMe: 0 });
    const detail = await fetchAlert(fake({ ...row, explanation: 'Départ anticipé', history: [{ id: 1, action: 'created', new_status: 'open', created_at: '2026-10-07T15:31:00' }] }).client, 4);
    expect(detail.explanation).toBe('Départ anticipé');
    expect(detail.history).toHaveLength(1);
  });

  it('traite un statut ou une gravité inconnus avec prudence', async () => {
    const page = await fetchAlerts(fake({ items: [{ ...row, status: 'archivee', severity: 'apocalypse' }] }).client);
    expect(page.items[0]).toMatchObject({ status: 'open', severity: 'warning' });
  });
});

describe('sites', () => {
  it('extrait la société du site et écarte le reste du plan', async () => {
    const page = await fetchSitesPage(
      fake({ items: [{ id: 3, name: 'Site Nord', indicatif: 'SN', client_name: 'Client X', commune: 'Hydra', wilaya: 'Alger', contractual_staff: 12, active: 1, equipment_plan: { societe: 'Societe A', armes: ['secret'] } }], total: 1, page: 1, page_size: 25, pages: 1 }).client,
    );
    expect(page.items[0]).toEqual({ id: 3, name: 'Site Nord', indicatif: 'SN', client: 'Client X', commune: 'Hydra', wilaya: 'Alger', address: null, society: 'Societe A', contractualStaff: 12, active: true });
  });

  it('ne demande que les sites actifs et aplatit les agents par groupe', async () => {
    const { client, get } = fake({ items: [] });
    await fetchSitesPage(client, { q: 'nord', society: 'Societe A' });
    expect(get).toHaveBeenCalledWith('/api/ops/sites/page', { query: { q: 'nord', society: 'Societe A', active: 1 } });

    const detail = await fetchSiteDetail(
      fake({ site: { id: 3, name: 'Site Nord', equipment_plan: { _legacy: { societe: 'Societe A' } } }, contractual_staff: 12, realized_staff: 10, missing_staff: 2, surplus_staff: 0,
        by_group: { B: [{ assignment_id: 2, employee_id: 6, code: 'AGT006', name: 'ZIANE Omar', position: null }], A: [{ assignment_id: 1, employee_id: 5, code: 'AGT005', name: 'BENALI Karim', position: 'Agent' }], C: [] } }).client,
      3,
    );
    expect(detail.site.society).toBe('Societe A');
    expect(detail.missingStaff).toBe(2);
    expect(detail.agents.map((agent) => `${agent.group}:${agent.name}`)).toEqual(['A:BENALI Karim', 'B:ZIANE Omar']);
    expect(sameSociety('Société A', 'SOCIETE A')).toBe(true);
    expect(sameSociety('', '')).toBe(false);
  });
});

describe('DRH', () => {
  const raw = { id: 5, code: 'AGT005', first_name: 'Karim', last_name: 'BENALI', position: 'Agent', society: 'Societe A', status: 'actif', contract_type: 'CDD',
    recruit_date: '2025-01-15', contract_end_date: null, phone: '0550', email: null, salary_net: 45000, nin: '123', extra: { photoData: 'data:image/jpeg;base64,AAAA', _legacy: { big: true } },
    current_site_id: 3, current_site_name: 'Site Nord', current_group_code: 'A', current_position: 'Chef de poste' };

  it('ne conserve ni la rémunération, ni les identifiants civils, ni les données volumineuses', async () => {
    const page = await fetchEmployeesPage(fake({ items: [raw], total: 1, page: 1, page_size: 25, pages: 1 }).client, { q: 'ben' });
    const employee = page.items[0]!;
    expect(employee).toEqual({ id: 5, code: 'AGT005', firstName: 'Karim', lastName: 'BENALI', position: 'Chef de poste', society: 'Societe A', status: 'actif', contractType: 'CDD',
      recruitDate: '2025-01-15', contractEndDate: null, phone: '0550', email: null, siteId: 3, siteName: 'Site Nord', group: 'A' });
    const serialized = JSON.stringify(employee);
    for (const forbidden of ['45000', 'salary', 'nin', 'base64', '_legacy']) expect(serialized).not.toContain(forbidden);
    expect((await fetchEmployee(fake(raw).client, 5)).code).toBe('AGT005');
  });

  it('lit les congés et transmet la décision au backend', async () => {
    const leaves = await fetchLeaves(fake([{ id: 1, employee_id: 5, leave_type: 'conge', start_date: '2026-10-10', end_date: '2026-10-12', reason: null, status: 'instance', created_at: '2026-10-01T10:00:00' }]).client, { status: 'instance' });
    expect(leaves[0]).toMatchObject({ id: 1, employeeId: 5, status: 'instance', startDate: '2026-10-10' });
    const { client, post } = fake({ id: 1, employee_id: 5, status: 'approuve' });
    expect((await decideLeave(client, 1, 'approve')).status).toBe('approuve');
    expect(post).toHaveBeenCalledWith('/api/drh/leaves/1/approve');
  });

  it('liste les candidats sans leurs données annexes', async () => {
    const { client, get } = fake({ items: [{ id: 2, first_name: 'Lina', last_name: 'SAADI', desired_position: 'Agent', society: null, status: 'nouvelle', created_at: '2026-10-01T10:00:00', data: { cv: 'base64…' }, phone: '0661', expected_salary: 50000 }], total: 1, page: 1, page_size: 25, pages: 1 });
    const page = await fetchCandidatesPage(client, { mode: 'all', q: 'saa' });
    expect(get).toHaveBeenCalledWith('/api/drh/candidates/page', { query: { q: 'saa', mode: undefined } });
    expect(Object.keys(page.items[0]!).sort()).toEqual(['createdAt', 'desiredPosition', 'firstName', 'id', 'lastName', 'society', 'status']);
  });
});

describe('BRQ', () => {
  it('lit la situation calculée par le backend', async () => {
    const item = { employee_id: 5, matricule: 'AGT005', nom: 'BENALI Karim', fonction: 'Agent', site: 'Site Nord', wilaya: 'Alger', state: 'absent', arrival: '', departure: '', date_sortie: null, abandon: null };
    const situation = await fetchBrqSituation(
      fake({ date: '2026-10-07', kpis: { effectif_prevu: 12, presents: 9, absents: 2, non_pointes: 1, abandons_poste: 1, sortants: 0, effectif_disponible: 9, couverture_pct: 75.0, ecart: -3 },
        absence_items: [item], abandon_items: [{ ...item, state: 'abandon_poste', abandon: { event_id: 9 } }], sortant_items: [], notes: ['Note du jour', 42] }).client,
      { society: 'Societe A' },
    );
    expect(situation.kpis).toEqual({ expected: 12, present: 9, absent: 2, notPointed: 1, abandons: 1, leaving: 0, available: 9, coveragePct: 75, gap: -3 });
    expect(situation.absences[0]).toMatchObject({ name: 'BENALI Karim', state: 'absent' });
    expect(situation.abandons[0]?.key).toContain('9');
    expect(situation.notes).toEqual(['Note du jour']);
    expect((await fetchBrqSituation(fake({ kpis: { effectif_prevu: 0, couverture_pct: null } }).client)).kpis.coveragePct).toBeNull();
  });
});

describe('incidents', () => {
  const draft = { siteId: 3, society: 'Societe A', type: 'vol', severity: 'elevee', subject: ' Vol de matériel ', description: ' Constat à 14 h. ', date: '2026-10-07', time: '14:05' } as const;

  it('contrôle la saisie avant tout envoi', () => {
    expect(validateIncident(draft)).toEqual({});
    expect(validateIncident({})).toEqual({ site: 'required', society: 'required', subject: 'required', description: 'required' });
    expect(validateIncident({ ...draft, siteId: 0, subject: '   ' })).toEqual({ site: 'required', subject: 'required' });
    expect(validateIncident({ ...draft, subject: 'x'.repeat(256), description: 'y'.repeat(4001) })).toEqual({ subject: 'tooLong', description: 'tooLong' });
  });

  it("crée l'incident avec la société du site et l'origine mobile, sans identifiant imposé", async () => {
    const { client, post } = fake({ backendId: 12, date: '2026-10-07', heure: '14:05', siteBackendId: 3, type: 'vol', gravite: 'elevee', sujet: 'Vol de matériel', description: 'Constat à 14 h.', statut: 'ouvert', societe: 'Societe A' });
    const created = await createIncident(client, draft);
    const body = post.mock.calls[0]![1] as { data: Record<string, unknown> };
    expect(post.mock.calls[0]![0]).toBe('/api/irongs/collections/incidents/items');
    expect(body.data).toEqual({ date: '2026-10-07', heure: '14:05', siteBackendId: 3, societe: 'Societe A', type: 'vol', gravite: 'elevee', sujet: 'Vol de matériel', description: 'Constat à 14 h.', statut: 'ouvert', origine: 'mobile' });
    expect(body.data).not.toHaveProperty('id');
    expect(body.data).not.toHaveProperty('backendId');
    expect(created).toMatchObject({ id: 12, status: 'ouvert', siteId: 3 });
  });

  it('ignore les entrées sans identifiant serveur', async () => {
    expect(await fetchIncidents(fake([{ backendId: 12, sujet: 'A' }, { sujet: 'sans id' }, null]).client)).toHaveLength(1);
    expect(await fetchIncidents(fake({ erreur: true }).client)).toEqual([]);
  });
});

describe('périmètre et formatage', () => {
  it("n'envoie que la société et le site sélectionnés", () => {
    expect(scopeParams({ society: 'Societe A', site: { id: 3, name: 'Site Nord', society: 'Societe A' } })).toEqual({ society: 'Societe A', site_id: 3 });
    expect(scopeParams({ society: null, site: null })).toEqual({ society: undefined, site_id: undefined });
  });

  it('formate dates, heures et durées sans dépendre de la locale', () => {
    expect(formatDate('2026-10-07')).toBe('07/10/2026');
    expect(formatDate('2026-10-07T15:31:00+01:00')).toBe('07/10/2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('demain')).toBe('');
    expect(formatDateTime('2026-10-07T15:31:00+01:00')).toBe('07/10/2026 15:31');
    expect(formatDateTime('2026-10-07')).toBe('07/10/2026');
    expect(formatTime('2026-10-07T07:05:00')).toBe('07:05');
    expect(formatTime('07:05')).toBe('07:05');
    expect(formatTime('')).toBe('');
    expect(formatMinutes(150)).toBe('2 h 30');
    expect(formatMinutes(45.4)).toBe('45 min');
    expect(formatMinutes(-5)).toBe('0 min');
    expect(formatMinutes(null)).toBe('');
    expect(fullName('BENALI', ' Karim ')).toBe('BENALI Karim');
    expect(fullName(null, 'Karim')).toBe('Karim');
  });
});

describe('ajouts DRH / OPS', () => {
  const fakeClient = (response: unknown) => {
    const calls: unknown[][] = [];
    const client = {
      get: async (...a: unknown[]) => (calls.push(a), response),
      post: async (...a: unknown[]) => (calls.push(a), response),
    } as unknown as import('@/api/client').ApiClient;
    return { client, calls };
  };

  it('dépose une demande de congé sans statut ni champ superflu', async () => {
    const { createLeave } = jest.requireActual('@/api/domains/drh');
    const { client, calls } = fakeClient({ id: 3, employee_id: 5, leave_type: 'conge', start_date: '2026-10-10', end_date: '2026-10-12', status: 'instance' });
    const leave = await createLeave(client, { employeeId: 5, type: 'conge', startDate: '2026-10-10', endDate: '2026-10-12', reason: '  ' });
    expect(calls[0]).toEqual(['/api/drh/leaves', { employee_id: 5, leave_type: 'conge', start_date: '2026-10-10', end_date: '2026-10-12', reason: null }]);
    expect(leave.status).toBe('instance');
  });

  it("lit les pointages d'un employé, du plus récent au plus ancien", async () => {
    const { fetchEmployeeAttendance } = jest.requireActual('@/api/domains/attendance');
    const { client, calls } = fakeClient({ days: [{ id: 1, date: '2026-10-05', status: 'absent' }, { id: 2, date: '2026-10-07', status: 'present', site: 'Site Nord', arrival: '07:02', extra: 'ignoré' }, 'bruit'] });
    const days = await fetchEmployeeAttendance(client, 5);
    expect(calls[0]).toEqual(['/api/attendance/employees/5', { query: { days: 14 } }]);
    expect(days.map((day: { date: string }) => day.date)).toEqual(['2026-10-07', '2026-10-05', '']);
    expect(days[0]).toEqual({ id: 2, date: '2026-10-07', status: 'present', site: 'Site Nord', arrival: '07:02', departure: '' });
  });

  it("lit le planning d'un site sans conserver la liste nominative des agents attendus", async () => {
    const { fetchSitePlanning } = jest.requireActual('@/api/domains/ops');
    const { client, calls } = fakeClient({ occurrences: [{ date: '2026-10-08', start: '07:00', end: '19:00', group: 'A', rest: false, expected_count: 6, expected: [{ employee_id: 5, name: 'X' }] }] });
    const shifts = await fetchSitePlanning(client, 1, '2026-10-08', '2026-10-14');
    expect(calls[0]).toEqual(['/api/attendance/rotation-planning', { query: { site_id: 1, date_from: '2026-10-08', date_to: '2026-10-14' } }]);
    expect(shifts).toEqual([{ key: '2026-10-08-A-07:00-0', date: '2026-10-08', start: '07:00', end: '19:00', group: 'A', rest: false, expectedCount: 6 }]);
  });
});
