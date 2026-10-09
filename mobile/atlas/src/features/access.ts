import type { ApiUser } from '@/api/types';
import { canAccessAnyModule, canAccessModule, canPerform, type Action, type ModuleKey } from '@/auth/permissions';

/**
 * Règles d'accès par fonction mobile, alignées sur les contrôles du backend
 * pour chaque route consommée. Elles ne servent qu'à l'affichage ; elles ne
 * sont jamais plus larges que ce que le backend accepte.
 */
type User = ApiUser | null | undefined;

const ATTENDANCE_MODULES: readonly ModuleKey[] = ['pointage', 'ops', 'drh'];
const ALERT_MODULES: readonly ModuleKey[] = ['drh', 'ops'];
const LEAVE_MODULES: readonly ModuleKey[] = ['drh', 'conges'];

function canPerformOnAny(user: User, modules: readonly ModuleKey[], action: Action): boolean {
  return modules.some((module) => canPerform(user, module, action));
}

export const access = {
  alerts: (user: User) => canAccessAnyModule(user, ALERT_MODULES),
  actOnAlerts: (user: User) => canPerformOnAny(user, ALERT_MODULES, 'update') || canPerformOnAny(user, ALERT_MODULES, 'validate'),
  attendance: (user: User) => canAccessAnyModule(user, ATTENDANCE_MODULES),
  /** Journée ouverte : droit de modification ; journée clôturée : droit de validation en plus. */
  correctAttendance: (user: User, closed: boolean = false) =>
    canPerformOnAny(user, ATTENDANCE_MODULES, 'update') && (!closed || canPerformOnAny(user, ATTENDANCE_MODULES, 'validate')),
  abandons: (user: User) => canAccessAnyModule(user, ATTENDANCE_MODULES) && canAccessAnyModule(user, ALERT_MODULES),
  /** L'autorisation fine de saisie manuelle est tranchée par le backend à la déclaration. */
  declareAbandon: (user: User) => canPerformOnAny(user, ['pointage', 'pointeur'], 'create'),
  sites: (user: User) => canAccessModule(user, 'ops'),
  incidents: (user: User) => canAccessModule(user, 'ops'),
  createIncident: (user: User) => canPerform(user, 'ops', 'create'),
  brq: (user: User) => canAccessModule(user, 'brq'),
  employees: (user: User) => canAccessModule(user, 'drh'),
  leaves: (user: User) => canAccessAnyModule(user, LEAVE_MODULES),
  decideLeaves: (user: User) => canPerformOnAny(user, LEAVE_MODULES, 'validate'),
  requestLeave: (user: User) => canPerformOnAny(user, LEAVE_MODULES, 'create'),
  candidates: (user: User) => canAccessAnyModule(user, ['drh', 'recrute']),
} as const;

export type AccessKey = keyof typeof access;
