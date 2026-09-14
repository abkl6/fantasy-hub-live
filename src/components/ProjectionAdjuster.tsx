/**
 * Adjust one player's projection for yourself: a slider from -40% to +40% of
 * the shared baseline, or exact numbers if you'd rather type them.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { clearOverride, setOverride } from "@/lib/projections.functions";

export interface AdjusterPlayer {
  id: string;
  name: string;
  position: string;
  baseWeek: number;
  baseSeason: number;
  myWeek: number | null;
  mySeason: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function ProjectionAdjuster({
  player,
  onDone,
}: {
  player: AdjusterPlayer;
  onDone?: () => void;
}) {
  const save = useServerFn(setOverride);
  const reset = useServerFn(clearOverride);
  const queryClient = useQueryClient();

  const startPct =
    player.myWeek !== null && player.baseWeek > 0
      ? Math.round(((player.myWeek / player.baseWeek) * 100 - 100))
      : 0;

  const [pct, setPct] = useState(Math.max(-40, Math.min(40, startPct)));
  const [week, setWeek] = useState(round1(player.myWeek ?? player.baseWeek));
  const [season, setSeason] = useState(round1(player.mySeason ?? player.baseSeason));

  useEffect(() => {
    setWeek(round1(player.baseWeek * (1 + pct / 100)));
    setSeason(round1(player.baseSeason * (1 + pct / 100)));
    // Only the slider drives both numbers; typing sets them directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct]);

  const invalidate = () => {
    void queryClient.invalidateQueries();
    onDone?.();
  };

  const saving = useMutation({
    mutationFn: () => save({ data: { playerId: player.id, week, season } }),
    onSuccess: () => {
      toast.success(`${player.name} updated for your leagues.`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that."),
  });

  const clearing = useMutation({
    mutationFn: () => reset({ data: { playerId: player.id } }),
    onSuccess: () => {
      toast.success(`${player.name} is back to the standard projection.`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reset that."),
  });

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={`adj-${player.id}`}>Adjust by</Label>
          <span className="font-mono text-sm">{pct > 0 ? `+${pct}` : pct}%</span>
        </div>
        <Slider
          id={`adj-${player.id}`}
          className="mt-3"
          min={-40}
          max={40}
          step={1}
          value={[pct]}
          onValueChange={(v) => setPct(v[0] ?? 0)}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Standard: {round1(player.baseWeek)} a week, {round1(player.baseSeason)} for the season.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`week-${player.id}`}>Points per week</Label>
          <Input
            id={`week-${player.id}`}
            type="number"
            step="0.1"
            min="0"
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor={`season-${player.id}`}>Points this season</Label>
          <Input
            id={`season-${player.id}`}
            type="number"
            step="1"
            min="0"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={() => saving.mutate()} disabled={saving.isPending}>
          Save for my leagues
        </Button>
        {player.myWeek !== null && (
          <Button variant="ghost" onClick={() => clearing.mutate()} disabled={clearing.isPending}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Reset to standard
          </Button>
        )}
      </div>
    </div>
  );
}
