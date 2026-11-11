import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const sess = JSON.parse(readFileSync(process.env.HOME + "/.cache/lovable-auth/session.json", "utf8")).session;
const env = Object.fromEntries(readFileSync("/dev-server/.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${sess.access_token}` } }, auth: { persistSession: false } });
const L = "93a630e0-8936-4ce7-b6a5-98fa101e0f3f";
async function t<T>(label: string, f: () => Promise<T>) { const s = performance.now(); const r = await f(); console.log(label.padEnd(28), Math.round(performance.now() - s), "ms"); return r; }
const cache = await import("@/lib/fantasy/cache.server");
const ss = await import("@/lib/fantasy/sleeper-sync.server");
const h1 = await t("hash before", () => cache.leagueInputsHash(sb as never, L));
await t("refreshSleeperLeague", () => ss.refreshSleeperLeague(sb as never, sess.user.id, L));
const h2 = await t("hash after", () => cache.leagueInputsHash(sb as never, L));
console.log("hash unchanged by a no-news sync:", h1 === h2);
