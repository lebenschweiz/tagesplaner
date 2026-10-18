// Asana-API (nur Lesen) mit persönlichem Zugangsschlüssel: eigene offene Aufgaben.
const API = "https://app.asana.com/api/1.0";
const TOKEN_KEY = "tagesplaner:asanaToken";

export const FILTERS = {
  today: { label: "Heute" },
  due: { label: "Fällig" },
  all: { label: "Alle offenen" }
};

export function savedToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
export function saveToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} }

async function call(token, path) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (r.status === 401) throw Object.assign(new Error("Zugangsschlüssel ungültig"), { code: "unauthorized" });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).errors[0].message; } catch {}
    throw Object.assign(new Error(msg), { code: "failed" });
  }
  return r.json();
}

/** Alle offenen Aufgaben, die mir zugewiesen sind, aus allen Arbeitsbereichen. */
export async function listMyTasks(token) {
  const { data: me } = await call(token, "/users/me?opt_fields=workspaces.name");
  const out = [];
  for (const ws of me.workspaces || []) {
    let path = `/tasks?assignee=me&workspace=${ws.gid}&completed_since=now&limit=100&opt_fields=name,due_on,assignee_section.name,permalink_url`;
    while (path) {
      const r = await call(token, path);
      r.data.forEach(t => out.push({
        id: t.gid,
        name: (t.name || "").trim() || "(ohne Titel)",
        due: t.due_on || "",
        section: (t.assignee_section?.name || "").trim(),
        url: t.permalink_url || `https://app.asana.com/0/0/${t.gid}`
      }));
      path = r.next_page ? r.next_page.path : null;
    }
  }
  return out;
}

/** "Heute" = Bereich „today“/„Heute“ in Meine Aufgaben oder heute fällig. */
export function matches(t, filter, today) {
  if (filter === "all") return true;
  if (filter === "due") return !!t.due && t.due <= today;
  return /^(today|heute)$/i.test(t.section) || t.due === today;
}
