import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const s = JSON.parse(fs.readFileSync("/root/.cache/lovable-auth/session.json","utf8"));
const tok = (s.session ?? s).access_token;
const sb = createClient(process.env['SUPABASE_URL']!, process.env['VITE_SUPABASE_PUBLISHABLE_KEY']!, {
  global: { headers: { Authorization: `Bearer ${tok}` } }, auth: { persistSession: false },
});
const uid = "63787e9b-171d-4b07-8156-b554b67b649b";
const { syncLeagueRosters } = await import("@/lib/fantasy/rosters.server");
const { syncPlayerNews } = await import("@/lib/fantasy/sleeper.server");
let t=Date.now();
await syncLeagueRosters(sb as any, uid, "e53cb435-cc10-4dd4-a950-a80af8b98fac");
console.log("rosters", Date.now()-t);
t=Date.now();
await syncPlayerNews(sb as any).catch((e)=>console.log("news err",e.message));
console.log("news", Date.now()-t);
