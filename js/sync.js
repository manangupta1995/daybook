// GitHub Contents API sync: pull, merge, push with sha; retries on conflict.
import { getDb, replaceAll, mergeDb, fingerprint, serialize, onChange, gcTombstones } from './store.js';

const CFG_KEY = 'daybook.cfg.v1';
export const DEFAULTS = { token: '', owner: 'manangupta1995', repo: 'daybook-data', path: 'data.json', branch: 'main' };

export function getCfg() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function setCfg(patch) {
  const next = { ...getCfg(), ...patch };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch (e) { console.warn(e); }
  return next;
}

export const status = { state: 'idle', message: '', lastSynced: null, lastSha: null };
const subs = new Set();
export const onStatus = (fn) => { subs.add(fn); return () => subs.delete(fn); };
function setStatus(state, message = '') {
  status.state = state; status.message = message;
  if (state === 'ok') status.lastSynced = new Date();
  subs.forEach((f) => f(status));
}

const b64enc = (s) => { const b = new TextEncoder().encode(s); let bin = ''; b.forEach((x) => (bin += String.fromCharCode(x))); return btoa(bin); };
const b64dec = (s) => { const bin = atob(s.replace(/\n/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); };

function api(cfg, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(cfg.path)}${path}`, {
    cache: 'no-store',
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
}

async function fetchRemote(cfg) {
  const r = await api(cfg, `?ref=${encodeURIComponent(cfg.branch)}`);
  if (r.status === 404) return { data: null, sha: null };
  if (r.status === 401 || r.status === 403) throw new Error('auth');
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  let text;
  if (j.content) text = b64dec(j.content);
  else { // files over 1MB come back without inline content
    const raw = await api(cfg, `?ref=${encodeURIComponent(cfg.branch)}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    text = await raw.text();
  }
  return { data: JSON.parse(text), sha: j.sha };
}

async function putRemote(cfg, data, sha) {
  const body = { message: `daybook sync ${new Date().toISOString()}`, content: b64enc(serialize(data)), branch: cfg.branch };
  if (sha) body.sha = sha;
  const r = await api(cfg, '', { method: 'PUT', body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (r.status === 401 || r.status === 403) throw new Error('auth');
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  return { sha: j.content?.sha };
}

let running = null, again = false;

export function syncNow() {
  const cfg = getCfg();
  if (!cfg.token) { setStatus('off', 'Not connected'); return Promise.resolve(); }
  if (running) { again = true; return running; }
  running = (async () => {
    await null; // never finish synchronously, or `running` would be assigned after it was cleared
    setStatus('syncing');
    try {
      if (!navigator.onLine) throw new Error('offline');
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await fetchRemote(cfg);
        let merged = remote.data ? mergeDb(getDb(), remote.data) : getDb();
        replaceAll(merged, 'remote');
        gcTombstones();
        merged = getDb();
        const needsPush = !remote.data || fingerprint(merged) !== fingerprint(remote.data);
        if (!needsPush) { status.lastSha = remote.sha; setStatus('ok'); return; }
        const res = await putRemote(cfg, merged, remote.sha);
        if (res.conflict) continue; // someone else wrote first: refetch and merge again
        status.lastSha = res.sha;
        setStatus('ok');
        return;
      }
      throw new Error('Could not resolve sync conflict, will retry');
    } catch (e) {
      if (e.message === 'auth') setStatus('error', 'Token rejected or missing access to the data repo');
      else if (e.message === 'offline' || e instanceof TypeError) setStatus('offline', 'Offline, changes are saved on this device');
      else setStatus('error', e.message);
    } finally {
      running = null;
      if (again) { again = false; setTimeout(syncNow, 500); }
    }
  })();
  return running;
}

let timer = null;
export function startAutoSync() {
  onChange((kind) => {
    if (kind !== 'local') return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 4000); // batch quick edits into one commit
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', syncNow);
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 90000);
  syncNow();
}

export async function testConnection(cfg) {
  const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
    cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}` },
  });
  if (r.status === 401) return 'The token was rejected.';
  if (r.status === 404 || r.status === 403) return 'The token cannot see that repo. Check the repo name and that the token has access to it.';
  if (!r.ok) return `GitHub returned ${r.status}.`;
  const j = await r.json();
  if (j.permissions && !j.permissions.push) return 'The token can read the repo but not write to it. Give it Contents: Read and write.';
  return null;
}
