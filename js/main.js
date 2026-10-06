// App shell: routing, navigation, event wiring.
import { esc } from './util.js';
import * as S from './store.js';
import './dnd.js';
import { dragging, registerDnd, computeOrder } from './dnd.js';
import { icons, grip, dispatchAction, dispatchField, registerActions, closeSheet, refreshSheet, sheetOpen, uiGet, uiSet } from './ui.js';
import { renderToday, renderList, renderTag, handleQuick, openNewList } from './tasks.js';
import { renderCalendar, calendarMounted } from './calendar.js';
import { renderHabits } from './habits.js';
import { renderSettings, applyTheme, syncLabel } from './settings.js';
import { startAutoSync, onStatus, status, getCfg } from './sync.js';

const $ = (s) => document.querySelector(s);

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  return { name: name || 'today', arg: decodeURIComponent(rest.join('/')) };
}

function listNav() {
  const lists = S.live('lists').sort(S.byOrder);
  const folders = S.live('folders').sort(S.byOrder);
  const open = {}; S.live('tasks').forEach((t) => { if (!t.done && !t.parentId) open[t.listId] = (open[t.listId] || 0) + 1; });
  const r = route();
  const item = (l) => `<a class="nav-item ${r.name === 'list' && r.arg === l.id ? 'on' : ''}" href="#/list/${l.id}"><span class="lico" style="--c:${l.color || 'var(--muted)'}">${l.id === 'inbox' ? icons.inbox : l.kind === 'notes' ? icons.note : '<i></i>'}</span><span class="lname">${esc(l.name)}</span><span class="lcount">${open[l.id] || ''}</span></a>`;
  const row = (l) => `<div class="navrow" data-dnd-item data-id="${l.id}">${item(l)}${grip(l.id, l.name)}</div>`;
  const inbox = lists.find((l) => l.id === 'inbox');
  const loose = lists.filter((l) => l.id !== 'inbox' && !folders.find((f) => f.id === l.folderId));
  const tags = S.tagsInUse();
  return `${inbox ? item(inbox) : ''}<div class="zone" data-dnd-zone data-group="lists" data-zone="">${loose.map(row).join('')}</div>
    ${folders.map((f) => { const inside = lists.filter((l) => l.folderId === f.id); const col = uiGet('fold:' + f.id, false); return `<div class="folder" data-dnd-zone data-group="lists" data-zone="${f.id}"><div class="fhead"><button class="fbtn" data-act="folder-toggle" data-id="${f.id}" aria-expanded="${!col}">${col ? icons.chevR : icons.chevD}${esc(f.name)}</button><button class="mini" data-act="folder-open" data-id="${f.id}" aria-label="Folder options">${icons.dots}</button></div>${col ? '' : inside.map(row).join('')}</div>`; }).join('')}
    ${tags.length ? `<div class="tagnav"><h4>Tags</h4>${tags.map((g) => `<a class="chip tag ${r.name === 'tag' && r.arg === g ? 'on' : ''}" href="#/tag/${encodeURIComponent(g)}">#${esc(g)}</a>`).join('')}</div>` : ''}`;
}

registerDnd('lists', ({ id, zone, zoneIds }) => {
  const upd = computeOrder(zoneIds, id, (x) => S.get('lists', x)?.sortOrder ?? 0);
  S.putMany('lists', Object.entries(upd).map(([lid, sortOrder]) => ({ id: lid, sortOrder, ...(lid === id ? { folderId: zone || null } : {}) })));
});

registerActions({
  'folder-toggle': (el) => { uiSet('fold:' + el.dataset.id, !uiGet('fold:' + el.dataset.id, false)); render(); },
  'new-list': () => openNewList(),
});

const syncBtn = () => `<button class="syncbtn ${status.state}" data-act="sync-now" aria-label="Sync now: ${esc(syncLabel())}">${icons.sync}<span>${esc(syncLabel())}</span></button>`;

function sidebar(r) {
  const nav = (n, label, icon) => `<a class="nav-item ${r.name === n ? 'on' : ''}" href="#/${n}"><span class="lico">${icon}</span><span class="lname">${label}</span></a>`;
  return `<div class="brand"><span class="logo">${icons.check}</span><b>Daybook</b></div>
    <nav aria-label="Main">${nav('today', 'Today', icons.today)}${nav('calendar', 'Calendar', icons.calendar)}${nav('habits', 'Habits', icons.habit)}</nav>
    <div class="side-sec"><h4>Lists</h4><button class="mini" data-act="new-list" aria-label="New list">${icons.plus}</button></div>
    <div class="side-lists">${listNav()}</div>
    <div class="side-foot">${syncBtn()}${nav('settings', 'Settings', icons.settings)}</div>`;
}

function tabs(r) {
  const t = (n, label, icon, on) => `<a class="tab ${on ? 'on' : ''}" href="#/${n}" ${on ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></a>`;
  const listish = ['lists', 'list', 'tag'].includes(r.name);
  return t('today', 'Today', icons.today, r.name === 'today') + t('lists', 'Lists', icons.list, listish) + t('calendar', 'Calendar', icons.calendar, r.name === 'calendar') + t('habits', 'Habits', icons.habit, r.name === 'habits') + t('settings', 'Settings', icons.settings, r.name === 'settings');
}

function connectBanner() {
  if (getCfg().token) return '';
  return `<a class="banner" href="#/settings">${icons.sync}<span><b>Connect GitHub</b> to load your data and sync across devices.</span>${icons.chevR}</a>`;
}

function body(r) {
  switch (r.name) {
    case 'today': return connectBanner() + renderToday();
    case 'list': return renderList(r.arg);
    case 'tag': return renderTag(r.arg);
    case 'lists': return `<div class="page-head"><div><h1>Lists</h1></div><div class="head-actions"><button class="icon-btn" data-act="new-list">${icons.plus} New list</button></div></div><div class="lists-index">${listNav()}</div>`;
    case 'calendar': return renderCalendar();
    case 'habits': return renderHabits();
    case 'settings': return renderSettings();
    default: return renderToday();
  }
}

let pending = false;
export function render() {
  const r = route();
  const y = window.scrollY;
  $('#side').innerHTML = sidebar(r);
  $('#tabs').innerHTML = tabs(r);
  $('#topsync').innerHTML = syncBtn();
  $('#view').innerHTML = body(r);
  document.title = 'Daybook';
  window.scrollTo(0, y);
  if (r.name === 'calendar') calendarMounted();
  pending = false;
}

const typing = () => { if (dragging()) return true; const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'noop'; };

S.onChange((kind) => {
  if (kind === 'remote' && typing()) { pending = true; return; }
  render();
  if (kind === 'remote' && sheetOpen()) refreshSheet();
});
window.addEventListener('daybook:render', render);
window.addEventListener('hashchange', () => { closeSheet(); window.scrollTo(0, 0); render(); });
document.addEventListener('focusout', () => { if (pending) setTimeout(() => { if (!typing()) render(); }, 50); });
onStatus(() => { // update status text without rebuilding the page
  document.querySelectorAll('.syncbtn').forEach((b) => { b.className = `syncbtn ${status.state}`; b.querySelector('span').textContent = syncLabel(); });
  document.querySelectorAll('.syncline').forEach((b) => { if (route().name === 'settings' && !typing()) render(); });
});

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (el) { dispatchAction(el, ev); }
});
document.addEventListener('change', (ev) => { const el = ev.target.closest('[data-field]'); if (el) dispatchField(el); });
document.addEventListener('submit', (ev) => { const f = ev.target.closest('form[data-quick]'); if (f) { ev.preventDefault(); handleQuick(f); } });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeSheet();
  if (ev.key === 'Enter' && ev.target.matches('.title-input,.sub input,[data-field="hb:name"],[data-field="ls:name"],[data-field="folder:name"]')) ev.target.blur();
});
document.addEventListener('toggle', (ev) => { const d = ev.target; if (d.dataset?.done) uiSet('showdone:' + d.dataset.done, d.open); }, true);


applyTheme();
S.load();
render();
startAutoSync();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
