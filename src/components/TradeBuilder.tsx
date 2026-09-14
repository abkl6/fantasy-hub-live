import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeftRight, Loader2, X } from "lucide-react";

import { TeamBadge } from "@/components/TeamBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { evaluateProposalFn, getProposalBoard } from "@/lib/proposal.functions";
import type { ProposalAsset, ProposalBoard, ProposalResult, ProposalSide } from "@/lib/fantasy/proposal.server";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

function assetId(a: ProposalAsset) {
  return a.kind === "player" ? `p:${a.name}` : `k:${a.season}-${a.round}-${a.slot}`;
}

function SidePicker({
  team,
  selected,
  onToggle,
}: {
  team: ProposalBoard["teams"][number] | undefined;
  selected: ProposalAsset[];
  onToggle: (a: ProposalAsset) => void;
}) {
  const [search, setSearch] = useState("");
  const chosen = new Set(selected.map(assetId));
  const players = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = team?.players ?? [];
    return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;
  }, [team, search]);

  if (!team) return <p className="text-sm text-muted-foreground">Pick a team.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TeamBadge badge={team.badge} />
        {team.dynastyValue != null && (
          <span className="text-xs text-muted-foreground">
            Dynasty value {team.dynastyValue.toLocaleString()} (#{team.dynastyRank})
          </span>
        )}
      </div>
      <Input placeholder="Search players" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ScrollArea className="h-64 rounded-md border">
        <div className="divide-y">
          {players.map((p) => {
            const asset: ProposalAsset = { kind: "player", name: p.name, position: p.position };
            const on = chosen.has(assetId(asset));
            return (
              <button
                key={`${p.name}-${p.position}`}
                type="button"
                onClick={() => onToggle(asset)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${on ? "bg-primary/10" : ""}`}
              >
                <span className="truncate">
                  {p.name} <span className="text-xs text-muted-foreground">{p.position}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.round(p.value).toLocaleString()}
                </span>
              </button>
            );
          })}
          {team.picks.map((k) => {
            const asset: ProposalAsset = { kind: "pick", season: k.season, round: k.round, slot: k.slot };
            const on = chosen.has(assetId(asset));
            return (
              <button
                key={k.label}
                type="button"
                onClick={() => onToggle(asset)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${on ? "bg-primary/10" : ""}`}
              >
                <span className="truncate">
                  {k.label} <span className="text-xs text-muted-foreground">pick</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.round(k.value).toLocaleString()}
                </span>
              </button>
            );
          })}
          {!players.length && !team.picks.length && (
            <p className="px-3 py-6 text-sm text-muted-foreground">No players or picks on record for this team.</p>
          )}
        </div>
      </ScrollArea>
      <div className="flex flex-wrap gap-1">
        {selected.map((a) => (
          <Badge key={assetId(a)} variant="secondary" className="gap-1">
            {a.kind === "player" ? a.name : `${a.season} R${a.round}`}
            <button type="button" onClick={() => onToggle(a)} aria-label="Remove">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}

function SideResult({ side, isDynasty }: { side: ProposalSide; isDynasty: boolean }) {
  const titleDelta = (side.titleAfter - side.titleBefore) * 100;
  const playoffDelta = (side.playoffAfter - side.playoffBefore) * 100;
  const dynDelta =
    side.dynastyAfter != null && side.dynastyBefore != null ? side.dynastyAfter - side.dynastyBefore : null;
  return (
    <div className="rounded-lg bg-secondary/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{side.teamName}</p>
        <TeamBadge badge={side.badge} />
      </div>
      <p className="text-xs text-muted-foreground">
        Sends {side.sendValue.toLocaleString()} · Receives {side.receiveValue.toLocaleString()} ·{" "}
        <span className={side.valueDelta >= 0 ? "text-emerald-600" : "text-destructive"}>
          {signed(side.valueDelta, 0)}
        </span>
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Playoff chance</dt>
        <dd className="tabular-nums">
          {pct(side.playoffBefore)} → {pct(side.playoffAfter)}{" "}
          <span className={playoffDelta >= 0 ? "text-emerald-600" : "text-destructive"}>({signed(playoffDelta)})</span>
        </dd>
        <dt className="text-muted-foreground">Title chance</dt>
        <dd className="tabular-nums">
          {pct(side.titleBefore)} → {pct(side.titleAfter)}{" "}
          <span className={titleDelta >= 0 ? "text-emerald-600" : "text-destructive"}>({signed(titleDelta)})</span>
        </dd>
        <dt className="text-muted-foreground">Weekly points</dt>
        <dd className="tabular-nums">
          {side.pointsBefore.toFixed(1)} → {side.pointsAfter.toFixed(1)}
        </dd>
        {isDynasty && dynDelta != null && (
          <>
            <dt className="text-muted-foreground">Dynasty future value</dt>
            <dd className="tabular-nums">
              {Math.round(side.dynastyBefore!).toLocaleString()} → {Math.round(side.dynastyAfter!).toLocaleString()}{" "}
              <span className={dynDelta >= 0 ? "text-emerald-600" : "text-destructive"}>
                ({signed(dynDelta, 0)})
              </span>
              {side.dynastyRankBefore && side.dynastyRankAfter && (
                <span className="text-muted-foreground">
                  {" "}
                  · rank #{side.dynastyRankBefore} → #{side.dynastyRankAfter}
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function TradeBuilder({ leagueId }: { leagueId: string }) {
  const loadBoard = useServerFn(getProposalBoard);
  const evaluate = useServerFn(evaluateProposalFn);

  const board = useQuery({
    queryKey: ["proposal-board", leagueId],
    queryFn: () => loadBoard({ data: { leagueId } }),
  });

  const [teamAId, setTeamAId] = useState<string>("");
  const [teamBId, setTeamBId] = useState<string>("");
  const [aGives, setAGives] = useState<ProposalAsset[]>([]);
  const [bGives, setBGives] = useState<ProposalAsset[]>([]);
  const [result, setResult] = useState<ProposalResult | null>(null);

  useEffect(() => {
    const teams = board.data?.teams ?? [];
    if (!teams.length) return;
    const mine = teams.find((t) => t.isMine) ?? teams[0]!;
    const other = teams.find((t) => t.id !== mine.id);
    setTeamAId((cur) => (teams.some((t) => t.id === cur) ? cur : mine.id));
    setTeamBId((cur) => (teams.some((t) => t.id === cur) && cur !== mine.id ? cur : (other?.id ?? "")));
    setAGives([]);
    setBGives([]);
    setResult(null);
  }, [board.data]);

  const run = useMutation({
    mutationFn: () => evaluate({ data: { leagueId, teamAId, teamBId, aGives, bGives } }),
    onSuccess: (r) => setResult(r),
  });

  const teams = board.data?.teams ?? [];
  const teamA = teams.find((t) => t.id === teamAId);
  const teamB = teams.find((t) => t.id === teamBId);

  const toggle = (side: "a" | "b") => (asset: ProposalAsset) => {
    const set = side === "a" ? setAGives : setBGives;
    set((cur) =>
      cur.some((x) => assetId(x) === assetId(asset))
        ? cur.filter((x) => assetId(x) !== assetId(asset))
        : [...cur, asset],
    );
    setResult(null);
  };

  if (board.isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading rosters and values…
      </div>
    );
  }
  if (board.error) {
    return <p className="p-6 text-sm text-destructive">{(board.error as Error).message}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {(["a", "b"] as const).map((side) => {
          const value = side === "a" ? teamAId : teamBId;
          const setValue = side === "a" ? setTeamAId : setTeamBId;
          const selected = side === "a" ? aGives : bGives;
          const team = side === "a" ? teamA : teamB;
          return (
            <Card key={side}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{side === "a" ? "Team A sends" : "Team B sends"}</CardTitle>
                <Select
                  value={value}
                  onValueChange={(v) => {
                    setValue(v);
                    (side === "a" ? setAGives : setBGives)([]);
                    setResult(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.isMine ? " (you)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <SidePicker team={team} selected={selected} onToggle={toggle(side)} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => run.mutate()}
          disabled={run.isPending || !teamAId || !teamBId || teamAId === teamBId || (!aGives.length && !bGives.length)}
        >
          {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowLeftRight className="mr-2 h-4 w-4" />}
          Evaluate trade
        </Button>
        {run.error && <span className="text-sm text-destructive">{(run.error as Error).message}</span>}
        {board.data && (
          <span className="text-xs text-muted-foreground">
            Values: {board.data.valueFormat === "sf" ? "Superflex" : "One-QB"} market
          </span>
        )}
      </div>

      {result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Verdict
              <Badge variant="outline">{result.fairnessText}</Badge>
              <Badge variant="secondary">{result.acceptanceBand} to be accepted</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Chance they accept</span>
                <span className="tabular-nums">{pct(result.acceptance)}</span>
              </div>
              <Progress value={result.acceptance * 100} />
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {result.acceptanceReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <Separator />
            <div className="grid gap-3 md:grid-cols-2">
              <SideResult side={result.a} isDynasty={result.isDynasty} />
              <SideResult side={result.b} isDynasty={result.isDynasty} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
