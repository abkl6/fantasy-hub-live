import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ffpcToken } from "@/lib/fantasy/ffpc-sync.server";
import { ffpcLeagueBundle } from "@/lib/fantasy/ffpc.server";

const leagueId = "99cdb0f8-8a01-4cb4-b6bc-1842cdd1bab0";
const { data: l } = await supabaseAdmin.from("leagues").select("external_id,user_id").eq("id", leagueId).maybeSingle();
const t = await ffpcToken(supabaseAdmin as never, l!.user_id, l!.external_id!);
console.log("token?", !!t);
const bundle = await ffpcLeagueBundle(l!.external_id!, t!, {});
console.log(JSON.stringify(bundle.settings, null, 1));
console.log("warnings", bundle.parseWarnings, "allplay", bundle.allPlayWeeks, "rsw", bundle.regularSeasonWeeks, "contest", bundle.contestFormat);
