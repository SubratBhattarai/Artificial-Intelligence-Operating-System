import { DEADLINE_PATTERN } from '../../shared/mail';
import type { EventStore } from '../apps/eventStore';
import type { MailStore } from '../apps/mailStore';
import type { TaskStore } from '../apps/taskStore';
import { scoreImportance } from './importance';
import type { NotificationStore } from './stores';

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Looks through the user's own local data and raises notifications for what matters. Each event
 * is announced once (by key). Returns the notifications that were new, so the UI can show them.
 */
export function scanLocalSources(
  deps: { tasks: TaskStore; events: EventStore; mail: MailStore; notifications: NotificationStore },
  now = Date.now(),
) {
  const created = [];
  const today = dayKey(now);

  for (const task of deps.tasks.list()) {
    if (task.status === 'done' || !task.due) continue;
    const dueAt = new Date(`${task.due}T23:59:00`).getTime();
    const hoursUntil = (dueAt - now) / 3_600_000;
    if (hoursUntil > 36) continue;
    const item = deps.notifications.add(
      {
        source: 'task',
        title:
          hoursUntil < 0
            ? `Overdue: ${task.title}`
            : `Due ${task.due === today ? 'today' : 'soon'}: ${task.title}`,
        importance: scoreImportance({ source: 'task', hoursUntil }),
        key: `task-${task.id}-${task.due}-${hoursUntil < 0 ? 'late' : today}`,
      },
      now,
    );
    if (item) created.push(item);
  }

  for (const event of deps.events.list({ from: now, to: now + 36 * 3_600_000 })) {
    const hoursUntil = (event.start - now) / 3_600_000;
    const item = deps.notifications.add(
      {
        source: 'calendar',
        title: `${event.title}`,
        body: event.allDay
          ? 'All day'
          : new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        importance: scoreImportance({ source: 'calendar', hoursUntil }),
        key: `event-${event.id}-${event.start}`,
      },
      now,
    );
    if (item) created.push(item);
  }

  for (const message of deps.mail.list({ folder: 'inbox', unreadOnly: true }).slice(0, 20)) {
    const mentionsDeadline = DEADLINE_PATTERN.test(`${message.subject} ${message.body}`);
    const item = deps.notifications.add(
      {
        source: 'mail',
        title: message.subject || '(no subject)',
        body: `From ${message.from}`,
        importance: scoreImportance({ source: 'mail', mentionsDeadline }),
        key: `mail-${message.id}`,
      },
      now,
    );
    if (item) created.push(item);
  }
  return created;
}
