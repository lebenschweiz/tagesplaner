// Outlook-Kalender über Microsoft Graph (nur Lesen). Anmeldung direkt bei Microsoft (OAuth mit PKCE, ohne Server).
// Das Zugriffstoken gilt ca. 1 Stunde und wird still erneuert. Das Erneuerungstoken gilt bei Web-Apps ohne Server
// laut Microsoft höchstens 24 Stunden, danach einmal „Neu verbinden“. Beides liegt nur in diesem Browser.
import { outlookConfig } from "./outlook-config.js";

const AUTH = `https://login.microsoftonline.com/${outlookConfig.tenant || "common"}/oauth2/v2.0`;
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = "offline_access Calendars.Read";
const KEY = "tagesplaner:outlook", PENDING = "tagesplaner:outlookPending", RESULT = "tagesplaner:outlookResult";
const redirectUri = () => new URL("ms-auth.html", location.href).href;

export const outlookReady = !!outlookConfig.clientId;

const read = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const fail = (msg, code) => Object.assign(new Error(msg), { code });

export const outlookConnected = () => { const t = read(KEY); return !!t && (t.exp > Date.now() || t.rtExp > Date.now()); };
export function forgetOutlook() { write(KEY, null); }

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function tokenRequest(params) {
  const r = await fetch(AUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: outlookConfig.clientId, scope: SCOPE, ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw fail((j.error_description || j.error || r.statusText || "").split(/\r?\n/)[0], j.error === "invalid_grant" ? "expired" : "failed");
  const now = Date.now(), old = read(KEY);
  // Das 24-Stunden-Limit zählt ab der Anmeldung, nicht ab der letzten Erneuerung
  const t = { at: j.access_token, exp: now + Math.max(60, (j.expires_in || 3600) - 300) * 1000, rt: j.refresh_token || "",
    rtExp: params.grant_type === "refresh_token" && old?.rtExp ? old.rtExp : now + 24 * 3600 * 1000 - 5 * 60 * 1000 };
  write(KEY, t);
  return t.at;
}

async function finish(result, pending) {
  write(RESULT, null); write(PENDING, null);
  const p = new URLSearchParams(result.q || "");
  if (p.get("state") !== pending.state) throw fail("Anmeldung passt nicht zusammen, bitte erneut versuchen", "failed");
  if (p.get("error")) throw fail((p.get("error_description") || p.get("error")).split(/\r?\n/)[0], p.get("error") === "access_denied" ? "cancelled" : "failed");
  return tokenRequest({ grant_type: "authorization_code", code: p.get("code"), redirect_uri: redirectUri(), code_verifier: pending.verifier });
}

/**
 * Öffnet die Microsoft-Anmeldung. Muss direkt im Klick aufgerufen werden (vor jedem await), sonst blockiert der
 * Browser das Fenster. Geht kein Fenster auf, läuft die Anmeldung über eine Weiterleitung und die Seite lädt neu.
 */
export function connectOutlook() {
  if (!outlookReady) return Promise.reject(fail("Outlook ist noch nicht eingerichtet", "not-configured"));
  const w = window.open("", "tagesplaner-outlook", "popup,width=480,height=640");
  return (async () => {
    const verifier = random(48), state = random(16);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const pending = { state, verifier, mode: w ? "popup" : "redirect", back: location.href };
    write(RESULT, null); write(PENDING, pending);
    const url = AUTH + "/authorize?" + new URLSearchParams({
      client_id: outlookConfig.clientId, response_type: "code", response_mode: "query", redirect_uri: redirectUri(),
      scope: SCOPE, state, code_challenge: challenge, code_challenge_method: "S256"
    });
    if (!w) { location.assign(url); return new Promise(() => {}); }
    w.location.href = url;
    const result = await new Promise((resolve, reject) => {
      let closedAt = 0;
      const timer = setInterval(() => {
        const r = read(RESULT);
        if (r) { clearInterval(timer); return resolve(r); }
        if (!w.closed) return;
        // Kurz warten: das Fenster schreibt sein Ergebnis, bevor es sich schließt
        if (!closedAt) closedAt = Date.now();
        else if (Date.now() - closedAt > 1500) { clearInterval(timer); write(PENDING, null); reject(fail("Abgebrochen", "cancelled")); }
      }, 250);
    });
    return finish(result, pending);
  })();
}

/** Nach einer Anmeldung per Weiterleitung beim Laden der Seite aufrufen. true, wenn gerade verbunden wurde. */
export async function finishOutlookRedirect() {
  const pending = read(PENDING), result = read(RESULT);
  if (!pending || pending.mode !== "redirect" || !result) return false;
  await finish(result, pending);
  return true;
}

let refreshing = null;
/** Gültiges Zugriffstoken (erneuert es bei Bedarf), sonst null = neu verbinden. */
export async function outlookToken() {
  const t = read(KEY);
  if (!t) return null;
  if (t.exp > Date.now()) return t.at;
  if (!t.rt || t.rtExp <= Date.now()) { forgetOutlook(); return null; }
  refreshing ||= tokenRequest({ grant_type: "refresh_token", refresh_token: t.rt }).finally(() => { refreshing = null; });
  try { return await refreshing; }
  catch (e) { if (e.code === "expired") { forgetOutlook(); return null; } throw e; }
}

const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();

async function call(token, path) {
  const r = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${token}`, Prefer: `outlook.timezone="${tz}"` } });
  if (r.status === 401) throw fail("Zugriff abgelaufen", "expired");
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error.message; } catch {}
    throw fail(msg, r.status === 403 ? "forbidden" : "failed");
  }
  return r.json();
}

const pad = n => String(n).padStart(2, "0");
const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Graph liefert die Zeit in der gewünschten Zeitzone (ohne Angabe = UTC)
const toDate = s => new Date(s.dateTime.slice(0, 19) + (/^(utc|z)$/i.test(s.timeZone || "") ? "Z" : ""));

/** Termine am Tag `date` (JJJJ-MM-TT) aus allen Outlook-Kalendern, im selben Format wie gcal.listEvents. */
export async function listOutlookEvents(token, date) {
  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(y, m - 1, d), to = new Date(y, m - 1, d + 1);
  const { value: cals = [] } = await call(token, "/me/calendars?$top=50&$select=id,name,hexColor,isDefaultCalendar");
  const q = `startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}&$top=100` +
    "&$select=subject,start,end,isAllDay,isCancelled,responseStatus,lastModifiedDateTime,webLink";
  const lists = await Promise.all(cals.map(c =>
    call(token, `/me/calendars/${encodeURIComponent(c.id)}/calendarView?${q}`).then(r => (r.value || []).map(e => [c, e]))));
  const out = [];
  for (const [c, e] of lists.flat()) {
    if (e.isCancelled) continue;
    // Termine, die ich abgelehnt habe, gehören nicht in den Plan
    if (e.responseStatus?.response === "declined") continue;
    const base = {
      id: `ms|${e.id}`, title: (e.subject || "(ohne Titel)").trim(), updated: e.lastModifiedDateTime || "",
      calendar: c.isDefaultCalendar ? "" : (c.name || ""), color: c.hexColor || "", link: e.webLink || ""
    };
    if (e.isAllDay) {
      // Ganztägig: Enddatum ist exklusiv
      const s = e.start.dateTime.slice(0, 10), en = (e.end?.dateTime || e.start.dateTime).slice(0, 10);
      if (s === date || (s < date && date < en)) out.push({ ...base, allDay: true });
      continue;
    }
    const s = toDate(e.start), en = toDate(e.end || e.start);
    const start = localDate(s) < date ? 0 : s.getHours() * 60 + s.getMinutes();
    const end = localDate(en) > date ? 1440 : en.getHours() * 60 + en.getMinutes();
    out.push({ ...base, allDay: false, start, end: Math.max(end, start) });
  }
  return out.sort((a, b) => (b.allDay - a.allDay) || ((a.start || 0) - (b.start || 0)) || a.title.localeCompare(b.title));
}
