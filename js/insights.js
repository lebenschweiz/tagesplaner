// KI-Auswertung des Gedanken-Journals: der Auswertungs-Prompt und der Aufruf von Claude.
// Der Prompt funktioniert auch ohne Schlüssel: „Prompt kopieren“ legt ihn samt Einträgen in die Zwischenablage,
// zum Einfügen in claude.ai. Mit eigenem Anthropic-Schlüssel läuft die Auswertung direkt in der App.

export const MODEL = "claude-opus-5-5";
const SDK_URLS = [
  "https://esm.sh/@anthropic-ai/sdk@0.133.0",
  "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm"
];
const KEY = "tagesplaner:anthropicKey";

export const KINDS = {
  gedanke: { label: "Gedanke", icon: "💭" },
  idee: { label: "Idee", icon: "💡" },
  rueckmeldung: { label: "Rückmeldung", icon: "💬" },
  erkenntnis: { label: "Erkenntnis", icon: "✨" },
  tag: { label: "Tagesnotiz", icon: "📓" }   // aus „Gedanken, Ideen & Erfolge“ auf der Tagesseite
};

/* ---------- Der Auswertungs-Prompt ---------- */
export const SYSTEM_PROMPT = `Du bist mein persönlicher Denkpartner und wertest mein Gedanken-Journal aus. Darin halte ich über den Tag kurze Notizen fest: Gedanken, Ideen, Rückmeldungen (von anderen an mich oder von mir an mich selbst) und Erkenntnisse. Dazu kommen Tagesnotizen aus meinem Tagesplaner.

Dein Ziel: Hilf mir zu erkennen, was mich in diesem Zeitraum wirklich beschäftigt hat, welche Ideen es wert sind, weiterverfolgt zu werden, und wie sich mein Denken entwickelt hat.

So arbeitest du:
- Stütze jede Aussage auf meine Einträge und belege sie mit Datum und einem kurzen wörtlichen Zitat, z. B. (14.03.: „…“). Erfinde nichts. Wenn die Einträge für eine Aussage nicht reichen, sag das offen.
- Gewichte nach Wiederholung und Entwicklung, nicht nach der Länge einzelner Einträge. Ein Thema, das an vielen Tagen auftaucht, zählt mehr als ein langer Einzeleintrag.
- Achte auf den zeitlichen Verlauf: Was taucht auf, verschwindet, kehrt zurück, verändert sich?
- Umfasst der Zeitraum mehr als zwei Monate, beschreibe die Entwicklung nach Monaten oder Quartalen gegliedert.
- Hashtags (#…) sind meine eigenen Stichworte. Nutze sie als Hinweis, aber erkenne Themen auch ohne sie.
- Ton: ehrlich, warm und direkt, wie ein guter Coach. Keine Floskeln, kein Schönreden, keine Diagnosen oder psychologischen Etiketten.
- Schreibe auf Deutsch in Markdown und verwende die Überschriften unten. Lass einen Abschnitt weg, wenn die Einträge nichts dafür hergeben.

## Auf einen Blick
Drei bis fünf Sätze: Was hat diesen Zeitraum geprägt?

## Hauptthemen
Die drei bis sieben wichtigsten Themen. Je Thema: ein treffender Name, wie oft und wann es vorkam (z. B. „an 12 Tagen, vor allem im März“), worum es ging, ein bis zwei Belegzitate.

## Ideen-Speicher
Alle Ideen, nach Thema gruppiert. Markiere wiederkehrende Ideen mit 🔁 und Ideen, die laut späteren Einträgen schon umgesetzt sind, mit ✅. Danach die drei vielversprechendsten Ideen, je mit Begründung und einem ersten konkreten Schritt.

## Rückmeldungen
Was mir andere oder ich mir selbst zurückgemeldet habe: Was wiederholt sich, was kann ich daraus lernen?

## Muster & Entwicklung
Wiederkehrende Denkmuster, Energiequellen und Energieräuber, Zusammenhänge mit Wochentagen, Tageszeiten oder Phasen. Wie hat sich mein Denken über den Zeitraum verändert?

## Erkenntnisse
Die wichtigsten Einsichten, möglichst in meinen eigenen Worten, mit Datum.

## Offene Schleifen
Fragen, Vorhaben oder Sorgen, die auftauchten und nie aufgelöst wurden.

## Für die nächste Zeit
Drei konkrete, kleine Empfehlungen, jeweils mit Bezug auf meine Einträge.

## Fragen an mich
Drei Reflexionsfragen, die mir helfen, tiefer zu gehen.`;

const DOW = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmt = s => { const [y, m, d] = s.split("-"); return `${d}.${m}.${y}`; };

/** Die Nachricht mit Zeitraum, Zahlen und allen Einträgen (älteste zuerst). */
export function buildUserPrompt(entries, from, to, focus = "") {
  const sorted = [...entries].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const counts = Object.entries(KINDS).map(([k, v]) => [v.label, sorted.filter(e => e.kind === k).length]).filter(([, n]) => n);
  const activeDays = new Set(sorted.map(e => e.date)).size;
  let body = "", lastDate = "";
  for (const e of sorted) {
    if (e.date !== lastDate) {
      const d = new Date(e.date + "T12:00:00");
      body += `${lastDate ? "\n" : ""}${e.date} (${DOW[d.getDay()]})\n`;
      lastDate = e.date;
    }
    const text = e.text.trim().replace(/\n+/g, "\n  ");
    body += `- ${e.time ? e.time + " " : ""}[${KINDS[e.kind]?.label || "Gedanke"}] ${text}\n`;
  }
  return `Zeitraum: ${fmt(from)} – ${fmt(to)} (${days} Tage, Einträge an ${activeDays} Tagen)\n` +
    `Einträge: ${sorted.length}${counts.length ? " (" + counts.map(([l, n]) => `${l} ${n}`).join(", ") + ")" : ""}\n` +
    (focus.trim() ? `Besonders interessiert mich: ${focus.trim()}\n` : "") +
    `\n<journal>\n${body}</journal>\n\nBitte werte mein Journal für diesen Zeitraum aus.`;
}

/** Alles in einem Text, zum Einfügen in claude.ai oder eine andere KI. */
export const fullPrompt = (entries, from, to, focus) => `${SYSTEM_PROMPT}\n\n---\n\n${buildUserPrompt(entries, from, to, focus)}`;

/** Grobe Schätzung der Tokens (deutscher Text: etwa 3,5 Zeichen je Token). */
export const estimateTokens = text => Math.round(text.length / 3.5);

/* ---------- Anthropic-Schlüssel (nur in diesem Browser, optional im Konto, siehe journal.js) ---------- */
export function localKey() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
export function saveLocalKey(k) { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch {} }

let sdk = null;
async function loadSdk() {
  if (sdk) return sdk;
  let last;
  for (const url of SDK_URLS) {
    try { sdk = (await import(url)).default; return sdk; } catch (e) { last = e; }
  }
  throw Object.assign(new Error("Die Claude-Bibliothek konnte nicht geladen werden. Bist du online?"), { code: "sdk", cause: last });
}

/**
 * Auswertung mit Claude, Text kommt Stück für Stück über onText.
 * Gibt { text, model } zurück. Fehler haben code: unauthorized | rate | refusal | failed.
 */
export async function analyze({ key, entries, from, to, focus, onText, signal }) {
  const Anthropic = await loadSdk();
  // Der Schlüssel bleibt im Browser und geht nur direkt an api.anthropic.com.
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(entries, from, to, focus) }]
    }, { signal });
    stream.on("text", (_, snapshot) => onText && onText(snapshot));
    const msg = await stream.finalMessage();
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
    if (msg.stop_reason === "refusal") {
      throw Object.assign(new Error("Claude hat diese Auswertung abgelehnt."), { code: "refusal" });
    }
    return { text: msg.stop_reason === "max_tokens" ? text + "\n\n_(Auswertung wurde wegen Länge abgeschnitten.)_" : text, model: msg.model };
  } catch (e) {
    if (e.code) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw Object.assign(new Error("Der Anthropic-Schlüssel wurde abgelehnt (ungültig oder widerrufen)."), { code: "unauthorized" });
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw Object.assign(new Error("Zu viele Anfragen oder Guthaben aufgebraucht. Bitte später erneut versuchen."), { code: "rate" });
    }
    if (e instanceof Anthropic.APIUserAbortError) throw Object.assign(new Error("Abgebrochen"), { code: "aborted" });
    if (e instanceof Anthropic.APIConnectionError) {
      throw Object.assign(new Error("Keine Verbindung zu Claude. Bist du online?"), { code: "failed" });
    }
    throw Object.assign(new Error(e.message || "Unbekannter Fehler"), { code: "failed" });
  }
}

/** Sehr kleines Markdown für die Anzeige: Überschriften, Listen, fett, kursiv, Zitate. Escaped alles. */
export function renderMarkdown(md) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])_(.+?)_(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>").replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
  let html = "", list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { close(); const l = Math.min(m[1].length + 1, 5); html += `<h${l}>${inline(m[2])}</h${l}>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^>\s?(.*)$/))) { close(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (/^(-{3,}|\*{3,})$/.test(line.trim())) { close(); html += "<hr>"; }
    else if (!line.trim()) close();
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}
