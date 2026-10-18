// Gmail-API (nur Lesen): Mails auflisten mit Absender, Betreff, Vorschau.
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const FILTERS = {
  unread: { label: "Ungelesen", q: "is:unread in:inbox" },
  starred: { label: "Markiert", q: "is:starred" },
  today: { label: "Heute", q: "in:inbox newer_than:1d" },
  important: { label: "Wichtig", q: "is:important in:inbox newer_than:7d" }
};

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

const decode = s => new DOMParser().parseFromString(s || "", "text/html").documentElement.textContent;
const fromName = f => { const m = (f || "").match(/^\s*"?([^"<]*?)"?\s*<(.+)>\s*$/); return m ? (m[1] || m[2]) : (f || ""); };

export async function listMessages(token, q, max = 15) {
  const { messages = [] } = await call(token, `/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  return Promise.all(messages.map(async m => {
    const x = await call(token, `/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`);
    const h = Object.fromEntries((x.payload?.headers || []).map(hd => [hd.name.toLowerCase(), hd.value]));
    const labels = x.labelIds || [];
    return {
      id: x.id, threadId: x.threadId,
      subject: (h.subject || "(kein Betreff)").trim(),
      from: fromName(h.from),
      snippet: decode(x.snippet),
      date: new Date(+x.internalDate),
      unread: labels.includes("UNREAD"),
      starred: labels.includes("STARRED")
    };
  }));
}
