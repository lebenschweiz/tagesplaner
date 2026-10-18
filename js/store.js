// Speicher: Firestore (mit Google-Login) oder localStorage (ohne Konto).
// Beide bieten dieselbe Schnittstelle: get(kind, id), set(kind, id, data), all().
import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const KINDS = ["days", "weeks", "meta"];

export const cloudAvailable = !!firebaseConfig;

/* ---------- lokal ---------- */
function localStore() {
  const key = (kind, id) => `tagesplaner:${kind}:${id}`;
  return {
    mode: "local",
    user: { name: "Dieses Gerät", email: "Ohne Konto – Daten nur in diesem Browser" },
    async get(kind, id) {
      try { return JSON.parse(localStorage.getItem(key(kind, id)) || "null"); } catch { return null; }
    },
    async set(kind, id, data) {
      localStorage.setItem(key(kind, id), JSON.stringify(data));
    },
    async all() {
      const out = { days: {}, weeks: {}, meta: {} };
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const m = k && k.match(/^tagesplaner:(days|weeks|meta):(.+)$/);
        if (m) { try { out[m[1]][m[2]] = JSON.parse(localStorage.getItem(k)); } catch {} }
      }
      return out;
    },
    async signOut() { localStorage.removeItem("tagesplaner:mode"); }
  };
}

/* ---------- Firebase ---------- */
let fb = null;
async function loadFirebase() {
  if (fb) return fb;
  const [app, auth, fs] = await Promise.all([
    import(FB + "firebase-app.js"),
    import(FB + "firebase-auth.js"),
    import(FB + "firebase-firestore.js")
  ]);
  const a = app.initializeApp(firebaseConfig);
  let db;
  try {
    db = fs.initializeFirestore(a, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
    });
  } catch {
    db = fs.getFirestore(a);
  }
  fb = { auth: auth.getAuth(a), authMod: auth, db, fs };
  return fb;
}

function cloudStore(fbx, user) {
  const { db, fs } = fbx;
  const ref = (kind, id) => fs.doc(db, "users", user.uid, kind, id);
  return {
    mode: "cloud",
    user: { name: user.displayName || "Angemeldet", email: user.email || "" },
    async get(kind, id) {
      const s = await fs.getDoc(ref(kind, id));
      return s.exists() ? s.data() : null;
    },
    async set(kind, id, data) {
      await fs.setDoc(ref(kind, id), data);
    },
    async all() {
      const out = { days: {}, weeks: {}, meta: {} };
      for (const kind of KINDS) {
        const snap = await fs.getDocs(fs.collection(db, "users", user.uid, kind));
        snap.forEach(d => { out[kind][d.id] = d.data(); });
      }
      return out;
    },
    async signOut() { await fbx.authMod.signOut(fbx.auth); }
  };
}

/** Ruft onReady(store) auf, sobald jemand angemeldet ist, oder onReady(null) für den Login-Bildschirm. */
export async function watchAuth(onReady) {
  if (localStorage.getItem("tagesplaner:mode") === "local") { onReady(localStore()); return; }
  if (!cloudAvailable) { onReady(null); return; }
  try {
    const f = await loadFirebase();
    try { await f.authMod.getRedirectResult(f.auth); } catch {}
    f.authMod.onAuthStateChanged(f.auth, u => onReady(u ? cloudStore(f, u) : null));
  } catch (e) {
    console.error(e);
    onReady(null, "Firebase konnte nicht geladen werden. Bist du online?");
  }
}

export async function signInWithGoogle() {
  const f = await loadFirebase();
  const provider = new f.authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await f.authMod.signInWithPopup(f.auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await f.authMod.signInWithRedirect(f.auth, provider);
    } else throw e;
  }
}

export function useLocal() {
  localStorage.setItem("tagesplaner:mode", "local");
  return localStore();
}
