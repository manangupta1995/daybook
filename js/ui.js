// UI plumbing shared by the views: icons, action registry, sheet, toast.
import { esc } from './util.js';

const I = (d, extra = '') => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;
export const icons = {
  today: I('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>'),
  list: I('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".8"/><circle cx="4" cy="12" r=".8"/><circle cx="4" cy="18" r=".8"/>'),
  calendar: I('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  habit: I('<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.2 1 2 2 2-.5-3 0-5 1-8z"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  minus: I('<path d="M5 12h14"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  chevL: I('<path d="M14.5 6l-6 6 6 6"/>'),
  chevR: I('<path d="M9.5 6l6 6-6 6"/>'),
  chevD: I('<path d="M6 9.5l6 6 6-6"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'),
  trash: I('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
  sync: I('<path d="M20 11a8 8 0 0 0-14.3-4.2L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.2L20 15M20 20v-5h-5"/>'),
  inbox: I('<path d="M3.5 13l2.3-7.2A2 2 0 0 1 7.7 4.5h8.6a2 2 0 0 1 1.9 1.3L20.5 13v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 13h5l1 2.5h5l1-2.5h5"/>'),
  folder: I('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  note: I('<path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16h5"/>'),
  tag: I('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.6 7.6a1 1 0 0 1 0 1.4l-7.7 7.7a1 1 0 0 1-1.4 0L3.8 12.9a1 1 0 0 1-.3-.7z"/><circle cx="8" cy="8" r="1"/>'),
  flame: I('<path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.2 1 2 2 2-.5-3 0-5 1-8z"/>'),
  dots: I('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  sub: I('<path d="M6 4v8a3 3 0 0 0 3 3h9M14.5 11.5L18 15l-3.5 3.5"/>'),
  grip: I('<circle cx="9" cy="6" r="1.1"/><circle cx="15" cy="6" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="18" r="1.1"/><circle cx="15" cy="18" r="1.1"/>'),
  up: I('<path d="M6 14.5l6-6 6 6"/>'),
  alert: I('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.1"/>'),
};

// ---- action registry (click delegation) ----
const actions = {};
export const registerActions = (map) => Object.assign(actions, map);
export function dispatchAction(el, ev) {
  const fn = actions[el.dataset.act];
  if (fn) fn(el, ev);
}

// ---- toast ----
let toastTimer;
let toastUndo = null;
export function toast(msg, undo = null) {
  const t = document.getElementById('toast');
  toastUndo = undo;
  t.innerHTML = '';
  const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (undo) { const b = document.createElement('button'); b.type = 'button'; b.dataset.act = 'toast-undo'; b.textContent = 'Undo'; t.appendChild(b); }
  t.classList.toggle('has-action', !!undo);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 6000 : 2600);
}
registerActions({ 'toast-undo': () => { const f = toastUndo; toastUndo = null; document.getElementById('toast').classList.remove('show'); f?.(); } });

// ---- sheet (bottom sheet on phone, side drawer on desktop) ----
let sheetRender = null;
export function openSheet(render) {
  sheetRender = render;
  const s = document.getElementById('sheet');
  const body = s.querySelector('.sheet-body');
  body.innerHTML = render();
  s.hidden = false;
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => s.classList.add('open'));
}
export function refreshSheet() {
  if (!sheetRender) return;
  const body = document.querySelector('#sheet .sheet-body');
  const y = body.scrollTop;
  body.innerHTML = sheetRender();
  body.scrollTop = y;
}
export function closeSheet() {
  const s = document.getElementById('sheet');
  if (s.hidden) return;
  sheetRender = null;
  s.classList.remove('open');
  document.body.classList.remove('sheet-open');
  setTimeout(() => { if (!sheetRender) { s.hidden = true; s.querySelector('.sheet-body').innerHTML = ''; } }, 200);
}
export const sheetOpen = () => !document.getElementById('sheet').hidden && !!sheetRender;

export const COLORS = ['#2F6F4F', '#4C8DD6', '#6E75F4', '#35A86B', '#D6A22E', '#D9673B', '#C4452F', '#B04C8F', '#7A8A82'];
export const swatch = (colors, cur, act) => colors.map((c) => `<button type="button" class="sw ${c === cur ? 'on' : ''}" style="--c:${c}" data-act="${act}" data-color="${c}" aria-label="Colour ${c}"></button>`).join('');
export const grip = (id, label) => `<button class="grip" data-drag data-id="${id}" aria-label="Reorder ${esc(label)}. Drag, or use the up and down arrow keys" title="Drag to reorder">${icons.grip}</button>`;
export { esc };

// ---- field change registry (inputs inside sheets / views) ----
const fields = {};
export const registerFields = (map) => Object.assign(fields, map);
export function dispatchField(el) {
  const fn = fields[el.dataset.field];
  if (fn) fn(el);
}

// Two-tap confirmation for destructive buttons. Returns true on the confirming tap.
export function armed(el, label = 'Tap again to confirm') {
  if (el.dataset.armed) return true;
  const orig = el.innerHTML;
  el.dataset.armed = '1';
  el.classList.add('armed');
  el.textContent = label;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.classList.remove('armed'); el.innerHTML = orig; } }, 3500);
  return false;
}

export const rerender = () => window.dispatchEvent(new Event('daybook:render'));
export function focusField(name) {
  requestAnimationFrame(() => document.querySelector(`[data-field="${name}"]`)?.focus());
}

// light persisted UI preferences (collapsed folders, sort...)
const UI_KEY = 'daybook.ui.v1';
let uiState = {};
try { uiState = JSON.parse(localStorage.getItem(UI_KEY) || '{}'); } catch { uiState = {}; }
export const uiGet = (k, d) => (k in uiState ? uiState[k] : d);
export function uiSet(k, v) { uiState[k] = v; try { localStorage.setItem(UI_KEY, JSON.stringify(uiState)); } catch { /* ignore */ } }
