// Reminders for things a rider signed up for (events, challenges). Stored on the phone; shown in the
// bell list, and as a phone notification when the app is open and the rider allowed notifications.
export interface Reminder { id: string; title: string; body: string; at: number; tab?: string }
const KEY = 'legonrush.reminders.v1';

const read = (): Reminder[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (r: Reminder[]) => { try { localStorage.setItem(KEY, JSON.stringify(r.slice(-100))); } catch { /* storage full or blocked */ } };

export function remind(r: Reminder) {
  write([...read().filter((x) => x.id !== r.id), r]);
}
export function cancelReminder(id: string) {
  write(read().filter((x) => x.id !== id && !x.id.startsWith(id + ':')));
}
export const reminders = () => read().sort((a, b) => a.at - b.at);

/** due reminders, removed from the list; call on a timer */
export function takeDue(now = Date.now()): Reminder[] {
  const all = read();
  const due = all.filter((r) => r.at <= now);
  if (due.length) write(all.filter((r) => r.at > now));
  return due;
}

export async function askPermission() {
  if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => undefined);
}
export function showSystem(r: Reminder) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(r.title, { body: r.body, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` }); } catch { /* not allowed here */ }
  }
}
