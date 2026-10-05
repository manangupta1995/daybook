// Settings: GitHub connection, appearance, export, local reset.
import { esc } from './util.js';
import * as S from './store.js';
import { getCfg, setCfg, syncNow, status, testConnection } from './sync.js';
import { icons, registerActions, registerFields, armed, toast, rerender } from './ui.js';

export function applyTheme() {
  const t = getCfg().theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}

export function syncLabel() {
  if (status.state === 'syncing') return 'Syncing…';
  if (status.state === 'off') return 'Not connected';
  if (status.state === 'offline') return 'Offline';
  if (status.state === 'error') return 'Sync problem';
  return status.lastSynced ? `Synced ${status.lastSynced.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Ready';
}

export function renderSettings() {
  const c = getCfg();
  const connected = !!c.token;
  const counts = { t: S.live('tasks').length, h: S.live('habits').length };
  return `<div class="page-head"><div><h1>Settings</h1></div></div>
  <section class="card">
    <h3>GitHub sync</h3>
    <p class="muted">Your data lives in <b>${esc(c.owner)}/${esc(c.repo)}</b> (private) as <code>${esc(c.path)}</code>. Every device that has the token stays in sync.</p>
    <div class="syncline ${status.state}"><span class="dot"></span><span>${esc(syncLabel())}</span>${status.message ? `<span class="muted"> · ${esc(status.message)}</span>` : ''}</div>
    <div class="row"><label>Access token</label><input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" data-field="set:token" placeholder="${connected ? 'Token saved. Paste a new one to replace it' : 'github_pat_…'}" aria-label="GitHub access token"></div>
    <details class="adv"><summary>Repository details</summary>
      <div class="row two"><div><label>Owner</label><input data-field="set:owner" value="${esc(c.owner)}" autocapitalize="off" aria-label="Repo owner"></div><div><label>Repo</label><input data-field="set:repo" value="${esc(c.repo)}" autocapitalize="off" aria-label="Repo name"></div></div></details>
    <div class="btnrow"><button class="btn" data-act="set-connect">${connected ? 'Save and sync' : 'Connect'}</button>${connected ? `<button class="btn ghost" data-act="sync-now">${icons.sync} Sync now</button><button class="btn danger ghost" data-act="set-disconnect">Disconnect</button>` : ''}</div>
    <details class="adv"><summary>How to create the token</summary><ol class="steps">
      <li>On GitHub open <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
      <li>Name it <i>daybook</i>, set expiry to the longest allowed, and under <b>Repository access</b> choose <b>Only select repositories</b> → <code>daybook-data</code>.</li>
      <li>Under <b>Permissions → Repository permissions</b> set <b>Contents</b> to <b>Read and write</b>. Nothing else.</li>
      <li>Generate, copy the token, and paste it above. It is stored only in this browser.</li></ol></details>
  </section>
  <section class="card"><h3>Appearance</h3>
    <div class="row two"><div><label>Theme</label><select data-field="set:theme" aria-label="Theme">${[['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}" ${(c.theme || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div><label>Week starts on</label><select data-field="set:week" aria-label="Week starts on"><option value="1" ${String(c.weekStart ?? 1) === '1' ? 'selected' : ''}>Monday</option><option value="0" ${String(c.weekStart ?? 1) === '0' ? 'selected' : ''}>Sunday</option></select></div></div>
  </section>
  <section class="card"><h3>Data</h3>
    <p class="muted">${counts.t} tasks and ${counts.h} habits on this device.</p>
    <div class="btnrow"><button class="btn ghost" data-act="set-export">Download a copy (JSON)</button><button class="btn danger ghost" data-act="set-reset">Clear this device</button></div>
    <p class="muted small">Clearing only removes the copy on this device. Your data stays in GitHub and returns on the next sync.</p>
  </section>`;
}

registerFields({
  'set:token': () => {},
  'set:owner': (el) => setCfg({ owner: el.value.trim() }),
  'set:repo': (el) => setCfg({ repo: el.value.trim() }),
  'set:theme': (el) => { setCfg({ theme: el.value }); applyTheme(); },
  'set:week': (el) => { setCfg({ weekStart: Number(el.value) }); },
});

registerActions({
  'sync-now': () => { syncNow(); },
  'set-connect': async (el) => {
    const tokenEl = document.querySelector('[data-field="set:token"]');
    const token = tokenEl?.value.trim();
    const owner = document.querySelector('[data-field="set:owner"]')?.value.trim() || getCfg().owner;
    const repo = document.querySelector('[data-field="set:repo"]')?.value.trim() || getCfg().repo;
    const next = setCfg({ owner, repo, ...(token ? { token } : {}) });
    if (!next.token) { toast('Paste your access token first'); return; }
    el.disabled = true;
    const err = await testConnection(next);
    el.disabled = false;
    if (err) { toast(err); return; }
    if (tokenEl) tokenEl.value = '';
    await syncNow();
    toast(status.state === 'ok' ? 'Connected and synced' : 'Saved, but sync failed: ' + (status.message || status.state));
    rerender();
  },
  'set-disconnect': (el) => { if (!armed(el, 'Tap again to disconnect')) return; setCfg({ token: '' }); status.state = 'off'; status.message = ''; toast('Disconnected. Data stays on this device'); rerender(); },
  'set-export': () => {
    const blob = new Blob([S.serialize(S.getDb())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `daybook-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  'set-reset': (el) => {
    if (!armed(el, 'Tap again to clear this device')) return;
    localStorage.removeItem('daybook.db.v2'); location.reload();
  },
});
