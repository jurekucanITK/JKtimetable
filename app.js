'use strict';

/* =========================================================
   JKtimetable — tedenski pregled iz Wise Timetable iCal
   ========================================================= */

const DATA_URL = 'data/urnik.ics';
const STORE_KEY = 'urnik.settings.v1';
const CACHE_KEY = 'urnik.ics.v1';
const DAY_NAMES = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const COLORS = ['#2f6fe4', '#d9480f', '#2b8a3e', '#ae3ec9', '#c2255c', '#0c8599', '#e67700', '#5f3dc4'];

const $ = (id) => document.getElementById(id);

let events = [];          // vsi dogodki
let subjects = [];        // [{name, groups:[..], color}]
let weekOffset = 0;
let settings = loadSettings();

/* ---------- nastavitve ---------- */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === 'object') return { groups: {}, showRes: false, showWeekend: false, ...s };
  } catch (_) {}
  return { groups: {}, showRes: false, showWeekend: false, fresh: true };
}
function saveSettings() {
  delete settings.fresh;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (_) {}
}

/* ---------- iCal parser ---------- */
function unescapeIcs(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function parseIcsDate(v) {
  // 20261001T090000 (lokalni čas, TZID=Europe/Ljubljana) ali ...Z (UTC)
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  return z
    ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s))
    : new Date(+y, mo - 1, +d, +h, +mi, +s);
}
function parseIcs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0];
    cur[key] = line.slice(i + 1);
  }
  return out.map(toEvent).filter(Boolean);
}
function toEvent(r) {
  const start = parseIcsDate(r.DTSTART || '');
  const end = parseIcsDate(r.DTEND || '');
  if (!start || !end) return null;
  const summary = unescapeIcs(r.SUMMARY || '').trim();
  const desc = unescapeIcs(r.DESCRIPTION || '');
  const tm = summary.match(/^(.*?)\s*\((PR|RV|LV|SV|SE)\)$/);
  const subject = tm ? tm[1] : summary;
  const type = tm ? tm[2] : (/^rezervacija$/i.test(summary) ? 'RES' : 'OTHER');
  const who = (desc.match(/Predavatelji:\s*(.*)/) || [])[1] || '';
  const groupsText = (desc.match(/Skupine:\s*(.*)/) || [])[1] || '';
  const groupNums = [...groupsText.matchAll(/(?:RV|LV|SV)\s*-\s*(\d+)\.\s*sk/g)].map((m) => m[1]);
  return {
    uid: r.UID, start, end, subject, type,
    room: unescapeIcs(r.LOCATION || ''),
    who, groupsText, groups: [...new Set(groupNums)],
  };
}

/* ---------- pomožne ---------- */
function abbreviate(name) {
  const words = name.split(/\s+/).filter((w) => w.length > 2);
  const a = words.map((w) => w[0]).join('').toUpperCase();
  return a.length >= 2 ? a : name.slice(0, 6);
}
function shortRoom(room) {
  return room.replace(/^\([^)]*\)\s*/, '').replace(/,\s*\d+\.\s*nadstropje/i, '');
}
function niceCase(s) {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
function hhmm(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function baseMonday() {
  const now = new Date();
  const m = mondayOf(now);
  // čez vikend pokaži naslednji teden
  const dow = (now.getDay() + 6) % 7;
  return (dow >= 5 && !settings.showWeekend) ? addDays(m, 7) : m;
}

/* ---------- filter ---------- */
function isVisible(ev) {
  if (ev.type === 'RES') return settings.showRes;
  if (ev.type === 'PR' || ev.type === 'OTHER') return true;
  const pick = settings.groups[ev.subject];
  if (pick === 'hide') return false;
  if (!pick || pick === 'all' || ev.groups.length === 0) return true;
  return ev.groups.includes(pick);
}

/* ---------- izris tedna ---------- */
function render() {
  const monday = addDays(baseMonday(), weekOffset * 7);
  const nDays = settings.showWeekend ? 7 : 5;
  const days = Array.from({ length: nDays }, (_, i) => addDays(monday, i));
  const weekEnd = addDays(monday, nDays);
  const today = new Date();

  const weekEvents = events.filter((e) => e.start >= monday && e.start < weekEnd && isVisible(e));

  // naslov
  const last = days[days.length - 1];
  $('week-label').textContent = monday.getMonth() === last.getMonth()
    ? `${monday.getDate()}.–${last.getDate()}. ${MONTHS[last.getMonth()]}`
    : `${monday.getDate()}. ${MONTHS[monday.getMonth()]} – ${last.getDate()}. ${MONTHS[last.getMonth()]}`;
  $('week-sub').textContent = weekOffset === 0 ? 'ta teden'
    : weekOffset === 1 ? 'naslednji teden'
    : weekOffset === -1 ? 'prejšnji teden'
    : (weekOffset > 0 ? `čez ${weekOffset} tedne` : `pred ${-weekOffset} tedni`).replace('čez 1 tedne', 'čez 1 teden');

  // časovni razpon
  let minH = 8, maxH = 16;
  if (weekEvents.length) {
    minH = Math.min(...weekEvents.map((e) => e.start.getHours()));
    maxH = Math.max(...weekEvents.map((e) => e.end.getHours() + (e.end.getMinutes() ? 1 : 0)));
  }
  minH = Math.min(minH, 8); maxH = Math.max(maxH, 16);
  const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour')) || 52;
  const height = (maxH - minH) * hourPx;
  const y = (d) => ((d.getHours() + d.getMinutes() / 60) - minH) * hourPx;

  const week = $('week');
  week.style.setProperty('--days', nDays);
  week.innerHTML = '';

  // glave dni
  week.append(el('div', 'axis-head'));
  days.forEach((d, i) => {
    const h = el('div', 'day-head' + (sameDay(d, today) ? ' today' : ''));
    h.innerHTML = `${DAY_NAMES[i]}<b>${d.getDate()}</b>`;
    week.append(h);
  });

  // časovna os
  const axis = el('div', 'axis');
  axis.style.height = height + 'px';
  for (let h = minH + 1; h < maxH; h++) {
    const s = el('span'); s.textContent = h; s.style.top = (h - minH) * hourPx + 'px'; axis.append(s);
  }
  week.append(axis);

  // stolpci
  days.forEach((d) => {
    const col = el('div', 'col' + (sameDay(d, today) ? ' today' : ''));
    col.style.height = height + 'px';
    const list = weekEvents.filter((e) => sameDay(e.start, d)).sort((a, b) => a.start - b.start || b.end - a.end);
    layoutLanes(list).forEach(({ ev, lane, lanes }) => {
      const b = el('button', 'ev' + (ev.type === 'RV' || ev.type === 'LV' ? ' rv' : '') + (ev.type === 'RES' ? ' res' : ''));
      b.style.setProperty('--c', colorOf(ev.subject));
      b.style.top = y(ev.start) + 1 + 'px';
      b.style.height = Math.max(y(ev.end) - y(ev.start) - 2, 18) + 'px';
      if (lanes > 1) {
        b.style.left = `calc(${(lane / lanes) * 100}% + 1px)`;
        b.style.right = 'auto';
        b.style.width = `calc(${100 / lanes}% - 2px)`;
      }
      const name = ev.type === 'RES' ? 'Rez.' : abbreviate(ev.subject);
      const type = ev.type === 'PR' ? 'PR' : ev.type === 'RES' || ev.type === 'OTHER' ? '' : `${ev.type}${ev.groups.length === 1 ? ' ' + ev.groups[0] : ''}`;
      b.innerHTML = `<span class="n"></span><span class="t"></span><span class="r"></span>`;
      b.querySelector('.n').textContent = name + (type ? ' · ' + type : '');
      b.querySelector('.t').textContent = `${hhmm(ev.start)}–${hhmm(ev.end)}`;
      b.querySelector('.r').textContent = shortRoom(ev.room);
      b.addEventListener('click', () => openDetail(ev));
      col.append(b);
    });
    if (sameDay(d, today)) {
      const nowY = y(today);
      if (nowY >= 0 && nowY <= height) {
        const line = el('div', 'now-line'); line.style.top = nowY + 'px'; col.append(line);
      }
    }
    week.append(col);
  });

  if (!weekEvents.length) {
    const e = el('div', 'empty');
    e.textContent = events.length ? 'Ta teden ni ničesar. 🎉' : 'Nalagam urnik …';
    week.append(e);
  }
}

function layoutLanes(list) {
  // razporedi prekrivajoče se dogodke v vzporedne stolpce
  const out = [];
  let cluster = [], clusterEnd = 0;
  const flush = () => {
    const lanesEnd = [];
    const placed = cluster.map((ev) => {
      let lane = lanesEnd.findIndex((t) => t <= ev.start);
      if (lane < 0) { lane = lanesEnd.length; lanesEnd.push(0); }
      lanesEnd[lane] = ev.end;
      return { ev, lane };
    });
    placed.forEach((p) => out.push({ ...p, lanes: lanesEnd.length }));
    cluster = []; clusterEnd = 0;
  };
  for (const ev of list) {
    if (cluster.length && +ev.start >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, +ev.end);
  }
  if (cluster.length) flush();
  return out;
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (tag === 'button') e.type = 'button';
  return e;
}
function colorOf(subject) {
  const i = subjects.findIndex((s) => s.name === subject);
  return i >= 0 ? COLORS[i % COLORS.length] : '#8a8d93';
}

/* ---------- podrobnosti ---------- */
const TYPE_NAMES = { PR: 'Predavanja', RV: 'Računalniške vaje', LV: 'Laboratorijske vaje', SV: 'Seminarske vaje', SE: 'Seminar', RES: 'Rezervacija', OTHER: 'Dogodek' };
function openDetail(ev) {
  const t = $('d-type');
  t.textContent = TYPE_NAMES[ev.type] || ev.type;
  t.style.setProperty('--c', colorOf(ev.subject));
  $('d-title').textContent = ev.type === 'RES' ? 'Rezervacija' : niceCase(ev.subject);
  const d = ev.start;
  $('d-time').textContent = `${DAY_NAMES[(d.getDay() + 6) % 7]}, ${d.getDate()}. ${d.getMonth() + 1}. · ${hhmm(ev.start)}–${hhmm(ev.end)}`;
  $('d-room').textContent = ev.room || '—';
  $('d-who').textContent = ev.who ? ev.who.split(/,\s*/).map((n) => n.split(' ').map(niceCase).join(' ')).join(', ') : '—';
  $('d-groups').textContent = ev.groupsText.length > 120 ? ev.groupsText.slice(0, 120) + '…' : (ev.groupsText || '—');
  $('detail').showModal();
}

/* ---------- nastavitve ---------- */
function renderSettings() {
  const box = $('subject-list');
  box.innerHTML = '';
  subjects.filter((s) => s.groups.length).forEach((s) => {
    const wrap = el('div', 'subject');
    wrap.style.setProperty('--c', s.color);
    wrap.innerHTML = `<div class="name"><span class="dot"></span><span></span></div><div class="seg"></div>`;
    wrap.querySelector('.name span:last-child').textContent = niceCase(s.name);
    const seg = wrap.querySelector('.seg');
    const cur = settings.groups[s.name] || 'all';
    [['all', 'Vse'], ...s.groups.map((g) => [g, g]), ['hide', 'Skrij']].forEach(([val, label]) => {
      const b = el('button');
      b.textContent = label;
      b.setAttribute('aria-pressed', String(cur === val));
      b.addEventListener('click', () => {
        settings.groups[s.name] = val;
        saveSettings();
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        render();
      });
      seg.append(b);
    });
    box.append(wrap);
  });
  $('show-res').checked = settings.showRes;
  $('show-weekend').checked = settings.showWeekend;
}

/* ---------- nalaganje podatkov ---------- */
function ingest(text) {
  events = parseIcs(text);
  const map = new Map();
  events.forEach((e) => {
    if (e.type === 'RES' || e.type === 'OTHER') return;
    if (!map.has(e.subject)) map.set(e.subject, new Set());
    if (e.type !== 'PR') e.groups.forEach((g) => map.get(e.subject).add(g));
  });
  subjects = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'sl'))
    .map(([name, g], i) => ({ name, groups: [...g].sort((a, b) => a - b), color: COLORS[i % COLORS.length] }));
}

async function load() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (_) {}
  if (cached?.text) { ingest(cached.text); render(); setUpdated(cached.modified, true); }

  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    const modified = res.headers.get('Last-Modified') || new Date().toUTCString();
    ingest(text);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ text, modified })); } catch (_) {}
    setUpdated(modified, false);
  } catch (err) {
    if (!cached) $('status').textContent = 'Urnika ni bilo mogoče naložiti. Preveri povezavo.';
    else $('status').textContent = 'Brez povezave — prikazan je shranjen urnik.';
  }
  render();
  renderSettings();
  if (settings.fresh && subjects.some((s) => s.groups.length)) $('settings').showModal();
}

function setUpdated(modified, offline) {
  const d = new Date(modified);
  const txt = isNaN(d) ? '' : `Urnik posodobljen ${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ob ${hhmm(d)}`;
  $('updated').textContent = txt;
  if (!offline) $('status').textContent = '';
}

/* ---------- dogodki UI ---------- */
$('prev').addEventListener('click', () => { weekOffset--; render(); });
$('next').addEventListener('click', () => { weekOffset++; render(); });
$('title').addEventListener('click', () => { weekOffset = 0; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('settings-btn').addEventListener('click', () => { renderSettings(); $('settings').showModal(); });
$('settings').addEventListener('close', () => { saveSettings(); render(); });
$('show-res').addEventListener('change', (e) => { settings.showRes = e.target.checked; saveSettings(); render(); });
$('show-weekend').addEventListener('change', (e) => { settings.showWeekend = e.target.checked; saveSettings(); render(); });

// zapri list s tapom na ozadje
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
});

// swipe levo/desno za menjavo tedna
let tx = 0, ty = 0;
$('week').addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
$('week').addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 50) { weekOffset += dx < 0 ? 1 : -1; render(); }
}, { passive: true });

// tipkovnica (za računalnik)
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowLeft') { weekOffset--; render(); }
  if (e.key === 'ArrowRight') { weekOffset++; render(); }
});

// višina glave za lepljive glave dni
function syncHeader() {
  document.documentElement.style.setProperty('--head', document.querySelector('.top').offsetHeight + 'px');
}
window.addEventListener('resize', syncHeader);
syncHeader();

// osveži ob vrnitvi v aplikacijo in vsako minuto (črta "zdaj")
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(render, 60 * 1000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
load();
