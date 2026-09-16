import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Target } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { TradeFinderAsset, TradeFinderIdea } from "@/lib/fantasy/trade-finder-types";
import { getTradeFinderFn } from "@/lib/fantasy.functions";
import { TrajectoryChip } from "@/components/TrajectoryChip";

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

function AssetList({ label, assets }: { label: string; assets: TradeFinderAsset[] }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] uppercase-none text-muted-foreground">{label}</p>
      <ul className="mt-1 space-y-1">
        {assets.map((a) => (
          <li key={a.name} className="truncate text-sm font-semibold">
            {a.name}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {a.position} · {a.proj.toFixed(1)} proj
            </span>{" "}
            <TrajectoryChip trajectory={a.trajectory} playerName={a.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function IdeaCard({ idea }: { idea: TradeFinderIdea }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(idea.offerText);
      toast.success("Offer copied");
    } catch {
      toast.error("Could not copy the offer");
    }
  };

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{idea.teamName}</p>
          <p className="text-xs text-muted-foreground">{idea.fitReason}</p>
        </div>
        <div className="shrink-0 text-right">
          <Badge variant="secondary">{idea.shape}</Badge>
          {idea.impactLabel ? (
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {idea.impactLabel}
            </p>
          ) : null}
        </div>
      </div>

      {idea.ruleNote ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Rule: {idea.ruleNote}</p>
      ) : null}

      <div className="mt-3 flex gap-4">
        <AssetList label="You send" assets={idea.iGive} />
        <AssetList label="You get" assets={idea.iGet} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="font-display text-lg font-bold tabular-nums text-primary">
            {signed(idea.myPointsDelta)}
          </p>
          <p className="text-[11px] text-muted-foreground">Your points/week</p>
        </div>
        <div>
          <p className="font-display text-lg font-bold tabular-nums">{signed(idea.theirPointsDelta)}</p>
          <p className="text-[11px] text-muted-foreground">Their points/week</p>
        </div>
        <div>
          <p className="font-display text-lg font-bold tabular-nums">{idea.fairness}</p>
          <p className="text-[11px] text-muted-foreground">Fairness</p>
        </div>
      </div>
      <Progress value={idea.fairness} className="mt-2 h-1.5" />
      <p className="mt-1 text-[11px] text-muted-foreground">{idea.fairnessText}</p>

      <Button size="sm" variant="secondary" className="mt-3" onClick={copy}>
        <Copy className="size-4" aria-hidden="true" />
        Copy offer
      </Button>
    </div>
  );
}

export function TradeFinder({ leagueId }: { leagueId: string }) {
  const load = useServerFn(getTradeFinderFn);
  const query = useQuery({
    queryKey: ["trade-finder", leagueId],
    queryFn: () => load({ data: { leagueId } }),
  });

  if (query.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Looking for matches across the league…
      </p>
    );
  }
  if (query.error) return <p className="text-sm text-destructive">Could not build trade ideas.</p>;

  const data = query.data;
  if (!data?.hasMyTeam) {
    return <p className="text-sm text-muted-foreground">Mark which team is yours in this league first.</p>;
  }
  if (!data.ideas.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No package improves both rosters right now — everyone's holes line up the same way.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Target className="size-4 text-primary" aria-hidden="true" />
        Ranked by fit: their thinnest starting spot against your deepest position.
      </div>
      {data.ideas.map((idea) => (
        <IdeaCard key={idea.teamId} idea={idea} />
      ))}
    </div>
  );
}
