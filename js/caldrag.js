// Calendar drag-to-reschedule: month cells, day/week timeline (15-minute snap), all-day strips, and resize.
// Touch needs a long-press (350 ms) so scrolling still works; mouse/pen start after a 4 px move.
import * as S from './store.js';
import { friendlyDate } from './util.js';
import { toast, rerender } from './ui.js';

const SNAP = 15, LONG = 350;
let d = null;

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const label = (m) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const snap = (m) => Math.round(m / SNAP) * SNAP;

function scrollParent(el) {
  for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; }
  return null;
}
const clearMarks = () => document.querySelectorAll('.drop').forEach((n) => n.classList.remove('drop'));

function start(e) {
  const t = d.task;
  const r = d.src.getBoundingClientRect();
  if (d.mode === 'resize') {
    d.active = true; d.dur = t.duration || 30;
    document.body.classList.add('dragging'); d.src.classList.add('cal-src'); d.scroller = scrollParent(d.src); navigator.vibrate?.(8); tick();
    return;
  }
  d.active = true; d.offX = d.sx - r.left; d.offY = d.mode === 'block' ? d.sy - r.top : Math.min(14, d.sy - r.top);
  d.dur = t.duration || 30;
  const g = d.src.cloneNode(true);
  g.classList.add('cal-ghost'); g.removeAttribute('data-act'); g.removeAttribute('data-cal-src');
  g.querySelector('.tl-resize')?.remove();
  const w = d.mode === 'month' ? Math.max(r.width, 90) : r.width;
  Object.assign(g.style, { width: w + 'px', left: r.left + 'px', top: r.top + 'px', right: 'auto', bottom: 'auto', margin: 0 });
  if (d.mode === 'block') g.style.height = r.height + 'px';
  document.body.appendChild(g); d.ghost = g;
  d.src.classList.add('cal-src');
  document.body.classList.add('dragging');
  d.scroller = scrollParent(d.src);
  navigator.vibrate?.(12);
  tick();
}

function tick() {
  if (!d?.active) return;
  const s = d.scroller;
  const top = s ? s.getBoundingClientRect().top : 0, bottom = s ? s.getBoundingClientRect().bottom : innerHeight;
  const dy = d.y < top + 60 ? -12 : d.y > bottom - 60 ? 12 : 0;
  if (dy) { (s || window).scrollBy(0, dy); update(); }
  d.raf = requestAnimationFrame(tick);
}

// where would the task land if released now?
function target() {
  const els = document.elementsFromPoint(d.x, d.y);
  const col = els.find((n) => n.classList?.contains('tl-col'));
  if (col) {
    const tl = col.closest('.timeline'); const base = Number(tl.dataset.base), hour = Number(tl.dataset.hour);
    const top = d.y - d.offY - col.getBoundingClientRect().top;
    const room = col.offsetHeight / hour * 60;
    let m = snap(base + top / hour * 60);
    m = Math.max(base, Math.min(m, base + room - Math.min(d.dur, room)));
    return { kind: 'time', date: col.dataset.date, time: hhmm(m), m, col, base, hour };
  }
  const ad = els.find((n) => n.dataset?.adDate);
  if (ad) return { kind: 'allday', date: ad.dataset.adDate, time: null, el: ad };
  const cell = els.find((n) => n.classList?.contains('cell') && n.dataset.d);
  if (cell) return { kind: 'month', date: cell.dataset.d, time: d.task.time || null, el: cell };
  return null;
}

function preview(tg) {
  d.preview?.remove(); d.preview = null; clearMarks();
  d.tg = tg;
  if (!tg) return;
  if (tg.kind === 'time') {
    const p = document.createElement('div'); p.className = 'tl-preview';
    p.style.top = (tg.m - tg.base) / 60 * tg.hour + 'px'; p.style.height = Math.max(d.dur / 60 * tg.hour - 2, 18) + 'px';
    p.textContent = `${label(tg.m)}–${label(tg.m + d.dur)}`;
    tg.col.appendChild(p); d.preview = p; tg.col.classList.add('drop');
  } else tg.el.classList.add('drop');
}

function update() {
  if (!d?.active) return;
  if (d.mode === 'resize') return resizeUpdate();
  d.ghost.style.left = d.x - d.offX + 'px'; d.ghost.style.top = d.y - d.offY + 'px';
  preview(target());
}

function resizeUpdate() {
  const hour = d.hour;
  const top = d.src.getBoundingClientRect().top; const room = d.col.getBoundingClientRect().bottom;
  let dur = snap((d.y - top) / hour * 60);
  dur = Math.max(SNAP, Math.min(dur, Math.floor((room - top) / hour * 60 / SNAP) * SNAP));
  d.newDur = dur;
  d.src.style.height = Math.max(dur / 60 * hour - 2, 14) + 'px';
  d.preview?.remove();
  const p = d.preview = document.createElement('div'); p.className = 'tl-preview resize';
  const s = mins(d.task.time);
  p.style.top = (s - d.base) / 60 * hour + 'px'; p.style.height = Math.max(dur / 60 * hour - 2, 14) + 'px';
  p.textContent = `${label(s)}–${label(s + dur)} · ${dur} min`;
  d.col.appendChild(p);
}

function undoer(id, before) {
  return () => { S.patch('tasks', id, before); rerender(); };
}

function finish(commit) {
  if (!d) return;
  cancelAnimationFrame(d.raf); clearTimeout(d.timer);
  const cur = d; const tg = cur.tg;
  cur.ghost?.remove(); cur.preview?.remove(); clearMarks();
  document.body.classList.remove('dragging');
  d = null;
  if (!cur.active) return;
  cur.src.classList.remove('cal-src');
  const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, true), 80);
  const t = cur.task; const id = t.id;
  if (commit && cur.mode === 'resize') {
    if (cur.newDur && cur.newDur !== (t.duration || 30)) {
      S.patch('tasks', id, { duration: cur.newDur });
      toast(`Duration ${cur.newDur} min`, undoer(id, { duration: t.duration ?? null }));
    }
  } else if (commit && tg && (tg.date !== t.date || (tg.time || null) !== (t.time || null))) {
    const before = { date: t.date, time: t.time || null };
    const fields = { date: tg.date, time: tg.time };
    S.patch('tasks', id, fields);
    toast(`Moved to ${friendlyDate(tg.date)}${tg.time ? ', ' + label(mins(tg.time)) : ''}`, undoer(id, before));
  }
  rerender();
}

document.addEventListener('pointerdown', (e) => {
  if (d || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const handle = e.target.closest?.('[data-cal-resize]');
  const src = handle ? handle.closest('.tl-task') : e.target.closest?.('[data-cal-src]');
  if (!src) return;
  const id = handle ? handle.dataset.id : (src.dataset.id);
  const task = id && S.get('tasks', id); if (!task) return;
  let mode = handle ? 'resize' : src.classList.contains('tl-task') ? 'block' : src.classList.contains('pill') ? 'month' : 'strip';
  if (mode === 'resize' && !task.time) return;
  d = { src, task, mode, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pid: e.pointerId, pointer: e.pointerType, active: false };
  if (mode === 'resize') {
    const col = src.closest('.tl-col'); const tl = col.closest('.timeline');
    d.col = col; d.hour = Number(tl.dataset.hour); d.base = Number(tl.dataset.base);
  }
  if (e.pointerType === 'mouse' || mode === 'resize') { /* starts after a small move */ }
  else {
    d.timer = setTimeout(() => { if (d && !d.active) { start({ clientX: d.x, clientY: d.y }); update(); } }, LONG);
  }
  if (mode === 'resize' || e.pointerType !== 'mouse') { try { (handle || src).setPointerCapture(e.pointerId); } catch { /* ignore */ } }
});

document.addEventListener('pointermove', (e) => {
  if (!d || e.pointerId !== d.pid) return;
  d.x = e.clientX; d.y = e.clientY;
  const moved = Math.hypot(d.x - d.sx, d.y - d.sy);
  if (!d.active) {
    if (d.pointer === 'touch' && d.mode !== 'resize') { if (moved > 8) { clearTimeout(d.timer); d = null; } return; }
    if (moved > 4) { start(e); } else return;
  }
  e.preventDefault(); update();
});
document.addEventListener('pointerup', (e) => { if (d && e.pointerId === d.pid) finish(true); });
document.addEventListener('pointercancel', (e) => { if (d && e.pointerId === d.pid) finish(false); });

// once a touch long-press has picked something up, the page must stop scrolling under the finger
document.addEventListener('touchmove', (e) => { if (d?.active) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (d && e.target.closest?.('[data-cal-src],[data-cal-resize]')) e.preventDefault(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d) finish(false); });
