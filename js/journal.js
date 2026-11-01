// Gedanken-Journal: über den Tag Gedanken, Ideen, Rückmeldungen und Erkenntnisse festhalten,
// nach Zeitraum durchsehen und von der KI auswerten lassen (bis zu einem Jahr und mehr).
//
// Speicher: ein Dokument pro Monat unter journal/<JJJJ-MM> = { entries: [{ id, date, time, kind, text, at }] }.
// Auswertungen unter reviews/<Zeitstempel>. Der Anthropic-Schlüssel liegt im Browser und auf Wunsch unter secrets/anthropic.
import { KINDS, SYSTEM_PROMPT, fullPrompt, estimateTokens, analyze, renderMarkdown, localKey, saveLocalKey, MODEL } from "./insights.js";

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); return iso(new Date(y, m - 1, d + n)); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtDate = s => { const [y, m, d] = s.split("-"); return `${d}.${m}.${y}`; };
const longDate = s => new Date(s + "T12:00:00").toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

const PRESETS = [
  { id: "today", label: "Heute", days: 1 },
  { id: "7", label: "7 Tage", days: 7 },
  { id: "30", label: "30 Tage", days: 30 },
  { id: "90", label: "3 Monate", days: 91 },
  { id: "365", label: "12 Monate", days: 365 },
  { id: "custom", label: "Zeitraum …" }
];
const CAPTURE_KINDS = ["gedanke", "idee", "rueckmeldung", "erkenntnis"];

/**
 * deps: getStore() → aktueller Speicher, beforeLoad() → offene Änderungen speichern,
 * toast(text, onUndo), openDay(date)
 */
export function createJournal({ getStore, beforeLoad, toast, openDay }) {
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem("tagesplaner:jr" + k); localStorage.setItem("tagesplaner:jr" + k, v); } catch {} return null; };
  let preset = ls("Preset") || "30";
  let kind = ls("Kind") || "gedanke";
  let filterKind = "", search = "";
  let includeDays = ls("Days") !== "0";
  let custom = { from: addDays(iso(new Date()), -29), to: iso(new Date()) };
  let entries = [], loadedFor = "", loading = false;
  let reviews = [], key = "", running = null;

  /* ---------- Zeitraum ---------- */
  function range() {
    const today = iso(new Date());
    if (preset === "custom") return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
    const p = PRESETS.find(x => x.id === preset) || PRESETS[2];
    return { from: addDays(today, -(p.days - 1)), to: today };
  }
  function months(from, to) { return [from.slice(0, 7), to.slice(0, 7)]; }

  /* ---------- Laden & Speichern ---------- */
  async function load(force) {
    const store = getStore(); if (!store) return;
    const { from, to } = range();
    const sig = `${from}|${to}|${includeDays}`;
    if (!force && sig === loadedFor) return render();
    loading = true; renderInfo();
    try {
      await beforeLoad();
      const [mf, mt] = months(from, to);
      const [docs, days] = await Promise.all([
        store.range("journal", mf, mt),
        includeDays ? store.range("days", from, to) : Promise.resolve({})
      ]);
      const list = [];
      Object.values(docs).forEach(d => (d.entries || []).forEach(e => { if (e.date >= from && e.date <= to) list.push(e); }));
      Object.entries(days).forEach(([date, d]) => {
        const t = (d && d.ideas || "").trim();
        if (t) list.push({ id: "day:" + date, date, time: "", kind: "tag", text: t });
      });
      entries = list;
      loadedFor = sig;
    } catch (e) {
      console.error(e);
      toast("Gedanken konnten nicht geladen werden: " + e.message);
    } finally { loading = false; }
    render();
  }

  // Vor jedem Schreiben den Monat frisch holen, damit Einträge von anderen Geräten nicht verloren gehen.
  async function updateMonth(date, fn) {
    const store = getStore();
    const id = date.slice(0, 7);
    const doc = (await store.get("journal", id)) || { entries: [] };
    doc.entries = fn(doc.entries || []);
    doc.updatedAt = new Date().toISOString();
    await store.set("journal", id, doc);
  }

  async function add(text, k, when = new Date()) {
    const e = { id: newId(), date: iso(when), time: `${pad(when.getHours())}:${pad(when.getMinutes())}`, kind: k, text, at: when.toISOString() };
    entries.push(e); render();
    try { await updateMonth(e.date, list => [...list, e]); }
    catch (err) { console.error(err); toast("Speichern fehlgeschlagen: " + err.message); }
    return e;
  }
  async function restore(e) {
    entries.push(e); render();
    await updateMonth(e.date, list => list.some(x => x.id === e.id) ? list : [...list, e]);
  }
  async function remove(id) {
    const e = entries.find(x => x.id === id); if (!e) return;
    entries = entries.filter(x => x.id !== id); render();
    try { await updateMonth(e.date, list => list.filter(x => x.id !== id)); toast("Eintrag gelöscht", () => restore(e)); }
    catch (err) { console.error(err); toast("Löschen fehlgeschlagen: " + err.message); }
  }
  async function edit(id, patch) {
    const e = entries.find(x => x.id === id); if (!e) return;
    Object.assign(e, patch, { editedAt: new Date().toISOString() }); render();
    try { await updateMonth(e.date, list => list.map(x => x.id === id ? { ...x, ...patch, editedAt: e.editedAt } : x)); }
    catch (err) { console.error(err); toast("Speichern fehlgeschlagen: " + err.message); }
  }

  /* ---------- Anzeige ---------- */
  function visible() {
    const q = search.trim().toLowerCase();
    return entries
      .filter(e => !filterKind || e.kind === filterKind)
      .filter(e => !q || e.text.toLowerCase().includes(q))
      .sort((a, b) => (b.date + (b.time || "99")).localeCompare(a.date + (a.time || "99")));
  }
  const withTags = t => esc(t).replace(/(^|\s)(#[\p{L}\p{N}_-]+)/gu, '$1<span class="jr-tag">$2</span>');

  function renderPresets() {
    $("jrPresets").innerHTML = PRESETS.map(p => `<button type="button" data-preset="${p.id}" aria-pressed="${p.id === preset}">${p.label}</button>`).join("");
    $("jrCustom").hidden = preset !== "custom";
    $("jrFrom").value = custom.from; $("jrTo").value = custom.to;
  }
  function renderKinds() {
    $("jrKinds").innerHTML = CAPTURE_KINDS.map(k => `<button type="button" role="radio" data-kind="${k}" aria-checked="${k === kind}">${KINDS[k].icon} ${KINDS[k].label}</button>`).join("");
    $("jrText").placeholder = {
      gedanke: "Was geht dir gerade durch den Kopf?",
      idee: "Welche Idee hattest du? Auch halbfertige zählen.",
      rueckmeldung: "Welche Rückmeldung hast du bekommen oder dir selbst gegeben?",
      erkenntnis: "Was hast du heute verstanden oder gelernt?"
    }[kind] + "  #Stichworte helfen beim Wiederfinden";
  }
  function renderInfo() {
    const { from, to } = range();
    const vis = visible();
    const counts = Object.keys(KINDS).map(k => [k, vis.filter(e => e.kind === k).length]).filter(([, n]) => n);
    $("jrStats").innerHTML = loading ? "Lädt …" :
      `${fmtDate(from)} – ${fmtDate(to)} · <b>${vis.length}</b> ${vis.length === 1 ? "Eintrag" : "Einträge"}` +
      (counts.length ? " · " + counts.map(([k, n]) => `${KINDS[k].icon} ${n}`).join("  ") : "");
    const tokens = vis.length ? estimateTokens(fullPrompt(vis, from, to, $("jrFocus").value)) : 0;
    const cost = tokens * 4 / 1e6 + 0.15; // grob: Eingabe $4 / Mio. Tokens, dazu die Antwort
    $("jrAiInfo").textContent = vis.length
      ? `Ausgewertet ${vis.length === 1 ? "wird der angezeigte Eintrag" : `werden die ${vis.length} angezeigten Einträge`} (${fmtDate(from)} – ${fmtDate(to)}), ca. ${tokens.toLocaleString("de-CH")} Tokens` +
        (key ? `, Kosten ${cost < 0.5 ? "unter 0.50" : "etwa " + cost.toFixed(2)} US-Dollar.` : ".")
      : "Im gewählten Zeitraum gibt es noch keine Einträge.";
    $("jrAnalyze").disabled = !vis.length || !!running;
    $("jrCopy").disabled = !vis.length;
    $("jrAnalyze").title = key ? "" : "Zuerst unten unter „KI-Zugang“ einen Anthropic-Schlüssel hinterlegen";
  }
  function render() {
    renderInfo();
    const vis = visible();
    if (!vis.length) {
      $("jrList").innerHTML = `<p class="sub jr-empty">${loading ? "Lädt …" : entries.length ? "Keine Einträge passen zum Filter." : "Noch nichts festgehalten. Fang oben mit deinem ersten Gedanken an."}</p>`;
      return;
    }
    let html = "", last = "";
    for (const e of vis) {
      if (e.date !== last) { if (last) html += "</div>"; html += `<h3 class="jr-day">${esc(longDate(e.date))}</h3><div class="jr-group">`; last = e.date; }
      const k = KINDS[e.kind] || KINDS.gedanke;
      const day = e.kind === "tag";
      html += `<article class="jr-entry k-${esc(e.kind)}" data-id="${esc(e.id)}">` +
        `<div class="jr-meta"><span class="jr-time">${esc(e.time || "")}</span><span class="jr-kind">${k.icon} ${k.label}</span>` +
        `<span class="jr-acts">${day
          ? `<button type="button" data-jr="day" data-date="${esc(e.date)}">Zum Tag</button>`
          : `<button type="button" data-jr="edit">Bearbeiten</button><button type="button" data-jr="del">Löschen</button>`}</span></div>` +
        `<div class="jr-text">${withTags(e.text)}</div></article>`;
    }
    $("jrList").innerHTML = html + "</div>";
  }

  function startEdit(art) {
    const e = entries.find(x => x.id === art.dataset.id); if (!e) return;
    art.classList.add("editing");
    art.querySelector(".jr-text").innerHTML =
      `<textarea rows="3" aria-label="Eintrag bearbeiten">${esc(e.text)}</textarea>` +
      `<div class="jr-edit-row"><select aria-label="Art">${CAPTURE_KINDS.map(k => `<option value="${k}"${k === e.kind ? " selected" : ""}>${KINDS[k].icon} ${KINDS[k].label}</option>`).join("")}</select>` +
      `<button type="button" class="btn small primary" data-jr="save">Speichern</button><button type="button" class="btn small" data-jr="cancel">Abbrechen</button></div>`;
    art.querySelector(".jr-acts").hidden = true;
    const ta = art.querySelector("textarea"); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /* ---------- KI ---------- */
  async function initKey() {
    const store = getStore();
    key = localKey();
    $("jrSyncLabel").hidden = !store || store.mode !== "cloud";
    if (!key && store && store.mode === "cloud") {
      try { key = (await store.get("secrets", "anthropic"))?.key || ""; } catch (e) { console.error(e); }
      if (key) saveLocalKey(key);
    }
    renderKey();
  }
  function renderKey() {
    $("jrKeySet").hidden = !!key; $("jrKeyOk").hidden = !key;
    $("jrKeyState").textContent = key ? "verbunden" : "nicht verbunden";
    renderInfo();
  }
  async function saveKey() {
    const k = $("jrKey").value.trim();
    if (!/^sk-ant-/.test(k)) return toast("Das sieht nicht nach einem Anthropic-Schlüssel aus (beginnt mit „sk-ant-“).");
    key = k; saveLocalKey(k); $("jrKey").value = "";
    const store = getStore();
    if (store.mode === "cloud" && $("jrSync").checked) {
      try { await store.set("secrets", "anthropic", { key: k, savedAt: new Date().toISOString() }); } catch (e) { console.error(e); }
    }
    renderKey(); toast("KI-Zugang gespeichert");
  }
  async function forgetKey() {
    key = ""; saveLocalKey("");
    const store = getStore();
    if (store.mode === "cloud") { try { await store.remove("secrets", "anthropic"); } catch (e) { console.error(e); } }
    renderKey(); toast("KI-Zugang entfernt");
  }

  async function loadReviews() {
    try {
      const r = await getStore().range("reviews", "0", "9~");
      reviews = Object.entries(r).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.id.localeCompare(a.id));
    } catch (e) { console.error(e); reviews = []; }
    renderReviews();
  }
  function renderReviews() {
    $("jrReviewCount").textContent = reviews.length ? `(${reviews.length})` : "";
    $("jrReviewList").innerHTML = reviews.length ? reviews.map(r =>
      `<div class="jr-review" data-rid="${esc(r.id)}"><button type="button" class="jr-review-open" data-jr="review">` +
      `<b>${fmtDate(r.from)} – ${fmtDate(r.to)}</b><span class="sub">${r.count} Einträge · erstellt ${esc(new Date(r.createdAt).toLocaleDateString("de-CH"))}${r.focus ? " · " + esc(r.focus) : ""}</span></button>` +
      `<button type="button" class="jr-review-del" data-jr="review-del" aria-label="Auswertung löschen">✕</button></div>`).join("")
      : `<p class="sub">Noch keine gespeicherten Auswertungen.</p>`;
  }
  function showResult(text, head) {
    $("jrResult").hidden = !text;
    $("jrResult").innerHTML = (head ? `<p class="sub jr-result-head">${esc(head)}</p>` : "") + renderMarkdown(text || "");
  }

  async function runAnalysis() {
    if (!key) { $("jrKeyBox").open = true; $("jrKey").focus(); return toast("Für die Auswertung in der App braucht es einen Anthropic-Schlüssel. Ohne Schlüssel: „Prompt kopieren“ und in claude.ai einfügen."); }
    const vis = visible(); if (!vis.length) return;
    const { from, to } = range();
    const focus = $("jrFocus").value.trim();
    const ctrl = new AbortController();
    running = ctrl;
    $("jrStop").hidden = false; renderInfo();
    showResult("_Claude liest deine Einträge …_");
    try {
      const r = await analyze({ key, entries: vis, from, to, focus, signal: ctrl.signal, onText: t => showResult(t) });
      showResult(r.text, `Auswertung ${fmtDate(from)} – ${fmtDate(to)} · ${vis.length} ${vis.length === 1 ? "Eintrag" : "Einträge"}`);
      const now = new Date();
      const id = now.toISOString().replace(/[:.]/g, "-");
      const review = { from, to, focus, count: vis.length, model: r.model || MODEL, createdAt: now.toISOString(), text: r.text };
      try { await getStore().set("reviews", id, review); reviews.unshift({ id, ...review }); renderReviews(); }
      catch (e) { console.error(e); toast("Auswertung konnte nicht gespeichert werden: " + e.message); }
    } catch (e) {
      if (e.code === "aborted") showResult("_Abgebrochen._");
      else {
        showResult("");
        toast(e.message);
        if (e.code === "unauthorized") { await forgetKey(); $("jrKeyBox").open = true; }
      }
    } finally {
      running = null; $("jrStop").hidden = true; renderInfo();
    }
  }

  async function copyPrompt() {
    const vis = visible(); if (!vis.length) return;
    const { from, to } = range();
    const text = fullPrompt(vis, from, to, $("jrFocus").value);
    try { await navigator.clipboard.writeText(text); toast(`Prompt mit ${vis.length} Einträgen kopiert – in claude.ai einfügen`); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("Prompt kopiert"); } catch { toast("Kopieren nicht möglich"); }
      ta.remove();
    }
  }

  /* ---------- Ereignisse ---------- */
  $("jrForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    const t = $("jrText").value.trim(); if (!t) return $("jrText").focus();
    $("jrText").value = "";
    const today = iso(new Date());
    if (range().to < today || range().from > today) { preset = "30"; ls("Preset", preset); renderPresets(); await load(true); }
    await add(t, kind);
    $("jrText").focus();
  });
  $("jrText").addEventListener("keydown", ev => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $("jrForm").requestSubmit(); } });
  $("jrKinds").addEventListener("click", ev => { const b = ev.target.closest("[data-kind]"); if (!b) return; kind = b.dataset.kind; ls("Kind", kind); renderKinds(); $("jrText").focus(); });
  $("jrPresets").addEventListener("click", ev => { const b = ev.target.closest("[data-preset]"); if (!b) return; preset = b.dataset.preset; ls("Preset", preset); renderPresets(); load(); });
  ["jrFrom", "jrTo"].forEach(id => $(id).addEventListener("change", () => { if ($("jrFrom").value && $("jrTo").value) { custom = { from: $("jrFrom").value, to: $("jrTo").value }; load(); } }));
  $("jrFilterKind").innerHTML = `<option value="">Alle Arten</option>` + Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join("");
  $("jrFilterKind").addEventListener("change", ev => { filterKind = ev.target.value; render(); });
  $("jrSearch").addEventListener("input", ev => { search = ev.target.value; render(); });
  $("jrDays").checked = includeDays;
  $("jrDays").addEventListener("change", ev => { includeDays = ev.target.checked; ls("Days", includeDays ? "1" : "0"); load(); });
  $("jrFocus").addEventListener("input", renderInfo);
  $("jrList").addEventListener("click", ev => {
    const b = ev.target.closest("[data-jr]"); if (!b) return;
    const art = b.closest(".jr-entry");
    const act = b.dataset.jr;
    if (act === "day") return openDay(b.dataset.date);
    if (act === "del") return remove(art.dataset.id);
    if (act === "edit") return startEdit(art);
    if (act === "cancel") return render();
    if (act === "save") {
      const t = art.querySelector("textarea").value.trim();
      if (!t) return remove(art.dataset.id);
      return edit(art.dataset.id, { text: t, kind: art.querySelector("select").value });
    }
  });
  $("jrList").addEventListener("keydown", ev => {
    if (ev.target.matches(".jr-entry textarea") && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); ev.target.closest(".jr-entry").querySelector('[data-jr="save"]').click(); }
    if (ev.target.matches(".jr-entry textarea") && ev.key === "Escape") render();
  });
  $("jrAnalyze").onclick = runAnalysis;
  $("jrStop").onclick = () => running && running.abort();
  $("jrCopy").onclick = copyPrompt;
  $("jrKeySave").onclick = saveKey;
  $("jrKey").addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); saveKey(); } });
  $("jrKeyForget").onclick = forgetKey;
  $("jrReviewList").addEventListener("click", async ev => {
    const b = ev.target.closest("[data-jr]"); if (!b) return;
    const row = b.closest("[data-rid]"); const r = reviews.find(x => x.id === row.dataset.rid); if (!r) return;
    if (b.dataset.jr === "review") { showResult(r.text, `Auswertung ${fmtDate(r.from)} – ${fmtDate(r.to)} · ${r.count} Einträge`); $("jrResult").scrollIntoView({ block: "start", behavior: "smooth" }); }
    if (b.dataset.jr === "review-del") {
      reviews = reviews.filter(x => x.id !== r.id); renderReviews();
      try { await getStore().remove("reviews", r.id); toast("Auswertung gelöscht", async () => { await getStore().set("reviews", r.id, Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id"))); reviews.push(r); reviews.sort((a, b) => b.id.localeCompare(a.id)); renderReviews(); }); }
      catch (e) { console.error(e); toast("Löschen fehlgeschlagen: " + e.message); }
    }
  });
  $("jrPrompt").textContent = SYSTEM_PROMPT;
  renderPresets(); renderKinds();

  return {
    /** Nach der Anmeldung: Schlüssel und gespeicherte Auswertungen holen. */
    async init() { loadedFor = ""; entries = []; await initKey(); loadReviews(); },
    /** Beim Öffnen des Reiters (und bei Rückkehr in den Tab). */
    show(force) { return load(force); },
    /** Schnellerfassung von außen, z. B. von der Tagesseite. */
    add
  };
}
