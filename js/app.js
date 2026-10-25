import { watchAuth, signInWithGoogle, useLocal, cloudAvailable, connectGoogle, cachedGoogleToken, forgetGoogleToken, GMAIL_SCOPE, CALENDAR_SCOPE } from "./store.js";
import { listMessages, FILTERS } from "./gmail.js";
import { listEvents } from "./gcal.js";
import { createAutocomplete } from "./autocomplete.js";
import { createGoals } from "./goals.js";

/* ================= Grundlagen ================= */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const weekday = s => (parse(s).getDay() + 6) % 7;            // 0 = Montag
const mondayOf = s => addDays(s, -weekday(s));
const todayIso = () => iso(new Date());
const clone = o => JSON.parse(JSON.stringify(o));
function isoWeek(s) {
  const d = parse(s); d.setDate(d.getDate() + 3 - weekday(s));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

const DAY_LETTERS = ["M", "D", "M", "D", "F", "S", "S"];
const DAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const DAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const QUOTES = [
  ["Ich betrachte jeden Misserfolg als eine Stufe zum Erfolg.", "Inayat Khan"],
  ["Wer immer tut, was er schon kann, bleibt immer das, was er schon ist.", "Henry Ford"],
  ["Es ist nicht wenig Zeit, die wir haben, sondern es ist viel Zeit, die wir nicht nutzen.", "Seneca"],
  ["Auch aus Steinen, die einem in den Weg gelegt werden, kann man Schönes bauen.", "Johann Wolfgang von Goethe"],
  ["Der beste Weg, die Zukunft vorauszusagen, ist, sie zu gestalten.", "Willy Brandt"],
  ["Wir sind, was wir wiederholt tun.", "Will Durant"],
  ["Ruhe ist die Mutter des Erfolgs.", "Sprichwort"]
];
// Zeitplan: alle 15-Minuten-Blöcke des Tages; angezeigt wird der gewählte Zeitraum (Standard 05:15 – 20:30)
const hm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const ALL_TIMES = Array.from({ length: 96 }, (_, i) => hm(i * 15));
const DEFAULT_RANGE = { start: 5 * 60 + 15, end: 20 * 60 + 30 };
let TIMES = [];
const HABIT_ROWS = 6;
const MOODS = ["glücklich", "begeistert", "hoffnungsvoll", "liebevoll", "entspannt", "dankbar", "müde", "traurig", "gestresst", "überfordert"];
const WATER_GLASSES = 8;

/* ================= Datenmodell ================= */
const list = n => Array.from({ length: n }, () => ({ t: "", d: false }));
function blankDay(date) {
  return { date, grateful: ["", ""], forward: ["", ""], focus: { text: "", done: false },
    cream: list(2), cherries: list(4), more: list(3), habit: false, relax: list(2), appts: "", ideas: "", slots: {},
    affirm: ["", ""], moods: [], moodOther: "", weight: "", fitness: list(5),
    meals: { breakfast: "", lunch: "", dinner: "", snack: "" }, water: 0, selfRating: null, reflection: "" };
}
function normDay(x, date) {
  const b = blankDay(date);
  if (!x || typeof x !== "object") return b;
  const out = Object.assign(b, x, { date });
  ["cream", "cherries", "relax", "fitness"].forEach(k => { out[k] = blankDay(date)[k].map((v, i) => Object.assign(v, (x[k] || [])[i] || {})); });
  out.more = Array.isArray(x.more) ? x.more.map(v => Object.assign({ t: "", d: false }, v)) : list(3);
  while (out.more.length < 3) out.more.push({ t: "", d: false });
  out.meals = Object.assign(blankDay(date).meals, x.meals || {});
  out.moods = Array.isArray(x.moods) ? x.moods : [];
  ["grateful", "forward", "affirm"].forEach(k => { out[k] = [0, 1].map(i => (x[k] || [])[i] || ""); });
  out.focus = Object.assign({ text: "", done: false }, x.focus || {});
  out.slots = x.slots && typeof x.slots === "object" ? x.slots : {};
  return out;
}
function blankWeek(monday) {
  return { monday,
    habits: Array.from({ length: HABIT_ROWS }, () => ({ name: "", days: [false, false, false, false, false, false, false] })),
    goals: [0, 1].map(() => ({ text: "", steps: list(3) })),
    meaning: null, meaningNotes: "", wins: "" };
}
function normWeek(x, monday) {
  const b = blankWeek(monday);
  if (!x || typeof x !== "object") return b;
  const out = Object.assign(b, x, { monday });
  out.habits = blankWeek(monday).habits.map((h, i) => {
    const s = (x.habits || [])[i] || {};
    return { name: s.name || "", days: h.days.map((_, j) => !!(s.days || [])[j]) };
  });
  out.goals = blankWeek(monday).goals.map((g, i) => {
    const s = (x.goals || [])[i] || {};
    return { text: s.text || "", steps: g.steps.map((st, j) => Object.assign(st, (s.steps || [])[j] || {})) };
  });
  return out;
}
const dayHasContent = d => !!d && (Object.keys(d.slots || {}).length || d.focus?.text || [...(d.cream || []), ...(d.cherries || [])].some(x => x.t));

/* ================= Zustand ================= */
let store = null;
let view = "day";
let current = todayIso();
let day = blankDay(current);
let week = blankWeek(mondayOf(current));
let meta = { vocab: null, templates: {}, habitNames: [], range: null, columns: [], calAuto: true };
let rendering = false;
const timers = {};
const dirty = new Set();
const ac = createAutocomplete({ onChange: v => { meta.vocab = v; queueSave("meta"); } });
const goals = createGoals({ onChange: () => queueSave("goals"), today: todayIso, onOpen: id => { setView("goals"); goals.reveal(id); setTimeout(() => document.querySelector(`#goalsView [data-gid="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 30); } });

/* ================= Speichern ================= */
function setStatus(t, err) { const s = $("status"); s.textContent = t; s.classList.toggle("err", !!err); }
function queueSave(what) {
  dirty.add(what);
  setStatus("Änderungen …");
  clearTimeout(timers[what]);
  timers[what] = setTimeout(() => flush(what), 700);
}
async function flush(what) {
  clearTimeout(timers[what]);
  if (!dirty.has(what) || !store) return;
  dirty.delete(what);
  try {
    if (what === "day") { const d = clone(day); d.updatedAt = new Date().toISOString(); await store.set("days", d.date, d); }
    if (what === "week") { const w = clone(week); w.updatedAt = new Date().toISOString(); await store.set("weeks", w.monday, w); }
    if (what === "meta") {
      await store.set("meta", "vocab", meta.vocab || {});
      await store.set("meta", "settings", { templates: meta.templates, habitNames: meta.habitNames, range: meta.range, columns: meta.columns, calAuto: meta.calAuto });
    }
    if (what === "goals") await store.set("meta", "goals", { ...goals.data(), updatedAt: new Date().toISOString() });
    if (!dirty.size) setStatus("Gespeichert " + new Date().toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }));
  } catch (e) {
    console.error(e);
    dirty.add(what);
    setStatus("Speichern fehlgeschlagen – wird erneut versucht", true);
    timers[what] = setTimeout(() => flush(what), 5000);
  }
}
const flushAll = () => Promise.all(["day", "week", "meta", "goals"].map(flush));
window.addEventListener("pagehide", () => { if (dirty.size) flushAll(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushAll();
  else if (store && !dirty.size) loadDate(current, true);
});

/* ================= Rückgängig ================= */
let undoState = null, toastTimer = null;
function snapshotForUndo(label) { undoState = { day: clone(day), week: clone(week), goals: goals.data(), columns: clone(meta.columns), label }; }
function toast(text, undoable = true) {
  $("toastText").textContent = text;
  $("toastUndo").hidden = !undoable || !undoState;
  $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, 6000);
}
$("toastUndo").onclick = () => {
  if (!undoState) return;
  if (undoState.day.date === day.date) { day = undoState.day; queueSave("day"); }
  if (undoState.week.monday === week.monday) { week = undoState.week; queueSave("week"); }
  if (JSON.stringify(undoState.goals) !== JSON.stringify(goals.data())) { goals.load(undoState.goals); queueSave("goals"); }
  if (JSON.stringify(undoState.columns) !== JSON.stringify(meta.columns)) { meta.columns = undoState.columns; buildColumns(); queueSave("meta"); }
  undoState = null; $("toast").hidden = true;
  renderAll();
};
goals.beforeChange = () => snapshotForUndo();
goals.afterDelete = n => toast(n > 1 ? `Ziel mit ${n - 1} Etappen gelöscht` : "Ziel gelöscht");

/* ================= Aufbau Tagesansicht ================= */
function itemRow(key, i, ph, group) {
  const row = document.createElement("div"); row.className = "item";
  row.innerHTML = `<input type="checkbox" class="check" id="${key}${i}c" data-k="${key}.${i}.d" aria-label="Erledigt">` +
    `<input type="text" id="${key}${i}t" data-k="${key}.${i}.t" data-ac="${group}" list="ac-${group}" autocomplete="off" placeholder="${ph}">`;
  return row;
}
function buildList(id, key, n, ph, group = "todo") {
  const host = $(id);
  for (let i = 0; i < n; i++) {
    const row = document.createElement("div"); row.className = "item";
    row.innerHTML = `<input type="checkbox" class="check" id="${key}${i}c" data-k="${key}.${i}.d" aria-label="Erledigt">` +
      `<input type="text" id="${key}${i}t" data-k="${key}.${i}.t" data-ac="todo" placeholder="${ph}">`;
    host.appendChild(row);
  }
}
buildList("cream", "cream", 2, "Wichtig heute");
buildList("cherries", "cherries", 4, "Wäre schön");
buildList("relax", "relax", 2, "Was mir guttut");
buildList("fitness", "fitness", 5, "z. B. 30 Min. Laufen", "fit");
function renderMore() {
  const host = $("more");
  if (host.children.length === day.more.length) return;
  host.replaceChildren(...day.more.map((_, i) => itemRow("more", i, i ? "" : "Alles Weitere", "todo")));
}
$("addMore").onclick = () => {
  day.more.push({ t: "", d: false }); renderDay(); queueSave("day");
  $("more").lastElementChild.querySelector("input[type=text]").focus();
};
$("moods").innerHTML = MOODS.map(m => `<button type="button" aria-pressed="false" data-mood="${m}">${m}</button>`).join("");
$("water").innerHTML = Array.from({ length: WATER_GLASSES }, (_, i) => `<button type="button" data-water="${i + 1}" aria-label="${i + 1} Glas"></button>`).join("");
$("dayScale").innerHTML = Array.from({ length: 10 }, (_, i) => `<button type="button" role="radio" aria-checked="false" data-rate="${i + 1}">${i + 1}</button>`).join("");
$("dayView").addEventListener("click", e => {
  const m = e.target.closest("[data-mood]"), w = e.target.closest("[data-water]"), r = e.target.closest("[data-rate]");
  if (!m && !w && !r) return;
  if (m) { const v = m.dataset.mood; day.moods = day.moods.includes(v) ? day.moods.filter(x => x !== v) : [...day.moods, v]; }
  if (w) { const n = +w.dataset.water; day.water = day.water === n ? n - 1 : n; }
  if (r) { const n = +r.dataset.rate; day.selfRating = day.selfRating === n ? null : n; }
  paintReflection(); queueSave("day");
});
function paintReflection() {
  $("moods").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(day.moods.includes(b.dataset.mood))));
  $("water").querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.water <= day.water));
  $("waterInfo").textContent = `${day.water} / ${WATER_GLASSES} · ${(day.water * 0.25).toLocaleString("de-CH")} l`;
  $("dayScale").querySelectorAll("button").forEach(b => b.setAttribute("aria-checked", String(+b.dataset.rate === day.selfRating)));
}

const slotsHost = $("slots");
const allRows = ALL_TIMES.map(t => {
  const r = document.createElement("div");
  r.className = "slot" + (t.endsWith(":00") ? " hour" : "");
  r.dataset.t = t; r.setAttribute("role", "row");
  const id = t.replace(":", "");
  r.innerHTML = `<div class="t" role="cell">${t}</div>` +
    `<div class="pc"><input type="text" class="p" id="p${id}" data-ac="slot" aria-label="Geplant ${t}"><span class="du" aria-hidden="true"></span></div>` +
    `<div class="dc"><input type="text" class="d" id="d${id}" data-ac="slot" aria-label="Gemacht ${t}"></div>` +
    `<button class="cp" title="Wie geplant erledigt" aria-label="Plan um ${t} als gemacht übernehmen">✓</button>`;
  slotsHost.insertBefore(r, $("fillHandle"));
  return r;
});
let rows = [];

/* Eigene Bereiche im Zeitplan (z. B. „Energie“, „Ort“): Spalten neben Geplant/Gemacht.
   Name und auf/zu gelten fürs ganze Konto (meta.settings.columns), die Werte stehen pro Zeile in slot.x */
const colSel = el => el.classList.contains("p") ? ".p" : el.classList.contains("d") ? ".d" : `.x[data-col="${el.dataset.col}"]`;
const openColSels = () => [".p", ".d", ...meta.columns.filter(c => c.open).map(c => `.x[data-col="${c.id}"]`)];
function buildColumns() {
  const cols = meta.columns, open = cols.filter(c => c.open).length;
  slotsHost.style.setProperty("--grid", ["3.7em", "minmax(0,1fr)", "minmax(0,1fr)", ...cols.map(c => c.open ? "minmax(0,1fr)" : "2.2em"), "2.2em"].join(" "));
  // Viele Spalten: Zeitplan wird breiter und lässt sich seitlich scrollen statt zu quetschen
  slotsHost.style.minWidth = cols.length ? `${6 + (2 + open) * 7 + (cols.length - open) * 2.2}em` : "";
  const head = slotsHost.querySelector(".slot-h");
  head.querySelectorAll(".xh").forEach(n => n.remove());
  cols.forEach(c => {
    const h = document.createElement("div");
    h.className = "xh" + (c.open ? "" : " shut"); h.dataset.col = c.id;
    h.innerHTML = `<button type="button" class="xh-t" data-xtoggle aria-expanded="${c.open}" title="${c.open ? "Zuklappen" : "Aufklappen"}: ${esc(c.name)}">${esc(c.name)}</button>` +
      (c.open ? `<button type="button" class="xh-e" data-xedit title="Umbenennen oder löschen" aria-label="Bereich ${esc(c.name)} bearbeiten">✎</button>` : "");
    head.insertBefore(h, head.lastElementChild);
  });
  allRows.forEach(r => {
    r.querySelectorAll(".xc").forEach(n => n.remove());
    const cp = r.querySelector(".cp");
    cols.forEach(c => {
      const cell = document.createElement("div");
      cell.className = "xc" + (c.open ? "" : " shut");
      cell.innerHTML = `<input type="text" class="x" data-col="${c.id}" data-ac="slot" list="ac-slot" autocomplete="off" aria-label="${esc(c.name)} ${r.dataset.t}">`;
      r.insertBefore(cell, cp);
    });
  });
}
function columnsChanged() { buildColumns(); renderDay(); queueSave("meta"); }
function editColumn(id) {
  const c = meta.columns.find(x => x.id === id);
  $("tplTitle").textContent = c ? "Bereich bearbeiten" : "Eigenen Bereich hinzufügen";
  $("tplBody").innerHTML = `<p class="sub">${c ? "Neuer Name für diese Spalte im Zeitplan." : "Eine weitere Spalte neben Geplant und Gemacht, z. B. Energie, Ort oder Notiz. Ein Tipp auf ihren Namen klappt sie auf und zu."}</p>` +
    `<input type="text" id="colName" maxlength="40" placeholder="z. B. Energie" autocomplete="off">` +
    (c ? `<div><button type="button" class="btn small del" id="colDel">Bereich löschen</button></div>` : "");
  $("colName").value = c ? c.name : "";
  $("colName").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); dlg.close("ok"); } };
  $("tplOk").textContent = c ? "Speichern" : "Hinzufügen";
  $("tplBody").onclick = e => {
    if (e.target.id !== "colDel") return;
    dlg.close("cancel");
    snapshotForUndo();
    meta.columns = meta.columns.filter(x => x.id !== id);
    columnsChanged(); toast(`Bereich „${c.name}“ gelöscht`);
  };
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok") return;
    const name = $("colName").value.trim(); if (!name) return;
    if (c) c.name = name;
    else meta.columns.push({ id: "c" + Date.now().toString(36), name, open: true });
    columnsChanged();
  };
  dlg.showModal(); setTimeout(() => $("colName").focus(), 30);
}
$("addCol").onclick = () => editColumn(null);
slotsHost.querySelector(".slot-h").addEventListener("click", e => {
  const h = e.target.closest(".xh"); if (!h) return;
  const c = meta.columns.find(x => x.id === h.dataset.col); if (!c) return;
  if (e.target.closest("[data-xedit]")) return editColumn(c.id);
  if (e.target.closest("[data-xtoggle]")) { c.open = !c.open; columnsChanged(); }
});

/* Zeitraum des Zeitplans: pro Tag gespeichert, zuletzt gewählter gilt als Vorgabe für neue Tage */
const rangeOf = d => (d && d.range && d.range.end > d.range.start) ? d.range : (meta.range || DEFAULT_RANGE);
$("rangeStart").innerHTML = ALL_TIMES.map((t, i) => `<option value="${i * 15}">${t}</option>`).join("");
$("rangeEnd").innerHTML = ALL_TIMES.map((t, i) => `<option value="${(i + 1) * 15}">${i === 95 ? "24:00" : hm((i + 1) * 15)}</option>`).join("");
function applyRange() {
  const { start, end } = rangeOf(day);
  rows = allRows.filter(r => { const m = toMin(r.dataset.t); return m >= start && m < end; });
  TIMES = rows.map(r => r.dataset.t);
  allRows.forEach(r => { r.hidden = !rows.includes(r); });
  $("rangeStart").value = start; $("rangeEnd").value = end;
  $("rangeInfo").textContent = `${hm(start)} – ${end === 1440 ? "24:00" : hm(end)}`;
  $("rangeEarlier").hidden = start === 0;
  $("rangeLater").hidden = end === 1440;
  const outside = Object.keys(day.slots).filter(t => { const m = toMin(t); return m < start || m >= end; }).sort();
  $("rangeOut").textContent = outside.length ? `${outside.length} Einträge außerhalb (${outside.slice(0, 3).join(", ")}${outside.length > 3 ? " …" : ""})` : "";
  $("rangeFit").hidden = !outside.length;
  $("rangeFit").textContent = "Zeitraum auf alle Einträge erweitern";
  $("rangeFit").dataset.start = Math.min(start, ...outside.map(toMin));
  $("rangeFit").dataset.end = Math.max(end, ...outside.map(t => toMin(t) + 15));
}
function setRange(start, end) {
  start = Math.max(0, Math.min(1425, start)); end = Math.max(start + 15, Math.min(1440, end));
  day.range = { start, end }; meta.range = { start, end };
  clearSel(); applyRange(); decorateDay();
  queueSave("day"); queueSave("meta");
}
$("rangeStart").addEventListener("change", e => { const s = +e.target.value, r = rangeOf(day); setRange(s, Math.max(r.end, s + 15)); });
$("rangeEnd").addEventListener("change", e => { const en = +e.target.value, r = rangeOf(day); setRange(Math.min(r.start, en - 15), en); });
$("rangeEarlier").onclick = () => { const r = rangeOf(day); setRange(r.start - 60, r.end); rows[0]?.scrollIntoView({ block: "nearest" }); };
$("rangeLater").onclick = () => { const r = rangeOf(day); setRange(r.start, r.end + 60); };
$("rangeFit").onclick = () => setRange(+$("rangeFit").dataset.start, +$("rangeFit").dataset.end);
document.querySelectorAll("[data-ac]").forEach(el => { el.setAttribute("list", "ac-" + el.dataset.ac); el.autocomplete = "off"; });

/* ================= Render Tag ================= */
const getPath = (o, p) => p.split(".").reduce((a, k) => a == null ? a : a[k], o);
function setPath(o, p, v) { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach(k => a = a[k]); a[ks.at(-1)] = v; }

function renderDay() {
  rendering = true;
  renderMore();
  document.querySelectorAll("#dayView [data-k]").forEach(el => {
    const v = getPath(day, el.dataset.k);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v || "";
  });
  allRows.forEach(r => {
    const s = day.slots[r.dataset.t] || {};
    r.querySelector(".p").value = s.p || ""; r.querySelector(".d").value = s.d || "";
    r.querySelectorAll(".x").forEach(x => { x.value = (s.x || {})[x.dataset.col] || ""; });
    r.classList.toggle("pause", !!s.b);
  });
  applyRange();
  const d = parse(current), wd = weekday(current);
  $("longDate").textContent = d.toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("dayKw").textContent = `KW ${isoWeek(current)}`;
  const mon = mondayOf(current), tIso = todayIso();
  $("weekLetters").innerHTML = DAY_SHORT.map((n, i) => {
    const ds = addDays(mon, i);
    return `<button type="button" data-goto="${ds}"${i === wd ? ' aria-current="date"' : ""}${ds === tIso ? ' class="today"' : ""} aria-label="${DAY_NAMES[i]}, ${parse(ds).toLocaleDateString("de-CH")}"><span>${n}</span><b>${parse(ds).getDate()}</b></button>`;
  }).join("");
  $("copyWeekdayBtn").textContent = `Zeitplan vom letzten ${DAY_NAMES[wd]}`;
  const q = QUOTES[Math.floor(d.getTime() / 864e5) % QUOTES.length];
  const qq = document.createElement("q"); qq.textContent = q[0];
  const sm = document.createElement("small"); sm.textContent = q[1];
  $("quote").replaceChildren(qq, sm);

  // Gewohnheiten des Tages aus der Woche
  const host = $("habitsToday"); host.replaceChildren();
  week.habits.forEach((h, i) => {
    if (!h.name.trim()) return;
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" class="check" data-habit="${i}">`;
    l.firstChild.checked = h.days[wd];
    l.append(document.createTextNode(h.name));
    host.appendChild(l);
  });
  const wg = week.goals.map(g => g.text.trim()).filter(Boolean);
  $("weekGoalsHint").textContent = wg.length ? "Wochenziele: " + wg.join(" · ") : "";
  goals.setRef(current);
  paintReflection();
  rendering = false;
  decorateDay();
}

function decorateDay() {
  const t = todayIso(), isToday = current === t, past = current < t;
  const nowD = new Date(), nm = nowD.getHours() * 60 + nowD.getMinutes();
  let planned = 0, met = 0, tracked = 0, pauses = 0;
  const same = (a, b) => a.toLocaleLowerCase("de-CH") === b.toLocaleLowerCase("de-CH");
  allRows.forEach(r => {
    const sm = toMin(r.dataset.t), pause = r.classList.contains("pause");
    const p = r.querySelector(".p").value.trim(), d = r.querySelector(".d").value.trim();
    if (pause) { pauses++; r.classList.remove("met", "missed"); }
    else { if (p) planned++; if (d) tracked++; if (p && d) met++; }
    r.classList.toggle("has-p", !!p && !pause);
    r.classList.toggle("met", !!d && !pause);
    r.classList.toggle("diff", !!d && !!p && !pause && !same(p, d));
    r.classList.toggle("missed", !pause && !!p && !d && (past || (isToday && sm + 15 <= nm)));
    const isNow = isToday && nm >= sm && nm < sm + 15;
    r.classList.toggle("now", isNow);
    if (isNow) { r.style.setProperty("--nowp", ((nm - sm) / 15).toFixed(3)); r.dataset.now = hm(nm); }
  });
  // Gleiche Einträge hintereinander wirken wie ein Block: Folgezeilen ohne Trennlinie, Dauer in der ersten Zeile
  ["p", "d"].forEach(c => {
    const key = x => x && !x.classList.contains("pause") ? x.querySelector("." + c).value.trim().toLocaleLowerCase("de-CH") : "";
    rows.forEach((r, i) => {
      const k = key(r), cont = !!k && key(rows[i - 1]) === k, more = !!k && key(rows[i + 1]) === k;
      r.classList.toggle(c + "-cont", cont);
      r.classList.toggle(c + "-more", more);
      if (c !== "p") return;
      let n = 1; if (k && !cont) while (key(rows[i + n]) === k) n++;
      r.querySelector(".du").textContent = k && !cont && n > 1 ? fmtDur(n * 15) : "";
    });
  });
  // Eigene Bereiche: gleiche Werte hintereinander ebenfalls als Block; zugeklappt zeigt ein Punkt, dass etwas drinsteht
  meta.columns.forEach(c => {
    const sel = `.x[data-col="${c.id}"]`;
    const key = x => x ? (x.querySelector(sel)?.value || "").trim().toLocaleLowerCase("de-CH") : "";
    rows.forEach((r, i) => {
      const inp = r.querySelector(sel); if (!inp) return;
      const k = key(r), cell = inp.parentElement;
      cell.classList.toggle("on", !!k);
      cell.classList.toggle("cont", !!k && key(rows[i - 1]) === k);
      cell.classList.toggle("more", !!k && key(rows[i + 1]) === k);
      cell.title = c.open ? "" : inp.value;
    });
  });
  const miss = x => !!x && x.classList.contains("missed");
  rows.forEach((r, i) => { r.classList.toggle("m-cont", miss(r) && miss(rows[i - 1])); r.classList.toggle("m-more", miss(r) && miss(rows[i + 1])); });
  $("focusBox").classList.toggle("done", !!day.focus.done);
  document.querySelectorAll("#dayView .item").forEach(it => it.classList.toggle("done", it.querySelector(".check").checked));
  const tasks = [...day.cream, ...day.cherries, ...day.more].filter(x => x.t.trim());
  const tasksDone = tasks.filter(x => x.d).length;
  const hrs = (tracked * 15 / 60).toLocaleString("de-CH", { maximumFractionDigits: 2 });
  const wd = weekday(current), habits = week.habits.filter(h => h.name.trim()), habitsDone = habits.filter(h => h.days[wd]).length;
  const meter = (k, v, of, pct, cls = "") => `<div class="meter"><span class="k">${k}</span><span class="v">${v}${of ? ` <small>${of}</small>` : ""}</span>` +
    `<span class="bar"><i class="${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></i></span></div>`;
  $("stats").innerHTML =
    meter("Plan umgesetzt", met, `von ${planned} Blöcken`, planned ? met / planned * 100 : 0) +
    meter("Aufgaben erledigt", tasksDone, `von ${tasks.length}`, tasks.length ? tasksDone / tasks.length * 100 : 0, "g") +
    meter(pauses ? `Getrackt · Pause ${fmtDur(pauses * 15)}` : "Getrackt", hrs, "h", rows.length ? tracked / rows.length * 100 : 0, "d") +
    meter("Gewohnheiten", habitsDone, `von ${habits.length}`, habits.length ? habitsDone / habits.length * 100 : 0);
  $("todoCount").textContent = tasks.length ? `${tasksDone} / ${tasks.length}` : "";
  const journal = [...day.grateful, ...day.forward, ...day.affirm];
  $("journalCount").textContent = `${journal.filter(x => x.trim()).length} von ${journal.length} ausgefüllt`;
  renderLoad();
  positionHandle();
}

// Auslastung: Zeit pro Eintrag; „Cocktail: Video“ und „Cocktail: Mail“ zählen beide als „Cocktail“
const loadKey = v => v.split(":")[0].trim();
const fmtDur = min => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`; };
function loadList(col) {
  const groups = new Map();
  allRows.forEach(r => {
    const name = r.classList.contains("pause") ? "Pause" : loadKey(r.querySelector(col).value); if (!name) return;
    const k = name.toLocaleLowerCase("de-CH");
    const g = groups.get(k) || { name, n: 0 }; g.n++; groups.set(k, g);
  });
  const list = [...groups.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de-CH"));
  const total = list.reduce((s, g) => s + g.n, 0);
  if (!total) return `<li class="sub">Noch nichts eingetragen</li>`;
  return list.map(g => {
    const pct = Math.round(g.n / total * 100);
    return `<li><span class="n" title="${esc(g.name)}">${esc(g.name)}</span><span class="v">${fmtDur(g.n * 15)} · ${pct} %</span>` +
      `<span class="bar"><i style="width:${g.n / list[0].n * 100}%"></i></span></li>`;
  }).join("") + `<li class="sum"><span class="n">Gesamt</span><span class="v">${fmtDur(total * 15)}</span></li>`;
}
function renderLoad() {
  $("loadPlan").innerHTML = loadList(".p");
  $("loadDone").innerHTML = loadList(".d");
}
setInterval(() => { if (view === "day") decorateDay(); }, 60000);

/* ================= Eingaben Tag ================= */
function slotFromRow(r) {
  const t = r.dataset.t, p = r.querySelector(".p").value, d = r.querySelector(".d").value, b = r.classList.contains("pause");
  const x = {}; r.querySelectorAll(".x").forEach(i => { if (i.value) x[i.dataset.col] = i.value; });
  const hasX = Object.keys(x).length > 0;
  if (p || d || b || hasX) { const s = b ? { p, d, b } : { p, d }; if (hasX) s.x = x; day.slots[t] = s; }
  else delete day.slots[t];
}
$("dayView").addEventListener("input", e => {
  if (rendering) return;
  const el = e.target;
  if (el.dataset.k) setPath(day, el.dataset.k, el.type === "checkbox" ? el.checked : el.value);
  else if (el.dataset.habit != null) {
    week.habits[+el.dataset.habit].days[weekday(current)] = el.checked;
    queueSave("week"); decorateDay(); return;
  } else if (el.closest(".slot")) slotFromRow(el.closest(".slot"));
  else return;
  decorateDay(); queueSave("day");
});
slotsHost.addEventListener("click", e => {
  const b = e.target.closest(".cp"); if (!b) return;
  const r = b.closest(".slot"), p = r.querySelector(".p"), d = r.querySelector(".d");
  if (!p.value.trim()) { d.focus(); return; }
  d.value = p.value; slotFromRow(r); ac.learn("slot", p.value); decorateDay(); queueSave("day");
});
// Enter / Pfeile: nächste Zeile derselben Spalte (wie Excel)
slotsHost.addEventListener("keydown", e => {
  const inp = e.target; if (inp.tagName !== "INPUT") return;
  const r = inp.closest(".slot"); const col = colSel(inp);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); fillDown(col); return; }
  if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (e.key === "Enter" && inp.selectionStart !== inp.selectionEnd) inp.setSelectionRange(inp.value.length, inp.value.length);
  inp.dispatchEvent(new Event("change", { bubbles: true }));
  const up = e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey);
  const nx = rows[rows.indexOf(r) + (up ? -1 : 1)];
  if (nx) { e.preventDefault(); nx.querySelector(col).focus(); }
});
// Mehrzeiliges Einfügen (z. B. aus Excel: Zeilen untereinander, Tab trennt Geplant/Gemacht)
slotsHost.addEventListener("paste", e => {
  const inp = e.target; if (inp.tagName !== "INPUT") return;
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!/[\n\t]/.test(text.trim())) return;
  e.preventDefault();
  pasteRows(text, rows.indexOf(inp.closest(".slot")), Math.max(0, openColSels().indexOf(colSel(inp))));
});
function pasteRows(text, startIdx, startCol) {
  snapshotForUndo();
  const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n");
  lines.forEach((line, i) => {
    const r = rows[startIdx + i]; if (!r) return;
    const sels = openColSels();
    line.split("\t").slice(0, sels.length - startCol).forEach((cell, j) => {
      r.querySelector(sels[startCol + j]).value = cell.trim();
    });
    slotFromRow(r);
  });
  decorateDay(); queueSave("day");
  toast(`${Math.min(lines.length, rows.length - startIdx)} Zeilen eingefügt`);
}

/* ================= Markieren & Ausfüllen (Excel-Gefühl) ================= */
let selA = null, selB = null, dragSel = false;
const selRange = () => selA == null ? null : [Math.min(selA, selB), Math.max(selA, selB)];
function paintSel() {
  const r = selRange();
  rows.forEach((row, i) => row.classList.toggle("sel", !!r && i >= r[0] && i <= r[1]));
  $("selbar").hidden = !r;
  if (r) $("selInfo").textContent = `${TIMES[r[0]]} – ${endTime(r[1])} · ${r[1] - r[0] + 1} Zeilen`;
}
function endTime(i) { const x = toMin(TIMES[i]) + 15; return x === 1440 ? "24:00" : hm(x); }
function clearSel() { selA = selB = null; paintSel(); }

slotsHost.addEventListener("pointerdown", e => {
  const t = e.target.closest(".t"); if (!t) return;
  e.preventDefault();
  const i = rows.indexOf(t.parentElement);
  if (e.shiftKey && selA != null) selB = i;
  else if (selA != null && selA === selB && e.pointerType !== "mouse" && i !== selA) selB = i; // Touch: zweites Antippen erweitert
  else if (selA === i && selB === i) { clearSel(); return; }
  else { selA = selB = i; }
  dragSel = true; t.setPointerCapture?.(e.pointerId);
  paintSel();
});
slotsHost.addEventListener("pointermove", e => {
  if (!dragSel) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const r = el && el.closest(".slot");
  if (r) { const i = rows.indexOf(r); if (i >= 0 && i !== selB) { selB = i; paintSel(); } }
});
window.addEventListener("pointerup", () => { dragSel = false; });
document.addEventListener("keydown", e => { if (e.key === "Escape") clearSel(); });

function selectedOrFocusCol(fallback = ".p") {
  const a = document.activeElement;
  return a && a.closest && a.closest(".slot") && a.tagName === "INPUT" ? colSel(a) : fallback;
}
function fillDown(col) {
  const r = selRange(); if (!r || r[0] === r[1]) return;
  snapshotForUndo();
  const v = rows[r[0]].querySelector(col).value;
  for (let i = r[0] + 1; i <= r[1]; i++) { rows[i].querySelector(col).value = v; slotFromRow(rows[i]); }
  decorateDay(); queueSave("day"); toast(`„${v || "leer"}“ in ${r[1] - r[0]} Zeilen ausgefüllt`);
}
let clip = null;
$("selbar").addEventListener("click", async e => {
  const b = e.target.closest("[data-sel]"); if (!b) return;
  const r = selRange(); if (!r && b.dataset.sel !== "close") return;
  const act = b.dataset.sel;
  if (act === "close") return clearSel();
  if (act === "fillPlan") {
    // Ersten nicht-leeren Plan der Auswahl auf alle Zeilen übertragen
    const src = rows.slice(r[0], r[1] + 1).map(x => x.querySelector(".p").value).find(v => v.trim()) || "";
    if (!src) return toast("Trage zuerst in der ersten Zeile etwas ein.", false);
    snapshotForUndo();
    for (let i = r[0]; i <= r[1]; i++) { rows[i].querySelector(".p").value = src; slotFromRow(rows[i]); }
    toast(`Plan „${src}“ ausgefüllt`);
  }
  if (act === "planToDone") {
    snapshotForUndo();
    for (let i = r[0]; i <= r[1]; i++) { const p = rows[i].querySelector(".p").value; if (p) { rows[i].querySelector(".d").value = p; slotFromRow(rows[i]); } }
    toast("Plan als gemacht übernommen");
  }
  if (act === "copy") {
    const sels = openColSels();
    clip = rows.slice(r[0], r[1] + 1).map(x => sels.map(c => x.querySelector(c).value));
    const text = clip.map(c => c.join("\t")).join("\n");
    try { await navigator.clipboard.writeText(text); } catch {}
    toast(`${clip.length} Zeilen kopiert – Zielzeit markieren und „Einfügen“`, false);
  }
  if (act === "paste") {
    if (!clip) { try { const t = await navigator.clipboard.readText(); if (t) return pasteRows(t, r[0], 0); } catch {} return toast("Nichts zum Einfügen kopiert.", false); }
    return pasteRows(clip.map(c => c.join("\t")).join("\n"), r[0], 0);
  }
  if (act === "pause") {
    // Alle markierten Zeilen schon Pause → Pause aufheben, sonst alle als Pause markieren
    const sel = rows.slice(r[0], r[1] + 1), on = !sel.every(x => x.classList.contains("pause"));
    snapshotForUndo();
    sel.forEach(x => { x.classList.toggle("pause", on); slotFromRow(x); });
    toast(on ? `${sel.length * 15} min als Pause markiert` : "Pause aufgehoben");
  }
  if (act === "clear") {
    snapshotForUndo();
    for (let i = r[0]; i <= r[1]; i++) { rows[i].querySelectorAll("input").forEach(x => { x.value = ""; }); rows[i].classList.remove("pause"); slotFromRow(rows[i]); }
    toast("Zeilen geleert");
  }
  decorateDay(); queueSave("day");
});
document.addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey) || selA == null || view !== "day") return;
  const a = document.activeElement;
  if (a && a.tagName === "INPUT" && a.selectionStart !== a.selectionEnd) return; // normale Textauswahl hat Vorrang
  const k = e.key.toLowerCase();
  if (k === "c" && selA !== selB) { e.preventDefault(); $("selbar").querySelector('[data-sel="copy"]').click(); }
  if (k === "d" && !(a && a.closest && a.closest(".slot"))) { e.preventDefault(); fillDown(selectedOrFocusCol()); }
});

// Ausfüllkästchen am fokussierten Feld
let fillFrom = null, fillTo = null, fillCol = null;
function positionHandle() {
  const a = document.activeElement, h = $("fillHandle");
  if (!a || !a.closest || !a.closest(".slot") || a.tagName !== "INPUT" || fillFrom != null && fillTo == null) { if (fillFrom == null) h.hidden = true; return; }
  const box = slotsHost.getBoundingClientRect(), r = a.getBoundingClientRect();
  h.hidden = false;
  h.style.left = (r.right - box.left - (h.offsetWidth || 12) / 2 - 2) + "px";
  h.style.top = (r.bottom - box.top - (h.offsetHeight || 12) / 2 - 1) + "px";
  h.dataset.row = rows.indexOf(a.closest(".slot")); h.dataset.col = colSel(a);
}
slotsHost.addEventListener("focusin", positionHandle);
slotsHost.addEventListener("focusout", () => setTimeout(() => { if (fillFrom == null && !slotsHost.contains(document.activeElement)) $("fillHandle").hidden = true; }, 150));
window.addEventListener("resize", positionHandle);
$("fillHandle").addEventListener("pointerdown", e => {
  e.preventDefault();
  fillFrom = +e.target.dataset.row; fillCol = e.target.dataset.col; fillTo = fillFrom;
  e.target.setPointerCapture(e.pointerId);
});
$("fillHandle").addEventListener("pointermove", e => {
  if (fillFrom == null) return;
  const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains("slot"));
  if (!el || rows.indexOf(el) < 0) return;
  fillTo = rows.indexOf(el);
  const [a, b] = [Math.min(fillFrom, fillTo), Math.max(fillFrom, fillTo)];
  rows.forEach((r, i) => {
    r.classList.toggle("fillpreview", i >= a && i <= b);
    r.querySelectorAll("input").forEach(x => x.classList.toggle("fillcol", x.matches(fillCol)));
  });
  const h = $("fillHandle"), box = slotsHost.getBoundingClientRect(), rr = el.querySelector(fillCol).getBoundingClientRect();
  h.style.top = (rr.bottom - box.top - h.offsetHeight / 2 - 1) + "px";
});
$("fillHandle").addEventListener("pointerup", () => {
  if (fillFrom == null) return;
  const [a, b] = [Math.min(fillFrom, fillTo), Math.max(fillFrom, fillTo)];
  rows.forEach(r => r.classList.remove("fillpreview"));
  if (a !== b) {
    snapshotForUndo();
    const v = rows[fillFrom].querySelector(fillCol).value;
    for (let i = a; i <= b; i++) { rows[i].querySelector(fillCol).value = v; slotFromRow(rows[i]); }
    decorateDay(); queueSave("day");
    toast(`„${v || "leer"}“ in ${b - a} Zeilen ausgefüllt`);
  }
  const src = rows[fillFrom].querySelector(fillCol);
  fillFrom = fillTo = null;
  src.focus(); positionHandle();
});

/* ================= Übernehmen / Kopieren ================= */
async function getDay(date) { return normDay(await store.get("days", date), date); }
async function findLastWeekday(date) {
  for (let k = 1; k <= 8; k++) { const d = await getDay(addDays(date, -7 * k)); if (Object.keys(d.slots).some(t => d.slots[t].p)) return d; }
  return null;
}
function applyPlan(src, field, label) {
  if (!src) return toast("Kein passender Tag mit Zeitplan gefunden.", false);
  snapshotForUndo();
  let n = 0, skipped = 0;
  Object.entries(src.slots).forEach(([t, s]) => {
    const v = s[field]; if (!v || !ALL_TIMES.includes(t)) return;
    const cur = day.slots[t] || { p: "", d: "" };
    if (cur.p) { skipped++; return; }
    day.slots[t] = Object.assign({}, cur, { p: v, d: cur.d || "" }); n++;
  });
  renderDay(); queueSave("day");
  toast(`${n} Zeitblöcke ${label} übernommen${skipped ? ` (${skipped} schon belegt, nicht überschrieben)` : ""}`);
}
$("dayView").querySelector(".copybar").addEventListener("click", async e => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  const kind = b.dataset.copy;
  if (kind === "planYesterday") applyPlan(await getDay(addDays(current, -1)), "p", "von gestern");
  if (kind === "doneAsPlan") applyPlan(await getDay(addDays(current, -1)), "d", "(gestern gemacht) als Plan");
  if (kind === "planLastWeekday") { const d = await findLastWeekday(current); applyPlan(d, "p", d ? `vom ${parse(d.date).toLocaleDateString("de-CH")}` : ""); }
  if (kind === "todosYesterday") {
    const y = await getDay(addDays(current, -1));
    const open = { cream: y.cream.filter(x => x.t.trim() && !x.d), cherries: y.cherries.filter(x => x.t.trim() && !x.d), more: y.more.filter(x => x.t.trim() && !x.d) };
    if (!y.focus.done && y.focus.text.trim() && !day.focus.text.trim()) open.focus = y.focus.text;
    snapshotForUndo();
    let n = 0;
    const all = () => [...day.cream, ...day.cherries, ...day.more];
    ["cream", "cherries", "more"].forEach(k => open[k].forEach(item => {
      if (all().some(x => x.t.trim() === item.t.trim())) return;
      let slot = day[k].find(x => !x.t.trim()) || day.more.find(x => !x.t.trim());
      if (!slot) { slot = { t: "", d: false }; day.more.push(slot); }
      slot.t = item.t; slot.d = false; n++;
    }));
    if (open.focus) { day.focus.text = open.focus; n++; }
    renderDay(); queueSave("day");
    toast(n ? `${n} offene Einträge übernommen` : "Gestern war alles erledigt – nichts zu übernehmen.", n > 0);
  }
});

/* Vorlagen */
const dlg = $("tplDialog");
$("tplSave").onclick = () => {
  const n = Object.values(day.slots).filter(s => s.p).length;
  if (!n) return toast("Der Zeitplan hat noch keine geplanten Einträge.", false);
  $("tplTitle").textContent = "Zeitplan als Vorlage speichern";
  $("tplBody").innerHTML = `<p class="sub">${n} geplante Zeitblöcke werden gespeichert.</p><input type="text" id="tplName" placeholder="z. B. Arbeitstag, Wochenende" list="tplNames"><datalist id="tplNames">${Object.keys(meta.templates).map(k => `<option value="${esc(k)}">`).join("")}</datalist>`;
  $("tplOk").textContent = "Speichern";
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok") return;
    const name = ($("tplName").value || "").trim() || DAY_NAMES[weekday(current)];
    meta.templates[name] = Object.fromEntries(Object.entries(day.slots).filter(([, s]) => s.p).map(([t, s]) => [t, s.p]));
    queueSave("meta"); toast(`Vorlage „${name}“ gespeichert`, false);
  };
  dlg.showModal(); setTimeout(() => $("tplName").focus(), 30);
};
$("tplApply").onclick = () => {
  const names = Object.keys(meta.templates);
  if (!names.length) return toast("Noch keine Vorlage. Plane einen Tag und tippe „Als Vorlage speichern“.", false);
  $("tplTitle").textContent = "Vorlage einfügen";
  $("tplBody").innerHTML = `<p class="sub">Füllt nur leere Plan-Zeilen.</p><div class="tpl-list">${names.map((k, i) =>
    `<label><input type="radio" name="tpl" value="${esc(k)}" ${i ? "" : "checked"}> ${esc(k)} <span class="sub">${Object.keys(meta.templates[k]).length} Blöcke</span><button type="button" class="btn small del" data-del="${esc(k)}">Löschen</button></label>`).join("")}</div>`;
  $("tplOk").textContent = "Einfügen";
  $("tplBody").onclick = e => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    e.preventDefault(); delete meta.templates[d.dataset.del]; queueSave("meta"); d.closest("label").remove();
  };
  dlg.onclose = () => {
    if (dlg.returnValue !== "ok") return;
    const sel = $("tplBody").querySelector("input[name=tpl]:checked"); if (!sel) return;
    const tpl = meta.templates[sel.value];
    applyPlan({ slots: Object.fromEntries(Object.entries(tpl).map(([t, p]) => [t, { p }])) }, "p", `aus „${sel.value}“`);
  };
  dlg.showModal();
};
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ================= Wochenansicht ================= */
const habitBody = $("habitTable").tBodies[0];
for (let i = 0; i < HABIT_ROWS; i++) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td class="num">${i + 1}</td><td><input type="text" id="hn${i}" data-wk="habits.${i}.name" data-ac="habit" list="ac-habit" autocomplete="off" placeholder="${["z. B. Morgenroutine", "z. B. Sport", "", "", "", ""][i]}"></td>` +
    Array.from({ length: 7 }, (_, j) => `<td><input type="checkbox" class="check" data-wk="habits.${i}.days.${j}" aria-label="${DAY_NAMES[j]}"></td>`).join("") +
    `<td class="num" data-sum="${i}"></td>`;
  habitBody.appendChild(tr);
}
[0, 1].forEach(i => {
  $("goal" + i).innerHTML = `<div class="label">⟶ Ziel ${i + 1}:</div>` +
    `<textarea data-wk="goals.${i}.text" rows="3" aria-label="Ziel ${i + 1}"></textarea>` +
    [0, 1, 2].map(j => `<div class="item"><input type="checkbox" class="check" data-wk="goals.${i}.steps.${j}.d" aria-label="Schritt erledigt"><input type="text" data-wk="goals.${i}.steps.${j}.t" data-ac="todo" list="ac-todo" autocomplete="off" placeholder="Schritt"></div>`).join("");
});
$("scale").innerHTML = Array.from({ length: 10 }, (_, i) => `<button type="button" role="radio" aria-checked="false" data-v="${i + 1}">${i + 1}</button>`).join("");

let weekDays = [];
async function renderWeek() {
  rendering = true;
  document.querySelectorAll("#weekView [data-wk]").forEach(el => {
    const v = getPath(week, el.dataset.wk);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v || "";
  });
  [...$("scale").children].forEach(b => b.setAttribute("aria-checked", String(+b.dataset.v === week.meaning)));
  const mon = week.monday, sun = addDays(mon, 6);
  $("weekTitle").textContent = `KW ${isoWeek(mon)} · ${parse(mon).toLocaleDateString("de-CH", { day: "numeric", month: "long" })} – ${parse(sun).toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}`;
  const ti = todayIso(), tIdx = ti >= mon && ti <= sun ? weekday(ti) : -1;
  [...$("habitTable").tHead.rows[0].cells].forEach((c, i) => c.classList.toggle("today", i - 2 === tIdx));
  rendering = false;
  decorateWeek();
  weekDays = await Promise.all(Array.from({ length: 7 }, (_, i) => getDay(addDays(mon, i))));
  if (week.monday !== mon) return;
  if (current >= mon && current <= sun) weekDays[weekday(current)] = day;
  renderOverview();
}
function decorateWeek() {
  week.habits.forEach((h, i) => { habitBody.querySelector(`[data-sum="${i}"]`).textContent = h.name.trim() ? h.days.filter(Boolean).length : ""; });
}
function renderOverview() {
  const mon = week.monday, ti = todayIso();
  const head = `<thead><tr><th></th>${weekDays.map((d, i) => `<th data-open="${d.date}" class="${d.date === ti ? "today" : ""}">${DAY_SHORT[i]} ${parse(d.date).getDate()}.</th>`).join("")}</tr></thead>`;
  const cell = (d, fn) => fn(d);
  const rowsDef = [
    ["Fokus", d => d.focus.text.trim() ? `<td class="${d.focus.done ? "ok" : ""}"><span class="f">${d.focus.done ? "✓ " : ""}${esc(d.focus.text)}</span></td>` : `<td class="sub">–</td>`],
    ["To-dos", d => { const t = [...d.cream, ...d.cherries, ...d.more].filter(x => x.t.trim()); const n = t.filter(x => x.d).length; return t.length ? `<td class="${n === t.length ? "ok" : ""}">${n} / ${t.length}</td>` : `<td class="sub">–</td>`; }],
    ["Plan umgesetzt", d => { const s = Object.values(d.slots).filter(x => !x.b); const p = s.filter(x => x.p).length, m = s.filter(x => x.p && x.d).length; return p ? `<td>${m} / ${p}</td>` : `<td class="sub">–</td>`; }],
    ["Getrackt", d => { const n = Object.values(d.slots).filter(x => x.d && !x.b).length; return n ? `<td>${(n / 4).toLocaleString("de-CH")} h</td>` : `<td class="sub">–</td>`; }],
    ["Pausen", d => { const n = Object.values(d.slots).filter(x => x.b).length; return n ? `<td>${fmtDur(n * 15)}</td>` : `<td class="sub">–</td>`; }],
    ["Gewohnheiten", d => { const hs = week.habits.filter(h => h.name.trim()); return hs.length ? `<td>${hs.filter(h => h.days[weekday(d.date)]).length} / ${hs.length}</td>` : `<td class="sub">–</td>`; }],
    ["Stimmung", d => { const m = [...d.moods, d.moodOther].filter(Boolean); return m.length ? `<td><span class="f">${esc(m.join(", "))}</span></td>` : `<td class="sub">–</td>`; }],
    ["Selbsteinschätzung", d => d.selfRating ? `<td>${d.selfRating} / 10</td>` : `<td class="sub">–</td>`],
    ["Wasser", d => d.water ? `<td class="${d.water >= WATER_GLASSES ? "ok" : ""}">${d.water} / ${WATER_GLASSES}</td>` : `<td class="sub">–</td>`],
    ["Fitness", d => { const f = d.fitness.filter(x => x.t.trim()); const w = d.weight ? `${esc(d.weight)} kg` : ""; return f.length || w ? `<td>${f.length ? `${f.filter(x => x.d).length} / ${f.length}` : ""}${f.length && w ? " · " : ""}${w}</td>` : `<td class="sub">–</td>`; }],
    ["Relax", d => { const r = d.relax.filter(x => x.t.trim()); return r.length ? `<td>${r.filter(x => x.d).length} / ${r.length}</td>` : `<td class="sub">–</td>`; }]
  ];
  $("overview").innerHTML = head + "<tbody>" + rowsDef.map(([label, fn]) => `<tr><th>${label}</th>${weekDays.map(d => cell(d, fn)).join("")}</tr>`).join("") + "</tbody>";

  // Zeitraster
  let html = `<div></div>` + weekDays.map((d, i) => `<div class="hd" data-open="${d.date}">${DAY_SHORT[i]}</div>`).join("");
  const hs = Math.min(...weekDays.map(d => rangeOf(d).start)), he = Math.max(...weekDays.map(d => rangeOf(d).end));
  ALL_TIMES.filter(t => toMin(t) >= hs && toMin(t) < he).forEach(t => {
    html += `<div class="tm">${t.endsWith(":00") ? t : ""}</div>`;
    weekDays.forEach(d => { const s = d.slots[t] || {}; html += `<div class="c${s.b ? " b" : `${s.p ? " p" : ""}${s.d ? " d" : ""}`}" title="${d.date} ${t}${s.b ? " · Pause" : ""}${s.p ? " · Plan: " + esc(s.p) : ""}${s.d ? " · Gemacht: " + esc(s.d) : ""}"></div>`; });
  });
  $("heat").innerHTML = html;

  // Kennzahlen Woche
  const all = weekDays.flatMap(d => Object.values(d.slots)).filter(s => !s.b);
  const planned = all.filter(s => s.p).length, met = all.filter(s => s.p && s.d).length, tracked = all.filter(s => s.d).length;
  const focusDone = weekDays.filter(d => d.focus.done).length;
  const habitTotal = week.habits.filter(h => h.name.trim()).length * 7, habitDone = week.habits.filter(h => h.name.trim()).reduce((a, h) => a + h.days.filter(Boolean).length, 0);
  $("weekStats").innerHTML =
    `<span class="chip">Fokus erledigt <b>${focusDone} / 7</b></span>` +
    `<span class="chip">Plan umgesetzt <b>${planned ? Math.round(met / planned * 100) : 0} %</b></span>` +
    `<span class="chip">Getrackt <b>${(tracked / 4).toLocaleString("de-CH")} h</b></span>` +
    `<span class="chip">Gewohnheiten <b>${habitDone} / ${habitTotal}</b></span>` +
    (() => { const r = weekDays.map(d => d.selfRating).filter(Boolean); return r.length ? `<span class="chip">Ø Tag <b>${(r.reduce((a, b) => a + b, 0) / r.length).toLocaleString("de-CH", { maximumFractionDigits: 1 })} / 10</b></span>` : ""; })();
}
$("weekView").addEventListener("click", e => {
  const o = e.target.closest("[data-open]");
  if (o) { setView("day"); loadDate(o.dataset.open); return; }
  const s = e.target.closest("#scale button");
  if (s) { snapshotForUndo(); week.meaning = week.meaning === +s.dataset.v ? null : +s.dataset.v; renderWeek(); queueSave("week"); }
});
$("weekView").addEventListener("input", e => {
  if (rendering) return;
  const el = e.target; if (!el.dataset.wk) return;
  setPath(week, el.dataset.wk, el.type === "checkbox" ? el.checked : el.value);
  if (el.dataset.wk.endsWith(".name")) { meta.habitNames = week.habits.map(h => h.name); queueSave("meta"); }
  decorateWeek(); queueSave("week");
  if (el.type === "checkbox" && weekDays.length) renderOverview();
});
$("habitsFromLast").onclick = async () => {
  const prev = normWeek(await store.get("weeks", addDays(week.monday, -7)), addDays(week.monday, -7));
  const names = prev.habits.map(h => h.name).some(Boolean) ? prev.habits.map(h => h.name) : meta.habitNames;
  if (!names || !names.some(Boolean)) return toast("In der Vorwoche sind keine Gewohnheiten eingetragen.", false);
  snapshotForUndo();
  week.habits.forEach((h, i) => { if (!h.name.trim() && names[i]) h.name = names[i]; });
  renderWeek(); queueSave("week"); toast("Gewohnheiten übernommen");
};

/* ================= Navigation ================= */
function setView(v) {
  if (!["day", "week", "goals"].includes(v)) v = "day";
  view = v;
  $("dayView").hidden = v !== "day"; $("weekView").hidden = v !== "week"; $("goalsView").hidden = v !== "goals";
  $("tabDay").setAttribute("aria-selected", String(v === "day"));
  $("tabWeek").setAttribute("aria-selected", String(v === "week"));
  $("tabGoals").setAttribute("aria-selected", String(v === "goals"));
  clearSel();
  if (v === "week") renderWeek();
  if (v === "goals") goals.render();
  try { localStorage.setItem("tagesplaner:view", v); } catch {}
}
$("tabDay").onclick = () => setView("day");
$("tabWeek").onclick = () => setView("week");
$("tabGoals").onclick = () => setView("goals");
$("prev").onclick = () => loadDate(addDays(current, view === "week" ? -7 : -1));
$("next").onclick = () => loadDate(addDays(current, view === "week" ? 7 : 1));
$("today").onclick = () => loadDate(todayIso());
$("datePick").addEventListener("change", e => { if (e.target.value) loadDate(e.target.value); });
$("weekLetters").addEventListener("click", e => { const b = e.target.closest("[data-goto]"); if (b) loadDate(b.dataset.goto); });
$("planHelpBtn").onclick = () => { const h = $("planHelp"); h.hidden = !h.hidden; $("planHelpBtn").setAttribute("aria-expanded", String(!h.hidden)); };
// Menü „Tag vorbereiten“ schließt nach einer Aktion und bei Klick daneben
$("prepMenu").addEventListener("click", e => { if (e.target.closest(".prep-pop button")) $("prepMenu").open = false; });
document.addEventListener("click", e => { if ($("prepMenu").open && !$("prepMenu").contains(e.target)) $("prepMenu").open = false; });
$("jumpNow").onclick = async () => {
  if (current !== todayIso()) await loadDate(todayIso());
  $("planBox").open = true;
  const n = slotsHost.querySelector(".slot.now") || rows[0];
  n.scrollIntoView({ block: "center", behavior: "smooth" });
  n.querySelector(".d").focus({ preventScroll: true });
};

function renderAll() { renderDay(); if (view === "week") renderWeek(); }

let loadSeq = 0;
async function loadDate(date, silent) {
  const seq = ++loadSeq;
  await flushAll();
  const mon = mondayOf(date);
  const [d, w] = await Promise.all([store.get("days", date), store.get("weeks", mon)]);
  if (seq !== loadSeq) return;
  if (date !== current) { clearSel(); undoState = null; }
  current = date;
  day = normDay(d, date);
  week = normWeek(w, mon);
  // Neue Woche: Gewohnheitsnamen automatisch übernehmen
  if (!w && meta.habitNames && meta.habitNames.some(Boolean)) week.habits.forEach((h, i) => { h.name = meta.habitNames[i] || ""; });
  $("datePick").value = date;
  renderAll();
  if (!silent) setStatus(d ? "Geladen" : "Neuer Tag");
  loadCalendar();
}

/* ================= Export / Import ================= */
$("exportBtn").onclick = async () => {
  await flushAll();
  const data = await store.all();
  const blob = new Blob([JSON.stringify({ app: "tagesplaner", version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `tagesplaner-${todayIso()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== "tagesplaner") throw new Error("Keine Tagesplaner-Datei");
    let n = 0;
    for (const kind of ["days", "weeks", "meta"]) for (const [id, v] of Object.entries(data[kind] || {})) { await store.set(kind, id, v); n++; }
    await loadMeta(); await loadDate(current);
    toast(`${n} Einträge importiert`, false);
  } catch (err) { toast("Import fehlgeschlagen: " + err.message, false); }
  e.target.value = "";
});
$("logoutBtn").onclick = async () => { await flushAll(); await store.signOut(); location.reload(); };

/* ================= Gmail ================= */
let gmailFilter = "unread", gmailTaken = new Set(), gmailLoading = false;
try { gmailFilter = localStorage.getItem("tagesplaner:gmailFilter") || "unread"; } catch {}
$("gmailFilters").innerHTML = Object.entries(FILTERS).map(([k, f]) => `<button type="button" data-gf="${k}" aria-pressed="false">${f.label}</button>`).join("");
try { $("gmailBox").open = localStorage.getItem("tagesplaner:gmailOpen") !== "0"; } catch { $("gmailBox").open = true; }
$("gmailBox").addEventListener("toggle", () => { try { localStorage.setItem("tagesplaner:gmailOpen", $("gmailBox").open ? "1" : "0"); } catch {} });

function gmailState(msg, showConnect, connectLabel = "Gmail verbinden") {
  $("gmailState").hidden = !msg;
  $("gmailMsg").textContent = msg || "";
  $("gmailConnect").hidden = !showConnect;
  $("gmailConnect").textContent = connectLabel;
}
function paintGmailFilters() {
  $("gmailFilters").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.gf === gmailFilter)));
}
async function loadGmail() {
  paintGmailFilters();
  const token = cachedGoogleToken(GMAIL_SCOPE);
  $("gmailRefresh").hidden = !token;
  if (!token) {
    $("mails").replaceChildren(); $("gmailCount").textContent = "";
    if (store.mode !== "cloud") return gmailState("Gmail braucht die Google-Anmeldung. Melde dich ab und mit Google wieder an.", false);
    return gmailState("Hole deine Mails in den Planer und mach aus einer Mail mit einem Tipp ein To-do oder einen Zeitblock. Nur Lesen – Mails werden nicht gespeichert.", true);
  }
  if (gmailLoading) return;
  gmailLoading = true;
  gmailState("Lädt Mails …", false);
  try {
    const mails = await listMessages(token, FILTERS[gmailFilter].q);
    renderMails(mails);
    gmailState(mails.length ? "" : `Keine Mails unter „${FILTERS[gmailFilter].label}“.`, false);
  } catch (e) {
    $("mails").replaceChildren();
    if (e.code === "expired") { forgetGoogleToken(); gmailState("Die Verbindung ist nach einer Stunde abgelaufen.", true, "Neu verbinden"); }
    else if (e.code === "forbidden") gmailState("Google erlaubt den Zugriff noch nicht: " + e.message + " – siehe README, Abschnitt Gmail.", true, "Erneut versuchen");
    else gmailState("Mails konnten nicht geladen werden: " + e.message, true, "Erneut versuchen");
  } finally { gmailLoading = false; }
}
function renderMails(mails) {
  $("gmailCount").textContent = `${mails.length}${mails.length >= 15 ? "+" : ""} ${FILTERS[gmailFilter].label.toLowerCase()}`;
  const fmt = d => d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-CH", { day: "numeric", month: "short" });
  const email = store.user.email || "";
  $("mails").replaceChildren(...mails.map(m => {
    const li = document.createElement("li");
    li.className = "mail" + (m.unread ? " unread" : "");
    li.innerHTML = `<div class="who"><span></span><span>${fmt(m.date)}</span>${m.starred ? "<span>★</span>" : ""}</div>` +
      `<div class="subj"></div><div class="snip"></div>` +
      `<div class="acts"><button class="btn" data-mail="todo">+ To-do</button><button class="btn" data-mail="slot">+ Zeitplan</button>` +
      `<a class="btn" target="_blank" rel="noopener" href="https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${m.threadId}">Öffnen</a></div>`;
    li.querySelector(".who span").textContent = m.from;
    li.querySelector(".subj").textContent = m.subject;
    li.querySelector(".snip").textContent = m.snippet;
    li.dataset.subject = m.subject; li.dataset.id = m.id;
    if (gmailTaken.has(m.id + ":todo")) markTaken(li.querySelector('[data-mail="todo"]'));
    if (gmailTaken.has(m.id + ":slot")) markTaken(li.querySelector('[data-mail="slot"]'));
    return li;
  }));
}
function markTaken(b) { b.classList.add("done"); b.textContent = "✓ " + b.textContent.replace(/^\+ /, ""); }
$("gmailFilters").addEventListener("click", e => {
  const b = e.target.closest("[data-gf]"); if (!b) return;
  gmailFilter = b.dataset.gf;
  try { localStorage.setItem("tagesplaner:gmailFilter", gmailFilter); } catch {}
  loadGmail();
});
$("gmailRefresh").onclick = loadGmail;
$("gmailConnect").onclick = async () => {
  if (cachedGoogleToken(GMAIL_SCOPE)) return loadGmail();
  gmailState("Bestätige den Zugriff im Google-Fenster …", false);
  try { await connectGoogle(); loadGmail(); loadCalendar(); }
  catch (e) {
    console.error(e);
    gmailState(e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request" ? "Abgebrochen." : "Verbinden fehlgeschlagen: " + (e.message || e.code), true);
  }
};
$("mails").addEventListener("click", e => {
  const b = e.target.closest("[data-mail]"); if (!b || b.classList.contains("done")) return;
  const li = b.closest(".mail"), text = "✉ " + li.dataset.subject;
  snapshotForUndo();
  if (b.dataset.mail === "todo") {
    let slot = day.more.find(x => !x.t.trim());
    if (!slot) { slot = { t: "", d: false }; day.more.push(slot); }
    slot.t = text; slot.d = false;
    toast("Als To-do übernommen");
  } else {
    // Ab markierter Zeile, sonst ab jetzt (heute) bzw. 08:00: erster freier Plan-Block
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    let start = selRange() ? selRange()[0]
      : current === todayIso() ? Math.max(0, TIMES.findIndex(t => { const [h, m] = t.split(":").map(Number); return h * 60 + m + 15 > nm; }))
      : Math.max(0, TIMES.indexOf("08:00"));
    if (start < 0) start = TIMES.length - 1;
    const i = rows.findIndex((r, k) => k >= start && !r.classList.contains("pause") && !r.querySelector(".p").value.trim());
    if (i < 0) { undoState = null; return toast("Kein freier Zeitblock mehr ab dieser Zeit.", false); }
    rows[i].querySelector(".p").value = text; slotFromRow(rows[i]);
    rows[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
    toast(`Um ${TIMES[i]} eingeplant`);
  }
  gmailTaken.add(li.dataset.id + ":" + b.dataset.mail); markTaken(b);
  renderDay(); queueSave("day");
});

/* ================= Google Kalender ================= */
// Termine des Tages als Blöcke in „Geplant“. day.cal merkt sich pro Termin, welche Zeilen er belegt hat:
// so kommt ein gelöschter Block nicht wieder, und ein verschobener oder abgesagter Termin räumt seine Blöcke auf,
// solange sie noch unverändert sind. In „Gemacht“ und in belegte Zeilen wird nie geschrieben.
const CAL_MARK = "📅 ";
let calEvents = null, calDate = null, calSeq = 0;
try { $("calBox").open = localStorage.getItem("tagesplaner:calOpen") !== "0"; } catch { $("calBox").open = true; }
$("calBox").addEventListener("toggle", () => { try { localStorage.setItem("tagesplaner:calOpen", $("calBox").open ? "1" : "0"); } catch {} });

function calState(msg, showConnect, connectLabel = "Kalender verbinden") {
  $("calState").hidden = !msg;
  $("calMsg").textContent = msg || "";
  $("calConnect").hidden = !showConnect;
  $("calConnect").textContent = connectLabel;
}
const calTimes = ev => {
  const out = [], a = Math.floor(ev.start / 15) * 15, b = Math.max(a + 15, Math.ceil(ev.end / 15) * 15);
  for (let m = a; m < b && m < 1440; m += 15) out.push(hm(m));
  return out;
};
const fmtSpan = ev => ev.allDay ? "ganztägig" : `${hm(ev.start)} – ${ev.end === 1440 ? "24:00" : hm(ev.end)}`;

/** Gleicht day mit den Terminen ab. ids: nur diese Termine (neu) eintragen; sonst alle. Gibt Zähler zurück. */
function applyCalendar(events, ids) {
  const known = day.cal && typeof day.cal === "object" ? day.cal : (day.cal = {});
  const n = { added: 0, removed: 0, busy: 0 };
  const clearOld = c => (c.t || []).filter(t => {
    const s = day.slots[t]; if (!s || s.p !== c.p) return false;
    s.p = ""; if (!s.d && !s.b && !s.x) delete day.slots[t];
    return true;
  }).length;
  if (!ids) for (const [id, c] of Object.entries(known)) {
    const ev = events.find(e => e.id === id);
    if (ev && ev.updated === c.u) continue;
    const cleared = clearOld(c); delete known[id];
    if (!ev && cleared) n.removed++;
  }
  for (const ev of events) {
    if (ids ? !ids.has(ev.id) : known[ev.id]) continue;
    if (known[ev.id]) { clearOld(known[ev.id]); delete known[ev.id]; }
    const p = CAL_MARK + ev.title;
    if (ev.allDay) {
      // Ganztägige Termine gehören zu „Termine & Notizen“, nicht in den Zeitplan
      if (!day.appts.split("\n").some(l => l.trim() === p)) { day.appts = (day.appts.trim() ? day.appts.replace(/\s+$/, "") + "\n" : "") + p; n.added++; }
      known[ev.id] = { u: ev.updated, p, t: [] };
      continue;
    }
    const t = calTimes(ev).filter(x => { const s = day.slots[x]; return !s || (!s.p && !s.b); });
    t.forEach(x => { day.slots[x] = Object.assign({ p: "", d: "" }, day.slots[x], { p }); });
    known[ev.id] = { u: ev.updated, p, t };
    if (t.length) n.added++; else n.busy++;
  }
  if (!Object.keys(known).length) delete day.cal;
  return n;
}
function calToast(n, auto) {
  const parts = [];
  if (n.added) parts.push(`${n.added} ${n.added === 1 ? "Termin" : "Termine"} aus dem Kalender eingetragen`);
  if (n.removed) parts.push(`${n.removed} abgesagt und entfernt`);
  if (n.busy) parts.push(`${n.busy} nicht eingetragen (Zeit schon belegt)`);
  if (parts.length) toast(parts.join(" · "), !auto);
  else if (!auto) toast("Alle Termine stehen schon im Plan.", false);
}
function renderEvents() {
  const evs = calEvents || [];
  $("calCount").textContent = calEvents ? (evs.length ? `${evs.length} ${evs.length === 1 ? "Termin" : "Termine"}` : "keine Termine") : "";
  $("calImport").hidden = !evs.length;
  const known = day.cal || {};
  $("events").replaceChildren(...evs.map(ev => {
    const li = document.createElement("li");
    li.className = "mail event"; li.dataset.id = ev.id;
    const inPlan = known[ev.id] && (ev.allDay || known[ev.id].t.some(t => day.slots[t]?.p === known[ev.id].p));
    li.innerHTML = `<div class="when"><i></i><span></span><span></span></div><div class="subj"></div>` +
      `<div class="acts"><button class="btn${inPlan ? " done" : ""}" data-cal="add">${inPlan ? "✓ Im Plan" : "+ Zeitplan"}</button>` +
      (ev.link ? `<a class="btn" target="_blank" rel="noopener">Öffnen</a>` : "") + `</div>`;
    const [when, cal] = li.querySelectorAll(".when span");
    when.textContent = fmtSpan(ev); cal.textContent = ev.calendar;
    if (ev.color) li.querySelector(".when i").style.background = ev.color;
    li.querySelector(".subj").textContent = ev.title;
    if (ev.link) li.querySelector("a").href = ev.link;
    return li;
  }));
}
async function loadCalendar() {
  if (!store) return;
  $("calAuto").checked = meta.calAuto !== false;
  const token = cachedGoogleToken(CALENDAR_SCOPE), date = current, seq = ++calSeq;
  if (calDate !== date) { calEvents = null; calDate = date; }
  $("calRefresh").hidden = !token;
  if (!token) {
    calEvents = null; renderEvents();
    if (store.mode !== "cloud") return calState("Der Kalender braucht die Google-Anmeldung. Melde dich ab und mit Google wieder an.", false);
    return calState("Verbinde deinen Google Kalender: Die Termine des Tages erscheinen hier und werden als Blöcke in „Geplant“ eingetragen. Nur Lesen – in deinem Kalender wird nichts geändert.", true);
  }
  if (!calEvents) calState("Lädt Termine …", false);
  try {
    const evs = await listEvents(token, date);
    if (seq !== calSeq || date !== current) return;
    calEvents = evs;
    if ($("calAuto").checked && date >= todayIso()) {
      const before = JSON.stringify([day.slots, day.appts, day.cal]);
      const n = applyCalendar(evs);
      if (JSON.stringify([day.slots, day.appts, day.cal]) !== before) { renderDay(); queueSave("day"); }
      calToast(n, true);
    }
    renderEvents();
    calState(evs.length ? "" : "Keine Termine an diesem Tag.", false);
  } catch (e) {
    if (seq !== calSeq) return;
    calEvents = null; renderEvents();
    if (e.code === "expired") { forgetGoogleToken(); calState("Die Verbindung ist nach einer Stunde abgelaufen. Neu verbinden, damit neue Termine eingetragen werden.", true, "Neu verbinden"); }
    else if (e.code === "forbidden") calState("Google erlaubt den Zugriff noch nicht: " + e.message + " – siehe README, Abschnitt Google Kalender.", true, "Erneut verbinden");
    else calState("Termine konnten nicht geladen werden: " + e.message, true, "Erneut versuchen");
  }
}
$("calRefresh").onclick = loadCalendar;
$("calConnect").onclick = async () => {
  if ($("calConnect").textContent === "Erneut verbinden") forgetGoogleToken();
  if (cachedGoogleToken(CALENDAR_SCOPE)) return loadCalendar();
  calState("Bestätige den Zugriff im Google-Fenster …", false);
  try { await connectGoogle(); loadCalendar(); loadGmail(); }
  catch (e) {
    console.error(e);
    calState(e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request" ? "Abgebrochen." : "Verbinden fehlgeschlagen: " + (e.message || e.code), true);
  }
};
$("calAuto").addEventListener("change", e => {
  meta.calAuto = e.target.checked; queueSave("meta");
  if (meta.calAuto) loadCalendar();
});
function importCalendar(ids) {
  if (!calEvents || !calEvents.length) return;
  snapshotForUndo();
  const n = applyCalendar(calEvents, ids);
  renderDay(); renderEvents(); queueSave("day");
  calToast(n, false);
}
$("calImport").onclick = () => importCalendar(new Set(calEvents.map(e => e.id)));
$("events").addEventListener("click", e => {
  const b = e.target.closest("[data-cal]"); if (!b) return;
  importCalendar(new Set([b.closest(".event").dataset.id]));
});

/* ================= Bereiche auf-/zuklappen ================= */
// Zustand pro Bereich nur in diesem Browser (Komfort, keine Planer-Daten)
document.querySelectorAll("details[data-fold]").forEach(d => {
  try { const v = localStorage.getItem("tagesplaner:fold:" + d.dataset.fold); if (v != null) d.open = v === "1"; } catch {}
  d.addEventListener("toggle", () => { try { localStorage.setItem("tagesplaner:fold:" + d.dataset.fold, d.open ? "1" : "0"); } catch {} });
});
document.addEventListener("click", e => {
  const b = e.target.closest("[data-foldall]"); if (!b) return;
  const open = b.dataset.foldall === "1";
  b.closest(".view").querySelectorAll("details[data-fold], details.gmail").forEach(d => { d.open = open; });
});

/* Ziele: Bereiche in Tag, Woche und Zielübersicht */
goals.mount($("dayGoals"), "day");
goals.mount($("weekGoals"), "week");
goals.mount($("goalsView"), "tree");

/* ================= Start ================= */
async function loadMeta() {
  const [v, s, g] = await Promise.all([store.get("meta", "vocab"), store.get("meta", "settings"), store.get("meta", "goals")]);
  meta.vocab = v || {}; meta.templates = (s && s.templates) || {}; meta.habitNames = (s && s.habitNames) || [];
  meta.range = s && s.range && s.range.end > s.range.start ? s.range : null;
  meta.calAuto = !(s && s.calAuto === false);
  meta.columns = (s && Array.isArray(s.columns) ? s.columns : []).filter(c => c && c.id && c.name).map(c => ({ id: String(c.id), name: String(c.name), open: c.open !== false }));
  buildColumns();
  goals.load(g);
  ac.load(meta.vocab);
  // Erste Nutzung: Vorschläge aus den letzten 14 Tagen lernen
  if (!v || !Object.keys(v.slot || {}).length) {
    const days = await Promise.all(Array.from({ length: 14 }, (_, i) => store.get("days", addDays(todayIso(), -i - 1))));
    days.filter(Boolean).forEach(d => {
      Object.values(d.slots || {}).forEach(s => { if (s.p) ac.learn("slot", s.p); if (s.d) ac.learn("slot", s.d); });
      [...(d.cream || []), ...(d.cherries || [])].forEach(x => x.t && ac.learn("todo", x.t));
    });
  }
}

async function start(s) {
  if (store && store.mode === s.mode && store.user.email === s.user.email) return;
  store = s;
  $("login").hidden = true; $("app").hidden = false;
  $("userName").textContent = s.mode === "cloud" ? (s.user.name.split(" ")[0] || "Konto") : "Lokal";
  $("userInfo").textContent = s.mode === "cloud" ? `${s.user.name} · ${s.user.email}` : s.user.email;
  $("logoutBtn").textContent = s.mode === "cloud" ? "Abmelden" : "Zur Anmeldung";
  $("foot").textContent = s.mode === "cloud"
    ? "Alles wird automatisch in deinem Google-Konto gespeichert und auf allen Geräten synchronisiert."
    : "Ohne Konto: Einträge liegen nur in diesem Browser. Für alle Geräte mit Google anmelden.";
  setStatus("Lädt …");
  await loadMeta();
  let v = "day"; try { v = localStorage.getItem("tagesplaner:view") || "day"; } catch {}
  await loadDate(todayIso());
  setView(v);
  loadGmail();
}

function showLogin(msg) {
  $("app").hidden = true; $("login").hidden = false;
  $("googleLogin").hidden = !cloudAvailable;
  $("loginMsg").textContent = msg || (cloudAvailable ? "" : "Google-Anmeldung ist noch nicht eingerichtet (siehe README). Du kannst die App schon lokal nutzen.");
}
$("googleLogin").onclick = async () => {
  $("loginMsg").textContent = "";
  try { await signInWithGoogle(); }
  catch (e) { $("loginMsg").textContent = e.code === "auth/unauthorized-domain" ? "Diese Adresse ist in Firebase noch nicht freigegeben (Authentication → Einstellungen → Autorisierte Domains)." : "Anmeldung abgebrochen oder fehlgeschlagen."; }
};
$("localLogin").onclick = () => start(useLocal());

watchAuth((s, msg) => s ? start(s) : showLogin(msg));
