import { create } from 'zustand';
import type { NotificationItem } from '../../shared/agents';
import { useFocus } from './focusStore';

interface NotificationState {
  items: NotificationItem[];
  /** Urgent items briefly shown as a toast. Everything else waits quietly in the bell. */
  toasts: NotificationItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clear: () => Promise<void>;
  dismissToast: (id: string) => void;
}

export const useNotifications = create<NotificationState>((set) => ({
  items: [],
  toasts: [],
  open: false,
  setOpen: (open) => set({ open }),
  async refresh() {
    const items = await window.aios?.notifications.list();
    if (items) set({ items });
  },
  async markRead(id) {
    const items = await window.aios?.notifications.read(id);
    if (items) set({ items });
  },
  async markAllRead() {
    const items = await window.aios?.notifications.readAll();
    if (items) set({ items });
  },
  async clear() {
    const items = await window.aios?.notifications.clear();
    if (items) set({ items });
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

let started = false;
export function initNotifications(): void {
  if (started || !window.aios) return;
  started = true;
  void useNotifications.getState().refresh();
  window.aios.notifications.onNew((item) => {
    useNotifications.setState((state) => ({
      items: [item, ...state.items.filter((i) => i.id !== item.id)],
      toasts:
        item.importance === 'urgent' && (!useFocus.getState().endsAt || item.source === 'security')
          ? [...state.toasts, item].slice(-3)
          : state.toasts,
    }));
    if (item.importance === 'urgent') {
      window.setTimeout(() => useNotifications.getState().dismissToast(item.id), 9000);
    }
  });
}
