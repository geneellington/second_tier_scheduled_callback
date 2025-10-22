/* ===== Utilities ===== */
const pad2 = (n) => String(n).padStart(2, '0');
const fmtLocalDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const fmtLocalTime = (d) => `${pad2(d.getHours())}:${pad2(Math.floor(d.getMinutes()/10)*10)}`;

function uuidv4() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); }
function sortTimesAsc(a, b){ const [ah, am] = a.split(':').map(Number); const [bh, bm] = b.split(':').map(Number); return ah !== bh ? ah - bh : am - bm; }
function minutesOfDay(h, m) { return h * 60 + m; }
function getHM(entry){
  if (Array.isArray(entry.hm) && entry.hm.length === 2) return entry.hm;
  if (typeof entry.timeLocal === 'string' && entry.timeLocal.includes(':')){
    const [hh, mm] = entry.timeLocal.split(':').map(Number);
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) return [hh, mm];
  }
  return [0,0];
}

// Convert a wall time in a given TZ to a UTC ISO string
function tzWallToUtc(y, mo, da, hh, mm, zone){
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  const desiredUtc = Date.UTC(y, mo-1, da, hh, mm, 0, 0);
  function wall(ms){ const parts = dtf.formatToParts(new Date(ms)); const map = {}; for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value; return { y: +map.year, m: +map.month, d: +map.day, h: +map.hour, mi: +map.minute, s: +map.second }; }
  let t = desiredUtc; let w = wall(t);
  let actualUtc = Date.UTC(w.y, w.m-1, w.d, w.h, w.mi, w.s, 0);
  let delta = desiredUtc - actualUtc; t += delta; w = wall(t); actualUtc = Date.UTC(w.y, w.m-1, w.d, w.h, w.mi, w.s, 0); delta = desiredUtc - actualUtc; t += delta;
  return new Date(t).toISOString().replace('.000Z','Z');
}

function minuteKey(iso){ try { const d = new Date(iso); d.setSeconds(0,0); return d.toISOString().replace('.000Z','Z'); } catch { return iso; } }
function labelFromIso(iso, zone){
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour:'2-digit', minute:'2-digit', hour12:false });
  const parts = dtf.formatToParts(new Date(iso));
  const map = {}; for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;
  const hh = Number(map.hour), mm = Number(map.minute);
  return { hh, mm, label: `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}` };
}

function toE164(raw){
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('+')) {
    // keep + and digits
    return '+' + s.replace(/[^\d]/g,'');
  }
  const d = s.replace(/\D/g,'');
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length === 10) return '+1' + d;
  if (d.length >= 8) return '+' + d; // fallback for simple intl
  return '+' + d;
}
function prettyPhone(e164){
  if (!e164) return '';
  const d = e164.replace(/[^\d]/g,'');
  if (e164.startsWith('+1') && d.length >= 11) {
    const ten = d.slice(-10);
    return `(${ten.slice(0,3)}) ${ten.slice(3,6)}-${ten.slice(6)}`;
  }
  return '+' + d;
}

function maskPhone(p){ if(!p) return ''; const d = String(p).replace(/\D/g,''); return d.length >= 4 ? '…' + d.slice(-4) : p; }

/* ===== Store (localStorage + optional API) ===== */
const Store = (() => {
  const sKey = 'ts_entries_v1';
  const settingsKey = 'ts_settings_v1';
  const uiKey = 'ts_ui';
  const configKey = 'ts_config_v1';

  function safeParseLS(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Corrupt localStorage for', key, e);
      try { localStorage.removeItem(key); } catch(_){ }
      return fallback;
    }
  }

  const getSettings = () => safeParseLS(settingsKey, {});
  const saveSettings = (obj) => localStorage.setItem(settingsKey, JSON.stringify(obj));

  const getUi = () => safeParseLS(uiKey, {});
  const saveUi = (obj) => localStorage.setItem(uiKey, JSON.stringify(obj));

  const getSavedConfig = () => safeParseLS(configKey, null);
  const saveConfig = (obj) => localStorage.setItem(configKey, JSON.stringify(obj));
  const clearConfig = () => localStorage.removeItem(configKey);
  const clearUi = () => localStorage.removeItem(uiKey);

  const list = (date) => { const all = safeParseLS(sKey, {}); return all[date] || []; };
  const put = (date, entry) => { const all = safeParseLS(sKey, {}); if (!all[date]) all[date] = []; all[date].push(entry); localStorage.setItem(sKey, JSON.stringify(all)); };

  const remove = (date, id) => { const all = safeParseLS(sKey, {}); if (!all[date]) return; all[date] = all[date].filter(e => e.id !== id); localStorage.setItem(sKey, JSON.stringify(all)); };

  const update = (date, id, patch) => { const all = safeParseLS(sKey, {}); if (!all[date]) return; all[date] = all[date].map(e => e.id === id ? { ...e, ...patch } : e); localStorage.setItem(sKey, JSON.stringify(all)); };

    async function apiUpdate(base, useApi, id, patch, scheduledAtUtc) {
    if (!useApi || !base) return { ok: true };
    try {
      const curDate = scheduledAtUtc.slice(0, 10);
      const curTime = scheduledAtUtc.slice(11, 16);
      const res = await fetch(`${base}/entries/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentDate: curDate,
          currentTime: curTime,
          ...patch
        })
      });
      if (!res.ok) throw new Error(await res.text());
      return { ok: true };
    } catch (err) {
      console.error('API update failed:', err);
      alert('API update failed: ' + (err && err.message ? err.message : err));
      return { ok: false };
    }
  }


  async function apiDelete(base, useApi, id, scheduledAtUtc) {
    if (!useApi || !base) return { ok: true };
    try {
      const d = scheduledAtUtc.slice(0, 10);
      const t = scheduledAtUtc.slice(11, 16);
      const res = await fetch(`${base}/entries/${encodeURIComponent(id)}?date=${encodeURIComponent(d)}&time=${encodeURIComponent(t)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(await res.text());
      return { ok: true };
    } catch (err) {
      console.error('API delete failed:', err);
      alert('API delete failed: ' + (err && err.message ? err.message : err));
      return { ok: false };
    }
  }

  async function apiCreate(base, useApi, entry) {
    if (!useApi || !base) return { ok: true, id: entry.id };

    try {
      const d = entry.scheduledAt.slice(0, 10);
      const t = entry.scheduledAt.slice(11, 16);

      // --- TZ: use the UI-selected timezone for the customer ---
      const tzId =
        (typeof currentTz === 'function' && currentTz()) ||
        (tzSelect && tzSelect.value) ||
        (Intl.DateTimeFormat().resolvedOptions().timeZone) ||
        'UTC';

      // For now we use the same string for display; you can later map it to “Arizona Time”, etc.
      const tzLabel = tzId;
      // ---------------------------------------------------------

      const body = {
        id: entry.id,
        date: d,
        time: t,
        groupKey: entry.queueKey,
        customer: entry.customerName || entry.name || "",
        phone: entry.phone,
        agentId: entry.agentId || "",
        notes: entry.notes || "",
        capacityKey: entry.capacityKey || "default",

        // --- NEW fields we send to backend ---
        customerTz: tzId || undefined,
        customerTzLabel: tzLabel || undefined
      };

      const res = await fetch(`${base}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(text || res.statusText);
      const json = text ? JSON.parse(text) : {};
      return { ok: true, id: json.id || entry.id, server: json };
    } catch (err) {
      console.error("API create failed:", err);
      alert("API create failed: " + (err && err.message ? err.message : err));
      return { ok: false };
    }
  }



  const clearAll = () => { try { localStorage.removeItem(sKey); localStorage.removeItem(settingsKey); localStorage.removeItem(uiKey); localStorage.removeItem(configKey); } catch(_){} };

  return {
    list, put, remove, update,
    getSettings, saveSettings, getUi, saveUi,
    getSavedConfig, saveConfig, clearConfig, clearUi,
    apiCreate, apiUpdate, apiDelete, clearAll
  };


})();

/* ===== Capacity / Config ===== */
let capacity = { default: 2 };    // legacy uniform capacity
let capacityGroups = null;        // v2 groups

async function loadCapacity() {
  try {
    const res = await fetch('capacity.json', { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      if (json && json.version >= 2 && json.groups) capacityGroups = json.groups;
      else capacity = json || capacity;
    }
  } catch (_) { /* ignore */ }
}

function applyConfig(obj){
  if (!obj) return;

  // Capacity model
  if (obj.version >= 2 && obj.groups) {
    capacityGroups = obj.groups;
  } else if (obj.capacity) {
    capacity = obj.capacity;
  }

  // NEW: API base + defaults + locks
  const cur  = Store.getSettings() || {};
  const next = { ...cur };
  const d    = obj.defaults || {};
  const lock = obj.lock || {};

  // Helper to apply a default and optionally lock the UI control
  function applyField(key, val, lockFlag, el, onSet){
    if (lockFlag) {
      if (val != null) next[key] = val;           // enforce central value
      if (el) { el.disabled = true; el.title = 'Managed by configuration'; if (val != null && 'value' in el) el.value = val; }
      if (onSet) onSet(val);
      return;
    }
    // Not locked → seed only if user hasn’t set it yet
    if (cur[key] == null && val != null) {
      next[key] = val;
      if (el && 'value' in el) el.value = val;
      if (onSet) onSet(val);
    }
  }

  // API base
  if (obj.apiBase) {
    next.apiBase = obj.apiBase;
    next.useApi  = true;
    if (typeof apiBaseEl !== 'undefined' && apiBaseEl) {
      apiBaseEl.value = obj.apiBase;
      apiBaseEl.disabled = lock.apiBase === true;
      apiBaseEl.title = lock.apiBase ? 'Managed by configuration' : '';
    }
    if (typeof useApiEl !== 'undefined' && useApiEl) useApiEl.checked = true;
  }

  // Defaults (tz, capTz, queueKey, notifyAhead)
  applyField('tz', d.tz, !!lock.tz, tzSelect);
  applyField('capTz', d.capTz, !!lock.capTz, capTzSelect);
  applyField('queueKey', d.queueKey, !!lock.queueKey, queueSelect, (v) => {
    if (queueSelectTop && v != null) queueSelectTop.value = v;
  });
  applyField('notifyAhead', d.notifyAhead, !!lock.notifyAhead, notifyAheadEl);

  Store.saveSettings(next);

  populateQueues();
  flashTag('Config loaded');
  try { Store.saveConfig(obj); } catch(_) {}
}


async function loadConfigFromUrl(url){
  try { const res = await fetch(url, { cache: 'no-store' }); if (!res.ok) throw new Error(`HTTP ${res.status}`); const json = await res.json(); applyConfig(json); }
  catch (e) { alert('Failed to load config: ' + e.message); }
}

function loadConfigFromFile(file){ const reader = new FileReader(); reader.onload = () => { try { const json = JSON.parse(reader.result); applyConfig(json); } catch(e){ alert('Invalid JSON: ' + e.message); } }; reader.readAsText(file); }

/* ===== App State / Elements ===== */
const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const containerEl = document.getElementById('container');
const dateEl = document.getElementById('date');
const dateTop = document.getElementById('dateTop');
const slotsEl = document.getElementById('slots');
const dateTag = document.getElementById('dateTag');
const tzTag = document.getElementById('tzTag');
const localDateEl = document.getElementById('localDate');
const utcDateEl = document.getElementById('utcDate');

const entriesTbody = document.getElementById('entriesTbody');
const entryCount = document.getElementById('entryCount');

// Modal
const modal = document.getElementById('entryModal');
const modalSlotLabel = document.getElementById('modalSlotLabel');
const closeModalBtn = document.getElementById('closeModal');
const cancelBtn = document.getElementById('cancelBtn');
const createBtn = document.getElementById('createBtn');
const deleteBtn = document.getElementById('deleteBtn');
const modalTitle = document.querySelector('#entryModal .modal-header h3');

const mLocalDate = document.getElementById('mLocalDate');
const mLocalTime = document.getElementById('mLocalTime');
const mTz = document.getElementById('mTz');
const mScheduledAt = document.getElementById('mScheduledAt');
const mNotifyAt = document.getElementById('mNotifyAt');
const mPhone = document.getElementById('mPhone');
const mAgent = document.getElementById('mAgent');
const mNotes = document.getElementById('mNotes');
const mName = document.getElementById('mName');

// Settings
const apiBaseEl = document.getElementById('apiBase');
const notifyAheadEl = document.getElementById('notifyAhead');
const useApiEl = document.getElementById('useApi');
const saveSettingsBtn = document.getElementById('saveSettings');
const tzSelect = document.getElementById('tzSelect');
const capTzSelect = document.getElementById('capTzSelect');
const queueSelect = document.getElementById('queueSelect');
const queueSelectTop = document.getElementById('queueSelectTop');
const toggleConfigBtn = document.getElementById('toggleConfigBtn');
const configUrlEl = document.getElementById('configUrl');
const loadConfigBtn = document.getElementById('loadConfigBtn');
const configFileInput = document.getElementById('configFile');
const resetConfigBtn = document.getElementById('resetConfigBtn');
const resetLayoutBtn = document.getElementById('resetLayoutBtn');

let selectedSlot = null; // { hour, minute }
let selectedCtx = null;  // { queueKey, queueName, queueArn, utcIso }
let creating = false;    // debounce create
let editEntryId = null;  // when not null, modal is in edit mode
let viewEntryId = null; // id of entry opened from chip

function currentTz(){ const s = Store.getSettings(); return (s && s.tz) ? s.tz : sysTz; }
function capacityTz(){ const s = Store.getSettings(); return (s && s.capTz) ? s.capTz : 'America/New_York'; }

function populateTimezoneOptions(){
  const list = (Intl.supportedValuesOf && Intl.supportedValuesOf('timeZone')) ||
    ['UTC','America/New_York','America/Chicago','America/Denver','America/Phoenix','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney'];
  if (tzSelect) {
    tzSelect.innerHTML = list.map(z => `<option value="${z}">${z}</option>`).join('');
    const s = Store.getSettings(); const def = (s && s.tz) || sysTz || 'UTC';
    tzSelect.value = list.includes(def) ? def : 'UTC';
  }
  if (capTzSelect) {
    capTzSelect.innerHTML = list.map(z => `<option value="${z}">${z}</option>`).join('');
    const s = Store.getSettings(); const defCap = (s && s.capTz) || 'America/New_York';
    capTzSelect.value = list.includes(defCap) ? defCap : 'America/New_York';
  }
}

function populateQueues(){
  const s = Store.getSettings();
  let options = [];
  if (capacityGroups) { options = Object.entries(capacityGroups).map(([key, g]) => ({ key, name: (g.displayName || (g.queue && g.queue.name) || key) })); }
  else { options = [{ key: 'default', name: 'Default' }]; }

  const html = options.map(o => `<option value="${o.key}">${o.name}</option>`).join('');
  queueSelect.innerHTML = html;
  queueSelectTop.innerHTML = html;

  const def = (s && s.queueKey) || (options[0] && options[0].key);
  if (def) { queueSelect.value = def; queueSelectTop.value = def; }
}

function loadSettings() {
  const s = Store.getSettings();
  if (s.apiBase) apiBaseEl.value = s.apiBase;
  if (typeof s.notifyAhead === 'number') notifyAheadEl.value = s.notifyAhead;
  if (typeof s.useApi === 'boolean') useApiEl.checked = s.useApi;
  if (s.tz && tzSelect) tzSelect.value = s.tz;
  if (s.capTz && capTzSelect) capTzSelect.value = s.capTz;
  if (s.queueKey && queueSelect) { queueSelect.value = s.queueKey; if (queueSelectTop) queueSelectTop.value = s.queueKey; }
  if (configUrlEl && s.configUrl) configUrlEl.value = s.configUrl;
  if (s.date) { dateEl.value = s.date; if (dateTop) dateTop.value = s.date; }
}

function saveSettings() {
  Store.saveSettings({
    apiBase: apiBaseEl.value.trim(),
    notifyAhead: Number(notifyAheadEl.value) || 0,
    useApi: !!useApiEl.checked,
    tz: tzSelect ? tzSelect.value : undefined,
    capTz: capTzSelect ? capTzSelect.value : undefined,
    configUrl: configUrlEl ? configUrlEl.value.trim() : undefined,
    queueKey: queueSelect ? queueSelect.value : undefined,
    date: dateEl ? dateEl.value : undefined
  });
}

// UI collapse state
function updateToggleTitle(){ const collapsed = containerEl.classList.contains('config-collapsed'); toggleConfigBtn.title = collapsed ? 'Show settings panel' : 'Hide settings panel'; toggleConfigBtn.setAttribute('aria-pressed', (!collapsed).toString()); }
function setCollapsed(collapsed){ containerEl.classList.toggle('config-collapsed', collapsed); Store.saveUi({ collapsed }); updateToggleTitle(); }
function restoreUi(){ const ui = Store.getUi(); if (ui && typeof ui.collapsed === 'boolean') { containerEl.classList.toggle('config-collapsed', ui.collapsed); } updateToggleTitle(); }

function ensureDate() {
  if (!dateEl.value) {
    const today = new Date();
    dateEl.value = fmtLocalDate(today);
    if (dateTop) dateTop.value = dateEl.value;
  }
}

function updateDateTags() {
  ensureDate();
  const d = dateEl.value; const parts = (d || '').split('-');
  const y = Number(parts[0]), m = Number(parts[1]), da = Number(parts[2]);
  const dt = new Date(isFinite(y)?y:NaN, isFinite(m)?(m-1):NaN, isFinite(da)?da:NaN);
  dateTag.textContent = isNaN(dt) ? 'Invalid date' : dt.toDateString();
  tzTag.textContent = currentTz();
  let midnightUtcIso = null; try { midnightUtcIso = tzWallToUtc(y, m, da, 0, 0, currentTz()); } catch(_) {}
  if (midnightUtcIso) {
    const localFmt = new Intl.DateTimeFormat(undefined, { timeZone: currentTz(), weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    localDateEl.textContent = localFmt.format(new Date(midnightUtcIso));
    utcDateEl.textContent = new Date(midnightUtcIso).toUTCString();
  } else {
    localDateEl.textContent = '-';
    utcDateEl.textContent = '-';
  }
}

// Attach entry id + UTC ISO to the chip's "×" button by looking up today's entries.
// Does NOT require h/m; it derives the time from the closest cell (data-time or text).
function attachChipData(chip, nm, phone) {
  try {
    const btn = chip.querySelector('button.kill');
    if (!btn) return;

    // Try to read the slot time from the containing cell
    let timeKey = '';
    const cell = chip.closest('[data-time], td, div, section');
    if (cell && cell.getAttribute) {
      timeKey = cell.getAttribute('data-time') || (cell.dataset && cell.dataset.time) || '';
    }
    // Fallback: parse any HH:MM visible in the cell’s text
    if (!timeKey && cell) {
      const txt = (cell.querySelector('.time-label')?.textContent || cell.textContent || '');
      const m = txt.match(/\b(\d{1,2}):(\d{2})\b/);
      if (m) timeKey = `${m[1].padStart(2,'0')}:${m[2]}`;
    }

    const day  = (typeof dateEl !== 'undefined' && dateEl && dateEl.value) || '';
    const list = (typeof Store !== 'undefined' && Store.list) ? (Store.list(day) || []) : [];

    const norm   = s => (s || '').replace(/\D+/g, '');
    const digits = norm(phone);
    const name   = String(nm || '').trim();

    const sameTime = x => timeKey ? ((x.timeLocal || '').slice(0,5) === timeKey) : true;

    // 1) phone match at that time
    let found = digits ? list.find(x =>
      sameTime(x) &&
      (norm(x.phone) === digits || norm(x.phoneDisplay) === digits)
    ) : null;

    // 2) name match at that time
    if (!found && name) {
      found = list.find(x => sameTime(x) && String(x.customerName || x.name || '').trim() === name);
    }

    // 3) any entry at that time
    if (!found && timeKey) {
      found = list.find(x => (x.timeLocal || '').slice(0,5) === timeKey);
    }

    if (found) {
      btn.dataset.id  = found.id || '';
      const hhmm = (found.time || found.timeLocal || timeKey || '00:00').slice(0,5);
      btn.dataset.iso = found.scheduledAt || `${found.date}T${hhmm}:00Z`;
    }
  } catch (_) {
    // silently ignore; click handler will alert if data is still missing
  }
}


function buildSlots() {
  const dateStr = dateEl.value;
  const entries = Store.list(dateStr);
  slotsEl.innerHTML = '';

  let times = [];
  let capacityFor = (hhmm) => (capacity && capacity.default) ? Number(capacity.default) : 2;
  let qMeta = { name: 'Default', arn: undefined, key: 'default' };

  const [y, mo, da] = dateStr.split('-').map(Number);

  if (capacityGroups && queueSelect && queueSelect.value && capacityGroups[queueSelect.value]) {
    const group = capacityGroups[queueSelect.value];
    qMeta = { name: group.displayName || (group.queue && group.queue.name) || queueSelect.value, arn: group.queue && group.queue.arn, key: queueSelect.value };
    times = Object.keys(group.slots || {}).sort(sortTimesAsc);
    capacityFor = (hhmm) => Number(group.slots[hhmm] || 0);

    // Slot objects (UTC-anchored), display in current TZ
    const slotObjs = times.map(hhmm => {
      const [h, m] = hhmm.split(':').map(Number);
      const utcIso = tzWallToUtc(y, mo, da, h, m, capacityTz());
      const disp = labelFromIso(utcIso, currentTz());
      return { baseHHMM: hhmm, utcIso, dispHH: disp.hh, dispMM: disp.mm, dispLabel: disp.label, cap: capacityFor(hhmm) };
    }).sort((a,b) => new Date(a.utcIso) - new Date(b.utcIso));

    const booked = new Map();
    const perSlot = new Map();
    for (const e of entries) {
      const sameQueue = (e.queueKey || 'default') === (qMeta.key || 'default');
      if (!sameQueue || !e.scheduledAt) continue;
      const key = minuteKey(e.scheduledAt);
      booked.set(key, (booked.get(key) || 0) + 1);
      const arr = perSlot.get(key) || []; arr.push(e); perSlot.set(key, arr);
    }

    for (const s of slotObjs) {
      if (!s.cap) continue;
      const key = minuteKey(s.utcIso);
      const b = booked.get(key) || 0; const full = b >= s.cap;
      const div = document.createElement('div');
      div.className = 'slot' + (full ? ' full' : '');
      div.dataset.h = String(s.dispHH); div.dataset.m = String(s.dispMM);
      div.dataset.utc = s.utcIso; div.dataset.base = s.baseHHMM;
      div.dataset.time = `${s.dispHH}:${s.dispMM}`;
      div.title = `${s.baseHHMM} in ${capacityTz()} → ${s.dispLabel} in ${currentTz()}`;
      div.innerHTML = `
        <div><strong>${s.dispLabel}</strong></div>
        <div class="cap">${b} / ${s.cap} booked — <span class="muted">${qMeta.name}</span></div>
        <div><span class="badge">${full ? 'Full' : 'Open'}</span></div>`;
      if (!full) div.addEventListener('click', () => openModal(Number(div.dataset.h), Number(div.dataset.m), div.dataset.utc, s.dispLabel));
      // Render existing entries as chips
      const chips = document.createElement('div');
      chips.className = 'slot-entries';
      const arr = perSlot.get(key) || [];
      for (const ent of arr) {
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.title = `ID: ${ent.id}`;
        const phone = ent.phoneDisplay || prettyPhone(ent.phone || '');
        const nm = (ent.customerName || ent.name || '');
        const ag = ent.agentId ? ` • A:${ent.agentId}` : '';
        chip.innerHTML = `<span class="meta">${nm ? nm + ' — ' : '' }${phone}${ag}</span> <button type="button" class="kill" title="Delete" aria-label="Delete">×</button>`;
        const killBtn = chip.querySelector('button.kill');
        killBtn.dataset.id  = ent.id || '';
        killBtn.dataset.iso = ent.scheduledAt || div.dataset.utc || '';
        attachChipData(chip, nm, phone);
        chip.addEventListener('click', (ev) => { ev.stopPropagation(); openEntry(ent); });
        chips.appendChild(chip);
      }
      div.appendChild(chips);
      slotsEl.appendChild(div);
    }
    return;
  }

  // Legacy/uniform capacity: show every 10 minutes in current TZ
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 10) times.push(`${pad2(h)}:${pad2(m)}`);

  const booked = new Map();
  const perLegacy = new Map();
  for (const e of entries) {
    const hm = getHM(e); const hhmm = `${pad2(hm[0])}:${pad2(hm[1])}`;
    booked.set(hhmm, (booked.get(hhmm) || 0) + 1);
    const arr = perLegacy.get(hhmm) || []; arr.push(e); perLegacy.set(hhmm, arr);
  }

  for (const hhmm of times) {
    const [h, m] = hhmm.split(':').map(Number);
    const cap = capacityFor(hhmm);
    const b = booked.get(hhmm) || 0; const full = b >= cap;
    const div = document.createElement('div');
    div.className = 'slot' + (full ? ' full' : '');
    div.setAttribute('data-h', h); div.setAttribute('data-m', m);
    div.innerHTML = `
      <div><strong>${hhmm}</strong></div>
      <div class="cap">${b} / ${cap} booked — <span class="muted">${qMeta.name}</span></div>
      <div><span class="badge">${full ? 'Full' : 'Open'}</span></div>`;
    if (!full) { div.addEventListener('click', () => openModal(h, m)); div.title = 'Click to create entry'; }
    const chips = document.createElement('div');
    chips.className = 'slot-entries';
    const arr = perLegacy.get(hhmm) || [];
    for (const ent of arr) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.title = `ID: ${ent.id}`;
      const phone = ent.phoneDisplay || prettyPhone(ent.phone || '');
      const nm = (ent.customerName || ent.name || '');
      const ag = ent.agentId ? ` • A:${ent.agentId}` : '';
      chip.innerHTML = `<span class="meta">${nm ? nm + ' — ' : '' }${phone}${ag}</span> <button type="button" class="kill" title="Delete" aria-label="Delete">×</button>`;
      const killBtn = chip.querySelector('button.kill');
      killBtn.dataset.id  = ent.id || '';
      killBtn.dataset.iso = ent.scheduledAt || div.dataset.utc || '';
      attachChipData(chip, nm, phone);
      chip.addEventListener('click', (ev) => { ev.stopPropagation(); openEntry(ent); });
      chips.appendChild(chip);
    }
    div.appendChild(chips);
    slotsEl.appendChild(div);
  }
}

function renderEntries() {
  const dateStr = dateEl.value;
  const entries = Store.list(dateStr).slice();
  entries.sort((a,b) => minutesOfDay(...getHM(a)) - minutesOfDay(...getHM(b)));
  entriesTbody.innerHTML = '';
  for (const e of entries) {
    const tr = document.createElement('tr');
    const notesSafe = e.notes ? String(e.notes).replace(/</g,'&lt;') : '';
  tr.innerHTML = `
    <td>${e.timeLocal || (getHM(e).map(n=>String(n).padStart(2,'0')).join(':'))}</td>
    <td><code>${e.scheduledAt || ''}</code></td>
    <td><code>${e.notifyAt || ''}</code></td>
    <td>${e.customerName || e.name || ''}</td>
    <td title="${e.phone || ''}">${e.phoneDisplay || prettyPhone(e.phone || '')}</td>
    <td>${e.queueName || e.queueId || ''}</td>
    <td>${notesSafe}</td>
    <td><code>${e.id || ''}</code></td>
    <td>
      <button
        type="button"
        class="entry-del"
        title="Delete"
        aria-label="Delete"
        data-id="${e.id || ''}"
        data-iso="${e.scheduledAt || ''}"
      >×</button>
    </td>`;
    entriesTbody.appendChild(tr);
  }
  entryCount.textContent = String(entries.length);
}

function openModal(h, m, scheduledIsoOverride, displayLabel) {
  selectedSlot = { hour: h, minute: m };
  const [y, mo, da] = dateEl.value.split('-').map(Number);
  const scheduledAt = scheduledIsoOverride || tzWallToUtc(y, mo, da, h, m, currentTz());

  // Lock queue context at click time
  selectedCtx = (() => {
    let qk = 'default', qn = 'Default', qa;
    if (capacityGroups && queueSelect && capacityGroups[queueSelect.value]) {
      const g = capacityGroups[queueSelect.value];
      qk = queueSelect.value; qn = g.displayName || (g.queue && g.queue.name) || qk; qa = g.queue && g.queue.arn;
    }
    return { queueKey: qk, queueName: qn, queueArn: qa, utcIso: scheduledAt };
  })();

  // Derive local display
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: currentTz(), year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
  const parts = dtf.formatToParts(new Date(scheduledAt));
  const map = {}; for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;

  modalSlotLabel.textContent = displayLabel || `${pad2(h)}:${pad2(m)}`;
  mLocalDate.value = `${map.year}-${map.month}-${map.day}`;
  mLocalTime.value = `${map.hour}:${map.minute}`;
  mTz.value = currentTz();
  mScheduledAt.value = scheduledAt;

  const ahead = Number(Store.getSettings().notifyAhead) || Number(notifyAheadEl.value) || 0;
  mNotifyAt.value = new Date(Date.parse(scheduledAt) - ahead * 60000).toISOString().replace('.000Z','Z');

  // clear inputs
  mPhone.value = '';
  if (mName) mName.value = '';
  mAgent.value = '';
  mNotes.value = '';

  // CREATE mode UI
  if (modalTitle) modalTitle.textContent = 'Create Entry';
  if (createBtn) { createBtn.textContent = 'Create Entry'; createBtn.disabled = false; }
  if (deleteBtn) { deleteBtn.style.display = 'none'; deleteBtn.disabled = true; }

  editEntryId = null;
  modal.showModal();
}


function closeModal() { modal.close(); selectedCtx = null; selectedSlot = null; editEntryId = null; }

async function apiCreateInline(base, useApi, entry) {
  if (!useApi || !base) return { ok: true, id: entry.id };

  try {
    const d = entry.scheduledAt.slice(0, 10);
    const t = entry.scheduledAt.slice(11, 16);

    // --- TZ: use the UI-selected timezone for the customer ---
    const tzId =
      (typeof currentTz === 'function' && currentTz()) ||
      (tzSelect && tzSelect.value) ||
      (Intl.DateTimeFormat().resolvedOptions().timeZone) ||
      'UTC';

    // For now we use the same string for display; you can later map it to “Arizona Time”, etc.
    const tzLabel = tzId;
    // ---------------------------------------------------------

    const body = {

      id: entry.id,
      date: d,
      time: t,
      groupKey: entry.queueKey,
      customer: entry.customerName || entry.name || "",
      phone: entry.phone,
      agentId: entry.agentId || "",
      notes: entry.notes || "",
      capacityKey: entry.capacityKey || "default",
      customerTz: tzId || undefined,
      customerTzLabel: tzLabel || undefined
    };

    const res = await fetch(`${base}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    if (!res.ok) throw new Error(text || res.statusText);
    const json = text ? JSON.parse(text) : {};
    return { ok: true, id: json.id || entry.id, server: json };
  } catch (err) {
    console.error('API create failed:', err);
    alert('API create failed: ' + (err?.message || err));
    return { ok: false };
  }
}


async function createEntry() {
  if (creating) return;
  creating = true;
  try {
    if (!selectedSlot) return;

    // Define name first, then validate
    const customerName = (mName && mName.value.trim()) || '';
    if (!customerName) { alert("Please enter the customer's name."); return; }

    // Then the rest of your inputs
    const rawPhone = mPhone.value.trim();
    const notes = mNotes.value.trim();
    const agent = mAgent.value.trim() || undefined;

    // Use locked queue context if present
    let queueKey = 'default', queueName = 'Default', queueArn = undefined;
    if (selectedCtx) { queueKey = selectedCtx.queueKey; queueName = selectedCtx.queueName; queueArn = selectedCtx.queueArn; }

    // E.164 for payload; pretty for display
    const e164 = toE164(rawPhone);

    const entry = {
      id: uuidv4(),
      date: dateEl.value,
      timeLocal: `${pad2(selectedSlot.hour)}:${pad2(selectedSlot.minute)}`,
      hm: [selectedSlot.hour, selectedSlot.minute],
      scheduledAt: (selectedCtx && selectedCtx.utcIso) || mScheduledAt.value,
      notifyAt: mNotifyAt.value,
      phone: e164,
      phoneDisplay: prettyPhone(e164),
      notes,
      customerName,
      name: customerName, // back-compat alias
      agentId: agent,
      queueKey,
      queueName,
      queueArn,
      capacityKey: 'default',
      createdAt: new Date().toISOString()
    };

    if (createBtn) createBtn.disabled = true;

    const settings = Store.getSettings();               // you already have this function
    const base = settings.apiBase;
    const useApi = settings.useApi;
    const resp = await apiCreateInline(base, useApi, entry);
    if (!resp.ok) return;


    // Adopt server-generated values so PATCH/DELETE target the real record
    if (resp.id && resp.id !== entry.id) entry.id = resp.id;
    if (resp.server && resp.server.scheduledAt) entry.scheduledAt = resp.server.scheduledAt;

    Store.put(dateEl.value, entry);
    renderEntries();
    buildSlots();
    closeModal();
  } catch (err) {
    console.error('Create entry failed', err);
    alert('Create entry failed: ' + err.message);
  } finally {
    if (createBtn) createBtn.disabled = false;
    creating = false;
  }
}

// === API-read helpers (paste right above the Events block) ===
function normalizeFromServer(e) {
  const [hh, mm] = (e.time || '00:00').split(':').map(x => parseInt(x, 10));
  const phone = e.phone || '';
  const scheduledAt = e.scheduledAt || `${e.date}T${e.time}:00Z`;
  return {
    id: e.id,
    date: e.date,
    timeLocal: e.time,
    hm: [hh, mm],
    scheduledAt,
    notifyAt: e.notifyAt || null,
    phone,
    phoneDisplay: (typeof prettyPhone === 'function') ? prettyPhone(phone) : phone,
    notes: e.notes || '',
    customerName: e.customer || e.customerName || e.name || '',
    name: e.customer || e.customerName || e.name || '',
    agentId: e.agentId || '',
    queueKey: e.groupKey || e.queueKey || 'default',
    queueName: e.queueName || 'Default',
    queueArn: e.queueArn,
    capacityKey: e.capacityKey || 'default',
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || e.createdAt || null
  };
}

function replaceDay(date, entries) {
  try {
    const existing = (Store.list && Store.list(date)) || [];
    if (Store.remove) for (const ex of existing) Store.remove(date, ex.id);
    if (Store.put) for (const it of entries) Store.put(date, it);
  } catch (err) {
    console.error('replaceDay failed', err);
  }
}

async function loadFromApi(date) {
  try {
    const s = Store.getSettings ? Store.getSettings() : {};
    const base = s.apiBase;
    if (!base) return;

    const res = await fetch(`${base}/entries?date=${encodeURIComponent(date)}`);
    const text = await res.text();
    if (!res.ok) throw new Error(text || res.statusText);
    const serverItems = text ? JSON.parse(text) : [];
    const normalized = serverItems.map(normalizeFromServer);

    replaceDay(date, normalized);
    renderEntries();
    buildSlots();
  } catch (err) {
    console.error('loadFromApi failed', err);
  }
}


// Shared helper: delete by server id + UTC ISO (used by both tables and timeslot chips)
async function deleteByIdIso(id, iso) {
  if (!id || !iso) throw new Error('Missing id or timestamp (ISO).');

  const d = iso.slice(0,10);   // YYYY-MM-DD
  const t = iso.slice(11,16);  // HH:MM

  const settings = Store.getSettings ? Store.getSettings() : {};
  const base = settings.apiBase;
  if (!base) throw new Error('API Base URL is not set (Settings → API Base URL).');

  const url = `${base}/entries/${encodeURIComponent(id)}?date=${encodeURIComponent(d)}&time=${encodeURIComponent(t)}`;
  const res = await fetch(url, { method: 'DELETE' });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
}


/* ===== Events ===== */
function bindEventsOnce(){
  if (window.__tsEventsBound) return;
  window.__tsEventsBound = true;

  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => { saveSettings(); flashTag('Saved'); updateDateTags(); buildSlots(); renderEntries(); });
  if (tzSelect) tzSelect.addEventListener('change', () => { saveSettings(); updateDateTags(); buildSlots(); renderEntries(); });
  if (capTzSelect) capTzSelect.addEventListener('change', () => { saveSettings(); buildSlots(); renderEntries(); });
  if (queueSelect) queueSelect.addEventListener('change', () => { if (queueSelectTop) queueSelectTop.value = queueSelect.value; saveSettings(); buildSlots(); renderEntries(); });
  if (queueSelectTop) queueSelectTop.addEventListener('change', () => { if (queueSelect) queueSelect.value = queueSelectTop.value; saveSettings(); buildSlots(); renderEntries(); });
  // --- Date change wiring: fetch entries from API whenever the date changes ---
  if (dateEl) dateEl.addEventListener('change', async () => {
    if (dateTop) dateTop.value = dateEl.value;
    saveSettings(); updateDateTags(); buildSlots(); renderEntries();
    await loadFromApi(dateEl.value);   // ← added
  });

  if (dateTop) dateTop.addEventListener('change', async () => {
    if (dateEl) dateEl.value = dateTop.value;
    saveSettings(); updateDateTags(); buildSlots(); renderEntries();
    await loadFromApi(dateTop.value);  // ← added
  });

  if (toggleConfigBtn) toggleConfigBtn.addEventListener('click', () => { const collapsed = containerEl.classList.contains('config-collapsed'); setCollapsed(!collapsed); });
  if (loadConfigBtn) loadConfigBtn.addEventListener('click', () => { const url = (configUrlEl && configUrlEl.value.trim()); if (url) { saveSettings(); loadConfigFromUrl(url); } });
  if (configFileInput) configFileInput.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) loadConfigFromFile(f); });
  if (resetConfigBtn) resetConfigBtn.addEventListener('click', () => { capacityGroups = null; Store.clearConfig(); flashTag('Config cleared'); populateQueues(); buildSlots(); });
  if (resetLayoutBtn) resetLayoutBtn.addEventListener('click', () => { Store.clearUi(); containerEl.classList.remove('config-collapsed'); updateToggleTitle(); flashTag('Layout reset'); });

  // Modal
  if (closeModalBtn) closeModalBtn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
  if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });

// Primary button: create vs update
  if (createBtn) createBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (editEntryId) {
      await updateEntry();
    } else {
      await createEntry();
    }
  });

  // Calls API DELETE using the entry's exact UTC instant (date+time) so DynamoDB deletes the right row
  async function apiDeleteInline(base, useApi, id, curIso) {
    if (!useApi || !base) return { ok: true }; // local-only mode

    const d = curIso.slice(0, 10);   // YYYY-MM-DD
    const t = curIso.slice(11, 16);  // HH:MM

    const res = await fetch(`${base}/entries/${encodeURIComponent(id)}?date=${encodeURIComponent(d)}&time=${encodeURIComponent(t)}`, {
      method: 'DELETE'
    });

    const text = await res.text();
    if (!res.ok) throw new Error(text || res.statusText);
    return { ok: true };
  }



  // Delete button (only works in edit mode)
  if (deleteBtn) deleteBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!editEntryId) return;
    if (!confirm('Delete this entry?')) return;

    const settings = Store.getSettings();
    const curIso = (selectedCtx && selectedCtx.utcIso) || (mScheduledAt && mScheduledAt.value) || '';

    const resp = await apiDeleteInline(settings.apiBase, settings.useApi, editEntryId, curIso);
    if (!resp.ok) return;

    Store.remove(dateEl.value, editEntryId);
    renderEntries();
    buildSlots();
    closeModal();
  });



  if (deleteBtn) deleteBtn.addEventListener('click', (e) => { e.preventDefault(); if (!viewEntryId) return; if (confirm('Delete this entry?')) { Store.remove(dateEl.value, viewEntryId); renderEntries(); buildSlots(); closeModal(); } });
  if (modal) {
    modal.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
    modal.addEventListener('click', (e) => {
      const rect = modal.getBoundingClientRect();
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) closeModal();
    });
  }
}

/* ===== Error bubble (so failures aren’t silent) ===== */
(function installGlobalErrorSurface(){
  const bubble = document.createElement('div');
  bubble.id = 'appErrorBubble';
  bubble.style.cssText = 'position:fixed;top:12px;right:12px;max-width:420px;background:#2b2f44;color:#fff;border:1px solid rgba(255,255,255,.2);padding:10px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3);font:12px/1.4 ui-sans-serif;z-index:9999;display:none;';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(bubble));
  function show(msg){ bubble.style.display='block'; bubble.innerHTML = `<strong>App script error</strong><br>${msg}`; }
  window.addEventListener('error', (e) => show(`${e.message || e}`));
  window.addEventListener('unhandledrejection', (e) => show(`Promise error: ${(e.reason && e.reason.message) || e.reason || e}`));
})();

async function apiDeleteInline(base, useApi, entry) {
  if (!useApi || !base) return { ok: true };

  // Derive UTC date/time from the entry's scheduledAt (server's canonical instant)
  const iso = entry.scheduledAt || (() => {
    const [y, mo, da] = (entry.date||'').split('-').map(Number);
    const [hh, mm]    = (entry.timeLocal||'00:00').split(':').map(Number);
    return tzWallToUtc(y, mo, da, hh, mm, currentTz());
  })();

  const d = iso.slice(0,10);
  const t = iso.slice(11,16);

  const res = await fetch(`${Store.getSettings().apiBase}/entries/${encodeURIComponent(entry.id)}?date=${encodeURIComponent(d)}&time=${encodeURIComponent(t)}`, {
    method: 'DELETE'
  });

  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return { ok: true };
}



/* ===== Migrations & Start ===== */
function migrateExistingEntries(){
  try {
    const KEY = 'ts_entries_v1';
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    let changed = false;
    for (const d of Object.keys(all)) {
      const arr = all[d];
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (!Array.isArray(e.hm) && typeof e.timeLocal === 'string') {
          const parts = e.timeLocal.split(':');
          const hh = Number(parts[0]), mm = Number(parts[1]);
          if (!Number.isNaN(hh) && !Number.isNaN(mm)) { e.hm = [hh, mm]; changed = true; }
        }
      }
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(all));
  } catch(_) { /* ignore */ }
}

function flashTag(text) {
  const el = document.createElement('span');
  el.className = 'tag';
  el.textContent = text;
  el.style.marginLeft = '8px';
  (saveSettingsBtn||document.body).insertAdjacentElement('afterend', el);
  setTimeout(() => el.remove(), 1400);
}

// Start when DOM is ready (guard against double-initialization)
document.addEventListener('DOMContentLoaded', () => {
  if (window.__tsInitDone) return;
  window.__tsInitDone = true;

  bindEventsOnce();

  (async () => {
    try {
      restoreUi();
      populateTimezoneOptions();
      // ---- NEW: try to auto-load an app config file ----
      const params = new URLSearchParams(location.search);
      const tenant = params.get('tenant'); // optional multi-tenant via ?tenant=acme
      const bakedConfigUrl =
        // 1) allow a meta override if you want to set it in HTML
        document.querySelector('meta[name="app-config-url"]')?.content
        // 2) enable multi-tenant file naming
        || (tenant ? `config/${tenant}.json` : null)
        // 3) default to app-config.json in the same origin
        || 'app-config.json';

      try { await loadConfigFromUrl(bakedConfigUrl); } catch (_) { /* ignore if missing */ }
      // -----------------------------------------------

      await loadCapacity();
      try {
        const saved = Store.getSavedConfig();
        if (saved) applyConfig(saved);
      } catch (_) {}
      const s = Store.getSettings();
      if (s && s.configUrl) loadConfigFromUrl(s.configUrl);
      populateQueues();
      loadSettings();
      ensureDate();
      updateDateTags();
      migrateExistingEntries();
      buildSlots();
      renderEntries();
    } catch (err) {
      alert('Startup error: ' + err.message);
      console.error(err);
    }
  })();
});

function openEntry(e) {
  try {
    const hm = Array.isArray(e.hm) ? e.hm : getHM(e);
    selectedSlot = { hour: Number(hm[0] || 0), minute: Number(hm[1] || 0) };
    selectedCtx = { queueKey: e.queueKey, queueName: e.queueName, queueArn: e.queueArn, utcIso: e.scheduledAt };

    // Fill fields
    modalSlotLabel.textContent = `${pad2(selectedSlot.hour)}:${pad2(selectedSlot.minute)}`;
    mLocalDate.value = e.date || '';
    mLocalTime.value = e.timeLocal || `${pad2(selectedSlot.hour)}:${pad2(selectedSlot.minute)}`;
    mTz.value = currentTz();
    mScheduledAt.value = e.scheduledAt || '';
    mNotifyAt.value = e.notifyAt || '';
    mPhone.value = e.phoneDisplay || prettyPhone(e.phone || '');
    if (mName) mName.value = e.customerName || e.name || '';
    mAgent.value = e.agentId || '';
    mNotes.value = e.notes || '';

    // EDIT mode UI
    if (modalTitle) modalTitle.textContent = 'Edit Entry';
    if (createBtn) { createBtn.textContent = 'Update Entry'; createBtn.disabled = false; }
    if (deleteBtn) { deleteBtn.style.display = 'inline-flex'; deleteBtn.disabled = false; }

    editEntryId = e.id || null;
    modal.showModal();
  } catch (err) {
    console.error('openEntry failed', err);
  }
}

async function apiUpdateInline(base, useApi, id, patch, curIso) {
  if (!useApi || !base) return { ok: true };
  try {
    const curDate = curIso.slice(0, 10);
    const curTime = curIso.slice(11, 16);

    console.info('PATCH debug →', { id, curIso, curDate, curTime, patch });

    const res = await fetch(`${base}/entries/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentDate: curDate,
        currentTime: curTime,
        ...patch
      })
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('PATCH failed', { status: res.status, body: text });
      throw new Error(text || res.statusText);
    }
    const json = text ? JSON.parse(text) : {};
    return { ok: true, server: json };
  } catch (err) {
    console.error('API update failed:', err);
    alert('API update failed: ' + (err?.message || err));
    return { ok: false };
  }
}


async function updateEntry() {
  const customerName = (mName && mName.value.trim()) || '';
  if (!customerName) { alert("Please enter the customer's name."); return; }

  const rawPhone = mPhone.value.trim();
  const notes = mNotes.value.trim();
  const agent = mAgent.value.trim() || undefined;
  const e164 = toE164(rawPhone);

  // include the field your Lambda prefers
  const patch = {
    customer: customerName,                 // Lambda uses "customer"
    customerName,
    name: customerName,                     // back-compat for our UI
    phone: e164,
    phoneDisplay: prettyPhone(e164),
    notes,
    agentId: agent
  };

  // Get the exact UTC instant the server used for keys
  // (openEntry(e) should have set selectedCtx.utcIso = e.scheduledAt)
  let curIso =
    (selectedCtx && selectedCtx.utcIso) ||
    (mScheduledAt && mScheduledAt.value) ||
    '';

  if (!curIso) {
    // ultra-safety: derive from modal local date/time + current TZ
    const [y, mo, da] = (mLocalDate.value || '').split('-').map(Number);
    const [hh, mm] = (mLocalTime.value || '').split(':').map(Number);
    curIso = tzWallToUtc(y, mo, da, hh, mm, mTz.value || currentTz());
  }

  const settings = Store.getSettings();
  const resp = await apiUpdateInline(settings.apiBase, settings.useApi, editEntryId, patch, curIso);
  if (!resp.ok) return;

  // local update + repaint
  Store.update(dateEl.value, editEntryId, patch);
  renderEntries();
  buildSlots();
  closeModal();
}

// Delete the entry currently open in the modal (uses server UTC instant)
async function deleteEntry() {
  try {
    // find the entry that’s open in the modal
    const day = dateEl && dateEl.value;
    const all = (Store.list && Store.list(day)) || [];
    const entry = all.find(e => e.id === (viewEntryId || editEntryId));
    if (!entry) { alert('Entry not found locally.'); return; }

    const settings = Store.getSettings();
    await apiDeleteInline(settings.apiBase, settings.useApi, entry);

    // remove from local + refresh UI
    Store.remove(day, entry.id);
    buildSlots();
    renderEntries();
    closeModal();
  } catch (err) {
    console.error('API delete failed', err);
    alert('API delete failed: ' + (err?.message || err));
  }
}


// Fetch the selected date's entries from the API once the page is ready
window.addEventListener('load', async () => {
  const d =
    (dateEl && dateEl.value) ||
    (document.getElementById('date')?.value) ||
    new Date().toISOString().slice(0,10);
  if (d) {
    try { await loadFromApi(d); } catch (e) { console.error('initial loadFromApi failed', e); }
  }
});

// Delete from the entries table when the "×" button is clicked (instrumented)
document.addEventListener('click', async function onEntryDeleteClick(ev) {
  const btn = ev.target.closest('button.entry-del');
  if (!btn) return; // not our button

  ev.preventDefault();
  ev.stopPropagation();

  const id  = btn.dataset.id || '';
  const iso = btn.dataset.iso || '';
  console.info('[entry-del] clicked', { id, iso, btn });

  if (!id || !iso) { alert('Missing entry id or timestamp.'); return; }
  if (!confirm('Delete this entry?')) return;

  const d = iso.slice(0,10);   // YYYY-MM-DD
  const t = iso.slice(11,16);  // HH:MM

  const settings = (typeof Store !== 'undefined' && Store.getSettings) ? Store.getSettings() : {};
  const base = settings.apiBase;
  console.info('[entry-del] will DELETE', { base, id, d, t });

  if (!base) { alert('API Base URL is not set in Settings.'); return; }

  try {
    const url = `${base}/entries/${encodeURIComponent(id)}?date=${encodeURIComponent(d)}&time=${encodeURIComponent(t)}`;
    console.info('[entry-del] fetch', url);

    const res = await fetch(url, { method: 'DELETE' });
    const text = await res.text();
    console.info('[entry-del] response', res.status, text);

    if (!res.ok) throw new Error(text || res.statusText);

    if (dateEl && dateEl.value) {
      Store.remove(dateEl.value, id);
    }
    buildSlots();
    renderEntries();
  } catch (err) {
    console.error('[entry-del] API delete failed', err);
    alert('API delete failed: ' + (err?.message || err));
  }
});


// Timeslot grid "×" → delete from DynamoDB and UI (capture phase)
document.addEventListener('click', async function onSlotDelete(ev) {
  const btn = ev.target.closest('button.kill');
  if (!btn) return;

  ev.preventDefault();
  ev.stopPropagation();

  let id  = (btn.dataset.id  || '').trim();
  let iso = (btn.dataset.iso || '').trim();

  // If still missing (shouldn't happen after Step 2), try to reattach once
  if (!id || !iso) {
    const meta = btn.previousElementSibling;
    const txt  = meta ? meta.textContent || '' : '';
    // Very light retry using current slot time if h/m are embedded on the cell
    const cell = btn.closest('td,div,section');
    const hm   = cell && (cell.getAttribute('data-time') || cell.dataset?.time || '');
    if (hm && attachChipData) {
      // Best-effort parse hh:mm
      const m = hm.match(/(\d{1,2}):(\d{2})/);
      if (m) {
        const hN = parseInt(m[1], 10), mN = parseInt(m[2], 10);
        // Attempt to re-derive using displayed text as phone hint
        attachChipData(cell, txt, txt, hN, mN);
        id  = (btn.dataset.id  || '').trim();
        iso = (btn.dataset.iso || '').trim();
      }
    }
  }

  if (!id || !iso) { alert('Sorry — could not determine the entry to delete.'); return; }
  if (!confirm('Delete this entry?')) return;

  const d = iso.slice(0,10), t = iso.slice(11,16);
  try {
    const { apiBase } = Store.getSettings();
    if (!apiBase) throw new Error('API Base URL is not set in Settings.');

    const url = `${apiBase}/entries/${encodeURIComponent(id)}?date=${encodeURIComponent(d)}&time=${encodeURIComponent(t)}`;
    const res = await fetch(url, { method: 'DELETE' });
    const text = await res.text();
    if (!res.ok) throw new Error(text || res.statusText);

    if (dateEl && dateEl.value) Store.remove(dateEl.value, id);
    buildSlots();
    renderEntries();
  } catch (err) {
    console.error('[slot-del] delete failed', err);
    alert('API delete failed: ' + (err?.message || err));
  }
}, true);
