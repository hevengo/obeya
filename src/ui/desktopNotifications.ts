import { useEffect } from 'react';
import { INPUT } from './stalls';
import { t } from './strings';

export interface DesktopNotificationSettings {
  enabled: boolean;
  sound: boolean;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  }
}

export const desktopNotification = <T,>(command: string, args?: Record<string, unknown>) => {
  const ipc = window.__TAURI_INTERNALS__;
  if (!ipc) return Promise.reject(new Error(t.config.notifications.failed));
  return ipc.invoke<T>(command, args);
};

/** Report input to the shell, which also knows if the window is frontmost. */
export function useDesktopActivity() {
  useEffect(() => {
    if (!window.obeyaApp?.notifications) return;
    let last = -Infinity;
    const used = (event: Event) => {
      if (event.type === 'timeupdate' && (!(event.target instanceof HTMLVideoElement) || event.target.paused || event.target.ended)) return;
      const now = performance.now();
      if (!event.isTrusted || !document.hasFocus() || document.hidden || now - last < 250) return;
      last = now;
      void desktopNotification('notification_activity').catch(console.error);
    };
    const input = [...INPUT, 'timeupdate'];
    for (const type of input) addEventListener(type, used, { capture: true, passive: true });
    return () => {
      for (const type of input) removeEventListener(type, used, true);
    };
  }, []);
}
