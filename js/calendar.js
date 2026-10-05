// Month calendar with a day panel.
import { esc, today, addDays, ymd, parseYmd, friendlyDate, MONTHS_LONG, DOW_SHORT } from './util.js';
import * as S from './store.js';
import { icons, registerActions, rerender, uiGet, uiSet, openSheet, closeSheet, focusField } from './ui.js';
import { taskRow } from './tasks.js';
import { getCfg } from './sync.js';

let cursor = today().slice(0, 7); // YYYY-MM
let selected = today();
let needScroll = true;
const HOUR = 56; // px per hour in the day view
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const quick = (d) => `<form class="quick" data-quick="day:${d}" autocomplete="off"><input type="text" name="q" placeholder="Add a task on ${esc(friendlyDate(d))}…" enterkeyhint="done" aria-label="Add task"><button type="submit" aria-label="Add">${icons.plus}</button></form>`;

export function renderCalendar() {
  return uiGet('calmode', 'month') === 'day' ? renderDay() : renderMonth();
}

const modeSeg = () => { const m = uiGet('calmode', 'month'); return `<div class="seg slim" role="group" aria-label="Calendar view"><button class="${m === 'month' ? 'on' : ''}" data-act="cal-mode" data-m="month">Month</button><button class="${m === 'day' ? 'on' : ''}" data-act="cal-mode" data-m="day">Day</button></div>`; };

function renderMonth() {
  const [y, m] = cursor.split('-').map(Number);
  const ws = Number(getCfg().weekStart ?? 1);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() - ws + 7) % 7;
  const days = new Date(y, m, 0).getDate();
  const weeks = Math.ceil((lead + days) / 7);
  const start = addDays(ymd(first), -lead);
  const tasks = S.live('tasks').filter((t) => t.date && S.get('lists', t.listId)?.kind === 'tasks' && !t.parentId);
  const byDate = {};
  tasks.forEach((t) => { (byDate[t.date] ||= []).push(t); });
  const t0 = today();
  let cells = '';
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const list = (byDate[d] || []).sort((a, b) => (a.time || '').localeCompare(b.time || '') || S.byOrder(a, b));
    const open = list.filter((t) => !t.done).length;
    cells += `<button class="cell ${d.slice(0, 7) !== cursor ? 'out' : ''} ${d === t0 ? 'today' : ''} ${d === selected ? 'sel' : ''}" data-act="cal-sel" data-d="${d}" aria-label="${esc(friendlyDate(d))}, ${open} open task${open === 1 ? '' : 's'}">
      <span class="dn">${parseYmd(d).getDate()}</span>
      <span class="pills">${list.slice(0, 3).map((t) => `<span class="pill p${t.priority} ${t.done ? 'done' : ''}">${esc(t.title)}</span>`).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : ''}</span></button>`;
  }
  const dow = Array.from({ length: 7 }, (_, i) => `<span>${DOW_SHORT[(i + ws) % 7]}</span>`).join('');
  const dayTasks = (byDate[selected] || []).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || S.byOrder(a, b));
  return `<div class="page-head"><div><h1>${MONTHS_LONG[m - 1]} <span class="yr">${y}</span></h1></div>
      <div class="head-actions">${modeSeg()}<button class="icon-btn" data-act="cal-prev" aria-label="Previous month">${icons.chevL}</button><button class="icon-btn" data-act="cal-today">Today</button><button class="icon-btn" data-act="cal-next" aria-label="Next month">${icons.chevR}</button></div></div>
    <div class="cal-wrap"><div class="cal"><div class="dow">${dow}</div><div class="grid" style="--rows:${weeks}">${cells}</div></div>
    <div class="day-panel"><h3>${esc(friendlyDate(selected))}<span class="count">${dayTasks.length}</span></h3>${quick(selected)}
      ${dayTasks.map((t) => taskRow(t, { showList: true })).join('') || '<p class="muted pad">Nothing scheduled.</p>'}</div></div>`;
}

const shift = (n) => { const [y, m] = cursor.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); cursor = ymd(d).slice(0, 7); rerender(); };
registerActions({
  'cal-prev': () => shift(-1),
  'cal-next': () => shift(1),
  'cal-today': () => { cursor = today().slice(0, 7); selected = today(); rerender(); },
  'cal-sel': (el) => { selected = el.dataset.d; if (selected.slice(0, 7) !== cursor) cursor = selected.slice(0, 7); rerender(); },
});

// ---------- day view ----------
function layout(items) {
  // greedy column packing for overlapping blocks
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const cols = []; let cluster = [];
  const flush = () => { const n = Math.max(1, ...cluster.map((i) => i.col + 1)); cluster.forEach((i) => { i.n = n; }); cluster = []; cols.length = 0; };
  sorted.forEach((it) => {
    if (cluster.length && it.start >= Math.max(...cluster.map((i) => i.end))) flush();
    let c = cols.findIndex((end) => end <= it.start);
    if (c === -1) { c = cols.length; cols.push(0); }
    cols[c] = it.end; it.col = c; cluster.push(it);
  });
  flush();
  return sorted;
}

function renderDay() {
  const t0 = today();
  const all = S.live('tasks').filter((t) => t.date === selected && S.get('lists', t.listId)?.kind === 'tasks');
  const timed = all.filter((t) => t.time).sort((a, b) => a.time.localeCompare(b.time));
  const untimed = all.filter((t) => !t.time).sort(S.byOrder);
  const items = layout(timed.map((t) => { const start = mins(t.time); return { t, start, end: Math.min(1440, start + Math.max(t.duration || 30, 30)) }; }));
  const first = Math.min(7, ...items.map((i) => Math.floor(i.start / 60)));
  const last = Math.max(21, ...items.map((i) => Math.ceil(i.end / 60) - 1));
  const base = first * 60;
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const d = parseYmd(selected);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const showNow = selected === t0 && nowMin >= base && nowMin <= (last + 1) * 60;
  const fmt = (m) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h >= 12 ? 'p' : 'a'}`; };
  const blocks = items.map((i, idx) => `<button class="tl-task p${i.t.priority} ${i.t.done ? 'done' : ''} ${idx === 0 ? 'tl-first' : ''} ${(i.end - i.start) < 45 ? 'short' : ''}" data-act="task-open" data-id="${i.t.id}"
      style="top:${((i.start - base) / 60) * HOUR}px;height:${Math.max(((i.end - i.start) / 60) * HOUR - 2, 22)}px;left:calc(${(i.col / i.n) * 100}% + 2px);width:calc(${100 / i.n}% - 4px)">
      <b>${esc(i.t.title)}</b><span>${fmt(i.start)}–${fmt(i.end)}</span></button>`).join('');
  return `<div class="page-head"><div><h1>${esc(friendlyDate(selected))}</h1><p class="sub">${esc(MONTHS_LONG[d.getMonth()])} ${d.getDate()}, ${d.getFullYear()} · ${all.filter((t) => !t.done).length} open</p></div>
      <div class="head-actions">${modeSeg()}<button class="icon-btn" data-act="day-prev" aria-label="Previous day">${icons.chevL}</button><button class="icon-btn" data-act="day-today">Today</button><button class="icon-btn" data-act="day-next" aria-label="Next day">${icons.chevR}</button></div></div>
    ${untimed.length ? `<div class="allday"><h3>No time set<span class="count">${untimed.length}</span></h3>${untimed.map((t) => taskRow(t, { showList: true })).join('')}</div>` : ''}
    <div class="timeline" style="--h:${HOUR}px"><div class="tl-hours">${hours.map((h) => `<div class="tl-hour"><span>${fmt(h * 60)}</span></div>`).join('')}</div>
      <div class="tl-grid" style="height:${hours.length * HOUR}px"><div class="tl-bg" data-act="day-slot" data-base="${base}" role="button" aria-label="Add a task at a time"></div>${blocks}
        ${showNow ? `<div class="tl-now ${items.length ? '' : 'tl-first'}" style="top:${((nowMin - base) / 60) * HOUR}px"></div>` : ''}</div></div>
    ${timed.length || untimed.length ? '' : '<p class="muted pad">Nothing scheduled. Tap a time slot to add something.</p>'}`;
}

registerActions({
  'cal-mode': (el) => { uiSet('calmode', el.dataset.m); if (el.dataset.m === 'month') cursor = selected.slice(0, 7); needScroll = true; rerender(); scrollTimeline(); },
  'day-prev': () => { selected = addDays(selected, -1); needScroll = true; rerender(); scrollTimeline(); },
  'day-next': () => { selected = addDays(selected, 1); needScroll = true; rerender(); scrollTimeline(); },
  'day-today': () => { selected = today(); needScroll = true; rerender(); scrollTimeline(); },
  'day-slot': (el, ev) => {
    const y = ev.clientY - el.getBoundingClientRect().top;
    const m = Math.min(1410, Math.floor(((y / HOUR) * 60 + Number(el.dataset.base)) / 30) * 30);
    const time = hhmm(m);
    openSheet(() => `<div class="sheet-head"><h2>New task · ${esc(friendlyDate(selected))}, ${esc(fmtT(time))}</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
      <form class="quick" data-quick="slot:${selected}:${time.slice(0, 2)}:${time.slice(3)}" autocomplete="off"><input type="text" name="q" placeholder="Task title  (#tag  !high)" enterkeyhint="done" aria-label="Task title"><button type="submit" aria-label="Add">${icons.plus}</button></form>`);
    setTimeout(() => document.querySelector('#sheet .quick input')?.focus(), 250);
  },
});
const fmtT = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
function scrollTimeline() {
  if (!needScroll) return;
  needScroll = false;
  setTimeout(() => {
    const el = document.querySelector('.tl-first');
    if (el) el.scrollIntoView({ block: 'center' });
  }, 30);
}
export const calendarMounted = () => { if (uiGet('calmode', 'month') === 'day') scrollTimeline(); };
