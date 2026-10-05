// Habit tracker: daily list, per-habit detail with history, editor.
import { esc, uid, today, addDays, ymd, parseYmd, friendlyDate, fmtTime, MONTHS_LONG, DOW_SHORT } from './util.js';
import * as S from './store.js';
import { icons, registerActions, registerFields, openSheet, refreshSheet, closeSheet, swatch, COLORS, armed, rerender, uiGet, uiSet, toast } from './ui.js';
import { getCfg } from './sync.js';

let day = today();       // date being tracked on the main screen
let detailId = null;     // habit open in sheet
let detailMonth = today().slice(0, 7);
let detailDay = today();
let editing = null;      // draft for editor

const hcolor = (h) => h.color || '#2F6F4F';
const unitLabel = (h) => (h.unit && h.unit !== 'Count' ? ` ${esc(h.unit)}` : '');

function control(h, d) {
  if (h.type === 'check') {
    const done = S.isDone(h, d);
    return `<button class="hbtn ${done ? 'on' : ''}" style="--c:${hcolor(h)}" data-act="habit-toggle" data-id="${h.id}" data-d="${d}" aria-label="${done ? 'Undo' : 'Complete'} ${esc(h.name)}" aria-pressed="${done}">${done ? icons.check : ''}</button>`;
  }
  const v = S.logValue(h, d); const pct = Math.min(100, Math.round((v / h.goal) * 100));
  if (h.entry !== 'steps') {
    const has = !!S.getLog(h.id, d);
    return `<label class="total ${S.isDone(h, d) ? 'ok' : ''}" style="--c:${hcolor(h)}"><span class="tin"><input type="number" inputmode="decimal" min="0" step="any" data-field="habit:total" data-id="${h.id}" data-d="${d}" value="${has ? v : ''}" placeholder="0" aria-label="${esc(h.name)} total for the day"><em>/ ${h.goal}${unitLabel(h)}</em></span><i style="width:${pct}%"></i></label>`;
  }
  return `<div class="stepper" style="--c:${hcolor(h)}"><button data-act="habit-step" data-dir="-1" data-id="${h.id}" data-d="${d}" aria-label="Less">${icons.minus}</button>
    <span class="sv ${S.isDone(h, d) ? 'ok' : ''}"><b>${v}</b>/${h.goal}${unitLabel(h)}<i style="width:${pct}%"></i></span>
    <button data-act="habit-step" data-dir="1" data-id="${h.id}" data-d="${d}" aria-label="More">${icons.plus}</button></div>`;
}

function card(h, d) {
  const st = S.habitStats(h);
  const sched = (h.schedule?.freq === 'weekly') ? (h.schedule.days || []).map((x) => DOW_SHORT[x]).join(' ') : 'Daily';
  return `<div class="habit" style="--c:${hcolor(h)}">
    <button class="hmain" data-act="habit-open" data-id="${h.id}">
      <span class="hdot">${icons.flame}</span>
      <span class="htext"><b>${esc(h.name)}</b><span class="hsub">${st.streak ? `<em>${st.streak}-day streak</em> · ` : ''}${esc(sched)}${h.type === 'amount' ? ` · goal ${h.goal}${unitLabel(h)}` : ''}</span></span></button>
    ${control(h, d)}</div>`;
}

export function renderHabits() {
  const all = S.live('habits').sort(S.byOrder);
  const active = all.filter((h) => !h.archived);
  const due = active.filter((h) => S.isDue(h, day));
  const other = active.filter((h) => !S.isDue(h, day));
  const done = due.filter((h) => S.isDone(h, day)).length;
  const archived = all.filter((h) => h.archived);
  const isToday = day === today();
  return `<div class="page-head"><div><h1>Habits</h1><p class="sub">${due.length ? `${done} of ${due.length} done` : 'Nothing scheduled'}</p></div>
      <div class="head-actions"><button class="icon-btn" data-act="habit-new">${icons.plus} New</button></div></div>
    <div class="daynav"><button class="icon-btn" data-act="habit-day" data-n="-1" aria-label="Previous day">${icons.chevL}</button><button class="daylabel" data-act="habit-day" data-n="0">${esc(friendlyDate(day))}${isToday ? '' : ' · back to today'}</button><button class="icon-btn" data-act="habit-day" data-n="1" aria-label="Next day" ${day >= today() ? 'disabled' : ''}>${icons.chevR}</button></div>
    ${due.map((h) => card(h, day)).join('') || '<div class="empty">' + icons.habit + '<p>No habits due this day.</p></div>'}
    ${other.length ? `<h3 class="sechead">Not scheduled</h3>${other.map((h) => `<div class="dim">${card(h, day)}</div>`).join('')}` : ''}
    ${archived.length ? `<details class="group"><summary>Archived<span class="count">${archived.length}</span></summary>${archived.map((h) => card(h, day)).join('')}</details>` : ''}`;
}

registerFields({
  'habit:total': (el) => {
    const h = S.get('habits', el.dataset.id); if (!h) return;
    const raw = el.value.trim();
    if (raw === '') { S.clearLog(h, el.dataset.d); }
    else { const n = Number(raw); if (Number.isFinite(n) && n >= 0) S.setLog(h, el.dataset.d, n); }
    afterChange();
  },
});
registerActions({
  'habit-toggle': (el) => { S.toggleHabit(S.get('habits', el.dataset.id), el.dataset.d); afterChange(); },
  'habit-step': (el) => { S.stepHabit(S.get('habits', el.dataset.id), el.dataset.d, Number(el.dataset.dir)); afterChange(); },
  'habit-day': (el) => { const n = Number(el.dataset.n); day = n === 0 ? today() : addDays(day, n); if (day > today()) day = today(); rerender(); },
});
function afterChange() { if (detailId) refreshSheet(); }

// ---------- detail ----------
export function openHabit(id) {
  detailId = id; detailMonth = today().slice(0, 7); detailDay = today();
  openSheet(detailHtml);
}
function detailHtml() {
  const h = S.get('habits', detailId); if (!h) return '';
  const st = S.habitStats(h);
  const [y, m] = detailMonth.split('-').map(Number);
  const ws = Number(getCfg().weekStart ?? 1);
  const first = new Date(y, m - 1, 1); const lead = (first.getDay() - ws + 7) % 7;
  const days = new Date(y, m, 0).getDate(); const t0 = today();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="hc blank"></span>';
  for (let n = 1; n <= days; n++) {
    const d = `${detailMonth}-${String(n).padStart(2, '0')}`;
    const done = S.isDone(h, d); const part = !done && S.logValue(h, d) > 0; const due = S.isDue(h, d);
    cells += `<button class="hc ${done ? 'done' : part ? 'part' : ''} ${!due && !done ? 'off' : ''} ${d > t0 ? 'future' : ''} ${d === detailDay ? 'sel' : ''}" data-act="habit-pick" data-d="${d}" ${d > t0 ? 'disabled' : ''} aria-label="${esc(friendlyDate(d))}${done ? ', done' : ''}">${n}</button>`;
  }
  const dow = Array.from({ length: 7 }, (_, i) => `<span>${DOW_SHORT[(i + ws) % 7][0]}</span>`).join('');
  return `<div class="sheet-head" style="--c:${hcolor(h)}"><span class="hdot big">${icons.flame}</span><h2>${esc(h.name)}</h2>
      <button class="icon-btn" data-act="habit-edit" data-id="${h.id}" aria-label="Edit habit">Edit</button><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
    <div class="stats"><div><b>${st.streak}</b><span>Current streak</span></div><div><b>${st.best}</b><span>Best streak</span></div><div><b>${st.total}</b><span>Total days</span></div><div><b>${st.rate}%</b><span>Last 30 days</span></div></div>
    <div class="monthnav"><button class="icon-btn" data-act="habit-month" data-n="-1" aria-label="Previous month">${icons.chevL}</button><b>${MONTHS_LONG[m - 1]} ${y}</b><button class="icon-btn" data-act="habit-month" data-n="1" aria-label="Next month" ${detailMonth >= t0.slice(0, 7) ? 'disabled' : ''}>${icons.chevR}</button></div>
    <div class="hgrid" style="--c:${hcolor(h)}"><div class="dow">${dow}</div><div class="cells">${cells}</div></div>
    <div class="pickrow" style="--c:${hcolor(h)}"><span>${esc(friendlyDate(detailDay))}</span>${control(h, detailDay)}</div>`;
}
registerActions({
  'habit-open': (el) => openHabit(el.dataset.id),
  'habit-pick': (el) => { detailDay = el.dataset.d; refreshSheet(); },
  'habit-month': (el) => { const [y, m] = detailMonth.split('-').map(Number); detailMonth = ymd(new Date(y, m - 1 + Number(el.dataset.n), 1)).slice(0, 7); refreshSheet(); },
});

// ---------- editor ----------
const blank = () => ({ id: uid(), name: '', color: COLORS[0], type: 'check', entry: 'total', goal: 1, step: 1, unit: '', schedule: { freq: 'daily', interval: 1 }, reminders: [], startDate: today(), archived: false, sortOrder: Date.now(), isNew: true });
export function openHabitEditor(id) {
  editing = id ? JSON.parse(JSON.stringify(S.get('habits', id))) : blank();
  openSheet(editorHtml);
}
function editorHtml() {
  const e = editing; const days = e.schedule?.days || [];
  return `<div class="sheet-head"><h2>${e.isNew ? 'New habit' : 'Edit habit'}</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
    <div class="row"><label>Name</label><input data-field="hb:name" value="${esc(e.name)}" placeholder="e.g. Read a book" aria-label="Habit name"></div>
    <div class="row"><label>Type</label><div class="seg"><button class="${e.type === 'check' ? 'on' : ''}" data-act="hb-type" data-t="check">Done / not done</button><button class="${e.type === 'amount' ? 'on' : ''}" data-act="hb-type" data-t="amount">Amount</button></div></div>
    ${e.type === 'amount' ? `<div class="row"><label>Logging</label><div class="seg"><button class="${e.entry !== 'steps' ? 'on' : ''}" data-act="hb-entry" data-e="total">Type the day's total</button><button class="${e.entry === 'steps' ? 'on' : ''}" data-act="hb-entry" data-e="steps">Tap + / −</button></div></div>
    <div class="row three"><div><label>Daily goal</label><input type="number" min="1" inputmode="decimal" data-field="hb:goal" value="${e.goal}" aria-label="Daily goal"></div>${e.entry === 'steps' ? `<div><label>Step</label><input type="number" min="0.01" inputmode="decimal" data-field="hb:step" value="${e.step}" aria-label="Step per tap"></div>` : '<div></div>'}<div><label>Unit</label><input data-field="hb:unit" value="${esc(e.unit)}" placeholder="mg, min…" aria-label="Unit"></div></div>` : ''}
    <div class="row"><label>Repeat</label><div class="seg"><button class="${e.schedule.freq === 'daily' ? 'on' : ''}" data-act="hb-freq" data-f="daily">Every day</button><button class="${e.schedule.freq === 'weekly' ? 'on' : ''}" data-act="hb-freq" data-f="weekly">Chosen days</button></div></div>
    ${e.schedule.freq === 'weekly' ? `<div class="daychips">${[1, 2, 3, 4, 5, 6, 0].map((n) => `<button class="${days.includes(n) ? 'on' : ''}" data-act="hb-day" data-n="${n}" aria-pressed="${days.includes(n)}">${DOW_SHORT[n]}</button>`).join('')}</div>` : ''}
    <div class="row"><label>Reminders</label><div class="subs">${e.reminders.map((r, i) => `<div class="sub"><input type="time" data-field="hb:rem" data-i="${i}" value="${r}" aria-label="Reminder time"><button class="icon-btn sm" data-act="hb-delrem" data-i="${i}" aria-label="Remove reminder">${icons.x}</button></div>`).join('')}<button class="btn ghost small" data-act="hb-addrem">${icons.plus} Add reminder time</button></div></div>
    <div class="row"><label>Colour</label><div class="swatches">${swatch(COLORS, e.color, 'hb-color')}</div></div>
    <div class="sheet-foot">${e.isNew ? '<span></span>' : `<span class="foot-actions"><button class="btn ghost small" data-act="hb-archive">${e.archived ? 'Unarchive' : 'Archive'}</button><button class="btn danger ghost small" data-act="hb-del">${icons.trash} Delete</button></span>`}<button class="btn" data-act="hb-save">Save</button></div>`;
}
registerFields({
  'hb:name': (el) => { editing.name = el.value; },
  'hb:goal': (el) => { editing.goal = Math.max(1, Number(el.value) || 1); },
  'hb:step': (el) => { editing.step = Math.max(0.01, Number(el.value) || 1); },
  'hb:unit': (el) => { editing.unit = el.value.trim(); },
  'hb:rem': (el) => { editing.reminders[Number(el.dataset.i)] = el.value; },
});
registerActions({
  'habit-new': () => openHabitEditor(null),
  'habit-edit': (el) => openHabitEditor(el.dataset.id),
  'hb-entry': (el) => { editing.entry = el.dataset.e; refreshSheet(); },
  'hb-type': (el) => { editing.type = el.dataset.t; if (editing.type === 'check') { editing.goal = 1; editing.step = 1; editing.unit = ''; } else if (editing.goal < 2) { editing.goal = 10; } refreshSheet(); },
  'hb-freq': (el) => { editing.schedule = el.dataset.f === 'daily' ? { freq: 'daily', interval: 1 } : { freq: 'weekly', days: editing.schedule.days?.length ? editing.schedule.days : [1, 2, 3, 4, 5] }; refreshSheet(); },
  'hb-day': (el) => { const n = Number(el.dataset.n); const d = editing.schedule.days || []; editing.schedule.days = d.includes(n) ? d.filter((x) => x !== n) : [...d, n]; refreshSheet(); },
  'hb-addrem': () => { editing.reminders.push('09:00'); refreshSheet(); },
  'hb-delrem': (el) => { editing.reminders.splice(Number(el.dataset.i), 1); refreshSheet(); },
  'hb-color': (el) => { editing.color = el.dataset.color; refreshSheet(); },
  'hb-save': () => {
    const nameEl = document.querySelector('[data-field="hb:name"]'); if (nameEl) editing.name = nameEl.value;
    if (!editing.name.trim()) { toast('Give the habit a name'); return; }
    if (editing.schedule.freq === 'weekly' && !(editing.schedule.days || []).length) { toast('Pick at least one day'); return; }
    const { isNew, ...rec } = editing; rec.name = rec.name.trim();
    rec.createdAt = rec.createdAt || new Date().toISOString();
    S.put('habits', rec); closeSheet(); rerender();
  },
  'hb-archive': () => { S.patch('habits', editing.id, { archived: !editing.archived }); closeSheet(); rerender(); },
  'hb-del': (el) => { if (!armed(el, 'Tap again to delete')) return; S.remove('habits', editing.id); closeSheet(); toast('Habit deleted'); rerender(); },
});
