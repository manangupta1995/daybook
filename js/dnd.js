// Drag-to-reorder with pointer events (mouse, touch, pen) plus arrow-key fallback on the grip.
// Markup contract: a zone is [data-dnd-zone][data-group][data-zone]; items are [data-dnd-item][data-id]
// and contain a [data-drag] grip. Items can be dropped into any zone with the same data-group.
import { rerender } from './ui.js';

const handlers = {};
export const registerDnd = (kind, fn) => { handlers[kind] = fn; };
export const dragging = () => document.body.classList.contains('dragging');

// New sortOrder values after `id` landed in `ids` (its zone, in display order).
// Returns { id: value } for every record that needs writing.
export function computeOrder(ids, id, get) {
  const i = ids.indexOf(id);
  const prev = i > 0 ? get(ids[i - 1]) : null;
  const next = i < ids.length - 1 ? get(ids[i + 1]) : null;
  const GAP = 1e9;
  if (prev === null && next === null) return { [id]: 0 };
  if (prev === null) return { [id]: next - GAP };
  if (next === null) return { [id]: prev + GAP };
  if (next - prev > 1e-3) return { [id]: (prev + next) / 2 };
  const all = {}; ids.forEach((x, n) => { all[x] = n * GAP; }); // neighbours too close or tied: renumber the zone
  return all;
}

const items = (zone, except) => [...zone.querySelectorAll('[data-dnd-item]')].filter((n) => n !== except);
const zoneOf = (el) => el.closest('[data-dnd-zone]');
const kindOf = (zone) => zone.dataset.group.split(':')[0];

let d = null;

function begin(e) {
  const item = d.item; const r = item.getBoundingClientRect();
  d.active = true; d.offY = e.clientY - r.top;
  d.group = zoneOf(item).dataset.group; d.fromZone = zoneOf(item).dataset.zone;
  d.fromIndex = items(zoneOf(item)).indexOf(item);
  const g = item.cloneNode(true);
  g.classList.add('dnd-ghost'); g.removeAttribute('data-dnd-item');
  Object.assign(g.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
  document.body.appendChild(g); d.ghost = g;
  item.classList.add('dnd-src');
  document.body.classList.add('dragging');
  d.scroller = scrollParent(item);
  tick();
}

function scrollParent(el) {
  for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; }
  return null;
}

function tick() {
  if (!d || !d.active) return;
  const y = d.y; const s = d.scroller;
  const top = s ? s.getBoundingClientRect().top : 0, bottom = s ? s.getBoundingClientRect().bottom : innerHeight;
  const dy = y < top + 60 ? -12 : y > bottom - 60 ? 12 : 0;
  if (dy) { (s || window).scrollBy(0, dy); place(); }
  d.raf = requestAnimationFrame(tick);
}

function place() {
  if (!d.ghost) return;
  d.ghost.style.top = d.y - d.offY + 'px';
  const under = document.elementFromPoint(d.x, d.y);
  const zone = under && zoneOf(under);
  if (!zone || zone.dataset.group !== d.group) return;
  const list = items(zone, d.item);
  const before = list.find((n) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2 > d.y; });
  if (before) { if (d.item.nextElementSibling !== before) before.before(d.item); }
  else if (list.length) { const last = list[list.length - 1]; if (last.nextElementSibling !== d.item) last.after(d.item); }
  else if (d.item.parentElement !== zone) zone.appendChild(d.item);
}

function finish(commit) {
  if (!d) return;
  cancelAnimationFrame(d.raf);
  const { item, active, group, fromZone, fromIndex } = d;
  d.ghost?.remove();
  document.body.classList.remove('dragging');
  d = null;
  if (!active) return;
  item.classList.remove('dnd-src');
  // the click that ends a drag must not activate the thing underneath
  const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, true), 60);
  const zone = zoneOf(item);
  if (commit && zone) {
    const ids = items(zone).map((n) => n.dataset.id);
    const moved = zone.dataset.zone !== fromZone || ids.indexOf(item.dataset.id) !== fromIndex;
    if (moved) handlers[kindOf(zone)]?.({ id: item.dataset.id, zone: zone.dataset.zone, zoneIds: ids, group });
  }
  rerender(); // restores the DOM from data (and picks up the new order)
}

document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest?.('[data-drag]');
  if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const item = grip.closest('[data-dnd-item]'); if (!item) return;
  d = { grip, item, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, pid: e.pointerId };
  try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
document.addEventListener('pointermove', (e) => {
  if (!d || e.pointerId !== d.pid) return;
  d.x = e.clientX; d.y = e.clientY;
  if (!d.active && Math.hypot(d.x - d.sx, d.y - d.sy) > 4) begin(e);
  if (d.active) { e.preventDefault(); place(); }
});
document.addEventListener('pointerup', (e) => { if (d && e.pointerId === d.pid) finish(true); });
document.addEventListener('pointercancel', (e) => { if (d && e.pointerId === d.pid) finish(false); });

// keyboard: focus a grip, then ArrowUp / ArrowDown to move within the zone
document.addEventListener('keydown', (e) => {
  const grip = e.target.closest?.('[data-drag]');
  if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const item = grip.closest('[data-dnd-item]'); const zone = item && zoneOf(item); if (!zone) return;
  e.preventDefault();
  const list = items(zone); const i = list.indexOf(item); const j = i + (e.key === 'ArrowUp' ? -1 : 1);
  if (j < 0 || j >= list.length) return;
  if (e.key === 'ArrowUp') list[j].before(item); else list[j].after(item);
  const id = item.dataset.id;
  handlers[kindOf(zone)]?.({ id, zone: zone.dataset.zone, zoneIds: items(zone).map((n) => n.dataset.id), group: zone.dataset.group });
  rerender();
  setTimeout(() => document.querySelector(`[data-drag][data-id="${CSS.escape(id)}"]`)?.focus(), 0);
});
