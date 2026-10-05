// Month calendar with a day panel.
import { esc, today, addDays, ymd, parseYmd, friendlyDate, MONTHS_LONG, DOW_SHORT } from './util.js';
import * as S from './store.js';
import { icons, registerActions, rerender } from './ui.js';
import { taskRow } from './tasks.js';
import { getCfg } from './sync.js';

let cursor = today().slice(0, 7); // YYYY-MM
let selected = today();

const quick = (d) => `<form class="quick" data-quick="day:${d}" autocomplete="off"><input type="text" name="q" placeholder="Add a task on ${esc(friendlyDate(d))}…" enterkeyhint="done" aria-label="Add task"><button type="submit" aria-label="Add">${icons.plus}</button></form>`;

export function renderCalendar() {
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
      <div class="head-actions"><button class="icon-btn" data-act="cal-prev" aria-label="Previous month">${icons.chevL}</button><button class="icon-btn" data-act="cal-today">Today</button><button class="icon-btn" data-act="cal-next" aria-label="Next month">${icons.chevR}</button></div></div>
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
