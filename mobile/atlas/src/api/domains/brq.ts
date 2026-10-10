import type { ApiClient } from '../client';
import { asArray, asNullableNumber, asNumber, asRecord, asString } from './shared';

/** Bulletin de renseignement quotidien : rapport calculé par le backend, en lecture seule. */
export type BrqKpis = {
  expected: number;
  present: number;
  absent: number;
  notPointed: number;
  abandons: number;
  leaving: number;
  available: number;
  coveragePct: number | null;
  gap: number;
};

export type BrqItem = {
  key: string;
  employeeId: number | null;
  matricule: string;
  name: string;
  position: string;
  site: string;
  wilaya: string;
  state: string;
  arrival: string;
  departure: string;
  exitDate: string | null;
};

export type BrqSituation = {
  date: string;
  kpis: BrqKpis;
  absences: BrqItem[];
  abandons: BrqItem[];
  leaving: BrqItem[];
  notes: string[];
};

function toItem(raw: unknown, index: number): BrqItem {
  const row = asRecord(raw);
  const employeeId = asNullableNumber(row.employee_id);
  const abandon = asRecord(row.abandon);
  return {
    key: `${employeeId ?? 'x'}-${asNumber(abandon.event_id)}-${index}`,
    employeeId,
    matricule: asString(row.matricule),
    name: asString(row.nom),
    position: asString(row.fonction),
    site: asString(row.site),
    wilaya: asString(row.wilaya),
    state: asString(row.state),
    arrival: asString(row.arrival),
    departure: asString(row.departure),
    exitDate: typeof row.date_sortie === 'string' ? row.date_sortie : null,
  };
}

export async function fetchBrqSituation(
  client: ApiClient,
  query: { society?: string; site_id?: number } = {},
): Promise<BrqSituation> {
  const raw = asRecord(await client.get<unknown>('/api/brq/situation', { query }));
  const kpis = asRecord(raw.kpis);
  return {
    date: asString(raw.date),
    kpis: {
      expected: asNumber(kpis.effectif_prevu),
      present: asNumber(kpis.presents),
      absent: asNumber(kpis.absents),
      notPointed: asNumber(kpis.non_pointes),
      abandons: asNumber(kpis.abandons_poste),
      leaving: asNumber(kpis.sortants),
      available: asNumber(kpis.effectif_disponible),
      coveragePct: asNullableNumber(kpis.couverture_pct),
      gap: asNumber(kpis.ecart),
    },
    absences: asArray(raw.absence_items).map(toItem),
    abandons: asArray(raw.abandon_items).map(toItem),
    leaving: asArray(raw.sortant_items).map(toItem),
    notes: asArray(raw.notes).filter((note): note is string => typeof note === 'string'),
  };
}
