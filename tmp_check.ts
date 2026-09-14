import { createClient } from "@supabase/supabase-js";
import { buildAnalysis } from "@/lib/fantasy/analysis.server";
const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);
const t = Date.now();
try {
  const a = await buildAnalysis(sb as any, "e53cb435-cc10-4dd4-a950-a80af8b98fac");
  console.log("ok", Date.now() - t, "ms", a.scoringLabel, a.myTeam?.name, a.starters?.length);
} catch (e) { console.log("ERR", Date.now() - t, (e as Error).message); }
