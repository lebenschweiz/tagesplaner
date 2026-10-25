// Asana-API mit persönlichem Zugangsschlüssel: eigene offene Aufgaben lesen und abhaken.
const API = "https://app.asana.com/api/1.0";
const TOKEN_KEY = "tagesplaner:asanaToken";

export const FILTERS = {
  all: { label: "Alle" },
  today: { label: "Heute" },
  due: { label: "Fällig" }
};

/* Zugangsschlüssel nur in diesem Browser (localStorage). Optional zusätzlich im Konto, siehe app.js. */
export function localToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
export function saveLocalToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} }

async function call(token, path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) }
  });
  if (r.status === 401) throw Object.assign(new Error("Zugangsschlüssel ungültig oder widerrufen"), { code: "unauthorized" });
  if (!r.ok) {
    let msg = r.statusText || "HTTP " + r.status;
    try { msg = (await r.json()).errors[0].message; } catch {}
    throw Object.assign(new Error(msg), { code: "failed" });
  }
  return r.json();
}

const FIELDS = "name,due_on,due_at,assignee_section.name,permalink_url,projects.name,notes";

/** Alle offenen Aufgaben aus „Meine Aufgaben“ aller Arbeitsbereiche, in der Reihenfolge wie in Asana. */
export async function listMyTasks(token) {
  const { data: me } = await call(token, "/users/me?opt_fields=name,workspaces.name");
  const multi = (me.workspaces || []).length > 1;
  const out = [];
  for (const ws of me.workspaces || []) {
    const { data: utl } = await call(token, `/users/me/user_task_list?workspace=${ws.gid}&opt_fields=gid`);
    let path = `/user_task_lists/${utl.gid}/tasks?completed_since=now&limit=100&opt_fields=${FIELDS}`;
    while (path) {
      const r = await call(token, path);
      r.data.forEach(t => out.push({
        id: t.gid,
        name: (t.name || "").trim() || "(ohne Titel)",
        due: t.due_on || (t.due_at ? t.due_at.slice(0, 10) : ""),
        section: (t.assignee_section?.name || "").trim() || "Ohne Bereich",
        projects: (t.projects || []).map(p => p.name).filter(Boolean),
        notes: (t.notes || "").trim(),
        workspace: multi ? ws.name : "",
        url: t.permalink_url || `https://app.asana.com/0/0/${t.gid}`
      }));
      path = r.next_page ? r.next_page.path : null;
    }
  }
  return { user: me.name || "", tasks: out };
}

/** Aufgabe in Asana als erledigt (oder wieder offen) markieren. */
export function setCompleted(token, id, completed) {
  return call(token, `/tasks/${id}`, { method: "PUT", body: JSON.stringify({ data: { completed } }) });
}

/** "Heute" = Bereich „today“/„Heute“ in Meine Aufgaben oder heute (oder früher) fällig. */
export function matches(t, filter, today) {
  if (filter === "all") return true;
  if (filter === "due") return !!t.due && t.due <= today;
  return /^(today|heute)$/i.test(t.section) || (!!t.due && t.due <= today);
}
