export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function currentBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!browserNotificationsSupported()) return "unsupported";
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!browserNotificationsSupported()) return "unsupported";
  return window.Notification.requestPermission();
}

export function showBrowserNotification(title: string, options?: NotificationOptions): boolean {
  if (currentBrowserNotificationPermission() !== "granted") return false;
  try {
    new window.Notification(title, options);
    return true;
  } catch {
    return false;
  }
}
