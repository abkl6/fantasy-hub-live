/** A best ball tournament: every entry, its weekly scores and running total. */

import { useState } from "react";
import { ChevronDown, ChevronUp, Trophy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BestballPayload } from "@/lib/fantasy/bestball.server";

export function BestballLeague({ payload }: { payload: BestballPayload }) {
  const [open, setOpen] = useState<string | null>(null);
  const lastPlayed = payload.lastPlayedWeek;
  const weekScore = (entry: BestballPayload["entries"][number]) =>
    entry.weeks.find((w) => w.week === (lastPlayed || 1))?.points ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold">{payload.name}</h1>
        <Badge variant="secondary">{payload.siteLabel}</Badge>
        <Badge variant="outline">Best ball · {payload.scoringLabel}</Badge>
        {payload.weekly && <Badge variant="outline">Scored each week</Badge>}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {payload.entries.length} {payload.entries.length === 1 ? "entry" : "entries"} ·{" "}
        {payload.weekly
          ? `ranked by week ${lastPlayed || 1}`
          : `scores through week ${payload.lastWeek}`}
        {lastPlayed ? ` · weeks 1–${lastPlayed} played, the rest projected` : " · all weeks projected"}
      </p>


      <section className="mt-8 space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-5 text-primary" />
          <h2 className="text-xl font-bold">Entries</h2>
        </div>

        {!payload.entries.length && (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No entries were read for this tournament.
          </p>
        )}

        {payload.entries.map((entry) => (
          <div key={entry.id} className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">
                  #{entry.rank} of {payload.entries.length} · Entry {entry.entryId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {entry.draftSlot ? `Draft slot ${entry.draftSlot} · ` : ""}
                  {entry.players.length} players
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-2xl font-bold tabular-nums">{entry.total.toFixed(1)}</p>
                  <p className="text-xs text-muted-foreground">through week {payload.lastWeek}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setOpen(open === entry.id ? null : entry.id)}
                >
                  {open === entry.id ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </Button>
              </div>
            </div>

            {open === entry.id && (
              <div className="border-t border-border p-4">
                <div className="grid grid-cols-7 gap-2 sm:grid-cols-14">
                  {entry.weeks.map((week) => (
                    <div
                      key={week.week}
                      className={`rounded-lg p-2 text-center ${
                        week.actual ? "bg-secondary/60" : "bg-secondary/20"
                      }`}
                    >
                      <p className="text-[10px] text-muted-foreground">W{week.week}</p>
                      <p className="text-sm font-medium tabular-nums">{week.points.toFixed(1)}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Shaded weeks are scored from real stats; the rest use projections.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {entry.players.map((player) => (
                    <Badge key={`${entry.id}-${player.name}`} variant="outline">
                      {player.name} · {player.position}
                      {player.nflTeam ? ` · ${player.nflTeam}` : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
