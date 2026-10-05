// Client side of reminders: subscribe this device to Web Push and record it in the data file.
import * as S from './store.js';
import { syncNow } from './sync.js';

export const VAPID_PUBLIC = 'BNtUk4DM9QxrZYvJvp064vlnVkDITYw0Xctk0GNHkMkmo4byEZlPFJu887D3cWsr5HSBH8LPN6jBC9pT8UaOTG4';
const DEV_KEY = 'daybook.deviceId';

export const info = { supported: false, standalone: false, permission: 'default', subscribed: false, ready: false };

const b64uToBytes = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Edg\//.test(u) ? 'Edge' : /Chrome/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : 'Browser'; };
async function sha(text) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join(''); }

export async function refreshInfo() {
  info.supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  info.standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  info.permission = 'Notification' in window ? Notification.permission : 'denied';
  info.subscribed = false;
  if (info.supported) {
    try { const reg = await navigator.serviceWorker.ready; info.subscribed = !!(await reg.pushManager.getSubscription()) && info.permission === 'granted'; } catch { /* no sw yet */ }
  }
  info.ready = true;
  return info;
}

// Must be called from a tap (iOS requires a user gesture for the permission prompt).
export async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { await refreshInfo(); throw new Error('Notifications were not allowed. You can allow them in the iPhone Settings app under Notifications → Daybook.'); }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(VAPID_PUBLIC) });
  const j = sub.toJSON();
  const id = await sha(j.endpoint);
  S.put('devices', { id, name: deviceName(), endpoint: j.endpoint, keys: j.keys, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, createdAt: new Date().toISOString() });
  try { localStorage.setItem(DEV_KEY, id); } catch { /* ignore */ }
  await refreshInfo();
  syncNow();
}

export async function disable() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { const id = await sha(sub.endpoint); await sub.unsubscribe(); S.remove('devices', id); }
  await refreshInfo();
  syncNow();
}

export async function testLocal() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Daybook', { body: 'Notifications work on this device.', icon: 'icons/icon-192.png', tag: 'daybook-test' });
}
