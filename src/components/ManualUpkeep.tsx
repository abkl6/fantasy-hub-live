/** Weekly upkeep for a manually tracked league: transactions, lineup, reconcile. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { RosterStep, ScreenshotToText } from "@/components/ManualLeagueWizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { manualFreshness } from "@/lib/fantasy/manual-types";
import type { ManualReconcileDiff } from "@/lib/fantasy/manual-types";
import { getLeagueTeams } from "@/lib/fantasy.functions";
import {
  applyReconcile,
  confirmManualLineup,
  importTransactionLog,
  manualLeagueStatus,
  manualRosterProgress,
  previewReconcile,
  setOpponentLineup,
} from "@/lib/manual.functions";

export function ManualFreshnessBadge({ lastConfirmedAt }: { lastConfirmedAt: string | null }) {
  const fresh = manualFreshness(lastConfirmedAt);
  const tone =
    fresh.state === "synced"
      ? "border-primary text-primary"
      : fresh.state === "tracking"
        ? "border-warning text-warning"
        : "border-destructive text-destructive";
  return (
    <Badge variant="outline" className={`text-[10px] ${tone}`}>
      {fresh.label}
      {fresh.days !== null ? ` · ${fresh.days}d` : ""}
    </Badge>
  );
}

export function ManualUpkeep({ leagueId }: { leagueId: string }) {
  const queryClient = useQueryClient();
  const status = useServerFn(manualLeagueStatus);
  const teamsFn = useServerFn(getLeagueTeams);
  const confirmFn = useServerFn(confirmManualLineup);
  const importFn = useServerFn(importTransactionLog);
  const previewFn = useServerFn(previewReconcile);
  const applyFn = useServerFn(applyReconcile);
  const oppFn = useServerFn(setOpponentLineup);

  const [open, setOpen] = useState(false);
  const [logText, setLogText] = useState("");
  const [rosterText, setRosterText] = useState("");
  const [teamId, setTeamId] = useState<string>("");
  const [diff, setDiff] = useState<ManualReconcileDiff | null>(null);
  const [oppText, setOppText] = useState("");

  const leagues = useQuery({ queryKey: ["manual-status"], queryFn: () => status() });
  const teams = useQuery({
    queryKey: ["league-teams", leagueId],
    queryFn: () => teamsFn({ data: { leagueId } }),
  });

  const progressFn = useServerFn(manualRosterProgress);
  const progress = useQuery({
    queryKey: ["manual-roster-progress", leagueId],
    queryFn: () => progressFn({ data: { leagueId } }),
  });
  const missing = progress.data ? progress.data.total - progress.data.filled : 0;

  const me = (leagues.data ?? []).find((l) => l.id === leagueId);
  const mine = (teams.data ?? []).find((t) => t.is_mine);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["analysis", leagueId] });
    void queryClient.invalidateQueries({ queryKey: ["manual-status"] });
  };

  const confirm = useMutation({
    mutationFn: () => confirmFn({ data: { leagueId } }),
    onSuccess: (res) => {
      toast.success(`Lineup confirmed — ${res.starters} starters.`);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not confirm the lineup."),
  });

  const importLog = useMutation({
    mutationFn: () => importFn({ data: { leagueId, text: logText } }),
    onSuccess: (res) => {
      toast.success(
        res.found === 0
          ? "No transactions found in that text."
          : `${res.applied} change${res.applied === 1 ? "" : "s"} applied, ${res.skipped} already logged.`,
      );
      setLogText("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that log."),
  });

  const runPreview = useMutation({
    mutationFn: () =>
      previewFn({ data: { leagueId, teamId: teamId || mine?.id || "", text: rosterText } }),
    onSuccess: (res) => setDiff(res),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that roster."),
  });

  const applyDiff = useMutation({
    mutationFn: () =>
      applyFn({
        data: {
          leagueId,
          teamId: diff!.teamId,
          add: diff!.added.map((p) => ({ name: p.name, position: p.position, nflTeam: p.nflTeam })),
          drop: diff!.dropped.map((p) => ({ name: p.name, position: p.position, nflTeam: p.nflTeam })),
        },
      }),
    onSuccess: (res) => {
      toast.success(`${res.added} added, ${res.dropped} removed.`);
      setDiff(null);
      setRosterText("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not apply those changes."),
  });

  const saveOpp = useMutation({
    mutationFn: () =>
      oppFn({ data: { leagueId, teamId: teamId || "", text: oppText } }),
    onSuccess: (res) => {
      toast.success(`${res.starters} starters saved for that team.`);
      setOppText("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that lineup."),
  });

  const teamOptions = teams.data ?? [];

  return (
    <section className="mt-6 rounded-xl bg-card p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold">Keep this league current</span>
          <ManualFreshnessBadge lastConfirmedAt={me?.lastConfirmedAt ?? null} />
          {missing > 0 && (
            <span className="rounded-full border border-warning px-2 py-0.5 text-xs text-warning">
              {missing} roster{missing === 1 ? "" : "s"} missing
            </span>
          )}
        </span>
        <ChevronDown
          className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="mt-4 space-y-6">
          <div>
            <p className="text-sm font-medium">Confirm your lineup</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sets the best lineup under this league's scoring and marks the week as checked.
            </p>
            <Button
              size="sm"
              className="mt-2"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Confirm lineup
            </Button>
          </div>

          <div>
            <p className="text-sm font-medium">Transaction log</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste the week's adds, drops and trades. Anything already logged is ignored.
            </p>
            <ScreenshotToText
              label="Upload transaction screenshots"
              onText={(t) => setLogText((prev) => (prev ? `${prev}\n${t}` : t))}
            />
            <Textarea
              rows={5}
              className="mt-2 font-mono text-xs"
              value={logText}
              placeholder={"Sep 10 — Team A added Jaylen Warren\nSep 10 — Team A dropped Tyjae Spears"}
              onChange={(e) => setLogText(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={!logText.trim() || importLog.isPending}
              onClick={() => importLog.mutate()}
            >
              {importLog.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Apply transactions
            </Button>
          </div>

          <div>
            <RosterStep leagueId={leagueId} />
          </div>

          <div>
            <p className="text-sm font-medium">Reconcile a roster</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Paste a full roster and we will show what changed before anything is saved.
            </p>
            <select
              className="mt-2 rounded-md bg-background px-2 py-1.5 text-xs"
              aria-label="Team"
              value={teamId || mine?.id || ""}
              onChange={(e) => {
                setTeamId(e.target.value);
                setDiff(null);
              }}
            >
              {teamOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_mine ? " (you)" : ""}
                </option>
              ))}
            </select>
            <ScreenshotToText
              label="Upload roster screenshots"
              onText={(t) => setRosterText((prev) => (prev ? `${prev}\n${t}` : t))}
            />
            <Textarea
              rows={5}
              className="mt-2 font-mono text-xs"
              value={rosterText}
              placeholder={"Josh Allen (QB - BUF)\nBijan Robinson RB ATL"}
              onChange={(e) => setRosterText(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={!rosterText.trim() || runPreview.isPending}
              onClick={() => runPreview.mutate()}
            >
              {runPreview.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Check what changed
            </Button>

            {diff && (
              <div className="mt-3 rounded-lg bg-background/40 p-3 text-xs">
                <p className="font-medium">{diff.teamName}</p>
                <p className="mt-1 text-primary">
                  {diff.added.length
                    ? `Add: ${diff.added.map((p) => p.name).join(", ")}`
                    : "Nothing to add"}
                </p>
                <p className="mt-1 text-destructive">
                  {diff.dropped.length
                    ? `Remove: ${diff.dropped.map((p) => p.name).join(", ")}`
                    : "Nothing to remove"}
                </p>
                <p className="mt-1 text-muted-foreground">{diff.unchanged} unchanged</p>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={applyDiff.isPending}
                  onClick={() => applyDiff.mutate()}
                >
                  {applyDiff.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Apply changes
                </Button>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-medium">Opponent lineup</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Opponent lineups are estimated. Paste a real one for the team picked above to replace
              the estimate.
            </p>
            <Textarea
              rows={4}
              className="mt-2 font-mono text-xs"
              value={oppText}
              placeholder={"Jalen Hurts\nSaquon Barkley\nA.J. Brown"}
              onChange={(e) => setOppText(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={!oppText.trim() || !teamId || saveOpp.isPending}
              onClick={() => saveOpp.mutate()}
            >
              {saveOpp.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save their lineup
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
