import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ffpcToken } from "@/lib/fantasy/ffpc-sync.server";
const leagueId = "99cdb0f8-8a01-4cb4-b6bc-1842cdd1bab0";
const { data: l } = await supabaseAdmin.from("leagues").select("external_id,user_id").eq("id", leagueId).maybeSingle();
const t = await ffpcToken(supabaseAdmin as never, l!.user_id, l!.external_id!);
const r = await fetch(`https://myffpc.com/LeagueHome.aspx?ltuid=${t}`, { headers: { "User-Agent": "GridironEdge/1.0 (league sync)" } });
await Bun.write("/tmp/lh38.html", await r.text());
console.log("ok");
