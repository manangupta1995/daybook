// Cloudflare Worker: runs every minute (cron trigger), reads the private data repo, sends due reminders.
// Secrets: DATA_TOKEN (GitHub fine-grained token, Contents read/write on daybook-data), VAPID_PRIVATE_KEY.
const CATCHUP = 3 * 3600e3;  // after an outage, catch up on up to 3 hours (older ones are dropped)
const COLD_START = 5 * 60e3; // first ever run

// The free plan kills a run that uses more than ~10 ms of CPU, and downloading + decoding + parsing the whole
// data.json every minute is the expensive part. So: fetch it as raw text (no base64 decode) and keep the parsed
// copy in memory; GitHub answers 304 (no body) while the file is unchanged, and then nothing is parsed at all.
let dbCache = null; // { etag, db }, lives as long as the Worker isolate does

const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const b64enc = (s) => { let r = ''; new TextEncoder().encode(s).forEach((b) => { r += String.fromCharCode(b); }); return btoa(r); };

async function run(env) {
  const REPO = env.DATA_REPO || 'manangupta1995/daybook-data';
  const gh = (path, opts = {}) => fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.DATA_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'daybook-reminders', ...(opts.headers || {}) } });
  const getJson = async (path) => {
    const r = await gh(path);
    if (r.status === 404) return { data: null, sha: null };
    if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
    const j = await r.json();
    return { data: JSON.parse(b64dec(j.content)), sha: j.sha };
  };
  const putJson = async (path, data, sha, message) => (await gh(path, { method: 'PUT', body: JSON.stringify({ message, content: b64enc(JSON.stringify(data, null, 1) + '\n'), ...(sha ? { sha } : {}) }) })).status;
  const getDb = async () => {
    const headers = { Accept: 'application/vnd.github.raw+json' };
    if (dbCache?.etag) headers['If-None-Match'] = dbCache.etag;
    const r = await gh('data.json', { headers });
    if (r.status === 304 && dbCache) return dbCache.db;
    dbCache = null;
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GET data.json: ${r.status}`);
    const db = JSON.parse(await r.text());
    dbCache = { etag: r.headers?.get?.('etag') || null, db };
    console.log('loaded data.json');
    return db;
  };

  if (!env.DATA_TOKEN || !env.VAPID_PRIVATE_KEY) { console.log('Missing DATA_TOKEN or VAPID_PRIVATE_KEY'); return { sent: 0 }; }
  const now = Date.now();
  const [db, { data: state, sha: stateSha }] = await Promise.all([getDb(), getJson('state.json')]);
  if (!db) return { sent: 0 };
  const publicKey = db.config?.push?.publicKey;
  const devices = Object.values(db.devices || {}).filter((d) => !d.deleted && d.endpoint);
  if (!publicKey || !devices.length) return { sent: 0 };

  const from = Math.max(state?.lastRun ?? now - COLD_START, now - CATCHUP);
  const tz = devices[0].tz || 'America/Los_Angeles';
  const fmt = (e) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(e));
  const due = computeDue(db, { from, to: now, tz }).map((n) => (now - n.fire > 10 * 60e3 ? { ...n, body: `Missed at ${fmt(n.fire)}. ${n.body}` } : n));
  if (!due.length) return { sent: 0 };

  const gone = new Set(); let sent = 0;
  for (const d of devices) {
    for (const n of due) {
      try {
        const status = await sendPush({ endpoint: d.endpoint, keys: d.keys }, { title: n.title, body: n.body, url: n.url, tag: n.tag }, { subject: env.VAPID_SUBJECT || 'https://manangupta1995.github.io/daybook/', publicKey, privateKey: env.VAPID_PRIVATE_KEY });
        if (status === 404 || status === 410) { gone.add(d.id); break; }
        if (status >= 200 && status < 300) sent++; else console.log(`push service answered ${status}`);
      } catch (e) { console.log('send failed', e.message); }
    }
  }
  console.log(`due ${due.length}, sent ${sent}`);
  const code = await putJson('state.json', { lastRun: now }, stateSha, 'reminders: advance window');
  if (code >= 300) console.log(`state write answered ${code}`);
  for (let i = 0; gone.size && i < 3; i++) {
    const { data: fresh, sha } = await getJson('data.json');
    const stamp = new Date().toISOString();
    gone.forEach((id) => { if (fresh.devices?.[id]) fresh.devices[id] = { id, deleted: true, updatedAt: stamp }; });
    fresh.updatedAt = stamp;
    if ((await putJson('data.json', fresh, sha, 'reminders: remove expired device')) < 300) break;
  }
  if (gone.size) dbCache = null; // we changed the file; reload next time
  return { sent };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env).catch((e) => console.log('run failed:', e.message))); },
  async fetch(request, env) { // visiting the worker URL runs a check and reports (useful for a first test)
    try { const r = await run(env); return new Response(`ok, sent ${r.sent}\n`); } catch (e) { return new Response(`error: ${e.message}\n`, { status: 500 }); }
  },
};
export { run };
