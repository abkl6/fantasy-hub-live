/**
 * Future draft pick inventory for a dynasty league, so trade ideas can include
 * picks on either side.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listDraftPicks, resetDraftPicks, setDraftPick } from "@/lib/picks.functions";

const SLOTS = ["early", "mid", "late", "unknown"] as const;

export function DraftPicksPanel({ leagueId }: { leagueId: string }) {
  const load = useServerFn(listDraftPicks);
  const reset = useServerFn(resetDraftPicks);
  const save = useServerFn(setDraftPick);
  const queryClient = useQueryClient();

  const [teamId, setTeamId] = useState<string>("");
  const [season, setSeason] = useState<number>(0);
  const [round, setRound] = useState(1);
  const [slot, setSlot] = useState<(typeof SLOTS)[number]>("mid");
  const [count, setCount] = useState(1);

  const picks = useQuery({
    queryKey: ["draft-picks", leagueId],
    queryFn: () => load({ data: { leagueId } }),
  });

  const resetting = useMutation({
    mutationFn: () => reset({ data: { leagueId } }),
    onSuccess: () => {
      toast.success("Every team now holds its own picks for the next three years.");
      void queryClient.invalidateQueries({ queryKey: ["draft-picks", leagueId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reset picks."),
  });

  const saving = useMutation({
    mutationFn: () =>
      save({
        data: {
          leagueId,
          teamId: teamId || (picks.data?.teams.find((t) => t.isMine)?.id ?? ""),
          season: season || (picks.data?.seasons[0] ?? new Date().getFullYear() + 1),
          round,
          slot,
          count,
        },
      }),
    onSuccess: () => {
      toast.success("Pick inventory updated.");
      void queryClient.invalidateQueries({ queryKey: ["draft-picks", leagueId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that pick."),
  });

  const mine = (picks.data?.picks ?? []).filter((p) => p.isMine);
  const others = (picks.data?.picks ?? []).filter((p) => !p.isMine);

  return (
    <section className="rounded-xl bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Draft picks</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Who owns which future picks. Trade suggestions use these to even out offers.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => resetting.mutate()} disabled={resetting.isPending}>
          Reset to default
        </Button>
      </div>

      {picks.isLoading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading picks…
        </p>
      ) : (
        <>
          {!picks.data?.picks.length && (
            <p className="mt-4 text-sm text-muted-foreground">
              No picks recorded yet. “Reset to default” gives every team its own picks for the next
              three years, then you can adjust anything that has been traded.
            </p>
          )}

          {!!mine.length && (
            <div className="mt-4">
              <p className="text-sm font-semibold">Your picks</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {mine.map((p) => (
                  <Badge key={p.id} variant="secondary">
                    {p.label}
                    {p.count > 1 ? ` ×${p.count}` : ""}
                    {p.value ? ` · ${p.value.toLocaleString()}` : ""}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <Label htmlFor="pick-team">Team</Label>
              <select
                id="pick-team"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Select a team</option>
                {(picks.data?.teams ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.isMine ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pick-season">Year</Label>
              <select
                id="pick-season"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={season || (picks.data?.seasons[0] ?? 0)}
                onChange={(e) => setSeason(Number(e.target.value))}
              >
                {(picks.data?.seasons ?? []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pick-round">Round</Label>
              <Input id="pick-round" type="number" min="1" max="7" value={round} onChange={(e) => setRound(Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="pick-slot">Expected slot</Label>
              <select
                id="pick-slot"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={slot}
                onChange={(e) => setSlot(e.target.value as (typeof SLOTS)[number])}
              >
                {SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pick-count">How many</Label>
              <Input id="pick-count" type="number" min="0" max="10" value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => saving.mutate()} disabled={saving.isPending || !teamId}>
                Save pick
              </Button>
            </div>
          </div>

          {!!others.length && (
            <div className="mt-5">
              <p className="text-sm font-semibold">Around the league</p>
              <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                {others.slice(0, 30).map((p) => (
                  <p key={p.id}>
                    {p.teamName}: {p.label}
                    {p.count > 1 ? ` ×${p.count}` : ""}
                  </p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
