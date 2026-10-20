// Ziele mit Etappen: Jahresziel › Monatsziel › Wochenziel › Tagesziel.
// Jedes Ziel hat eine Frist; angezeigt wird, wie viel Zeit bis dahin bleibt.
// Datenform (meta/goals): { items: [{ id, title, level, due, parent, done, created }] }

export const LEVELS = ["year", "month", "week", "day"];
export const LEVEL_NAMES = { year: "Jahresziel", month: "Monatsziel", week: "Wochenziel", day: "Tagesziel" };
const LEVEL_SHORT = { year: "Jahr", month: "Monat", week: "Woche", day: "Tag" };

const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const weekday = s => (parse(s).getDay() + 6) % 7;
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const lvlIdx = l => LEVELS.indexOf(l);

/** Ende des Zeitraums, in dem ref liegt – Vorschlag für die Frist. */
export function periodEnd(level, ref) {
  const d = parse(ref);
  if (level === "year") return `${d.getFullYear()}-12-31`;
  if (level === "month") return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  if (level === "week") return addDays(ref, 6 - weekday(ref));
  return ref;
}
/** Beginn des Zeitraums, zu dem eine Frist gehört (Monatsziel bis 31.10. → ab 1.10.). */
function periodStart(level, due) {
  const d = parse(due);
  if (level === "year") return `${d.getFullYear()}-01-01`;
  if (level === "month") return iso(new Date(d.getFullYear(), d.getMonth(), 1));
  if (level === "week") return addDays(due, -weekday(due));
  return due;
}

/** Restzeit bis zur Frist, z. B. „noch 3 Wochen, 2 Tage“. */
export function countdown(g, today) {
  if (g.done) return { text: "erreicht", cls: "ok" };
  if (!g.due) return { text: "ohne Frist", cls: "" };
  const n = daysBetween(today, g.due);
  const tage = k => `${k} ${k === 1 ? "Tag" : "Tage"}`;
  if (n < 0) return { text: `seit ${tage(-n)} überfällig`, cls: "late" };
  if (n === 0) return { text: "heute fällig", cls: "soon" };
  if (n === 1) return { text: "noch 1 Tag (morgen)", cls: "soon" };
  if (n < 14) return { text: `noch ${tage(n)}`, cls: n <= 3 ? "soon" : "" };
  if (n < 56) { const w = Math.floor(n / 7), r = n % 7; return { text: `noch ${w} Wochen${r ? `, ${tage(r)}` : ""}`, cls: "" }; }
  const m = Math.floor(n / 30.44), w = Math.floor((n - m * 30.44) / 7);
  return { text: `noch ${m} ${m === 1 ? "Monat" : "Monate"}${w ? `, ${w} ${w === 1 ? "Woche" : "Wochen"}` : ""} (${n} Tage)`, cls: "" };
}
const fmtDue = s => parse(s).toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function createGoals({ onChange, today, onOpen }) {
  let items = [];
  let filter = "open";
  let collapsed = new Set();
  try { collapsed = new Set(JSON.parse(localStorage.getItem("tagesplaner:goalsCollapsed") || "[]")); } catch {}
  try { filter = localStorage.getItem("tagesplaner:goalsFilter") || "open"; } catch {}
  const mounts = [];
  let ref = today();

  const byId = id => items.find(g => g.id === id);
  const kids = id => items.filter(g => g.parent === id).sort(sortGoals);
  function sortGoals(a, b) { return (a.done - b.done) || (a.due || "9").localeCompare(b.due || "9") || lvlIdx(a.level) - lvlIdx(b.level) || a.created.localeCompare(b.created); }
  const descendants = id => kids(id).flatMap(k => [k, ...descendants(k.id)]);
  const pathOf = g => { const p = []; let x = byId(g.parent); while (x && p.length < 4) { p.unshift(x.title || LEVEL_NAMES[x.level]); x = byId(x.parent); } return p; };
  function changed() { onChange(); renderAll(); }

  function add({ title = "", level, due, parent = null }) {
    const p = byId(parent);
    if (!due) due = periodEnd(level, ref < today() ? today() : ref);
    if (p && p.due && due > p.due) due = p.due;
    const g = { id: newId(), title: title.trim(), level, due, parent: p ? p.id : null, done: false, created: today() };
    items.push(g);
    if (p) collapsed.delete(p.id);
    return g;
  }

  /* ---------- Darstellung ---------- */
  function bars(g) {
    const t = today(), ks = kids(g.id);
    let html = "";
    if (ks.length) {
      const n = ks.filter(k => k.done).length;
      html += `<span class="gl-bar" title="Etappen erreicht"><span>Etappen ${n} / ${ks.length}</span><span class="bar"><i class="good" style="width:${n / ks.length * 100}%"></i></span></span>`;
    }
    if (g.due && !g.done) {
      const total = Math.max(1, daysBetween(g.created || t, g.due)), gone = Math.min(total, Math.max(0, daysBetween(g.created || t, t)));
      html += `<span class="gl-bar" title="Seit dem Anlegen verstrichene Zeit"><span>Zeit ${Math.round(gone / total * 100)} % verstrichen</span><span class="bar"><i style="width:${gone / total * 100}%"></i></span></span>`;
    }
    return html ? `<div class="gl-bars">${html}</div>` : "";
  }
  function levelSelect(g) {
    const p = byId(g.parent), min = p ? lvlIdx(p.level) + 1 : 0;
    return `<select data-g="level" aria-label="Ebene">${LEVELS.map((l, i) => i < min ? "" : `<option value="${l}"${l === g.level ? " selected" : ""}>${LEVEL_SHORT[l]}</option>`).join("")}</select>`;
  }
  function node(g, depth) {
    const ks = kids(g.id).filter(k => filter !== "open" || !k.done);
    const cd = countdown(g, today());
    const fold = ks.length ? `<button type="button" class="gl-fold" data-ga="fold" aria-label="Etappen ${collapsed.has(g.id) ? "zeigen" : "verbergen"}" aria-expanded="${!collapsed.has(g.id)}">${collapsed.has(g.id) ? "▸" : "▾"}</button>` : `<span class="gl-fold"></span>`;
    const canAdd = g.level !== "day";
    return `<div class="gl-node lvl-${g.level}${g.done ? " done" : ""}" data-gid="${g.id}">
      <div class="gl-row">${fold}<input type="checkbox" class="check" data-g="done" aria-label="Ziel erreicht"${g.done ? " checked" : ""}>
        ${levelSelect(g)}
        <input type="text" data-g="title" value="${esc(g.title)}" placeholder="${LEVEL_NAMES[g.level]} …" aria-label="${LEVEL_NAMES[g.level]}">
        <span class="gl-due"><input type="date" data-g="due" value="${g.due || ""}" aria-label="Zu erreichen bis"${byId(g.parent)?.due ? ` max="${byId(g.parent).due}"` : ""}></span>
        <span class="gl-left ${cd.cls}">${cd.text}</span>
        <span class="gl-acts">${canAdd ? `<button type="button" class="btn small" data-ga="add">+ Etappe</button>` : ""}<button type="button" class="btn small icon" data-ga="del" aria-label="Ziel löschen">×</button></span>
      </div>
      ${bars(g)}
      ${ks.length && !collapsed.has(g.id) ? `<div class="gl-kids">${ks.map(k => node(k, depth + 1)).join("")}</div>` : ""}
    </div>`;
  }
  function renderTree(host) {
    const tops = items.filter(g => !byId(g.parent)).sort(sortGoals).filter(g => filter === "all" || (filter === "open" ? !g.done : g.done));
    const t = today(), open = items.filter(g => !g.done);
    const late = open.filter(g => g.due && g.due < t).length;
    host.querySelector("[data-gl=stats]").innerHTML =
      `<span class="chip">Offen <b>${open.length}</b></span>` +
      `<span class="chip${late ? " late" : ""}">Überfällig <b>${late}</b></span>` +
      `<span class="chip good">Erreicht <b>${items.length - open.length}</b></span>`;
    host.querySelectorAll("[data-gf]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.gf === filter)));
    host.querySelector("[data-gl=tree]").innerHTML = tops.length ? tops.map(g => node(g, 0)).join("")
      : `<p class="sub">${filter === "done" ? "Noch kein Ziel erreicht." : "Noch keine Ziele. Lege oben ein Jahres- oder Monatsziel an und teile es mit „+ Etappe“ in Wochen- und Tagesziele auf."}</p>`;
  }

  // Tag/Woche: Ziele, die in diesem Zeitraum anstehen, gruppiert
  function scopeGroups(scope, refDate) {
    const t = today();
    const from = scope === "week" ? addDays(refDate, -weekday(refDate)) : refDate;
    const to = scope === "week" ? addDays(from, 6) : refDate;
    const open = items.filter(g => !g.done || (g.due >= from && g.due <= to));
    const inRange = g => g.due && g.due >= from && g.due <= to;
    const active = g => g.due && g.due >= from && periodStart(g.level, g.due) <= to;
    const groups = [];
    if (refDate >= t) {
      const late = open.filter(g => !g.done && g.due && g.due < from);
      if (late.length) groups.push(["Überfällig", late]);
    }
    if (scope === "day") {
      groups.push(["Heute", open.filter(g => g.level === "day" && inRange(g))]);
      groups.push(["Diese Woche", open.filter(g => g.level === "week" && active(g))]);
    } else {
      groups.push(["Wochenziele", open.filter(g => g.level === "week" && active(g))]);
      groups.push(["Tagesziele", open.filter(g => g.level === "day" && inRange(g))]);
    }
    groups.push(["Darauf zahlt es ein", open.filter(g => !g.done && (g.level === "month" || g.level === "year") && active(g))]);
    return groups.map(([h, gs]) => [h, gs.sort(sortGoals)]);
  }
  function renderScope(host, scope) {
    const refDate = ref, t = today();
    const groups = scopeGroups(scope, refDate);
    const html = groups.filter(([, gs]) => gs.length).map(([h, gs]) => `<h4>${h}</h4><ul class="gl-list">${gs.map(g => {
      const cd = countdown(g, t), path = pathOf(g);
      return `<li class="gl-item lvl-${g.level}${g.done ? " done" : ""}" data-gid="${g.id}"><input type="checkbox" class="check" data-g="done" aria-label="Ziel erreicht"${g.done ? " checked" : ""}>` +
        `<button type="button" class="gl-txt" data-ga="open" title="In der Zielübersicht öffnen">${path.length ? `<span class="gl-path">${esc(path.join(" › "))} ›</span> ` : ""}${esc(g.title || LEVEL_NAMES[g.level])}</button>` +
        `<span class="gl-left ${cd.cls}" title="Frist: ${g.due ? fmtDue(g.due) : "–"}">${cd.text}</span></li>`;
    }).join("")}</ul>`).join("");
    host.querySelector("[data-gl=list]").innerHTML = html || `<p class="sub">Für ${scope === "day" ? "diesen Tag" : "diese Woche"} steht noch kein Ziel an.</p>`;
    // Übergeordnete Ziele zur Auswahl für die neue Etappe
    const newLevel = scope === "day" ? "day" : "week";
    const parents = items.filter(g => !g.done && lvlIdx(g.level) < lvlIdx(newLevel) && (!g.due || g.due >= refDate)).sort(sortGoals);
    const sel = host.querySelector("[data-gl=parent]"), keep = sel.value;
    sel.innerHTML = `<option value="">ohne übergeordnetes Ziel</option>` + parents.map(g => `<option value="${g.id}">${LEVEL_SHORT[g.level]}: ${esc(g.title || LEVEL_NAMES[g.level])}</option>`).join("");
    if (parents.some(g => g.id === keep)) sel.value = keep;
    const done = groups.flatMap(([, gs]) => gs).filter(g => g.level === newLevel || g.level === "day");
    const info = host.closest("details")?.querySelector("[data-gl=info]");
    if (info) info.textContent = done.length ? `${done.filter(g => g.done).length} / ${done.length} erreicht` : "";
  }
  function renderAll() { mounts.forEach(m => m.render()); }

  /* ---------- Eingaben ---------- */
  function wire(host, mode) {
    host.addEventListener("input", e => {
      const el = e.target, gid = el.closest("[data-gid]")?.dataset.gid, g = gid && byId(gid);
      if (!g || el.dataset.g !== "title") return;
      g.title = el.value; onChange();
    });
    host.addEventListener("change", e => {
      const el = e.target, gid = el.closest("[data-gid]")?.dataset.gid, g = gid && byId(gid);
      if (!g || !el.dataset.g) return;
      if (el.dataset.g === "done") {
        g.done = el.checked;
        if (g.done) g.doneAt = today(); else delete g.doneAt;
      }
      if (el.dataset.g === "due") {
        g.due = el.value || "";
        descendants(g.id).forEach(k => { if (g.due && k.due > g.due) k.due = g.due; });
      }
      if (el.dataset.g === "level") {
        g.level = el.value;
        descendants(g.id).forEach(k => { if (lvlIdx(k.level) <= lvlIdx(g.level)) k.level = LEVELS[Math.min(3, lvlIdx(g.level) + 1)]; });
      }
      if (el.dataset.g === "title") return;
      changed();
    });
    host.addEventListener("click", e => {
      const b = e.target.closest("[data-ga]"); if (!b) return;
      const g = byId(b.closest("[data-gid]")?.dataset.gid); if (!g) return;
      const a = b.dataset.ga;
      if (a === "fold") {
        collapsed.has(g.id) ? collapsed.delete(g.id) : collapsed.add(g.id);
        try { localStorage.setItem("tagesplaner:goalsCollapsed", JSON.stringify([...collapsed])); } catch {}
        return renderAll();
      }
      if (a === "open") return onOpen(g.id);
      if (a === "add") {
        const level = LEVELS[lvlIdx(g.level) + 1];
        const k = add({ level, parent: g.id });
        changed();
        host.querySelector(`[data-gid="${k.id}"] [data-g=title]`)?.focus();
      }
      if (a === "del") {
        const gone = new Set([g.id, ...descendants(g.id).map(k => k.id)]);
        api.beforeChange(`„${g.title || LEVEL_NAMES[g.level]}“ gelöscht`);
        items = items.filter(x => !gone.has(x.id));
        changed();
        api.afterDelete(gone.size);
      }
    });
    if (mode === "tree") {
      const f = host.querySelector("[data-gl=new]");
      const lvl = f.querySelector("[data-gl=level]"), due = f.querySelector("[data-gl=due]");
      const setDefaultDue = () => { due.value = periodEnd(lvl.value, today()); };
      lvl.addEventListener("change", setDefaultDue); setDefaultDue();
      f.addEventListener("submit", e => {
        e.preventDefault();
        const title = f.querySelector("[data-gl=title]");
        if (!title.value.trim()) { title.focus(); return; }
        add({ title: title.value, level: lvl.value, due: due.value || periodEnd(lvl.value, today()) });
        title.value = ""; changed(); title.focus();
      });
      host.querySelectorAll("[data-gf]").forEach(b => b.addEventListener("click", () => {
        filter = b.dataset.gf;
        try { localStorage.setItem("tagesplaner:goalsFilter", filter); } catch {}
        renderAll();
      }));
    } else {
      const f = host.querySelector("[data-gl=add]");
      f.addEventListener("submit", e => {
        e.preventDefault();
        const title = f.querySelector("[data-gl=title]"), parent = f.querySelector("[data-gl=parent]").value || null;
        if (!title.value.trim()) { title.focus(); return; }
        const level = mode === "day" ? "day" : "week";
        add({ title: title.value, level, parent, due: periodEnd(level, ref) });
        title.value = ""; changed();
      });
    }
  }

  const api = {
    beforeChange: () => {}, afterDelete: () => {},
    load(data) { items = Array.isArray(data?.items) ? data.items.filter(g => g && g.id && LEVELS.includes(g.level)) : []; renderAll(); },
    data() { return { items: JSON.parse(JSON.stringify(items)) }; },
    setRef(d) { ref = d; renderAll(); },
    /** Hängt einen Bereich an: mode "tree" (Zielübersicht), "day" oder "week". */
    mount(host, mode) {
      wire(host, mode);
      mounts.push({ render: () => mode === "tree" ? renderTree(host) : renderScope(host, mode) });
    },
    render: renderAll,
    reveal(id) {
      let g = byId(id);
      if (filter === "open" && g?.done) { filter = "all"; }
      while (g) { collapsed.delete(g.id); g = byId(g.parent); }
      renderAll();
    }
  };
  return api;
}
