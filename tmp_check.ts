import { createClient } from "@supabase/supabase-js";
import { buildAnalysis } from "@/lib/fantasy/analysis.server";
import fs from "node:fs";
const s = JSON.parse(fs.readFileSync("/root/.cache/lovable-auth/session.json","utf8"));
const tok = (s.session ?? s).access_token;
const sb = createClient(process.env['SUPABASE_URL']!, process.env['VITE_SUPABASE_PUBLISHABLE_KEY'] ?? process.env['SUPABASE_ANON_KEY']!, {
  global: { headers: { Authorization: `Bearer ${tok}` } }, auth: { persistSession: false },
});
let t = Date.now();
const { data, error } = await sb.from("player_week_stats").select("player_id, opponent, stats, src_points").eq("season",2026).eq("week",1);
console.log("weekstats", Date.now()-t, data?.length, error?.message);
t = Date.now();
const r = await sb.from("players").select("*");
console.log("players", Date.now()-t, r.data?.length);
t = Date.now();
const o = await sb.from("player_projection_overrides").select("player_id, proj_points_week, proj_points_season, players(full_name)");
console.log("overrides", Date.now()-t, o.data?.length, o.error?.message);
t = Date.now();
try { await buildAnalysis(sb as any, "e53cb435-cc10-4dd4-a950-a80af8b98fac"); console.log("analysis", Date.now()-t); }
catch(e){ console.log("ERR", (e as Error).message); }
