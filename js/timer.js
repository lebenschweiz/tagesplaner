/* Timer: Vorgaben 15 / 25 / 30 Min, eigene Dauer oder die Länge eines geplanten Blocks aus dem Zeitplan.
   Läuft weiter, wenn die Seite neu geladen wird (localStorage). Bei Ablauf: Browser-Benachrichtigung,
   Ton und ein Hinweis in der App, falls Benachrichtigungen nicht erlaubt sind. */

const KEY = "tagesplaner:timer";
const PRESETS = [15, 25, 30];
const pad = n => String(n).padStart(2, "0");
const hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};
const minLabel = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} Min` : ""}` : `${m} Min`;

/* Geplante Blöcke des Tages: gleiche Einträge hintereinander (ohne Pause) bilden einen Block */
export function planBlocks(slots) {
  const blocks = [];
  for (let i = 0; i < 96; i++) {
    const s = slots && slots[hm(i * 15)], p = s && !s.b ? String(s.p || "").trim() : "";
    const last = blocks.at(-1);
    if (p && last && last.end === i * 15 && last.key === p.toLocaleLowerCase("de-CH")) last.end += 15;
    else if (p) blocks.push({ name: p, key: p.toLocaleLowerCase("de-CH"), start: i * 15, end: i * 15 + 15 });
  }
  return blocks;
}

export function createTimer({ getTodaySlots, toast }) {
  const $ = id => document.getElementById(id);
  const menu = $("timerMenu"), pop = $("timerPop"), label = $("timerLabel"), pill = $("timerPill");
  let st = null, tick = null, fireT = null, audio = null, titleBefore = null, blocks = [];

  try { st = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  const save = () => { try { st ? localStorage.setItem(KEY, JSON.stringify(st)) : localStorage.removeItem(KEY); } catch {} };
  const left = () => !st ? 0 : st.paused ? st.left : st.end - Date.now();

  /* ---------- Ton ---------- */
  function unlockAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch { audio = null; }
  }
  function chime() {
    try {
      unlockAudio(); if (!audio) return;
      const t0 = audio.currentTime + 0.05;
      [0, 0.35, 0.7, 1.6, 1.95, 2.3].forEach((d, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = "sine"; o.frequency.value = [880, 1175, 1568][i % 3];
        g.gain.setValueAtTime(0.0001, t0 + d);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.6);
        o.connect(g).connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + 0.65);
      });
    } catch {}
    try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {}
  }

  /* ---------- Benachrichtigung ---------- */
  const canNotify = () => "Notification" in window;
  async function askPermission() {
    if (canNotify() && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch {}
      if (menu.open) render();
    }
  }
  function notify() {
    const body = `${st.label} · ${minLabel(st.total)} sind vorbei.`;
    if (canNotify() && Notification.permission === "granted") {
      try {
        const n = new Notification("Zeit ist um ⏰", { body, tag: "tagesplaner-timer", requireInteraction: true });
        n.onclick = () => { window.focus(); n.close(); };
      } catch {}
    }
    toast(`⏰ Zeit ist um: ${st.label}`, false);
    if (titleBefore == null) { titleBefore = document.title; document.title = "⏰ Zeit ist um · " + titleBefore; }
  }
  function restoreTitle() { if (titleBefore != null) { document.title = titleBefore; titleBefore = null; } }

  /* ---------- Ablauf ---------- */
  function schedule() {
    clearTimeout(fireT); clearInterval(tick); fireT = tick = null;
    if (st && !st.paused && !st.done) {
      const ms = st.end - Date.now();
      if (ms <= 0) return finish(ms < -60000);
      fireT = setTimeout(() => finish(false), ms);
      tick = setInterval(paint, 1000);
    }
    paint();
  }
  function finish(late) {
    if (!st || st.done) return;
    st.done = true; save(); schedule();
    // Lief der Timer ab, während die Seite zu war: nur still anzeigen, nicht nachträglich klingeln
    if (late) return;
    notify(); chime();
  }
  function start(min, name) {
    unlockAudio(); restoreTitle();
    min = Math.round(Math.max(1, Math.min(600, min)));
    st = { end: Date.now() + min * 60000, total: min, label: name || `Timer ${minLabel(min)}` };
    save(); schedule(); menu.open = false;
    toast(`Timer läuft: ${st.label} · ${minLabel(min)}`, false);
    askPermission();
  }
  function startUntil(endMin, name) {
    const now = new Date(), end = new Date(now); end.setHours(0, endMin, 0, 0);
    const min = (end - now) / 60000;
    if (min < 1) return start(1, name);
    unlockAudio(); restoreTitle();
    st = { end: end.getTime(), total: Math.round(min), label: name };
    save(); schedule(); menu.open = false;
    toast(`Timer läuft bis ${hm(endMin)}: ${name}`, false);
    askPermission();
  }
  function stop() { st = null; save(); restoreTitle(); schedule(); if (menu.open) render(); }
  function togglePause() {
    if (!st || st.done) return;
    if (st.paused) { st.end = Date.now() + st.left; delete st.paused; delete st.left; unlockAudio(); }
    else { st.left = st.end - Date.now(); st.paused = true; }
    save(); schedule(); if (menu.open) render();
  }
  function addFive() {
    if (!st) return;
    unlockAudio(); restoreTitle();
    if (st.done) { st = { end: Date.now() + 5 * 60000, total: 5, label: st.label }; }
    else if (st.paused) { st.left += 5 * 60000; st.total += 5; }
    else { st.end += 5 * 60000; st.total += 5; }
    save(); schedule(); if (menu.open) render();
  }

  /* ---------- Anzeige ---------- */
  function paint() {
    const ms = left(), on = !!st;
    const txt = !st ? "Timer" : st.done ? "Zeit ist um" : (st.paused ? "⏸ " : "") + fmt(ms);
    label.textContent = txt;
    menu.classList.toggle("running", on && !st.done && !st.paused);
    menu.classList.toggle("ringing", on && !!st.done);
    pill.hidden = !on;
    if (on) {
      pill.classList.toggle("ringing", !!st.done);
      pill.querySelector(".tp-time").textContent = st.done ? "Zeit ist um" : fmt(ms);
      pill.querySelector(".tp-name").textContent = st.label;
      pill.querySelector('[data-tp="pause"]').hidden = !!st.done;
      pill.querySelector('[data-tp="pause"]').textContent = st.paused ? "▶" : "⏸";
      pill.querySelector('[data-tp="pause"]').setAttribute("aria-label", st.paused ? "Weiter" : "Pausieren");
      pill.style.setProperty("--tp", st.done ? 1 : (1 - ms / (st.total * 60000)).toFixed(4));
    }
    const big = pop.querySelector(".tm-time");
    if (big && st) {
      big.textContent = st.done ? "Zeit ist um" : fmt(ms);
      pop.querySelector(".tm-bar i").style.width = (st.done ? 100 : (1 - ms / (st.total * 60000)) * 100).toFixed(2) + "%";
    }
  }

  async function render() {
    let slots = {};
    try { slots = (await getTodaySlots()) || {}; } catch {}
    blocks = planBlocks(slots);
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    const cur = blocks.find(b => b.start <= nm && nm < b.end);
    const next = blocks.find(b => b.start > nm || (b.start === nm && b !== cur));
    const after = cur && next ? null : blocks.find(b => b.start > (next ? next.start : nm) && b !== next);
    const opt = [];
    if (cur) opt.push(`<button type="button" class="tm-block" data-tm="cur"><span class="tm-when">Jetzt · bis ${hm(cur.end)}</span><b>${esc(cur.name)}</b><span class="tm-dur">noch ${minLabel(cur.end - nm)}</span></button>`);
    if (next) opt.push(`<button type="button" class="tm-block" data-tm="next"><span class="tm-when">Als Nächstes · ${hm(next.start)}–${hm(next.end)}</span><b>${esc(next.name)}</b><span class="tm-dur">${minLabel(next.end - next.start)}</span></button>`);
    else if (after) opt.push(`<button type="button" class="tm-block" data-tm="after"><span class="tm-when">${hm(after.start)}–${hm(after.end)}</span><b>${esc(after.name)}</b><span class="tm-dur">${minLabel(after.end - after.start)}</span></button>`);
    pop.dataset.cur = cur ? JSON.stringify(cur) : "";
    pop.dataset.next = next ? JSON.stringify(next) : after ? JSON.stringify(after) : "";

    const perm = !canNotify() ? `<p class="sub tm-note">Dieser Browser kann keine Benachrichtigungen zeigen. Bei Ablauf gibt es einen Ton und einen Hinweis in der App.</p>`
      : Notification.permission === "denied" ? `<p class="sub tm-note">Benachrichtigungen sind für diese Seite blockiert. Du hörst bei Ablauf einen Ton, solange die Seite offen ist. Freigeben kannst du sie in den Website-Einstellungen des Browsers.</p>`
      : Notification.permission === "default" ? `<p class="sub tm-note"><button type="button" class="linkish" data-tm="perm">Benachrichtigungen erlauben</button>, damit du den Ablauf auch in einem anderen Fenster mitbekommst.</p>` : "";

    pop.innerHTML =
      (st ? `<div class="tm-run${st.done ? " done" : ""}">
          <div class="tm-name">${esc(st.label)}</div>
          <div class="tm-time" aria-live="off">${st.done ? "Zeit ist um" : fmt(left())}</div>
          <div class="tm-bar"><i></i></div>
          <div class="tm-acts">
            ${st.done ? "" : `<button type="button" class="btn small" data-tm="pause">${st.paused ? "▶ Weiter" : "⏸ Pause"}</button>`}
            <button type="button" class="btn small" data-tm="plus5">+5 Min</button>
            <button type="button" class="btn small" data-tm="stop">${st.done ? "Fertig" : "Stopp"}</button>
          </div>
        </div><h5>${st.done ? "Neuer Timer" : "Neu starten"}</h5>` : `<h5>Timer starten</h5>`) +
      `<div class="tm-presets">${PRESETS.map(m => `<button type="button" class="btn" data-min="${m}">${m} Min</button>`).join("")}</div>` +
      (opt.length ? `<h5>Aus deinem Zeitplan</h5>${opt.join("")}` : `<p class="sub tm-note">Plane im Zeitplan einen Block (z. B. 45 Min „Deep Work“), dann kannst du ihn hier als Timer übernehmen.</p>`) +
      `<form class="tm-custom"><label>Eigene Dauer <input type="number" min="1" max="600" step="1" inputmode="numeric" placeholder="45" aria-label="Minuten"> Min</label><button class="btn small primary">Start</button></form>` +
      perm;
    paint();
  }

  pop.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.min) return start(+b.dataset.min);
    const a = b.dataset.tm;
    if (a === "cur" && pop.dataset.cur) { const c = JSON.parse(pop.dataset.cur); return startUntil(c.end, c.name); }
    if ((a === "next" || a === "after") && pop.dataset.next) { const n = JSON.parse(pop.dataset.next); return start(n.end - n.start, n.name); }
    if (a === "pause") togglePause();
    else if (a === "plus5") addFive();
    else if (a === "stop") stop();
    else if (a === "perm") askPermission();
  });
  pop.addEventListener("submit", e => {
    e.preventDefault();
    const v = +pop.querySelector(".tm-custom input").value;
    if (v > 0) start(v);
  });
  menu.addEventListener("toggle", () => { if (menu.open) { restoreTitle(); render(); } });
  document.addEventListener("click", e => { if (menu.open && !e.composedPath().some(n => n === menu || n === pill)) menu.open = false; });
  pill.addEventListener("click", e => {
    const b = e.target.closest("[data-tp]");
    if (!b) { menu.open = true; window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (b.dataset.tp === "pause") togglePause();
    else if (b.dataset.tp === "stop") stop();
  });
  // Im Hintergrund drosseln Browser Zeitgeber: beim Zurückkommen sofort prüfen
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { restoreTitle(); schedule(); } });
  window.addEventListener("focus", restoreTitle);
  window.addEventListener("storage", e => { if (e.key === KEY) { try { st = JSON.parse(e.newValue || "null"); } catch { st = null; } schedule(); } });

  schedule();
  return { start, stop };
}
