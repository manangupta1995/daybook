// Small shared helpers: ids, dates, escaping.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function uid() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const nowIso = () => new Date().toISOString();

const p2 = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const today = () => ymd(new Date());
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 864e5);
export const weekday = (s) => parseYmd(s).getDay(); // 0 = Sunday

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW_SHORT = DOW;

export function friendlyDate(s) {
  if (!s) return '';
  const diff = diffDays(s, today());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = parseYmd(s);
  const base = `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${p2(m)} ${ap}`;
}

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// Typed time -> "HH:MM" (24h). Accepts 3pm, 3:30 pm, 15:30, 1530, 930a, noon, midnight. Returns null if unreadable.
export function parseTime(s) {
  s = String(s ?? '').trim().toLowerCase().replace(/\./g, '');
  if (s === 'noon') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*([ap])?m?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === 'p' ? 12 : 0); }
  else if (h > 23) return null;
  return `${p2(h)}:${p2(min)}`;
}
