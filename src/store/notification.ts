import { setStore } from './store';

let notificationTimer: ReturnType<typeof setTimeout> | null = null;

export function showNotification(message: string): void {
  if (notificationTimer) clearTimeout(notificationTimer);
  setStore((s) => {
    s.notification = message;
  });
  notificationTimer = setTimeout(() => {
    setStore((s) => {
      s.notification = null;
    });
    notificationTimer = null;
  }, 3000);
}

export function clearNotification(): void {
  if (notificationTimer) clearTimeout(notificationTimer);
  notificationTimer = null;
  setStore((s) => {
    s.notification = null;
  });
}
