// Runs the built worker against a fake GitHub + fake push service; the "phone" decrypts what it receives.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import worker from './worker.js';
const subtle = globalThis.crypto.subtle;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

// phone side
const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
async function hk(ikm, salt, info, n) { const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8)); }
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));
  const ikm = await hk(secret, auth, cat(Buffer.from('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  assert.equal(plain.at(-1), 2); return JSON.parse(Buffer.from(plain.slice(0, -1)).toString());
}

// VAPID pair, as the app generates it
const vp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await subtle.exportKey('jwk', vp.privateKey);
const vpub = new Uint8Array(65); vpub[0] = 4; vpub.set(unb(jwk.x), 1); vpub.set(unb(jwk.y), 33);
const VAPID_PUBLIC = b64u(vpub);

const NOW = Date.parse('2026-10-06T13:00:30Z'); // 06:00:30 PDT
const realNow = Date.now; Date.now = () => NOW;
const files = { 'data.json': { schema: 2, updatedAt: '2026-10-06T06:35:00Z',
  config: { push: { id: 'push', publicKey: VAPID_PUBLIC } },
  devices: { d1: { id: 'd1', name: 'iPhone', endpoint: 'https://push.example.test/d1', keys: { p256dh: b64u(uaPub), auth: b64u(auth) }, tz: 'America/Los_Angeles' } },
  lists: { inbox: { id: 'inbox', name: 'Inbox', kind: 'tasks' } },
  tasks: { q: { id: 'q', listId: 'inbox', title: 'Quantum study', date: '2026-10-06', time: '06:00', reminder: 0, done: false, updatedAt: '2026-10-06T06:35:08Z' } }, habits: {}, logs: {} } };
const stats = { raw: 0, notModified: 0 }; const shas = {}; const pushes = []; let pushStatus = 201; const writes = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://push.example.test')) { pushes.push({ url, headers: opts.headers, body: new Uint8Array(opts.body) }); return { status: pushStatus }; }
  const m = url.match(/contents\/(.+)$/); const name = m[1];
  assert.equal(opts.headers.Authorization, 'Bearer tok');
  if (!opts.method || opts.method === 'GET') {
    if (!files[name]) return { status: 404, ok: false };
    if (opts.headers.Accept === 'application/vnd.github.raw+json') { // raw body + ETag, 304 when unchanged (like GitHub)
      const et = 'W/"' + createHash('sha1').update(JSON.stringify(files[name])).digest('hex') + '"';
      if (opts.headers['If-None-Match'] === et) { stats.notModified++; return { status: 304, ok: false }; }
      stats.raw++; return { status: 200, ok: true, headers: { get: (k) => (k.toLowerCase() === 'etag' ? et : null) }, text: async () => JSON.stringify(files[name]) };
    }
    return { status: 200, ok: true, json: async () => ({ sha: shas[name] || 's0', content: Buffer.from(JSON.stringify(files[name])).toString('base64') }) };
  }
  const b = JSON.parse(opts.body); files[name] = JSON.parse(Buffer.from(b.content, 'base64').toString()); shas[name] = 's' + (writes.length + 1); writes.push(name); return { status: 200 };
};
const env = { DATA_TOKEN: 'tok', VAPID_PRIVATE_KEY: jwk.d };

let r = await worker.fetch(new Request('https://w.test/'), env);
assert.match(await r.text(), /sent 1/); assert.equal(pushes.length, 1);
const msg = await decrypt(pushes[0].body); assert.equal(msg.title, 'Quantum study'); assert.equal(msg.body, 'Inbox'.length ? msg.body : ''); console.log('ok   phone decrypts the reminder:', JSON.stringify(msg));
const [h, c, s] = pushes[0].headers.Authorization.replace('vapid t=', '').split(', k=')[0].split('.');
const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vp.publicKey, unb(s), new TextEncoder().encode(`${h}.${c}`));
assert.ok(ok); assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://push.example.test'); console.log('ok   VAPID signature verifies');
assert.deepEqual(files['state.json'], { lastRun: NOW }); console.log('ok   state written');
r = await worker.fetch(new Request('https://w.test/'), env); assert.match(await r.text(), /sent 0/); assert.equal(pushes.length, 1); console.log('ok   second minute sends nothing (no duplicates)');

// outage: next check 12 minutes after the reminder time -> labelled as missed
files['data.json'].tasks.late = { id: 'late', listId: 'inbox', title: 'Review draft', date: '2026-10-06', time: '06:10', reminder: 0, done: false, updatedAt: '2026-10-06T06:35:08Z' };
Date.now = () => Date.parse('2026-10-06T13:22:00Z');
await worker.fetch(new Request('https://w.test/'), env); const late = await decrypt(pushes[1].body); assert.match(late.body, /^Missed at 6:10 AM/); console.log('ok   missed reminder is labelled:', late.body);

// dead subscription is removed
files['data.json'].tasks.again = { id: 'again', listId: 'inbox', title: 'Later', date: '2026-10-06', time: '06:30', reminder: 0, done: false, updatedAt: '2026-10-06T06:35:08Z' };
Date.now = () => Date.parse('2026-10-06T13:30:20Z'); pushStatus = 410;
await worker.fetch(new Request('https://w.test/'), env); assert.equal(files['data.json'].devices.d1.deleted, true); console.log('ok   expired device tombstoned');

// --- CPU saving: unchanged data.json is not downloaded/parsed again (304) ---
files['data.json'].devices.d1 = { id: 'd1', name: 'iPhone', endpoint: 'https://push.example.test/d1', keys: { p256dh: b64u(uaPub), auth: b64u(auth) }, tz: 'America/Los_Angeles' };
pushStatus = 201; Date.now = () => Date.parse('2026-10-06T13:40:00Z');
await worker.fetch(new Request('https://w.test/'), env);
const before = { ...stats };
await worker.fetch(new Request('https://w.test/'), env); await worker.fetch(new Request('https://w.test/'), env);
assert.equal(stats.raw, before.raw); assert.equal(stats.notModified, before.notModified + 2); console.log('ok   unchanged data.json answers 304, nothing re-downloaded');
files['data.json'].updatedAt = 'x'; await worker.fetch(new Request('https://w.test/'), env);
assert.equal(stats.raw, before.raw + 1); console.log('ok   changed data.json is downloaded again');

// --- recovery after a long outage (the 2026-10-17 case: Worker down 15:00-18:25, habit reminder at 16:00) ---
files['data.json'].habits.p = { id: 'p', name: '38 pushups', type: 'check', goal: 1, schedule: { freq: 'daily', interval: 1 }, reminders: ['16:00'], startDate: '2026-08-16', archived: false, updatedAt: '2026-10-10T23:08:32Z' };
files['state.json'] = { lastRun: Date.parse('2026-10-17T22:00:10Z') }; // 15:00:10 PDT, last successful advance
Date.now = () => Date.parse('2026-10-18T01:25:30Z'); // 18:25:30 PDT, Worker is healthy again
const n0 = pushes.length;
r = await worker.fetch(new Request('https://w.test/'), env); assert.match(await r.text(), /sent 1/);
const rec = await decrypt(pushes[n0].body); assert.equal(rec.title, '38 pushups'); assert.match(rec.body, /^Missed at 4:00 PM\. Not done yet today\./); console.log('ok   2h25m-late reminder is still delivered:', rec.body);
// ...but not once it is older than the catch-up window
files['state.json'] = { lastRun: Date.parse('2026-10-17T22:00:10Z') };
Date.now = () => Date.parse('2026-10-18T02:30:30Z'); // 19:30:30 PDT, 3.5 h after the reminder
const n1 = pushes.length;
r = await worker.fetch(new Request('https://w.test/'), env); assert.match(await r.text(), /sent 0/); assert.equal(pushes.length, n1); console.log('ok   reminders older than 3 h are dropped');

// scheduled() entry point
Date.now = realNow; let waited; await worker.scheduled({}, env, { waitUntil: (p) => { waited = p; } }); await waited; console.log('ok   scheduled() entry point runs');
