import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
const sess = JSON.parse(readFileSync(process.env.HOME + "/.cache/lovable-auth/session.json", "utf8")).session;
const env = Object.fromEntries(readFileSync("/dev-server/.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${sess.access_token}` } }, auth: { persistSession: false } });
async function t<T>(label: string, f: () => Promise<T>) { const s = performance.now(); const r = await f(); console.log(label.padEnd(28), Math.round(performance.now() - s), "ms"); return r; }
const hub = await import("@/lib/fantasy/waiver-hub.server");
const tw = await import("@/lib/fantasy/this-week.server");
const h = await t("buildWaiverHub", () => hub.buildWaiverHub(sb as never, { userId: sess.user.id }));
console.log("hub leagues", (h as any).leagues.length);
const w = await t("buildThisWeek", () => tw.buildThisWeek(sb as never, { userId: sess.user.id }));
console.log("this-week leagues", (w as any).leagues.length, "items", (w as any).items.length);
