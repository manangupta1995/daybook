// Month calendar with a day panel.
import { esc, today, addDays, ymd, parseYmd, friendlyDate, weekday, MONTHS_LONG, DOW_SHORT } from './util.js';
import * as S from './store.js';
import { icons, registerActions, rerender, uiGet, uiSet, openSheet, closeSheet, focusField } from './ui.js';
import { taskRow } from './tasks.js';
import { getCfg } from './sync.js';
import './caldrag.js';

let cursor = today().slice(0, 7); // YYYY-MM
let selected = today();
let needScroll = true;
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const quick = (d) => `<form class="quick" data-quick="day:${d}" autocomplete="off"><input type="text" name="q" placeholder="Add a task on ${esc(friendlyDate(d))}…" enterkeyhint="done" aria-label="Add task"><button type="submit" aria-label="Add">${icons.plus}</button></form>`;

export function renderCalendar() {
  const m = uiGet('calmode', 'month');
  return m === 'day' ? renderTimeline([selected]) : m === 'week' ? renderTimeline(weekDates()) : renderMonth();
}

const modeSeg = () => { const m = uiGet('calmode', 'month'); const b = (k, l) => `<button class="${m === k ? 'on' : ''}" data-act="cal-mode" data-m="${k}">${l}</button>`; return `<div class="seg slim" role="group" aria-label="Calendar view">${b('month', 'Month')}${b('week', 'Week')}${b('day', 'Day')}</div>`; };
function weekDates() { const ws = Number(getCfg().weekStart ?? 1); const lead = (weekday(selected) - ws + 7) % 7; const start = addDays(selected, -lead); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }

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
      <span class="pills">${list.slice(0, 3).map((t) => `<span class="pill p${t.priority} ${t.done ? 'done' : ''}" data-cal-src data-id="${t.id}">${esc(t.title)}</span>`).join('')}${list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : ''}</span></button>`;
  }
  const dow = Array.from({ length: 7 }, (_, i) => `<span>${DOW_SHORT[(i + ws) % 7]}</span>`).join('');
  const dayTasks = (byDate[selected] || []).sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || S.byOrder(a, b));
  return `<div class="page-head"><div><h1>${MONTHS_LONG[m - 1]} <span class="yr">${y}</span></h1></div>
      <div class="head-actions">${modeSeg()}<button class="icon-btn" data-act="cal-prev" aria-label="Previous month">${icons.chevL}</button><button class="icon-btn" data-act="cal-today">Today</button><button class="icon-btn" data-act="cal-next" aria-label="Next month">${icons.chevR}</button></div></div>
    <div class="cal-wrap"><div class="cal"><div class="dow">${dow}</div><div class="grid" style="--rows:${weeks}">${cells}</div></div>
    <div class="day-panel"><h3>${esc(friendlyDate(selected))}<span class="count">${dayTasks.length}</span></h3>${quick(selected)}
      ${dayTasks.map((t) => taskRow(t, { showList: true, calDrag: true })).join('') || '<p class="muted pad">Nothing scheduled.</p>'}</div></div>`;
}

const shift = (n) => { const [y, m] = cursor.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); cursor = ymd(d).slice(0, 7); rerender(); };
registerActions({
  'cal-prev': () => shift(-1),
  'cal-next': () => shift(1),
  'cal-today': () => { cursor = today().slice(0, 7); selected = today(); rerender(); },
  'cal-sel': (el) => { selected = el.dataset.d; if (selected.slice(0, 7) !== cursor) cursor = selected.slice(0, 7); rerender(); },
});

// ---------- day + week timeline ----------
export const HOUR = 56; // px per hour
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
const fmtShort = (m) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h >= 12 ? 'p' : 'a'}`; };

function renderTimeline(dates) {
  const week = dates.length > 1;
  const t0 = today();
  const tasksOn = (d) => S.live('tasks').filter((t) => t.date === d && S.get('lists', t.listId)?.kind === 'tasks' && !t.parentId);
  const perDay = dates.map((d) => {
    const all = tasksOn(d);
    const timed = all.filter((t) => t.time).sort((a, b) => a.time.localeCompare(b.time));
    return { d, all, timed, untimed: all.filter((t) => !t.time).sort(S.byOrder), items: layout(timed.map((t) => { const start = mins(t.time); return { t, start, end: Math.min(1440, start + Math.max(t.duration || 30, 15)) }; })) };
  });
  const everyItem = perDay.flatMap((p) => p.items);
  const first = Math.min(7, ...everyItem.map((i) => Math.floor(i.start / 60)));
  const last = Math.max(22, ...everyItem.map((i) => Math.ceil(i.end / 60) - 1));
  const base = first * 60;
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const firstId = everyItem.slice().sort((a, b) => a.start - b.start)[0]?.t.id;
  const cols = perDay.map((p) => {
    const blocks = p.items.map((i) => `<button class="tl-task p${i.t.priority} ${i.t.done ? 'done' : ''} ${i.t.id === firstId ? 'tl-first' : ''} ${(i.end - i.start) < 45 ? 'short' : ''}" data-act="task-open" data-id="${i.t.id}" data-cal-src
      style="top:${((i.start - base) / 60) * HOUR}px;height:${Math.max(((i.end - i.start) / 60) * HOUR - 2, 22)}px;left:calc(${(i.col / i.n) * 100}% + 2px);width:calc(${100 / i.n}% - 4px)">
      <b>${esc(i.t.title)}</b><span>${week ? fmtShort(i.start) : `${fmtShort(i.start)}–${fmtShort(i.end)}`}</span><i class="tl-resize" data-cal-resize data-id="${i.t.id}" aria-hidden="true"></i></button>`).join('');
    const showNow = p.d === t0 && nowMin >= base && nowMin <= (last + 1) * 60;
    return `<div class="tl-col tl-grid ${p.d === t0 ? 'is-today' : ''}" data-date="${p.d}" style="height:${hours.length * HOUR}px"><div class="tl-bg" data-act="day-slot" data-date="${p.d}" role="button" aria-label="Add a task at a time on ${esc(friendlyDate(p.d))}"></div>${blocks}
      ${showNow ? `<div class="tl-now ${firstId ? '' : 'tl-first'}" style="top:${((nowMin - base) / 60) * HOUR}px"></div>` : ''}</div>`;
  }).join('');
  const grid = `<div class="timeline ${week ? 'wk' : ''}" style="--h:${HOUR}px;--n:${dates.length}" data-base="${base}" data-hour="${HOUR}"><div class="tl-hours">${hours.map((h) => `<div class="tl-hour"><span>${fmtShort(h * 60)}</span></div>`).join('')}</div>${cols}</div>`;

  let title, sub, nav;
  if (week) {
    const a = parseYmd(dates[0]), b = parseYmd(dates[6]);
    title = a.getMonth() === b.getMonth() ? `${MONTHS_LONG[a.getMonth()]} ${a.getDate()}–${b.getDate()}` : `${MONTHS_LONG[a.getMonth()].slice(0, 3)} ${a.getDate()} – ${MONTHS_LONG[b.getMonth()].slice(0, 3)} ${b.getDate()}`;
    sub = `${b.getFullYear()} · ${perDay.reduce((n, p) => n + p.all.filter((t) => !t.done).length, 0)} open`;
    nav = ['wk-prev', 'wk-today', 'wk-next'];
  } else {
    const d = parseYmd(selected);
    title = friendlyDate(selected); sub = `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${perDay[0].all.filter((t) => !t.done).length} open`;
    nav = ['day-prev', 'day-today', 'day-next'];
  }
  const head = `<div class="page-head"><div><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p></div>
      <div class="head-actions">${modeSeg()}<button class="icon-btn" data-act="${nav[0]}" aria-label="Previous ${week ? 'week' : 'day'}">${icons.chevL}</button><button class="icon-btn" data-act="${nav[1]}">Today</button><button class="icon-btn" data-act="${nav[2]}" aria-label="Next ${week ? 'week' : 'day'}">${icons.chevR}</button></div></div>`;

  let top;
  if (week) {
    top = `<div class="wk-top" style="--n:7"><div class="wk-gutter"></div>${perDay.map((p) => `<div class="wk-cell"><button class="wk-day ${p.d === t0 ? 'today' : ''}" data-act="wk-open" data-d="${p.d}" aria-label="Open ${esc(friendlyDate(p.d))}"><span>${DOW_SHORT[weekday(p.d)]}</span><b>${parseYmd(p.d).getDate()}</b></button>
        <div class="ad-cell" data-ad-date="${p.d}">${p.untimed.map((t) => `<button class="ad-chip p${t.priority} ${t.done ? 'done' : ''}" data-act="task-open" data-id="${t.id}" data-cal-src>${esc(t.title)}</button>`).join('')}</div></div>`).join('')}</div>`;
  } else {
    const u = perDay[0].untimed;
    top = `<div class="allday ${u.length ? '' : 'zone-empty'}" data-ad-date="${selected}"><h3>No time set<span class="count">${u.length}</span></h3>${u.map((t) => taskRow(t, { showList: true, calDrag: true })).join('')}</div>`;
  }
  const empty = perDay.every((p) => !p.all.length) ? '<p class="muted pad">Nothing scheduled. Tap a time slot to add something.</p>' : '';
  return `${head}${top}${grid}${empty}`;
}

registerActions({
  'cal-mode': (el) => { uiSet('calmode', el.dataset.m); if (el.dataset.m === 'month') cursor = selected.slice(0, 7); needScroll = true; rerender(); scrollTimeline(); },
  'day-prev': () => { selected = addDays(selected, -1); needScroll = true; rerender(); scrollTimeline(); },
  'day-next': () => { selected = addDays(selected, 1); needScroll = true; rerender(); scrollTimeline(); },
  'day-today': () => { selected = today(); needScroll = true; rerender(); scrollTimeline(); },
  'wk-prev': () => { selected = addDays(selected, -7); needScroll = true; rerender(); scrollTimeline(); },
  'wk-next': () => { selected = addDays(selected, 7); needScroll = true; rerender(); scrollTimeline(); },
  'wk-today': () => { selected = today(); needScroll = true; rerender(); scrollTimeline(); },
  'wk-open': (el) => { selected = el.dataset.d; uiSet('calmode', 'day'); needScroll = true; rerender(); scrollTimeline(); },
  'day-slot': (el, ev) => {
    const date = el.dataset.date || selected;
    const base = Number(el.closest('.timeline').dataset.base);
    const y = ev.clientY - el.getBoundingClientRect().top;
    const m = Math.min(1410, Math.floor(((y / HOUR) * 60 + base) / 30) * 30);
    const time = hhmm(m);
    openSheet(() => `<div class="sheet-head"><h2>New task · ${esc(friendlyDate(date))}, ${esc(fmtT(time))}</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
      <form class="quick" data-quick="slot:${date}:${time.slice(0, 2)}:${time.slice(3)}" autocomplete="off"><input type="text" name="q" placeholder="Task title  (#tag  !high)" enterkeyhint="done" aria-label="Task title"><button type="submit" aria-label="Add">${icons.plus}</button></form>`);
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
export const calendarMounted = () => { if (uiGet('calmode', 'month') !== 'month') scrollTimeline(); };
