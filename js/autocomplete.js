// Excel-artige Autovervollständigung: Beim Tippen wird der Rest eines früheren Eintrags
// markiert ergänzt (Enter/Tab übernimmt, weitertippen überschreibt, Rücktaste verwirft).
// Zusätzlich füllt jede Gruppe eine <datalist> für die Vorschlagsliste (v. a. auf dem Handy).

const MAX_PER_GROUP = 400;

export function createAutocomplete({ onChange }) {
  // vocab[group][text] = { n: Anzahl, t: zuletzt benutzt (ms) }
  let vocab = { slot: {}, todo: {}, text: {}, habit: {}, meal: {}, fit: {} };

  function ranked(group) {
    const g = vocab[group] || {};
    return Object.entries(g).sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t).map(e => e[0]);
  }

  function refreshList(group) {
    const dl = document.getElementById("ac-" + group);
    if (!dl) return;
    dl.replaceChildren(...ranked(group).slice(0, 200).map(v => {
      const o = document.createElement("option"); o.value = v; return o;
    }));
  }

  function learn(group, value) {
    const v = (value || "").trim();
    if (!v || v.length < 2 || v.length > 120 || !vocab[group]) return;
    const e = vocab[group][v] || { n: 0, t: 0 };
    e.n++; e.t = Date.now();
    vocab[group][v] = e;
    const keys = Object.keys(vocab[group]);
    if (keys.length > MAX_PER_GROUP) {
      ranked(group).slice(MAX_PER_GROUP).forEach(k => delete vocab[group][k]);
    }
    refreshList(group);
    onChange && onChange(vocab);
  }

  function best(group, typed) {
    const low = typed.toLowerCase();
    return ranked(group).find(k => k.length > typed.length && k.toLowerCase().startsWith(low));
  }

  // Inline-Ergänzung (nur bei normalem Tippen am Ende des Feldes)
  document.addEventListener("input", e => {
    const el = e.target;
    const group = el.dataset && el.dataset.ac;
    if (!group || el.tagName !== "INPUT") return;
    if (e.inputType !== "insertText") return;
    if (el.selectionStart !== el.value.length) return;
    const typed = el.value;
    if (typed.trim().length < 1) return;
    const m = best(group, typed);
    if (!m) return;
    el.value = typed + m.slice(typed.length);
    el.setSelectionRange(typed.length, el.value.length);
  }, true);

  // Lernen, wenn ein Feld verlassen bzw. bestätigt wird
  document.addEventListener("change", e => {
    const el = e.target;
    if (el.dataset && el.dataset.ac && el.tagName === "INPUT") learn(el.dataset.ac, el.value);
  });

  return {
    load(v) {
      vocab = Object.assign({ slot: {}, todo: {}, text: {}, habit: {}, meal: {}, fit: {} }, v || {});
      Object.keys(vocab).forEach(refreshList);
    },
    learn,
    /** Bestehende Einträge nachträglich lernen (z. B. nach Kopieren/Import) */
    learnMany(group, values) { values.forEach(v => learn(group, v)); },
    get: () => vocab
  };
}
