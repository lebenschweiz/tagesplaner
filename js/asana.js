// Asana-API mit persönlichem Zugangsschlüssel: „Meine Aufgaben“ lesen, abhaken und neue Aufgaben anlegen.
const API = "https://app.asana.com/api/1.0";
const TOKEN_KEY = "tagesplaner:asanaToken";

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

// Farben der Asana-Projekte (aktuelle und ältere Palette), als Hintergrund der Projekt-Etiketten
export const COLORS = {
  red: "#f06a6a", orange: "#ec8d71", "yellow-orange": "#f1bd6c", yellow: "#f8df72", "yellow-green": "#aecf55",
  green: "#5da283", "blue-green": "#4ecbc4", aqua: "#9ee7e3", blue: "#4573d2", indigo: "#8d84e8",
  purple: "#b36bd4", magenta: "#f9aaef", "hot-pink": "#f26fb2", pink: "#fc979a", "cool-gray": "#6d6e6f",
  "dark-pink": "#ea4e9d", "dark-green": "#62d26f", "dark-blue": "#4186e0", "dark-red": "#e8384f", "dark-teal": "#37c5ab",
  "dark-brown": "#8d6e63", "dark-orange": "#fd612c", "dark-purple": "#7a6ff0", "dark-warm-gray": "#5b5e66",
  "light-pink": "#f9aaef", "light-green": "#a4cf30", "light-blue": "#4573d2", "light-red": "#ff7d7d", "light-teal": "#4ecbc4",
  "light-brown": "#b0907b", "light-orange": "#fdae33", "light-purple": "#aa62e3", "light-warm-gray": "#8da3a6"
};

const FIELDS = "name,due_on,due_at,assignee_section.name,permalink_url,projects.name,projects.color,notes";

/**
 * „Meine Aufgaben“ aller Arbeitsbereiche wie in Asana: Bereiche (Spalten) in Asana-Reihenfolge,
 * auch leere, und alle offenen Aufgaben in ihrer Reihenfolge.
 */
export async function loadMyTasks(token) {
  const { data: me } = await call(token, "/users/me?opt_fields=name,workspaces.name");
  const multi = (me.workspaces || []).length > 1;
  const sections = [], tasks = [];
  for (const ws of me.workspaces || []) {
    const prefix = multi ? ws.name + " · " : "";
    const { data: utl } = await call(token, `/users/me/user_task_list?workspace=${ws.gid}&opt_fields=gid`);
    // Bereiche von „Meine Aufgaben“ – klappt das nicht, ergeben sie sich unten aus den Aufgaben
    try {
      const r = await call(token, `/projects/${utl.gid}/sections?opt_fields=name&limit=100`);
      r.data.forEach(s => sections.push({ id: s.gid, name: prefix + (s.name || "").trim(), workspace: ws.gid }));
    } catch (e) { if (e.code === "unauthorized") throw e; }
    let path = `/user_task_lists/${utl.gid}/tasks?completed_since=now&limit=100&opt_fields=${FIELDS}`;
    while (path) {
      const r = await call(token, path);
      r.data.forEach(t => {
        const sec = t.assignee_section || {};
        if (sec.gid && !sections.some(s => s.id === sec.gid)) sections.push({ id: sec.gid, name: prefix + (sec.name || "").trim(), workspace: ws.gid });
        tasks.push({
          id: t.gid,
          name: (t.name || "").trim() || "(ohne Titel)",
          due: t.due_on || (t.due_at ? t.due_at.slice(0, 10) : ""),
          section: sec.gid || "",
          projects: (t.projects || []).map(p => ({ name: (p.name || "").trim(), color: p.color || "none" })).filter(p => p.name),
          notes: (t.notes || "").trim(),
          url: t.permalink_url || `https://app.asana.com/0/0/${t.gid}`
        });
      });
      path = r.next_page ? r.next_page.path : null;
    }
  }
  return { user: me.name || "", sections, tasks };
}

/** Aufgabe in Asana als erledigt (oder wieder offen) markieren. */
export function setCompleted(token, id, completed) {
  return call(token, `/tasks/${id}`, { method: "PUT", body: JSON.stringify({ data: { completed } }) });
}

/** Neue Aufgabe in „Meine Aufgaben“, im gewählten Bereich. */
export async function createTask(token, section, name) {
  const { data } = await call(token, `/tasks?opt_fields=${FIELDS}`, {
    method: "POST",
    body: JSON.stringify({ data: { name, assignee: "me", workspace: section.workspace, assignee_section: section.id } })
  });
  return data;
}
