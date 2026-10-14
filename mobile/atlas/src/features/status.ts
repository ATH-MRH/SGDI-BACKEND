import type { AlertSeverity, AlertStatus } from '@/api/domains/alerts';
import { t, type TranslationKey } from '@/i18n';
import type { Tone } from '@/theme/tokens';

type Label = { label: TranslationKey; tone: Tone };

const PRESENCE: Record<string, Label> = {
  present: { label: 'status.present', tone: 'success' },
  presence_hors_planning: { label: 'status.present', tone: 'success' },
  absent: { label: 'status.absent', tone: 'danger' },
  non_pointe: { label: 'status.notPointed', tone: 'warning' },
  conge: { label: 'status.leave', tone: 'info' },
  maladie: { label: 'status.sick', tone: 'info' },
  repos: { label: 'status.rest', tone: 'neutral' },
  repos_planifie: { label: 'status.rest', tone: 'neutral' },
  mission: { label: 'status.mission', tone: 'info' },
  abandon_poste: { label: 'status.abandon', tone: 'danger' },
  sortie_effective: { label: 'status.left', tone: 'neutral' },
};

/** Un statut inconnu est affiché tel quel, sans couleur : jamais interprété. */
export function presenceStatus(status: string): Label | null {
  return PRESENCE[status] ?? null;
}

export const SEVERITY: Record<AlertSeverity, Label> = {
  critical: { label: 'alerts.severity.critical', tone: 'danger' },
  warning: { label: 'alerts.severity.warning', tone: 'warning' },
  info: { label: 'alerts.severity.info', tone: 'info' },
};

export const ALERT_STATUS: Record<AlertStatus, Label> = {
  open: { label: 'alerts.status.open', tone: 'danger' },
  acknowledged: { label: 'alerts.status.acknowledged', tone: 'warning' },
  assigned: { label: 'alerts.status.assigned', tone: 'warning' },
  deferred: { label: 'alerts.status.deferred', tone: 'neutral' },
  treated: { label: 'alerts.status.treated', tone: 'success' },
  ignored: { label: 'alerts.status.ignored', tone: 'neutral' },
  resolved: { label: 'alerts.status.resolved', tone: 'success' },
};

const LEAVE: Record<string, Label> = {
  instance: { label: 'leaves.status.pending', tone: 'warning' },
  approuve: { label: 'leaves.status.approved', tone: 'success' },
  refuse: { label: 'leaves.status.refused', tone: 'danger' },
};

export function leaveStatus(status: string): Label | null {
  return LEAVE[status] ?? null;
}

const INCIDENT_SEVERITY: Record<string, Label> = {
  faible: { label: 'incidents.severity.faible', tone: 'neutral' },
  moyenne: { label: 'incidents.severity.moyenne', tone: 'info' },
  elevee: { label: 'incidents.severity.elevee', tone: 'warning' },
  critique: { label: 'incidents.severity.critique', tone: 'danger' },
};

export function incidentSeverity(severity: string): Label | null {
  return INCIDENT_SEVERITY[severity] ?? null;
}

/** Couleur d'un statut RH connu ; un statut inconnu reste neutre et s'affiche tel quel. */
export function employeeStatusTone(status: string): Tone {
  if (status === 'actif') return 'success';
  if (/suspen|blacklist|abandon/.test(status)) return 'danger';
  if (/sort|demission|licen|fin/.test(status)) return 'warning';
  if (/conge|maladie|mission/.test(status)) return 'info';
  return 'neutral';
}

/** Libellé d'un statut renvoyé tel quel par le backend : première lettre en capitale, rien d'interprété. */
export function rawStatusLabel(status: string): string {
  const text = status.replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : t('common.none');
}
