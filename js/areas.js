// Lebensbereiche: jeder Eintrag (Zeitblock oder To-do) gehört zu einem Bereich.
// Zuordnung pro Eintragsname („Sport“, „Cocktail: Video“ → „Cocktail“) gilt für alle Tage.
// Ohne eigene Zuordnung wird der Bereich anhand von Stichwörtern vermutet.

export const AREAS = [
  { id: "body", name: "Körper & Gesundheit", short: "Körper", hint: "Fitness, Ernährung, Schlaf, mentale Gesundheit, Wohlbefinden",
    words: ["sport", "training", "trainieren", "laufen", "joggen", "gym", "fitness", "yoga", "krafttraining", "velo", "rad", "schwimm", "wandern", "spazier", "dehnen",
      "schlaf", "schlafen", "nickerchen", "mittagsschlaf", "ausruhen", "frühstück", "mittagessen", "abendessen", "essen", "kochen", "znüni", "zvieri",
      "arzt", "zahnarzt", "physio", "therapie", "meditation", "meditieren", "atem", "sauna", "dusche", "morgenroutine", "abendroutine", "gesund"] },
  { id: "work", name: "Arbeit & Leistung", short: "Arbeit", hint: "Beruf, Karriere, Ausbildung, Hobbys, produktiv und schöpferisch sein",
    words: ["arbeit", "arbeiten", "büro", "job", "meeting", "besprechung", "call", "mail", "mails", "e-mail", "projekt", "kunde", "kunden", "offerte", "akquise",
      "präsentation", "konzept", "planung", "website", "programmieren", "code", "lernen", "kurs", "studium", "schule", "weiterbildung", "prüfung", "vokabeln",
      "hobby", "gitarre", "klavier", "musik", "malen", "zeichnen", "schreiben", "fotografie", "video", "podcast", "cocktail", "event", "marketing", "social media"] },
  { id: "social", name: "Soziales Netzwerk", short: "Soziales", hint: "Familie, Partnerschaft, Freundschaften, Nachbarschaft, Zugehörigkeit",
    words: ["familie", "kinder", "kind", "partner", "partnerin", "frau", "mann", "freund", "freundin", "freunde", "mama", "papa", "mutter", "vater", "eltern",
      "oma", "opa", "bruder", "schwester", "nachbar", "nachbarn", "anrufen", "telefonieren", "treffen", "besuch", "besuchen", "geburtstag", "date",
      "verein", "apéro", "apero", "essen mit", "abendessen mit", "mittagessen mit", "frühstück mit", "mit familie", "mit freunden", "spielen", "ausflug"] },
  { id: "material", name: "Materielle Sicherheit", short: "Materielles", hint: "Finanzen, Einkommen, Vermögen, Wohnung, Lebensgrundlagen",
    words: ["finanzen", "rechnung", "rechnungen", "steuern", "steuererklärung", "bank", "budget", "sparen", "geld", "versicherung", "miete", "vertrag",
      "einkauf", "einkaufen", "posten", "haushalt", "putzen", "aufräumen", "wäsche", "waschen", "wohnung", "reparatur", "garten", "auto", "admin", "papierkram", "flicken", "entsorgen"] },
  { id: "meaning", name: "Werte & Sinn", short: "Sinn", hint: "Spiritualität, Philosophie, Moral, Lebensziele, tieferer Sinn",
    words: ["journal", "tagebuch", "reflexion", "reflektieren", "dankbarkeit", "beten", "gebet", "kirche", "gottesdienst", "bibel", "spirituell",
      "ehrenamt", "freiwillig", "helfen", "spenden", "ziele", "lebensziele", "vision", "werte", "philosophie", "wochenplanung", "stille", "natur"] }
];
export const AREA_BY_ID = Object.fromEntries(AREAS.map(a => [a.id, a]));

// Eintragsname wie in der Auslastung: Teil vor dem Doppelpunkt, ohne Mail-/Kalender-Symbol
export const entryKey = v => (v || "").replace(/^[✉📅]️?\s*/u, "").split(":")[0].trim();
const norm = s => s.toLocaleLowerCase("de-CH");

/** Vermuteter Bereich anhand von Stichwörtern (ganze Wörter oder Wortanfang) */
export function guessArea(text) {
  const t = " " + norm(text).replace(/[^\p{L}\p{N}\s-]/gu, " ") + " ";
  let best = null, bestLen = 0;
  for (const a of AREAS) for (const w of a.words) {
    if (w.length > bestLen && (t.includes(" " + w + " ") || (w.length >= 4 && t.includes(" " + w)))) { best = a.id; bestLen = w.length; }
  }
  return best;
}

/** Bereich eines Eintrags: { id, sure } – sure=false heißt „vermutet“ */
export function areaOf(text, map) {
  const k = norm(entryKey(text));
  if (!k) return null;
  if (map && Object.prototype.hasOwnProperty.call(map, k)) return map[k] ? { id: map[k], sure: true } : null;
  const g = guessArea(text);
  return g ? { id: g, sure: false } : null;
}

/**
 * Auswertung eines Tages: Minuten geplant/gemacht und To-dos (erledigt/gesamt) pro Bereich.
 * Pausen zählen nicht. „none“ sammelt Einträge ohne Bereich.
 */
export function summarizeDay(day, map) {
  const out = {};
  [...AREAS.map(a => a.id), "none"].forEach(id => { out[id] = { plan: 0, done: 0, todo: 0, todoDone: 0 }; });
  Object.values(day.slots || {}).forEach(s => {
    if (s.b) return;
    if (s.p) out[areaOf(s.p, map)?.id || "none"].plan += 15;
    if (s.d) out[areaOf(s.d, map)?.id || "none"].done += 15;
  });
  [...(day.cream || []), ...(day.cherries || []), ...(day.more || [])].forEach(x => {
    if (!x.t || !x.t.trim()) return;
    const o = out[areaOf(x.t, map)?.id || "none"];
    o.todo++; if (x.d) o.todoDone++;
  });
  return out;
}

/** Alle Eintragsnamen eines Tages mit Minuten (gemacht vor geplant) – für die Zuordnungsliste */
export function entriesOfDay(day) {
  const m = new Map();
  const add = (text, min, kind) => {
    const name = entryKey(text); if (!name) return;
    const k = norm(name);
    const e = m.get(k) || { key: k, name, min: 0, todos: 0 }; if (kind === "todo") e.todos++; else e.min += min;
    m.set(k, e);
  };
  Object.values(day.slots || {}).forEach(s => { if (s.b) return; if (s.d) add(s.d, 15); else if (s.p) add(s.p, 15); });
  [...(day.cream || []), ...(day.cherries || []), ...(day.more || [])].forEach(x => { if (x.t && x.t.trim()) add(x.t, 0, "todo"); });
  return [...m.values()].sort((a, b) => b.min - a.min || b.todos - a.todos || a.name.localeCompare(b.name, "de-CH"));
}
