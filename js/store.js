// Local data store: records carry updatedAt; deletes are tombstones; merge is newest-wins per record.
import { uid, nowIso, today, addDays, weekday } from './util.js';

export const COLLS = ['folders', 'lists', 'sections', 'tasks', 'habits', 'habitGroups', 'logs', 'devices', 'config'];
const KEY = 'daybook.db.v2';
const TOMBSTONE_DAYS = 90;

let db = emptyDb();
const listeners = new Set();
let saveTimer = null;

function emptyDb() {
  const d = { schema: 2, updatedAt: nowIso() };
  COLLS.forEach((c) => (d[c] = {}));
  return d;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) db = normalize(JSON.parse(raw));
  } catch (e) { console.warn('load failed', e); }
  ensureInbox();
}

function normalize(d) {
  const out = emptyDb();
  out.updatedAt = d.updatedAt || out.updatedAt;
  COLLS.forEach((c) => { out[c] = d[c] || {}; });
  return out;
}

function ensureInbox() {
  if (!db.lists.inbox) db.lists.inbox = { id: 'inbox', name: 'Inbox', color: null, folderId: null, kind: 'tasks', sortOrder: -9e12, updatedAt: '1970-01-01T00:00:00.000Z' };
}

export const getDb = () => db;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('persist failed', e); }
}

// kind: 'local' (user edit, triggers sync) or 'remote' (merged from server, no re-push needed)
export function commit(kind = 'local') {
  db.updatedAt = nowIso();
  clearTimeout(saveTimer);
  persist();
  listeners.forEach((fn) => fn(kind));
}

export function replaceAll(next, kind = 'remote') {
  db = normalize(next);
  ensureInbox();
  commit(kind);
}

// ---- reads ----
export const live = (coll) => Object.values(db[coll]).filter((r) => !r.deleted);
export const get = (coll, id) => { const r = db[coll][id]; return r && !r.deleted ? r : null; };
export const byOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.id).localeCompare(String(b.id));

export function tagsInUse() {
  const s = new Set();
  live('tasks').forEach((t) => (t.tags || []).forEach((x) => s.add(x)));
  return [...s].sort();
}

// ---- writes ----
export function put(coll, rec) {
  const prev = db[coll][rec.id] || {};
  const next = { ...prev, ...rec, updatedAt: nowIso() };
  delete next.deleted; // writing to a record revives it
  db[coll][rec.id] = next;
  commit();
  return db[coll][rec.id];
}

// Write several records with one save and one re-render.
export function putMany(coll, recs) {
  const t = nowIso();
  recs.forEach((rec) => { const next = { ...(db[coll][rec.id] || {}), ...rec, updatedAt: t }; delete next.deleted; db[coll][rec.id] = next; });
  commit();
}

export function patch(coll, id, fields) {
  if (!db[coll][id]) return null;
  return put(coll, { id, ...fields });
}

export function tombstone(coll, id) {
  const r = db[coll][id];
  if (!r) return;
  db[coll][id] = { id, deleted: true, updatedAt: nowIso() };
}

export function remove(coll, id) {
  if (coll === 'tasks') {
    live('tasks').filter((t) => t.parentId === id).forEach((t) => tombstone('tasks', t.id));
  }
  if (coll === 'lists') {
    live('tasks').filter((t) => t.listId === id).forEach((t) => tombstone('tasks', t.id));
    live('sections').filter((s) => s.listId === id).forEach((s) => tombstone('sections', s.id));
  }
  if (coll === 'sections') {
    live('tasks').filter((t) => t.sectionId === id).forEach((t) => put('tasks', { id: t.id, sectionId: null }));
  }
  if (coll === 'habitGroups') {
    live('habits').filter((h) => h.groupId === id).forEach((h) => put('habits', { id: h.id, groupId: null }));
  }
  if (coll === 'habits') {
    Object.values(db.logs).filter((l) => l.habitId === id && !l.deleted).forEach((l) => tombstone('logs', `${l.habitId}|${l.date}`));
  }
  tombstone(coll, id);
  commit();
}

export function addTask(fields) {
  const siblings = live('tasks').filter((t) => t.listId === fields.listId && !t.parentId);
  const top = siblings.length ? Math.min(...siblings.map((t) => t.sortOrder ?? 0)) : 0;
  const now = nowIso();
  return put('tasks', {
    id: uid(), listId: 'inbox', sectionId: null, parentId: null, title: '', notes: '', priority: 0, tags: [],
    date: null, time: null, duration: null, reminder: null, repeat: null, checklist: [],
    done: false, doneAt: null, sortOrder: top - 1099511627776, createdAt: now, ...fields,
  });
}

export function toggleTask(id) {
  const t = get('tasks', id);
  if (!t) return;
  const done = !t.done;
  put('tasks', { id, done, doneAt: done ? nowIso() : null });
}

// ---- habits ----
export const logKey = (hid, date) => `${hid}|${date}`;
export const getLog = (hid, date) => { const l = db.logs[logKey(hid, date)]; return l && !l.deleted ? l : null; };

export function isDue(h, date) {
  if (date < h.startDate) return false;
  const s = h.schedule || { freq: 'daily' };
  if (s.freq === 'weekly') return (s.days || []).includes(weekday(date));
  if (s.interval > 1) {
    const diff = Math.round((new Date(date) - new Date(h.startDate)) / 864e5);
    return diff % s.interval === 0;
  }
  return true;
}

export function logValue(h, date) { return getLog(h.id, date)?.value || 0; }
export function isDone(h, date) {
  const l = getLog(h.id, date);
  if (!l) return false;
  return h.type === 'check' ? !!l.done : (l.value || 0) >= h.goal;
}

export function setLog(h, date, value) {
  const done = h.type === 'check' ? !!value : value >= h.goal;
  put('logs', { id: logKey(h.id, date), habitId: h.id, date, value: h.type === 'check' ? (value ? 1 : 0) : Math.max(0, value), done });
}

export function clearLog(h, date) { if (db.logs[logKey(h.id, date)]) { tombstone('logs', logKey(h.id, date)); commit(); } }

export function toggleHabit(h, date) { setLog(h, date, isDone(h, date) ? 0 : (h.type === 'check' ? 1 : h.goal)); }
export function stepHabit(h, date, dir) {
  const next = Math.max(0, logValue(h, date) + dir * (h.step || 1));
  setLog(h, date, next);
}

export function habitStats(h) {
  const t = today();
  let streak = 0, best = 0, run = 0, total = 0, due30 = 0, done30 = 0;
  // best streak & totals across all history
  let d = h.startDate;
  const logs = Object.values(db.logs).filter((l) => l.habitId === h.id && !l.deleted);
  const firstLog = logs.reduce((m, l) => (l.date < m ? l.date : m), h.startDate);
  d = firstLog < h.startDate ? firstLog : h.startDate;
  for (; d <= t; d = addDays(d, 1)) {
    const done = isDone(h, d);
    if (done) total++;
    const due = isDue(h, d) || done;
    if (due) { if (done) { run++; best = Math.max(best, run); } else if (d !== t) run = 0; }
    if (d > addDays(t, -30) && due) { due30++; if (done) done30++; }
  }
  // current streak: walk back from today
  for (let dd = t; dd >= (firstLog < h.startDate ? firstLog : h.startDate); dd = addDays(dd, -1)) {
    const done = isDone(h, dd);
    if (done) streak++;
    else if (isDue(h, dd) && dd !== t) break;
  }
  return { streak, best, total, rate: due30 ? Math.round((done30 / due30) * 100) : 0 };
}

// ---- merge ----
export function mergeDb(local, remote) {
  const out = emptyDb();
  COLLS.forEach((c) => {
    const ids = new Set([...Object.keys(local[c] || {}), ...Object.keys(remote[c] || {})]);
    ids.forEach((id) => {
      const a = local[c]?.[id], b = remote[c]?.[id];
      if (!a) out[c][id] = b;
      else if (!b) out[c][id] = a;
      else out[c][id] = (a.updatedAt || '') > (b.updatedAt || '') ? a : b;
    });
  });
  out.updatedAt = (local.updatedAt || '') > (remote.updatedAt || '') ? local.updatedAt : remote.updatedAt;
  return out;
}

// Stable text of the data, without the volatile top-level updatedAt, used to skip no-op pushes.
export function fingerprint(d) {
  const o = {};
  COLLS.forEach((c) => {
    o[c] = {};
    Object.keys(d[c] || {}).sort().forEach((k) => { o[c][k] = d[c][k]; });
  });
  return JSON.stringify(o);
}

export function serialize(d) {
  const o = { schema: 2, updatedAt: d.updatedAt };
  COLLS.forEach((c) => {
    o[c] = {};
    Object.keys(d[c] || {}).sort().forEach((k) => { o[c][k] = d[c][k]; });
  });
  return JSON.stringify(o, null, 1) + '\n';
}

export function gcTombstones() {
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 864e5).toISOString();
  let n = 0;
  COLLS.forEach((c) => Object.values(db[c]).forEach((r) => { if (r.deleted && r.updatedAt < cutoff) { delete db[c][r.id]; n++; } }));
  return n;
}
