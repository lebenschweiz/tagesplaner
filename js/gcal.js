// Google-Kalender-API (nur Lesen): Termine eines Tages aus allen sichtbaren Kalendern.
const API = "https://www.googleapis.com/calendar/v3";

async function call(token, path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw Object.assign(new Error("Zugriff abgelaufen"), { code: "expired" });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error.message; } catch {}
    throw Object.assign(new Error(msg), { code: r.status === 403 ? "forbidden" : "failed" });
  }
  return r.json();
}

const pad = n => String(n).padStart(2, "0");
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Termine am Tag `date` (JJJJ-MM-TT), sortiert. Zeiten als Minuten seit Mitternacht, auf den Tag zugeschnitten. */
export async function listEvents(token, date) {
  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(y, m - 1, d), to = new Date(y, m - 1, d + 1);
  const { items: cals = [] } = await call(token, "/users/me/calendarList?minAccessRole=reader");
  const shown = cals.filter(c => c.selected || c.primary);
  const q = `timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=100`;
  const lists = await Promise.all(shown.map(c =>
    call(token, `/calendars/${encodeURIComponent(c.id)}/events?${q}`).then(r => (r.items || []).map(e => [c, e]))));
  const out = [];
  for (const [c, e] of lists.flat()) {
    if (e.status === "cancelled") continue;
    // Termine, die ich abgelehnt habe, gehören nicht in den Plan
    if ((e.attendees || []).some(a => a.self && a.responseStatus === "declined")) continue;
    const base = {
      id: `${c.id}|${e.id}`, title: (e.summary || "(ohne Titel)").trim(), updated: e.updated || "",
      calendar: c.primary ? "" : (c.summaryOverride || c.summary || ""), color: c.backgroundColor || "", link: e.htmlLink || ""
    };
    if (e.start?.date) {
      // Ganztägig: Enddatum ist exklusiv
      if (e.start.date <= date && date < (e.end?.date || e.start.date)) out.push({ ...base, allDay: true });
      continue;
    }
    const s = new Date(e.start.dateTime), en = new Date(e.end?.dateTime || e.start.dateTime);
    const start = localDate(s) < date ? 0 : s.getHours() * 60 + s.getMinutes();
    const end = localDate(en) > date ? 1440 : en.getHours() * 60 + en.getMinutes();
    out.push({ ...base, allDay: false, start, end: Math.max(end, start) });
  }
  return out.sort((a, b) => (b.allDay - a.allDay) || ((a.start || 0) - (b.start || 0)) || a.title.localeCompare(b.title));
}
