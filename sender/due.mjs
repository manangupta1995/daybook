// Decides which reminders fire inside a time window. Pure functions, no network.
const pad = (n) => String(n).padStart(2, '0');

// Intl formatters are slow to build and the Worker has a tiny CPU budget, so build each once.
const fmtCache = new Map();
function formatter(tz, kind) {
  const k = kind + '|' + tz;
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', kind === 'full'
      ? { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    fmtCache.set(k, f);
  }
  return f;
}

function offsetMs(epoch, tz) {
  const p = Object.fromEntries(formatter(tz, 'full').formatToParts(new Date(epoch)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(epoch / 1000) * 1000;
}

// Epoch ms of a wall-clock date + time in a time zone.
export function zonedEpoch(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}

export function localDate(epoch, tz) {
  const p = Object.fromEntries(formatter(tz, 'date').formatToParts(new Date(epoch)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const weekday = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const live = (c) => Object.values(c || {}).filter((r) => r && !r.deleted);

function habitDue(h, date) {
  if (date < h.startDate) return false;
  const s = h.schedule || { freq: 'daily' };
  if (s.freq === 'weekly') return (s.days || []).includes(weekday(date));
  if ((s.interval || 1) > 1) return Math.round((Date.parse(date) - Date.parse(h.startDate)) / 864e5) % s.interval === 0;
  return true;
}
function habitDone(db, h, date) {
  const l = db.logs?.[`${h.id}|${date}`];
  if (!l || l.deleted) return false;
  return h.type === 'check' ? !!l.done : (l.value || 0) >= h.goal;
}
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };

// from < fire <= to. A reminder never fires for something edited after its fire time (no retroactive pings).
export function computeDue(db, { from, to, tz, defaultTime = '09:00' }) {
  const out = [];
  const lists = db.lists || {};
  const lo = addDays(localDate(from, tz), -1); // a task fires at its date+time minus the reminder, so its date can't be before the window
  for (const t of live(db.tasks)) {
    if (t.done || t.reminder === null || t.reminder === undefined || !t.date) continue;
    if (t.date < lo || t.date > addDays(localDate(to, tz), Math.ceil(t.reminder / 1440) + 1)) continue;
    if (lists[t.listId]?.kind === 'notes') continue;
    const fire = zonedEpoch(t.date, t.time || defaultTime, tz) - t.reminder * 60000;
    if (fire <= from || fire > to || fire <= Date.parse(t.updatedAt || 0)) continue;
    const list = lists[t.listId]?.name;
    const when = t.reminder ? `Due ${t.time ? fmtTime(t.time) : 'today'}` : (t.time ? fmtTime(t.time) : 'Due today');
    out.push({ fire, key: `t:${t.id}:${fire}`, title: t.title || 'Task', body: [when, list].filter(Boolean).join(' · '), url: `./#/today`, tag: `task-${t.id}` });
  }
  const days = [localDate(from, tz), localDate(to, tz)];
  const dates = [...new Set(days)];
  for (const h of live(db.habits)) {
    if (h.archived || !(h.reminders || []).length) continue;
    for (const date of dates) {
      if (!habitDue(h, date) || habitDone(db, h, date)) continue;
      for (const r of h.reminders) {
        const fire = zonedEpoch(date, r, tz);
        if (fire <= from || fire > to || fire <= Date.parse(h.updatedAt || 0)) continue;
        out.push({ fire, key: `h:${h.id}:${date}:${r}`, title: h.name, body: h.type === 'amount' ? `Goal: ${h.goal}${h.unit && h.unit !== 'Count' ? ' ' + h.unit : ''}. Not logged yet.` : 'Not done yet today.', url: `./#/habits`, tag: `habit-${h.id}` });
      }
    }
  }
  return out;
}
