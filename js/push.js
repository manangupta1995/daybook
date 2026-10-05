// Client side of reminders: subscribe this device to Web Push and record it in the data file.
import * as S from './store.js';
import { syncNow } from './sync.js';

const DEV_KEY = 'daybook.deviceId';
export const publicKey = () => S.get('config', 'push')?.publicKey || null;
export const hasKeys = () => !!publicKey();

// Generate a VAPID key pair in the browser. The public key goes into the synced data file;
// the private key is returned once for the user to paste into a GitHub secret and is never stored.
export async function generateKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const x = b64uToBytes(jwk.x), y = b64uToBytes(jwk.y);
  const raw = new Uint8Array(65); raw[0] = 4; raw.set(x, 1); raw.set(y, 33);
  const pub = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // new keys invalidate every existing subscription
  S.live('devices').forEach((d) => S.tombstone('devices', d.id));
  S.put('config', { id: 'push', publicKey: pub, createdAt: new Date().toISOString() });
  syncNow();
  return { publicKey: pub, privateKey: jwk.d };
}

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
  if (!hasKeys()) throw new Error('Generate the reminder keys first (on any device), then let this device sync.');
  const key = b64uToBytes(publicKey());
  let sub = await reg.pushManager.getSubscription();
  const cur = sub?.options?.applicationServerKey;
  if (sub && cur && cur.byteLength && Array.from(new Uint8Array(cur)).join() !== Array.from(key).join()) { await sub.unsubscribe(); sub = null; } // keys were regenerated
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
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
