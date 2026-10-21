'use strict';

/* =========================================================
   JKtimetable — tedenski pregled iz Wise Timetable iCal
   ========================================================= */

const DATA_URL = 'data/urnik.ics';
const STORE_KEY = 'urnik.settings.v1';
const CACHE_KEY = 'urnik.ics.v1';
const EXAMS_KEY = 'jktimetable.exams.v1';
const DAY_NAMES = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];
const COLORS = ['#2f6fe4', '#d9480f', '#2b8a3e', '#ae3ec9', '#c2255c', '#0c8599', '#e67700', '#5f3dc4'];

// Ročne preslikave terminov: kadar se skupine dejansko izvajajo drugače, kot piše v Wise.
// Dogodek, ki se natanko ujema s `from` (dan 1=pon … 7=ned, ura, prostor), se prestavi na `to`
// v istem tednu; če `to` nima prostora ali skupine, ostaneta tista iz Wise. Dogodek tega predmeta, ki se ne ujema z nobenim `from`, je dejanska sprememba
// v Wise — ostane nespremenjen in je viden vsem skupinam.
const OVERRIDES = [
  {
    subject: 'RAZVOJ INFORMACIJSKIH REŠITEV IN STORITEV',
    type: 'RV',
    slots: [
      { from: { day: 2, start: '17:00', end: '20:00', room: 'G-219' },
        to: { day: 1, start: '11:00', end: '14:00', room: 'F-104', group: '1' } },
      { from: { day: 3, start: '18:00', end: '21:00', room: 'G2-HERTZ' },
        to: { day: 3, start: '18:00', end: '21:00', room: 'G2-Hertz', group: '2' } },
      { from: { day: 4, start: '10:00', end: '13:00', room: 'G2-HERTZ' },
        to: { day: 4, start: '10:00', end: '13:00', room: 'G2-Hertz', group: '3' } },
    ],
  },
  {
    // skupine se ujemajo z Wise, popravljeni so le časi (prostor in skupina ostaneta iz Wise)
    subject: 'PODATKOVNE TEHNOLOGIJE IN STORITVE',
    type: 'RV',
    slots: [
      { from: { day: 5, start: '10:00', end: '13:00', room: 'C-202' },
        to: { day: 5, start: '10:00', end: '12:15' } },
      { from: { day: 4, start: '16:00', end: '19:00', room: 'G-219' },
        to: { day: 4, start: '16:00', end: '18:15' } },
      { from: { day: 5, start: '13:00', end: '16:00', room: 'C-202' },
        to: { day: 5, start: '13:00', end: '15:15' } },
      { from: { day: 5, start: '13:00', end: '16:00', room: 'G2 - P.06' },
        to: { day: 5, start: '13:00', end: '15:15' } },
      { from: { day: 5, start: '07:00', end: '10:00', room: 'G3 - Turing' },
        to: { day: 5, start: '07:45', end: '10:00' } },
      { from: { day: 4, start: '09:00', end: '12:00', room: 'F-103/a' },
        to: { day: 4, start: '09:45', end: '12:00' } },
    ],
  },
];

const $ = (id) => document.getElementById(id);

let events = [];          // vsi dogodki
let subjects = [];        // [{name, groups:[..], color}]
let weekOffset = 0;
let settings = loadSettings();
let exams = loadExams();   // [{id, subject, title, date:'YYYY-MM-DD'}]

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

function loadExams() {
  try {
    const a = JSON.parse(localStorage.getItem(EXAMS_KEY));
    if (Array.isArray(a)) return a;
  } catch (_) {}
  return [];
}
function saveExams() {
  try { localStorage.setItem(EXAMS_KEY, JSON.stringify(exams)); } catch (_) {}
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
  const who = (desc.match(/(?:Izvajalci|Predavatelji):\s*(.*)/) || [])[1] || '';
  const groupsText = (desc.match(/Skupine:\s*(.*)/) || [])[1] || '';
  const groupNums = [...groupsText.matchAll(/(?:RV|LV|SV)\s*-\s*(\d+)\.\s*sk/g)].map((m) => m[1]);
  return {
    uid: r.UID, start, end, subject, type,
    room: unescapeIcs(r.LOCATION || ''),
    who, groupsText, groups: [...new Set(groupNums)],
  };
}

function applyOverrides(list) {
  const isoDay = (d) => (d.getDay() + 6) % 7 + 1;
  const sameRoom = (a, b) => shortRoom(a).trim().toLowerCase() === b.toLowerCase();
  const at = (date, day, time) => {
    const [h, m] = time.split(':').map(Number);
    const d = addDays(mondayOf(date), day - 1);
    d.setHours(h, m, 0, 0);
    return d;
  };
  return list.map((ev) => {
    const o = OVERRIDES.find((x) => x.subject === ev.subject && x.type === ev.type);
    if (!o) return ev;
    const slot = o.slots.find(({ from: f }) =>
      isoDay(ev.start) === f.day && hhmm(ev.start) === f.start && hhmm(ev.end) === f.end && sameRoom(ev.room, f.room));
    // dejanska sprememba v Wise: pokaži vsem, stare številke skupin ne veljajo več
    if (!slot) return { ...ev, groups: [] };
    const t = slot.to;
    return {
      ...ev,
      start: at(ev.start, t.day, t.start),
      end: at(ev.start, t.day, t.end),
      room: t.room || ev.room,
      groups: t.group ? [t.group] : ev.groups,
      groupsText: t.group ? `${t.group}. skupina (prilagojeno)` : ev.groupsText,
    };
  });
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
function pad2(n) {
  return String(n).padStart(2, '0');
}
function isoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function dateAt(iso, time = '00:00') {
  const [y, mo, d] = iso.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi);
}
// 1 dan, 2 dneva, 3 dni … (forms: [1, 2, 3–4, 5+])
function plural(n, forms) {
  const r = n % 100;
  return r === 1 ? forms[0] : r === 2 ? forms[1] : r === 3 || r === 4 ? forms[2] : forms[3];
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
    // kolokvij, ko predmet ta dan nima ure v urniku: oznaka pod datumom
    exams.filter((x) => x.date === isoDate(d) && !classesFor(x).length).forEach((x) => {
      const c = el('button', 'exam-chip');
      c.textContent = abbreviate(x.subject);
      c.title = `${niceCase(x.subject)} · ${x.title || 'Kolokvij'}`;
      c.addEventListener('click', () => openExamEditor(x));
      h.append(c);
    });
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
      const exam = examFor(ev);
      const b = el('button', 'ev' + (ev.type === 'RV' || ev.type === 'LV' ? ' rv' : '') + (ev.type === 'RES' ? ' res' : '') + (exam ? ' exam' : ''));
      b.style.setProperty('--c', colorOf(ev.subject));
      b.style.top = y(ev.start) + 1 + 'px';
      b.style.height = Math.max(y(ev.end) - y(ev.start) - 2, 18) + 'px';
      if (lanes > 1) {
        b.style.left = `calc(${(lane / lanes) * 100}% + 1px)`;
        b.style.right = 'auto';
        b.style.width = `calc(${100 / lanes}% - 2px)`;
      }
      const name = ev.type === 'RES' ? 'Rez.' : abbreviate(ev.subject);
      const type = exam ? exam.title || 'Kolokvij'
        : ev.type === 'PR' ? 'PR' : ev.type === 'RES' || ev.type === 'OTHER' ? '' : `${ev.type}${ev.groups.length === 1 ? ' ' + ev.groups[0] : ''}`;
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
  const exam = examFor(ev);
  const t = $('d-type');
  t.textContent = exam ? exam.title || 'Kolokvij' : TYPE_NAMES[ev.type] || ev.type;
  t.style.setProperty('--c', exam ? 'var(--now)' : colorOf(ev.subject));
  $('d-title').textContent = ev.type === 'RES' ? 'Rezervacija' : niceCase(ev.subject);
  const d = ev.start;
  $('d-time').textContent = `${DAY_NAMES[(d.getDay() + 6) % 7]}, ${d.getDate()}. ${d.getMonth() + 1}. · ${hhmm(ev.start)}–${hhmm(ev.end)}`;
  $('d-room').textContent = ev.room || '—';
  $('d-who').textContent = ev.who ? ev.who.split(/,\s*/).map((n) => n.split(' ').map(niceCase).join(' ')).join(', ') : '—';
  $('d-groups').textContent = ev.groupsText.length > 120 ? ev.groupsText.slice(0, 120) + '…' : (ev.groupsText || '—');
  $('detail').showModal();
}

/* ---------- kolokviji ---------- */
// Kolokvij je vezan na predmet in datum; čas in prostor sta tista iz urnika.
function classesFor(x) {
  return events.filter((e) => e.subject === x.subject && e.type !== 'RES' && isoDate(e.start) === x.date && isVisible(e))
    .sort((a, b) => a.start - b.start);
}
function examFor(ev) {
  if (ev.type === 'RES') return null;
  const date = isoDate(ev.start);
  return exams.find((x) => x.subject === ev.subject && x.date === date) || null;
}

function renderExams() {
  const list = $('exam-list');
  list.innerHTML = '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sorted = exams.slice().sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((x) => dateAt(x.date) >= today);
  const past = sorted.filter((x) => dateAt(x.date) < today).reverse();

  const n = upcoming.length;
  $('exams-sub').textContent = n ? `${n} ${plural(n, ['prihajajoč', 'prihajajoča', 'prihajajoči', 'prihajajočih'])}` : '';

  if (!exams.length) {
    const e = el('p', 'empty-note');
    e.textContent = 'Še ni vnesenih kolokvijev. Dodaj jih z +.';
    list.append(e);
    return;
  }

  const item = (x, isPast) => {
    const date = dateAt(x.date);
    const b = el('button', 'exam-item' + (isPast ? ' past' : ''));
    b.style.setProperty('--c', colorOf(x.subject));
    b.innerHTML = `<div class="exam-date"><span></span><b></b><span></span></div>
      <div class="exam-body"><div class="exam-subj"></div><div class="exam-meta"></div></div>
      <div class="exam-when"></div>`;
    const [dow, mon] = b.querySelectorAll('.exam-date span');
    dow.textContent = DAY_NAMES[(date.getDay() + 6) % 7];
    b.querySelector('.exam-date b').textContent = date.getDate();
    mon.textContent = MONTHS[date.getMonth()];
    b.querySelector('.exam-subj').textContent = niceCase(x.subject);
    const cls = classesFor(x)[0];
    const when = cls ? `${hhmm(cls.start)}–${hhmm(cls.end)}` : '';
    b.querySelector('.exam-meta').textContent = [x.title || 'Kolokvij', when, cls && shortRoom(cls.room)].filter(Boolean).join(' · ');
    if (!isPast) {
      const days = Math.round((date - today) / 86400000);
      const w = b.querySelector('.exam-when');
      w.textContent = days === 0 ? 'danes' : days === 1 ? 'jutri' : `čez ${days} ${plural(days, ['dan', 'dneva', 'dni', 'dni'])}`;
      if (days <= 7) w.classList.add('soon');
    }
    b.addEventListener('click', () => openExamEditor(x));
    return b;
  };

  const section = (title, items, isPast) => {
    if (!items.length) return;
    const h = el('h3', 'section-title');
    h.textContent = title;
    list.append(h, ...items.map((x) => item(x, isPast)));
  };
  section('Prihajajoči', upcoming, false);
  section('Pretekli', past, true);
}

let editingId = null;
function openExamEditor(x) {
  editingId = x ? x.id : null;
  $('exam-edit-title').textContent = x ? 'Uredi kolokvij' : 'Nov kolokvij';
  const sel = $('ex-subject');
  sel.innerHTML = '';
  subjects.forEach((s) => sel.add(new Option(niceCase(s.name), s.name)));
  if (x && !subjects.some((s) => s.name === x.subject)) sel.add(new Option(niceCase(x.subject), x.subject));
  sel.value = x ? x.subject : subjects[0]?.name ?? '';
  $('ex-title').value = x ? x.title : '';
  $('ex-date').value = x ? x.date : isoDate(new Date());
  $('ex-delete').hidden = !x;
  $('exam-edit').showModal();
}

function examsChanged() {
  saveExams();
  renderExams();
  render();
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
  events = applyOverrides(parseIcs(text));
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
  if (!$('exams-view').hidden) renderExams();
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

// kolokviji
let examsFromApp = false;
$('exams-btn').addEventListener('click', () => { examsFromApp = true; location.hash = 'kolokviji'; });
$('exams-back').addEventListener('click', () => {
  if (examsFromApp) { history.back(); return; }
  history.replaceState(null, '', location.pathname + location.search);
  route();
});
$('exam-add').addEventListener('click', () => openExamEditor(null));
$('exam-close').addEventListener('click', () => $('exam-edit').close());
$('exam-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const subject = $('ex-subject').value;
  if (!subject) return;
  const rec = { id: editingId || newId(), subject, title: $('ex-title').value.trim(), date: $('ex-date').value };
  exams = exams.filter((x) => x.id !== rec.id).concat(rec);
  $('exam-edit').close();
  examsChanged();
});
$('ex-delete').addEventListener('click', () => {
  if (!editingId || !confirm('Izbrišem ta kolokvij?')) return;
  exams = exams.filter((x) => x.id !== editingId);
  $('exam-edit').close();
  examsChanged();
});

// podstran kolokvijev (#kolokviji)
function route() {
  const showExams = location.hash === '#kolokviji';
  if (!showExams) examsFromApp = false;
  $('timetable-view').hidden = showExams;
  $('exams-view').hidden = !showExams;
  if (showExams) renderExams();
  else { syncHeader(); render(); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

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
  if (document.querySelector('dialog[open]') || !$('exams-view').hidden) return;
  if (e.key === 'ArrowLeft') { weekOffset--; render(); }
  if (e.key === 'ArrowRight') { weekOffset++; render(); }
});

// višina glave za lepljive glave dni
function syncHeader() {
  const h = document.querySelector('#timetable-view .top').offsetHeight;
  if (h) document.documentElement.style.setProperty('--head', h + 'px');
}
window.addEventListener('resize', syncHeader);
syncHeader();

// osveži ob vrnitvi v aplikacijo in vsako minuto (črta "zdaj")
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(render, 60 * 1000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

route();
load();
