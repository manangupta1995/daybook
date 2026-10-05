// Task views: Today, list, tag; task sheet; list/folder management.
import { esc, uid, today, addDays, diffDays, friendlyDate, fmtTime, weekday } from './util.js';
import * as S from './store.js';
import { icons, registerActions, registerFields, openSheet, refreshSheet, closeSheet, swatch, COLORS, armed, rerender, focusField, uiGet, uiSet, toast } from './ui.js';

const PRIO = ['None', 'Low', 'Medium', 'High'];
const DAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseQuick(text) {
  let title = text, priority = 0, date = null; const tags = [];
  title = title.replace(/(^|\s)#([\w-]+)/g, (m, s, t) => { tags.push(t.toLowerCase()); return s; });
  title = title.replace(/(^|\s)!(1|2|3|l|m|h|low|med|medium|high)(?=\s|$)/gi, (m, s, p) => {
    const k = p.toLowerCase(); priority = { 1: 1, l: 1, low: 1, 2: 2, m: 2, med: 2, medium: 2, 3: 3, h: 3, high: 3 }[k]; return s;
  });
  title = title.replace(/\s+(today|tomorrow|tmrw)\s*$/i, (m, w) => { date = w.toLowerCase() === 'today' ? today() : addDays(today(), 1); return ''; });
  title = title.replace(/\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*$/i, (m, w) => {
    const target = DAYS[w.toLowerCase().slice(0, 3)]; let diff = (target - weekday(today()) + 7) % 7; if (diff === 0) diff = 7;
    date = addDays(today(), diff); return '';
  });
  title = title.replace(/\s+/g, ' ').trim();
  return { title: title || text.trim(), priority, date, tags };
}

// ---------- rows ----------
function dueChip(t) {
  if (!t.date) return '';
  const diff = diffDays(t.date, today());
  const cls = !t.done && diff < 0 ? 'over' : diff === 0 ? 'now' : '';
  return `<span class="chip ${cls}">${icons.calendar}${esc(friendlyDate(t.date))}${t.time ? ' · ' + fmtTime(t.time) : ''}</span>`;
}

export function taskRow(t, { showList = false, indent = false } = {}) {
  const kids = S.live('tasks').filter((k) => k.parentId === t.id);
  const doneKids = kids.filter((k) => k.done).length;
  const list = showList ? S.get('lists', t.listId) : null;
  return `<div class="task p${t.priority} ${t.done ? 'done' : ''} ${indent ? 'indent' : ''}" data-id="${t.id}">
    <button class="chk" data-act="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${t.done ? icons.check : ''}</button>
    <div class="tbody" data-act="task-open" data-id="${t.id}">
      <div class="ttitle">${esc(t.title) || '<i>Untitled</i>'}</div>
      <div class="tmeta">${dueChip(t)}${list ? `<span class="chip plain">${esc(list.name)}</span>` : ''}${(t.tags || []).map((g) => `<span class="chip tag">#${esc(g)}</span>`).join('')}${kids.length ? `<span class="chip plain">${icons.sub}${doneKids}/${kids.length}</span>` : ''}${t.notes ? `<span class="chip plain">${icons.note}</span>` : ''}</div>
    </div>
  </div>`;
}

function sortTasks(arr, mode) {
  const a = [...arr];
  if (mode === 'date') a.sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') || (x.time || '').localeCompare(y.time || '') || S.byOrder(x, y));
  else if (mode === 'priority') a.sort((x, y) => y.priority - x.priority || S.byOrder(x, y));
  else a.sort(S.byOrder);
  return a;
}

const quickAdd = (ctx, ph = 'Add a task…  (#tag  !high  tomorrow)') => `<form class="quick" data-quick="${esc(ctx)}" autocomplete="off"><input type="text" name="q" placeholder="${ph}" enterkeyhint="done" aria-label="Add task"><button type="submit" aria-label="Add">${icons.plus}</button></form>`;

export const taskLists = () => S.live('lists').filter((l) => l.kind === 'tasks');

// ---------- Today ----------
export function renderToday() {
  const t0 = today();
  const open = S.live('tasks').filter((t) => !t.done && S.get('lists', t.listId)?.kind === 'tasks');
  const overdue = sortTasks(open.filter((t) => t.date && t.date < t0), 'date');
  const todays = sortTasks(open.filter((t) => t.date === t0), 'date');
  const soon = sortTasks(open.filter((t) => t.date > t0 && t.date <= addDays(t0, 7)), 'date');
  const doneToday = S.live('tasks').filter((t) => t.done && t.doneAt && new Date(t.doneAt).toDateString() === new Date().toDateString());
  const hab = S.live('habits').filter((h) => !h.archived && S.isDue(h, t0));
  const habDone = hab.filter((h) => S.isDone(h, t0)).length;
  const sec = (title, arr, cls = '') => (arr.length ? `<section class="group ${cls}"><h3>${title}<span class="count">${arr.length}</span></h3>${arr.map((t) => taskRow(t, { showList: true })).join('')}</section>` : '');
  const empty = !overdue.length && !todays.length && !soon.length;
  return `<div class="page-head"><div><h1>Today</h1><p class="sub">${friendlyDate(t0)}</p></div></div>
    ${quickAdd('today', 'Add to today…  (#tag  !high)')}
    ${hab.length ? `<a class="habit-strip" href="#/habits"><span>${icons.flame}</span><span class="hs-text"><b>${habDone} of ${hab.length}</b> habits done today</span><span class="hs-bar"><i style="width:${Math.round((habDone / hab.length) * 100)}%"></i></span>${icons.chevR}</a>` : ''}
    ${sec('Overdue', overdue, 'over')}${sec('Today', todays)}${sec('Next 7 days', soon)}
    ${empty ? `<div class="empty">${icons.today}<p>Nothing due. Add a task above, or open a list.</p></div>` : ''}
    ${doneToday.length ? `<details class="group done-group"><summary>Done today<span class="count">${doneToday.length}</span></summary>${doneToday.map((t) => taskRow(t, { showList: true })).join('')}</details>` : ''}`;
}

// ---------- List ----------
export function renderList(id) {
  const list = S.get('lists', id);
  if (!list) return `<div class="empty"><p>That list no longer exists.</p><a class="btn" href="#/today">Go to Today</a></div>`;
  const all = S.live('tasks').filter((t) => t.listId === id);
  const tops = all.filter((t) => !t.parentId || !all.find((p) => p.id === t.parentId && !p.deleted));
  const mode = uiGet('sort:' + id, 'manual');
  const showDone = uiGet('showdone:' + id, false);
  const head = `<div class="page-head"><div><h1>${esc(list.name)}</h1><p class="sub">${all.filter((t) => !t.done && !t.parentId).length} open</p></div>
    <div class="head-actions"><button class="icon-btn" data-act="list-sort" data-id="${id}" title="Sort: ${mode}" aria-label="Change sort order">${mode === 'manual' ? 'Manual' : mode === 'date' ? 'By date' : 'By priority'}</button>
    <button class="icon-btn" data-act="list-settings" data-id="${id}" aria-label="List settings">${icons.dots}</button></div></div>`;

  if (list.kind === 'notes') {
    const notes = sortTasks(all, 'manual');
    return `${head}${quickAdd('list:' + id, 'New note title…')}
      <div class="notes">${notes.map((n) => `<button class="note-card" data-act="task-open" data-id="${n.id}"><b>${esc(n.title) || 'Untitled'}</b><span>${esc((n.notes || '').slice(0, 140))}</span></button>`).join('') || '<div class="empty"><p>No notes yet.</p></div>'}</div>`;
  }

  const sections = S.live('sections').filter((s) => s.listId === id).sort(S.byOrder);
  const render = (arr) => sortTasks(arr.filter((t) => !t.done), mode).map((t) => {
    const kids = sortTasks(all.filter((k) => k.parentId === t.id && !k.done), mode);
    const doneKids = showDone ? sortTasks(all.filter((k) => k.parentId === t.id && k.done), 'manual') : [];
    return taskRow(t) + [...kids, ...doneKids].map((k) => taskRow(k, { indent: true })).join('');
  }).join('');
  const noSec = tops.filter((t) => !t.sectionId || !sections.find((s) => s.id === t.sectionId));
  let body = '';
  const loose = render(noSec);
  if (loose) body += `<section class="group">${sections.length ? '<h3>No section</h3>' : ''}${loose}</section>`;
  sections.forEach((s) => {
    const arr = tops.filter((t) => t.sectionId === s.id);
    body += `<section class="group"><h3>${esc(s.name)}<span class="count">${arr.filter((t) => !t.done).length}</span><button class="mini" data-act="section-add" data-id="${s.id}" aria-label="Add task to ${esc(s.name)}">${icons.plus}</button></h3>
      ${uiGet('addsec', null) === s.id ? quickAdd('section:' + s.id + ':' + id, `Add to ${s.name}…`) : ''}${render(arr)}</section>`;
  });
  const doneAll = tops.filter((t) => t.done);
  const nDone = all.filter((t) => t.done).length;
  if (!body && !nDone) body = `<div class="empty">${icons.list}<p>This list is empty.</p></div>`;
  const doneBlock = nDone ? `<details class="group done-group" ${showDone ? 'open' : ''} data-done="${id}"><summary>Completed<span class="count">${nDone}</span></summary>${sortTasks(doneAll, 'manual').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).map((t) => taskRow(t)).join('')}</details>` : '';
  return `${head}${quickAdd('list:' + id)}${body}${doneBlock}`;
}

export function renderTag(tag) {
  const tasks = sortTasks(S.live('tasks').filter((t) => !t.done && (t.tags || []).includes(tag)), 'date');
  return `<div class="page-head"><div><h1>#${esc(tag)}</h1><p class="sub">${tasks.length} open</p></div></div>${tasks.map((t) => taskRow(t, { showList: true })).join('') || '<div class="empty"><p>No open tasks with this tag.</p></div>'}`;
}

// ---------- Task sheet ----------
let openId = null;
export const currentTaskId = () => openId;

export function openTask(id) {
  openId = id;
  openSheet(() => taskSheetHtml(openId));
}

function taskSheetHtml(id) {
  const t = S.get('tasks', id);
  if (!t) return '<p class="empty">Task not found.</p>';
  const list = S.get('lists', t.listId);
  const isNote = list?.kind === 'notes';
  const lists = S.live('lists').sort(S.byOrder);
  const sections = S.live('sections').filter((s) => s.listId === t.listId).sort(S.byOrder);
  const kids = S.live('tasks').filter((k) => k.parentId === id).sort(S.byOrder);
  const tags = t.tags || [];
  const rem = t.reminder;
  return `<div class="sheet-head">
      ${isNote ? '' : `<button class="chk big" data-act="task-toggle" data-id="${id}" aria-label="Toggle done">${t.done ? icons.check : ''}</button>`}
      <input class="title-input" data-field="task:title" value="${esc(t.title)}" placeholder="${isNote ? 'Note title' : 'Task title'}" aria-label="Title">
      <button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
    ${isNote ? '' : `<div class="row"><label>Date</label>
      <div class="inline"><input type="date" data-field="task:date" value="${t.date || ''}" aria-label="Date"><input type="time" data-field="task:time" value="${t.time || ''}" aria-label="Time"></div></div>
      <div class="quick-dates"><button data-act="task-date" data-d="today">Today</button><button data-act="task-date" data-d="tomorrow">Tomorrow</button><button data-act="task-date" data-d="nextweek">Next week</button><button data-act="task-date" data-d="none">Clear</button></div>
      <div class="row two"><div><label>Duration</label><select data-field="task:duration" aria-label="Duration">${[['', 'None'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']].map(([v, l]) => `<option value="${v}" ${String(t.duration ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Reminder</label><select data-field="task:reminder" aria-label="Reminder">${[['', 'None'], [0, 'At time'], [5, '5 min before'], [10, '10 min before'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']].map(([v, l]) => `<option value="${v}" ${String(rem ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="row"><label>Priority</label><div class="seg">${PRIO.map((p, i) => `<button class="${t.priority === i ? 'on' : ''} p${i}" data-act="task-prio" data-p="${i}">${p}</button>`).join('')}</div></div>`}
    <div class="row two"><div><label>List</label><select data-field="task:list" aria-label="List">${lists.map((l) => `<option value="${l.id}" ${l.id === t.listId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      ${sections.length ? `<div><label>Section</label><select data-field="task:section" aria-label="Section"><option value="">None</option>${sections.map((s) => `<option value="${s.id}" ${s.id === t.sectionId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}</div>
    <div class="row"><label>Tags</label><div class="tagbox">${tags.map((g) => `<span class="chip tag">#${esc(g)}<button data-act="task-rmtag" data-tag="${esc(g)}" aria-label="Remove tag ${esc(g)}">${icons.x}</button></span>`).join('')}<input data-field="task:addtag" list="taglist" placeholder="Add tag" aria-label="Add tag"><datalist id="taglist">${S.tagsInUse().map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div></div>
    <div class="row"><label>${isNote ? 'Note' : 'Notes'}</label><textarea data-field="task:notes" rows="${isNote ? 12 : 4}" placeholder="Add details…" aria-label="Notes">${esc(t.notes)}</textarea></div>
    ${isNote || t.parentId ? '' : `<div class="row"><label>Subtasks</label>
      <div class="subs">${kids.map((k) => `<div class="sub ${k.done ? 'done' : ''}"><button class="chk" data-act="task-toggle" data-id="${k.id}" aria-label="Toggle subtask">${k.done ? icons.check : ''}</button><input data-field="task:subtitle" data-id="${k.id}" value="${esc(k.title)}" aria-label="Subtask title"><button class="icon-btn sm" data-act="task-delsub" data-id="${k.id}" aria-label="Delete subtask">${icons.x}</button></div>`).join('')}
      <input class="sub-add" data-field="task:addsub" placeholder="Add a subtask" aria-label="Add subtask"></div></div>`}
    <div class="sheet-foot"><span class="meta-note">${t.updatedAt ? 'Edited ' + new Date(t.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
      <button class="btn danger ghost" data-act="task-del" data-id="${id}">${icons.trash} Delete</button></div>`;
}

const cur = () => openId;
const upd = (f) => { if (openId) S.patch('tasks', openId, f); };

registerFields({
  'task:title': (el) => { upd({ title: el.value.trim() }); },
  'task:date': (el) => { upd({ date: el.value || null, ...(el.value ? {} : { time: null }) }); refreshSheet(); },
  'task:time': (el) => { const t = S.get('tasks', cur()); upd({ time: el.value || null, ...(el.value && !t.date ? { date: today() } : {}) }); refreshSheet(); },
  'task:duration': (el) => upd({ duration: el.value ? Number(el.value) : null }),
  'task:reminder': (el) => { upd({ reminder: el.value === '' ? null : Number(el.value) }); const t = S.get('tasks', cur()); if (t.reminder !== null && !t.date) { upd({ date: today() }); refreshSheet(); } },
  'task:notes': (el) => upd({ notes: el.value }),
  'task:list': (el) => { upd({ listId: el.value, sectionId: null }); S.live('tasks').filter((k) => k.parentId === cur()).forEach((k) => S.patch('tasks', k.id, { listId: el.value, sectionId: null })); refreshSheet(); },
  'task:section': (el) => upd({ sectionId: el.value || null }),
  'task:addtag': (el) => {
    const add = el.value.split(/[,\s]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean);
    if (!add.length) return;
    const t = S.get('tasks', cur());
    upd({ tags: [...new Set([...(t.tags || []), ...add])] });
    refreshSheet(); focusField('task:addtag');
  },
  'task:addsub': (el) => {
    const v = el.value.trim(); if (!v) return;
    const p = S.get('tasks', cur());
    S.addTask({ title: v, listId: p.listId, sectionId: p.sectionId, parentId: p.id });
    refreshSheet(); focusField('task:addsub');
  },
  'task:subtitle': (el) => S.patch('tasks', el.dataset.id, { title: el.value.trim() }),
});

registerActions({
  'task-open': (el) => openTask(el.dataset.id),
  'task-toggle': (el) => { S.toggleTask(el.dataset.id); if (document.querySelector('#sheet.open [data-field="task:title"]')) refreshSheet(); },
  'sheet-close': () => closeSheet(),
  'task-prio': (el) => { upd({ priority: Number(el.dataset.p) }); refreshSheet(); },
  'task-date': (el) => {
    const d = el.dataset.d; const t0 = today();
    const date = d === 'today' ? t0 : d === 'tomorrow' ? addDays(t0, 1) : d === 'nextweek' ? addDays(t0, ((8 - weekday(t0)) % 7) || 7) : null;
    upd(date ? { date } : { date: null, time: null, reminder: null }); refreshSheet();
  },
  'task-rmtag': (el) => { const t = S.get('tasks', cur()); upd({ tags: (t.tags || []).filter((g) => g !== el.dataset.tag) }); refreshSheet(); },
  'task-delsub': (el) => { S.remove('tasks', el.dataset.id); refreshSheet(); },
  'task-del': (el) => { if (!armed(el, 'Tap again to delete')) return; S.remove('tasks', el.dataset.id); closeSheet(); toast('Task deleted'); },
  'list-sort': (el) => {
    const id = el.dataset.id; const cur2 = uiGet('sort:' + id, 'manual');
    uiSet('sort:' + id, cur2 === 'manual' ? 'date' : cur2 === 'date' ? 'priority' : 'manual'); rerender();
  },
  'section-add': (el) => { uiSet('addsec', uiGet('addsec', null) === el.dataset.id ? null : el.dataset.id); rerender(); requestAnimationFrame(() => document.querySelector('.quick input')?.focus()); },
});

// task sheet also re-renders when the underlying task changes via toggles
export function refreshOpenTask() { if (openId && document.querySelector('#sheet.open [data-field="task:title"]')) refreshSheet(); }

// ---------- quick add handler ----------
export function handleQuick(form) {
  const input = form.querySelector('input');
  const raw = input.value.trim();
  if (!raw) return;
  const [kind, a, b] = form.dataset.quick.split(':');
  const p = parseQuick(raw);
  const base = { title: p.title, priority: p.priority, tags: p.tags, date: p.date };
  if (kind === 'today') S.addTask({ ...base, listId: 'inbox', date: p.date || today() });
  else if (kind === 'list') S.addTask({ ...base, listId: a });
  else if (kind === 'section') S.addTask({ ...base, listId: b, sectionId: a });
  else if (kind === 'day') S.addTask({ ...base, listId: 'inbox', date: a });
  input.value = '';
  rerender();
  requestAnimationFrame(() => document.querySelector(`[data-quick="${form.dataset.quick}"] input`)?.focus());
}

// ---------- list & folder management ----------
let newListState = { name: '', kind: 'tasks', folderId: '', color: null };
export function openNewList() {
  newListState = { name: '', kind: 'tasks', folderId: '', color: COLORS[0] };
  openSheet(newListHtml);
  focusField('newlist:name');
}
const folders = () => S.live('folders').sort(S.byOrder);
function newListHtml() {
  const s = newListState;
  return `<div class="sheet-head"><h2>New list</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
    <div class="row"><label>Name</label><input data-field="newlist:name" value="${esc(s.name)}" placeholder="List name" aria-label="List name"></div>
    <div class="row"><label>Type</label><div class="seg"><button class="${s.kind === 'tasks' ? 'on' : ''}" data-act="newlist-kind" data-k="tasks">Tasks</button><button class="${s.kind === 'notes' ? 'on' : ''}" data-act="newlist-kind" data-k="notes">Notes</button></div></div>
    <div class="row"><label>Folder</label><select data-field="newlist:folder" aria-label="Folder"><option value="">No folder</option>${folders().map((f) => `<option value="${f.id}" ${s.folderId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}<option value="__new">New folder…</option></select></div>
    ${s.folderId === '__new' ? `<div class="row"><label>Folder name</label><input data-field="newlist:foldername" value="${esc(s.folderName || '')}" placeholder="Folder name" aria-label="New folder name"></div>` : ''}
    <div class="row"><label>Colour</label><div class="swatches">${swatch(COLORS, s.color, 'newlist-color')}</div></div>
    <div class="sheet-foot"><span></span><button class="btn" data-act="newlist-create">Create list</button></div>`;
}
registerFields({
  'newlist:name': (el) => { newListState.name = el.value; },
  'newlist:folder': (el) => { newListState.folderId = el.value; refreshSheet(); },
  'newlist:foldername': (el) => { newListState.folderName = el.value; },
});
registerActions({
  'newlist-kind': (el) => { newListState.kind = el.dataset.k; refreshSheet(); },
  'newlist-color': (el) => { newListState.color = el.dataset.color; refreshSheet(); },
  'newlist-create': () => {
    const s = newListState;
    const name = (document.querySelector('[data-field="newlist:name"]')?.value || s.name).trim();
    if (!name) { toast('Give the list a name'); return; }
    let folderId = s.folderId || null;
    if (folderId === '__new') {
      const fname = (document.querySelector('[data-field="newlist:foldername"]')?.value || s.folderName || '').trim();
      folderId = null;
      if (fname) {
        const existing = S.live('folders').find((f) => f.name.toLowerCase() === fname.toLowerCase());
        folderId = existing ? existing.id : S.put('folders', { id: uid(), name: fname, sortOrder: Date.now() }).id;
      }
    }
    const all = S.live('lists'); const bottom = all.length ? Math.max(...all.map((l) => l.sortOrder ?? 0)) : 0;
    const rec = S.put('lists', { id: uid(), name, color: s.color, folderId, kind: s.kind, sortOrder: bottom + 1 });
    closeSheet(); location.hash = `#/list/${rec.id}`;
  },
});

let settingsListId = null;
export function openListSettings(id) {
  settingsListId = id;
  openSheet(listSettingsHtml);
}
function listSettingsHtml() {
  const l = S.get('lists', settingsListId);
  if (!l) return '';
  const secs = S.live('sections').filter((s) => s.listId === l.id).sort(S.byOrder);
  const isInbox = l.id === 'inbox';
  return `<div class="sheet-head"><h2>${esc(l.name)}</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
    ${isInbox ? '' : `<div class="row"><label>Name</label><input data-field="ls:name" value="${esc(l.name)}" aria-label="List name"></div>
    <div class="row"><label>Folder</label><select data-field="ls:folder" aria-label="Folder"><option value="">No folder</option>${folders().map((f) => `<option value="${f.id}" ${l.folderId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
    <div class="row"><label>Colour</label><div class="swatches">${swatch(COLORS, l.color, 'ls-color')}</div></div>`}
    ${l.kind === 'tasks' ? `<div class="row"><label>Sections</label><div class="subs">${secs.map((s) => `<div class="sub"><input data-field="ls:secname" data-id="${s.id}" value="${esc(s.name)}" aria-label="Section name"><button class="icon-btn sm" data-act="ls-delsec" data-id="${s.id}" aria-label="Delete section">${icons.x}</button></div>`).join('')}<input class="sub-add" data-field="ls:addsec" placeholder="Add a section" aria-label="Add section"></div></div>` : ''}
    ${isInbox ? '' : `<div class="sheet-foot"><span></span><button class="btn danger ghost" data-act="ls-del" data-id="${l.id}">${icons.trash} Delete list</button></div>`}`;
}
registerFields({
  'ls:name': (el) => { if (el.value.trim()) S.patch('lists', settingsListId, { name: el.value.trim() }); },
  'ls:folder': (el) => S.patch('lists', settingsListId, { folderId: el.value || null }),
  'ls:secname': (el) => { if (el.value.trim()) S.patch('sections', el.dataset.id, { name: el.value.trim() }); },
  'ls:addsec': (el) => {
    const v = el.value.trim(); if (!v) return;
    const secs = S.live('sections').filter((s) => s.listId === settingsListId);
    S.put('sections', { id: uid(), listId: settingsListId, name: v, sortOrder: (secs.length ? Math.max(...secs.map((s) => s.sortOrder ?? 0)) : 0) + 1 });
    refreshSheet(); focusField('ls:addsec');
  },
});
registerActions({
  'list-settings': (el) => openListSettings(el.dataset.id),
  'ls-color': (el) => { S.patch('lists', settingsListId, { color: el.dataset.color }); refreshSheet(); },
  'ls-delsec': (el) => { S.remove('sections', el.dataset.id); refreshSheet(); },
  'ls-del': (el) => { if (!armed(el, 'Tap again to delete the list and its tasks')) return; S.remove('lists', el.dataset.id); closeSheet(); location.hash = '#/today'; toast('List deleted'); },
});

// folder sheet
let folderId = null;
export function openFolder(id) { folderId = id; openSheet(folderHtml); }
function folderHtml() {
  const f = S.get('folders', folderId); if (!f) return '';
  return `<div class="sheet-head"><h2>Folder</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">${icons.x}</button></div>
    <div class="row"><label>Name</label><input data-field="folder:name" value="${esc(f.name)}" aria-label="Folder name"></div>
    <div class="sheet-foot"><span class="meta-note">Lists inside stay, they just leave the folder.</span><button class="btn danger ghost" data-act="folder-del">${icons.trash} Delete folder</button></div>`;
}
registerFields({ 'folder:name': (el) => { if (el.value.trim()) S.patch('folders', folderId, { name: el.value.trim() }); } });
registerActions({
  'folder-open': (el) => openFolder(el.dataset.id),
  'folder-del': (el) => { if (!armed(el, 'Tap again to delete')) return; S.live('lists').filter((l) => l.folderId === folderId).forEach((l) => S.patch('lists', l.id, { folderId: null })); S.remove('folders', folderId); closeSheet(); },
});
