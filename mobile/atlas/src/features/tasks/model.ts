import type { Alert } from '@/api/domains/alerts';
import type { Leave } from '@/api/domains/drh';

/**
 * « Mes tâches » : vue de ce qui attend une action, construite à partir des
 * objets ATLAS existants (alertes, congés). Aucune donnée n'est dupliquée :
 * chaque tâche pointe vers son objet d'origine.
 */
export type TaskType = 'alert' | 'leave';
export type TaskPriority = 'critical' | 'high' | 'normal';

export type Task = {
  id: string;
  type: TaskType;
  title: string;
  /** Pour un congé : type de congé, à traduire par l'écran. */
  detail: string | null;
  priority: TaskPriority;
  date: string;
  society: string | null;
  siteId: number | null;
  route: string;
};

const ORDER: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2 };

export function alertPriority(severity: Alert['severity']): TaskPriority {
  return severity === 'critical' ? 'critical' : severity === 'warning' ? 'high' : 'normal';
}

export function buildTasks(input: { alerts?: readonly Alert[]; leaves?: readonly Leave[] }): Task[] {
  const tasks: Task[] = [];
  for (const alert of input.alerts ?? []) {
    if (alert.status !== 'open' && alert.status !== 'assigned') continue;
    tasks.push({
      id: `alert-${alert.id}`,
      type: 'alert',
      title: alert.title,
      detail: alert.summary,
      priority: alertPriority(alert.severity),
      date: alert.lastDetectedAt,
      society: alert.society || null,
      siteId: alert.siteId,
      route: `/alerts/${alert.id}`,
    });
  }
  for (const leave of input.leaves ?? []) {
    if (leave.status !== 'instance') continue;
    tasks.push({
      id: `leave-${leave.id}`,
      type: 'leave',
      title: '',
      detail: leave.type,
      priority: 'normal',
      date: leave.startDate,
      society: null,
      siteId: null,
      route: '/drh/leaves',
    });
  }
  return tasks.sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || a.date.localeCompare(b.date));
}
