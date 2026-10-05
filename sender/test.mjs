// Offline checks: encryption round-trips with the subscriber's key, JWT verifies, due-window logic.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { encrypt, vapidJwt, sendPush } from './webpush.mjs';
import { computeDue, zonedEpoch } from './due.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');
// --- subscriber side (what the phone has)
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { endpoint: 'https://push.example.test/abc', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };
function decrypt(body) {
  const salt = body.subarray(0, 16); const idlen = body[20]; const asPub = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2); return plain.subarray(0, plain.length - 1).toString();
}
const msg = JSON.stringify({ title: 'Tést ✓', body: 'x'.repeat(300) });
assert.equal(decrypt(encrypt(sub, msg)), msg); console.log('ok   encrypt/decrypt round trip');

// --- VAPID
const v = crypto.createECDH('prime256v1'); v.generateKeys();
const pub = b64u(v.getPublicKey()), priv = b64u(v.getPrivateKey());
const jwt = vapidJwt(sub.endpoint, 'https://example.test/', pub, priv);
const [h, c, s] = jwt.split('.');
const vk = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(v.getPublicKey().subarray(1, 33)), y: b64u(v.getPublicKey().subarray(33)) }, format: 'jwk' });
assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: vk, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://push.example.test'); console.log('ok   VAPID JWT verifies');
let seen;
const st = await sendPush(sub, { title: 'a' }, { subject: 'https://example.test/', publicKey: pub, privateKey: priv, fetchImpl: async (u, o) => { seen = o; return { status: 201 }; } });
assert.equal(st, 201); assert.equal(seen.headers['Content-Encoding'], 'aes128gcm'); assert.match(seen.headers.Authorization, /^vapid t=.+, k=/); console.log('ok   send request shape');

// --- time zones
const tz = 'America/Los_Angeles';
assert.equal(new Date(zonedEpoch('2026-10-05', '09:00', tz)).toISOString(), '2026-10-05T16:00:00.000Z'); // PDT
assert.equal(new Date(zonedEpoch('2026-12-05', '09:00', tz)).toISOString(), '2026-12-05T17:00:00.000Z'); // PST
assert.equal(new Date(zonedEpoch('2026-03-08', '09:00', tz)).toISOString(), '2026-03-08T16:00:00.000Z'); // DST day
console.log('ok   zoned time incl. DST');

// --- due logic
const at = (d, t) => zonedEpoch(d, t, tz);
const db = {
  lists: { inbox: { id: 'inbox', name: 'Inbox', kind: 'tasks' }, n: { id: 'n', name: 'Notes', kind: 'notes' } },
  tasks: {
    a: { id: 'a', listId: 'inbox', title: 'Call dentist', date: '2026-10-05', time: '15:00', reminder: 0, done: false, updatedAt: '2026-10-01T00:00:00Z' },
    b: { id: 'b', listId: 'inbox', title: 'Early heads-up', date: '2026-10-05', time: '15:00', reminder: 30, done: false, updatedAt: '2026-10-01T00:00:00Z' },
    c: { id: 'c', listId: 'inbox', title: 'Done already', date: '2026-10-05', time: '15:00', reminder: 0, done: true, updatedAt: '2026-10-01T00:00:00Z' },
    d: { id: 'd', listId: 'inbox', title: 'Edited late', date: '2026-10-05', time: '15:00', reminder: 0, done: false, updatedAt: '2026-10-05T23:00:00Z' },
    e: { id: 'e', listId: 'inbox', title: 'No time', date: '2026-10-05', reminder: 0, done: false, updatedAt: '2026-10-01T00:00:00Z' },
    f: { id: 'f', listId: 'inbox', title: 'Deleted', deleted: true },
    g: { id: 'g', listId: 'n', title: 'A note', date: '2026-10-05', time: '15:00', reminder: 0, done: false, updatedAt: '2026-10-01T00:00:00Z' },
  },
  habits: {
    h1: { id: 'h1', name: 'Pushups', type: 'check', goal: 1, schedule: { freq: 'daily' }, reminders: ['16:00'], startDate: '2026-08-16', updatedAt: '2026-08-16T00:00:00Z' },
    h2: { id: 'h2', name: 'Protein', type: 'amount', goal: 60, unit: 'g', schedule: { freq: 'daily' }, reminders: ['16:00'], startDate: '2026-08-16', updatedAt: '2026-08-16T00:00:00Z' },
    h3: { id: 'h3', name: 'Mon only', type: 'check', goal: 1, schedule: { freq: 'weekly', days: [1] }, reminders: ['16:00'], startDate: '2026-08-16', updatedAt: '2026-08-16T00:00:00Z' },
  },
  logs: { 'h2|2026-10-05': { habitId: 'h2', date: '2026-10-05', value: 70, done: true } },
};
let r = computeDue(db, { from: at('2026-10-05', '14:55'), to: at('2026-10-05', '15:05'), tz });
assert.deepEqual(r.map((x) => x.title), ['Call dentist']); // 15:00 sharp only; done/deleted/edited-late/note excluded
r = computeDue(db, { from: at('2026-10-05', '14:25'), to: at('2026-10-05', '14:35'), tz });
assert.deepEqual(r.map((x) => x.title), ['Early heads-up']); // 30 min before
r = computeDue(db, { from: at('2026-10-05', '08:55'), to: at('2026-10-05', '09:05'), tz });
assert.deepEqual(r.map((x) => x.title), ['No time']); // default 09:00
r = computeDue(db, { from: at('2026-10-05', '15:55'), to: at('2026-10-05', '16:05'), tz });
assert.deepEqual(r.map((x) => x.title).sort(), ['Mon only', 'Pushups']); // Protein already met so skipped; Oct 5 2026 is a Monday
r = computeDue(db, { from: at('2026-10-06', '15:55'), to: at('2026-10-06', '16:05'), tz });
assert.deepEqual(r.map((x) => x.title).sort(), ['Protein', 'Pushups']); // Tuesday: Mon-only skipped, Protein not logged
r = computeDue(db, { from: at('2026-10-05', '15:55'), to: at('2026-10-05', '16:05'), tz }); assert.equal(computeDue(db, { from: at('2026-10-05', '16:00'), to: at('2026-10-05', '16:10'), tz }).length, 0); // window is exclusive of its start: no double fire
console.log('ok   task + habit windows');
