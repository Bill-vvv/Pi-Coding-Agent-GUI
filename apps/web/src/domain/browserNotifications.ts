export type BrowserNotificationPermission = NotificationPermission | "unsupported";
export type BrowserNotificationOptions = NotificationOptions & { onClick?: () => void };

export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function currentBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!browserNotificationsSupported()) return "unsupported";
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!browserNotificationsSupported()) return "unsupported";
  try {
    return await window.Notification.requestPermission();
  } catch {
    return currentBrowserNotificationPermission();
  }
}

export function showBrowserNotification(title: string, options?: BrowserNotificationOptions): boolean {
  if (currentBrowserNotificationPermission() !== "granted") return false;
  const { onClick, ...notificationOptions } = options ?? {};
  try {
    const notification = new window.Notification(title, notificationOptions);
    if (onClick) {
      notification.onclick = () => {
        notification.close();
        window.focus();
        onClick();
      };
    }
    return true;
  } catch {
    return false;
  }
}
