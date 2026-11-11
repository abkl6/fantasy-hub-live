import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const sess = JSON.parse(readFileSync(process.env.HOME + "/.cache/lovable-auth/session.json", "utf8")).session;
const env = Object.fromEntries(readFileSync("/dev-server/.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${sess.access_token}` } }, auth: { persistSession: false } });
const L = "93a630e0-8936-4ce7-b6a5-98fa101e0f3f";
async function t<T>(label: string, f: () => Promise<T>) { const s = performance.now(); const r = await f(); console.log(label.padEnd(28), Math.round(performance.now() - s), "ms"); return r; }
const cache = await import("@/lib/fantasy/cache.server");
const rosters = await import("@/lib/fantasy/rosters.server");
await t("simple select", async () => sb.from("leagues").select("id").eq("id", L));
await t("simple select again", async () => sb.from("leagues").select("id").eq("id", L));
await t("leagueInputsHash", () => cache.leagueInputsHash(sb as never, L));
await t("componentHashes", () => cache.componentHashes(sb as never, L));
await t("syncLeagueRosters", () => rosters.syncLeagueRosters(sb as never, sess.user.id, L));
await t("allLeaguesInputsHash", () => cache.allLeaguesInputsHash(sb as never, { userId: sess.user.id }));
if (process.argv.includes("hub")) {
  const hub = await import("@/lib/fantasy/waiver-hub.server");
  await t("buildWaiverHub", () => hub.buildWaiverHub(sb as never, { userId: sess.user.id }));
}
