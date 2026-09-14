/** Tiny IndexedDB store used to show the last known data instantly while a fresh fetch runs. */

const DB_NAME = "gridiron-cache";
const STORE = "responses";

type Entry<T> = { data: T; savedAt: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let userKeyPromise: Promise<string> | null = null;

/** Scopes cache entries to the signed-in user so a shared device never leaks data. */
async function userKey(): Promise<string> {
  if (!userKeyPromise) {
    userKeyPromise = (async () => {
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.auth.getSession();
        return data.session?.user.id ?? "anon";
      } catch {
        return "anon";
      }
    })();
  }
  return userKeyPromise;
}

export async function readCache<T>(key: string): Promise<Entry<T> | null> {
  const scoped = `${await userKey()}:${key}`;
  const entry = await withStore<Entry<T>>("readonly", (store) => store.get(scoped));
  return entry && typeof entry.savedAt === "number" ? entry : null;
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  const scoped = `${await userKey()}:${key}`;
  try {
    await withStore("readwrite", (store) => store.put({ data, savedAt: Date.now() }, scoped));
  } catch {
    // structured-clone failures are not worth surfacing
  }
}

export function lastUpdatedLabel(savedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(savedAt);
}
