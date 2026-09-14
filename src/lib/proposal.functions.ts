/** Trade Simulator: price a proposed trade and load the pickers behind it. */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SLOTS = ["early", "mid", "late", "unknown"] as const;

const assetSchema = z.union([
  z.object({ kind: z.literal("player"), name: z.string().min(1), position: z.string().min(1) }),
  z.object({
    kind: z.literal("pick"),
    season: z.number().int().min(2024).max(2040),
    round: z.number().int().min(1).max(7),
    slot: z.enum(SLOTS),
  }),
]);

export const getProposalBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leagueId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { buildProposalBoard } = await import("./fantasy/proposal.server");
    return buildProposalBoard(context.supabase, data.leagueId);
  });

export const evaluateProposalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        leagueId: z.string().uuid(),
        teamAId: z.string().uuid(),
        teamBId: z.string().uuid(),
        aGives: z.array(assetSchema).max(8),
        bGives: z.array(assetSchema).max(8),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { evaluateProposal } = await import("./fantasy/proposal.server");
    return evaluateProposal(context.supabase, data);
  });
