/**
 * Where a player's market value is heading: one arrow-and-word chip that opens
 * a three-point chart (now, +1 year, +2 years) with its uncertainty band.
 */

import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingDown } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TRAJECTORY_LABEL, type Trajectory } from "@/lib/fantasy/age-curve";
import { cn } from "@/lib/utils";

const TONE: Record<Trajectory["classification"], string> = {
  rising: "text-primary",
  peak: "text-foreground",
  declining: "text-amber-400",
  cliff: "text-destructive",
};

const ICON = {
  rising: ArrowUpRight,
  peak: ArrowRight,
  declining: ArrowDownRight,
  cliff: TrendingDown,
} as const;

export function TrajectoryChip({
  trajectory,
  playerName,
  className,
}: {
  trajectory: Trajectory | null | undefined;
  playerName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!trajectory) return null;
  const Icon = ICON[trajectory.classification];

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium",
          TONE[trajectory.classification],
          className,
        )}
        aria-label={`${playerName} value trajectory: ${TRAJECTORY_LABEL[trajectory.classification]}`}
      >
        <Icon className="h-3 w-3" />
        {TRAJECTORY_LABEL[trajectory.classification]}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{playerName} — value trajectory</DialogTitle>
          </DialogHeader>
          <TrajectoryChart trajectory={trajectory} />
          <p className="text-sm text-muted-foreground">{trajectory.sentence}</p>
          <p className="text-xs text-muted-foreground">
            Shaded band is ±15%. Curve fitted from the{" "}
            {trajectory.curveSource === "market" ? "current trade market" : "standard age curve"}.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TrajectoryChart({ trajectory }: { trajectory: Trajectory }) {
  const points = [trajectory.now, trajectory.plus1, trajectory.plus2];
  const labels = ["Now", "+1 yr", "+2 yrs"];
  const highs = trajectory.band.map((b) => b.high);
  const lows = trajectory.band.map((b) => b.low);
  const max = Math.max(...highs, 1);
  const min = Math.min(...lows, 0);
  const span = Math.max(1, max - min);

  const width = 320;
  const height = 140;
  const x = (i: number) => 20 + (i * (width - 40)) / 2;
  const y = (v: number) => height - 24 - ((v - min) / span) * (height - 48);

  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const area =
    highs.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ") +
    " " +
    [...lows].reverse().map((v, i) => `L${x(2 - i)},${y(v)}`).join(" ") +
    " Z";

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Value over the next two years">
        <path d={area} className="fill-primary/15" />
        <path d={line} className="stroke-primary" strokeWidth={2} fill="none" />
        {points.map((v, i) => (
          <circle key={labels[i]} cx={x(i)} cy={y(v)} r={3.5} className="fill-primary" />
        ))}
        {points.map((v, i) => (
          <text
            key={`label-${labels[i]}`}
            x={x(i)}
            y={height - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {labels[i]}
          </text>
        ))}
      </svg>
      <div className="grid grid-cols-3 gap-2 text-center">
        {points.map((v, i) => (
          <div key={`value-${labels[i]}`}>
            <p className="stat-num text-lg">{v.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">
              {trajectory.band[i]!.low.toLocaleString()}–{trajectory.band[i]!.high.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
