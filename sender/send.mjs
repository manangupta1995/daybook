// Runs every few minutes from GitHub Actions: reads the private data repo, pushes due reminders to subscribed devices.
import { computeDue } from './due.mjs';
import { sendPush } from './webpush.mjs';

const { DATA_TOKEN, VAPID_PRIVATE_KEY, VAPID_SUBJECT = 'https://manangupta1995.github.io/daybook/' } = process.env;
const REPO = process.env.DATA_REPO || 'manangupta1995/daybook-data';
const DEFAULT_TZ = 'America/Los_Angeles';
const MAX_CATCHUP = 2 * 3600e3;

if (!DATA_TOKEN || !VAPID_PRIVATE_KEY) { console.log('Missing DATA_TOKEN or VAPID_PRIVATE_KEY. Add them as repository secrets. Nothing sent.'); process.exit(0); }

const gh = (path, opts = {}) => fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${DATA_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) } });
async function getJson(path) {
  const r = await gh(path);
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')), sha: j.sha };
}
async function putJson(path, data, sha, message) {
  const r = await gh(path, { method: 'PUT', body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(data, null, 1) + '\n').toString('base64'), ...(sha ? { sha } : {}) }) });
  return r.status;
}

const now = Date.now();
const [{ data: db }, { data: state, sha: stateSha }] = await Promise.all([getJson('data.json'), getJson('state.json')]);
if (!db) { console.log('No data.json yet.'); process.exit(0); }
const VAPID_PUBLIC_KEY = db.config?.push?.publicKey || process.env.VAPID_PUBLIC_KEY;
if (!VAPID_PUBLIC_KEY) { console.log('No reminder keys generated yet (Settings → Reminders).'); process.exit(0); }
const devices = Object.values(db.devices || {}).filter((d) => !d.deleted && d.endpoint);
if (!devices.length) { console.log('No subscribed devices.'); process.exit(0); }

const from = Math.max(state?.lastRun || now - 10 * 60e3, now - MAX_CATCHUP);
const tz = devices[0].tz || DEFAULT_TZ;
const due = computeDue(db, { from, to: now, tz });
console.log(`window ${Math.round((now - from) / 60e3)} min, ${devices.length} device(s), ${due.length} due`);
if (!due.length) process.exit(0);

const gone = new Set();
let sent = 0;
for (const d of devices) {
  for (const n of due) {
    try {
      const status = await sendPush({ endpoint: d.endpoint, keys: d.keys }, { title: n.title, body: n.body, url: n.url, tag: n.tag }, { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY });
      if (status === 404 || status === 410) { gone.add(d.id); break; }
      if (status >= 200 && status < 300) sent++; else console.log(`push service answered ${status}`);
    } catch (e) { console.log('send failed:', e.message); }
  }
}
console.log(`sent ${sent}`);

// Remember how far we got so nothing fires twice.
const code = await putJson('state.json', { lastRun: now }, stateSha, 'reminders: advance window');
if (code >= 300) console.log(`state write answered ${code}`);

// Drop subscriptions the push service says are gone (re-read the file first: the app may have written meanwhile).
for (let i = 0; gone.size && i < 3; i++) {
  const { data: fresh, sha } = await getJson('data.json');
  const stamp = new Date().toISOString();
  gone.forEach((id) => { if (fresh.devices?.[id]) fresh.devices[id] = { id, deleted: true, updatedAt: stamp }; });
  fresh.updatedAt = stamp;
  const c = await putJson('data.json', fresh, sha, 'reminders: remove expired device');
  if (c < 300) break;
}
