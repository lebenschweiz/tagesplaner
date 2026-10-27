// Outlook-Kalender über Microsoft Graph (nur Lesen).
// Anmeldung per Popup mit PKCE, ohne zusätzliche Bibliothek. Das Zugriffstoken gilt ca. 1 Stunde und wird
// mit dem Refresh-Token still erneuert (bei Microsoft für Web-Apps bis zu 24 Stunden), danach einmal neu verbinden.
import { msClientId } from "./ms-config.js";

const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access User.Read Calendars.Read";
const KEY = "tagesplaner:ms";
const RESULT_KEY = "tagesplaner:ms-auth";

export const outlookAvailable = !!msClientId;
const redirectUri = () => new URL("ms-auth.html", location.href).href;

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomString = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const save = t => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {} };

async function tokenRequest(params) {
  const r = await fetch(AUTH + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: msClientId, scope: SCOPES, ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error(j.error_description || j.error || r.statusText), { code: j.error || "failed" });
  const t = { access: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000, refresh: j.refresh_token || params.refresh_token || "", name: (load() || {}).name || "" };
  save(t);
  return t;
}

/** Gültiges Zugriffstoken oder null (erneuert still, falls möglich) */
export async function outlookToken() {
  if (!msClientId) return null;
  const t = load();
  if (!t) return null;
  if (t.access && t.exp > Date.now()) return t.access;
  if (!t.refresh) { forgetOutlook(); return null; }
  try { return (await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh })).access; }
  catch { forgetOutlook(); return null; }
}
export const outlookAccount = () => (load() || {}).name || "";
export function forgetOutlook() { try { localStorage.removeItem(KEY); } catch {} }

/** Anmeldung im Popup. Muss direkt aus einem Klick aufgerufen werden. */
export function connectOutlook() {
  if (!msClientId) return Promise.reject(Object.assign(new Error("Outlook ist noch nicht eingerichtet"), { code: "no-client" }));
  // Fenster sofort öffnen (sonst blockiert der Browser das Popup), Adresse danach setzen
  const popup = window.open("about:blank", "ms-login", "width=520,height=680");
  if (!popup) return Promise.reject(Object.assign(new Error("Das Anmeldefenster wurde blockiert. Erlaube Popups für diese Seite."), { code: "popup-blocked" }));
  return (async () => {
    const verifier = randomString(48), state = randomString(16);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    try { localStorage.removeItem(RESULT_KEY); } catch {}
    popup.location.href = `${AUTH}/authorize?` + new URLSearchParams({
      client_id: msClientId, response_type: "code", redirect_uri: redirectUri(), response_mode: "query",
      scope: SCOPES, code_challenge: challenge, code_challenge_method: "S256", state, prompt: "select_account"
    });
    const search = await new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, v) => { if (done) return; done = true; clearInterval(timer); window.removeEventListener("message", onMsg); window.removeEventListener("storage", onStore); fn(v); };
      const onMsg = e => { if (e.origin === location.origin && e.data && e.data.type === "ms-auth") finish(resolve, e.data.search); };
      const onStore = e => { if (e.key === RESULT_KEY && e.newValue) finish(resolve, JSON.parse(e.newValue).search); };
      window.addEventListener("message", onMsg);
      window.addEventListener("storage", onStore);
      const started = Date.now();
      const timer = setInterval(() => {
        try { const r = JSON.parse(localStorage.getItem(RESULT_KEY) || "null"); if (r && r.at >= started - 1000) return finish(resolve, r.search); } catch {}
        if (popup.closed) setTimeout(() => finish(reject, Object.assign(new Error("Abgebrochen"), { code: "cancelled" })), 600);
        if (Date.now() - started > 5 * 60 * 1000) finish(reject, Object.assign(new Error("Zeitüberschreitung"), { code: "timeout" }));
      }, 400);
    });
    try { localStorage.removeItem(RESULT_KEY); } catch {}
    const q = new URLSearchParams(search);
    if (q.get("error")) throw Object.assign(new Error(q.get("error_description") || q.get("error")), { code: q.get("error") });
    if (q.get("state") !== state || !q.get("code")) throw Object.assign(new Error("Antwort von Microsoft passt nicht zur Anfrage"), { code: "state" });
    const t = await tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(), code_verifier: verifier });
    try {
      const me = await call(t.access, "/me?$select=displayName,mail,userPrincipalName");
      t.name = me.mail || me.userPrincipalName || me.displayName || ""; save(t);
    } catch {}
    return t.access;
  })().catch(e => { try { popup.close(); } catch {} throw e; });
}

async function call(token, path, headers = {}) {
  const r = await fetch(GRAPH + path, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  if (r.status === 401) throw Object.assign(new Error("Zugriff abgelaufen"), { code: "expired" });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error.message; } catch {}
    throw Object.assign(new Error(msg), { code: r.status === 403 ? "forbidden" : "failed" });
  }
  return r.json();
}

const toMinutes = s => { const [h, m] = s.slice(11, 16).split(":").map(Number); return h * 60 + m; };

/** Termine am Tag `date` (JJJJ-MM-TT) aus allen Outlook-Kalendern – gleiche Form wie beim Google Kalender */
export async function listOutlookEvents(token, date) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [y, m, d] = date.split("-").map(Number);
  const from = new Date(y, m - 1, d), to = new Date(y, m - 1, d + 1);
  // Zeiten in der eigenen Zeitzone zurückgeben lassen: dann ist „2026-10-27T09:00“ direkt die Uhrzeit hier
  const pref = { Prefer: `outlook.timezone="${tz}"` };
  const { value: cals = [] } = await call(token, "/me/calendars?$select=id,name,hexColor,isDefaultCalendar&$top=50");
  const q = `startDateTime=${encodeURIComponent(from.toISOString())}&endDateTime=${encodeURIComponent(to.toISOString())}` +
    `&$top=100&$select=id,subject,start,end,isAllDay,isCancelled,showAs,webLink,lastModifiedDateTime,responseStatus`;
  const lists = await Promise.all(cals.map(c =>
    call(token, `/me/calendars/${encodeURIComponent(c.id)}/calendarView?${q}`, pref).then(r => (r.value || []).map(e => [c, e]))));
  const out = [];
  for (const [c, e] of lists.flat()) {
    if (e.isCancelled) continue;
    if (e.responseStatus && e.responseStatus.response === "declined") continue;
    const base = {
      id: `ms|${e.id}`, title: (e.subject || "(ohne Titel)").trim(), updated: e.lastModifiedDateTime || "",
      calendar: c.isDefaultCalendar ? "Outlook" : `Outlook · ${c.name}`, color: c.hexColor || "#0f6cbd", link: e.webLink || "", source: "outlook"
    };
    const sd = e.start.dateTime.slice(0, 10), ed = (e.end && e.end.dateTime || e.start.dateTime).slice(0, 10);
    if (e.isAllDay) {
      if (sd <= date && date < ed) out.push({ ...base, allDay: true });
      continue;
    }
    const start = sd < date ? 0 : toMinutes(e.start.dateTime);
    const end = ed > date ? 1440 : toMinutes(e.end.dateTime);
    out.push({ ...base, allDay: false, start, end: Math.max(end, start) });
  }
  return out;
}
