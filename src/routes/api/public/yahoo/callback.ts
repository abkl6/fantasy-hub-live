import { createFileRoute } from "@tanstack/react-router";

/**
 * Yahoo redirects the manager back here after they approve access.
 * The one-time `state` value identifies which account started the sign-in.
 */
export const Route = createFileRoute("/api/public/yahoo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const origin = url.origin;

        const back = (message: string) =>
          new Response(null, {
            status: 302,
            headers: { location: `${origin}/connect?yahoo=${encodeURIComponent(message)}` },
          });

        if (!code || !state) return back("cancelled");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { yahooExchangeCode } = await import("@/lib/fantasy/yahoo.server");

        const { data: pending } = await supabaseAdmin
          .from("platform_credentials")
          .select("id, user_id, payload, expires_at")
          .eq("platform", "yahoo_pending")
          .contains("payload", { state })
          .maybeSingle();

        if (!pending) return back("expired");
        if (pending.expires_at && Date.parse(pending.expires_at) < Date.now()) {
          await supabaseAdmin.from("platform_credentials").delete().eq("id", pending.id);
          return back("expired");
        }

        const storedOrigin =
          (pending.payload as Record<string, string> | null)?.["origin"] ?? origin;

        try {
          const { encryptToken } = await import("@/lib/fantasy/token-crypto.server");
          const tokens = await yahooExchangeCode(code, storedOrigin);
          await supabaseAdmin.from("platform_credentials").upsert(
            {
              user_id: pending.user_id,
              platform: "yahoo",
              payload: {
                access_token: await encryptToken(tokens.accessToken),
                refresh_token: await encryptToken(tokens.refreshToken),
              },
              expires_at: new Date(tokens.expiresAt).toISOString(),
            },
            { onConflict: "user_id,platform" },
          );
          await supabaseAdmin.from("platform_credentials").delete().eq("id", pending.id);
          return back("connected");
        } catch (error) {
          console.error("[yahoo] token exchange failed", error);
          return back("failed");
        }
      },
    },
  },
});
