import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Check, ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FORMAT_LABELS, LEAGUE_FORMATS } from "@/lib/fantasy/format";
import {
  createManualLeague,
  findSleeperLeagues,
  importSleeperLeague,
  readScreenshot,
  saveRoster,
} from "@/lib/fantasy.functions";
import {
  importAllYahooLeagues,
  importEspnLeague,
  importYahooLeague,
  listYahooLeagues,
  previewEspnLeague,
  startYahooSignIn,
  yahooStatus,
} from "@/lib/platforms.functions";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({
    meta: [
      { title: "Add a league — Gridiron Edge" },
      {
        name: "description",
        content:
          "Connect a Sleeper league instantly, or add a Yahoo, ESPN, NFL.com or FFPC team from a screenshot of your roster and scoring settings.",
      },
      { property: "og:title", content: "Add a league — Gridiron Edge" },
      { property: "og:description", content: "Connect Sleeper, or import any league from a screenshot." },
    ],
  }),
  component: ConnectPage,
});

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

interface DraftPlayer {
  name: string;
  position: string;
  nflTeam: string | null;
  isStarter: boolean;
  confidence: number;
}

function readFiles(files: FileList): Promise<string[]> {
  return Promise.all(
    Array.from(files)
      .slice(0, 4)
      .map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("Could not read that image."));
            reader.readAsDataURL(file);
          }),
      ),
  );
}

function ConnectPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">Add a league</h1>

      <Tabs defaultValue="sleeper" className="mt-8">
        <TabsList>
          <TabsTrigger value="sleeper">Sleeper</TabsTrigger>
          <TabsTrigger value="espn">ESPN</TabsTrigger>
          <TabsTrigger value="yahoo">Yahoo</TabsTrigger>
          <TabsTrigger value="manual">Screenshot or manual</TabsTrigger>
        </TabsList>
        <TabsContent value="sleeper" className="mt-6">
          <SleeperPanel />
        </TabsContent>
        <TabsContent value="espn" className="mt-6">
          <EspnPanel />
        </TabsContent>
        <TabsContent value="yahoo" className="mt-6">
          <YahooPanel />
        </TabsContent>
        <TabsContent value="manual" className="mt-6">
          <ManualPanel />
        </TabsContent>
      </Tabs>
    </main>
  );
}

type ImportState = "waiting" | "importing" | "done" | "failed";

interface ImportStep {
  leagueId: string;
  name: string;
  state: ImportState;
  error?: string;
}

function SleeperPanel() {
  const navigate = useNavigate();
  const find = useServerFn(findSleeperLeagues);
  const doImport = useServerFn(importSleeperLeague);

  const [username, setUsername] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [steps, setSteps] = useState<ImportStep[] | null>(null);
  const [byIdOpen, setByIdOpen] = useState(false);
  const [byId, setById] = useState("");

  const search = useMutation({
    mutationFn: (name: string) => find({ data: { username: name } }),
    onSuccess: (res) => {
      // Everything the account owns starts checked.
      setSelected(Object.fromEntries(res.leagues.map((l) => [l.league_id, true])));
      setSteps(null);
      if (!res.leagues.length) toast.info("No leagues found on that account.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reach Sleeper."),
  });

  const importSelected = useMutation({
    mutationFn: async () => {
      const res = search.data;
      if (!res) return null;
      const queue = res.leagues.filter((l) => selected[l.league_id]);
      setSteps(
        queue.map((l) => ({ leagueId: l.league_id, name: l.name, state: "waiting" as ImportState })),
      );

      let firstImported: string | null = null;
      for (const league of queue) {
        setSteps((prev) =>
          (prev ?? []).map((s) => (s.leagueId === league.league_id ? { ...s, state: "importing" } : s)),
        );
        try {
          const out = await doImport({
            data: {
              sleeperLeagueId: league.league_id,
              sleeperUserId: res.userId,
              season: res.season,
            },
          });
          firstImported ??= out.leagueId;
          setSteps((prev) =>
            (prev ?? []).map((s) => (s.leagueId === league.league_id ? { ...s, state: "done" } : s)),
          );
        } catch (e) {
          setSteps((prev) =>
            (prev ?? []).map((s) =>
              s.leagueId === league.league_id
                ? { ...s, state: "failed", error: e instanceof Error ? e.message : "Import failed." }
                : s,
            ),
          );
        }
      }
      return firstImported;
    },
    onSuccess: (leagueId) => {
      if (leagueId) {
        toast.success("Leagues imported.");
        navigate({ to: "/league/$leagueId", params: { leagueId } });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });

  const importById = useMutation({
    mutationFn: (sleeperLeagueId: string) =>
      doImport({
        data: {
          sleeperLeagueId,
          ...(username.trim() ? { sleeperUsername: username.trim() } : {}),
        },
      }),
    onSuccess: (res) => {
      toast.success(`${res.name} imported.`);
      navigate({ to: "/league/$leagueId", params: { leagueId: res.leagueId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });

  const leagues = search.data?.leagues ?? [];
  const checkedCount = leagues.filter((l) => selected[l.league_id]).length;
  const busy = importSelected.isPending;

  return (
    <section className="rounded-xl bg-card p-6">
      <h2 className="text-2xl font-bold">Connect Sleeper</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your Sleeper username and we'll pull in every league on the account. Your own team is
        picked out automatically.
      </p>

      <form
        className="mt-5 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (username.trim()) search.mutate(username.trim());
        }}
      >
        <Input
          className="max-w-xs"
          placeholder="Sleeper username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-label="Sleeper username"
        />
        <Button type="submit" disabled={search.isPending}>
          {search.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Find my leagues
        </Button>
      </form>

      {!!leagues.length && !steps && (
        <div className="mt-6">
          <div className="divide-y divide-border overflow-hidden rounded-lg bg-background/50">
            {leagues.map((l) => (
              <label
                key={l.league_id}
                className="flex cursor-pointer items-center gap-3 p-4"
                htmlFor={`league-${l.league_id}`}
              >
                <Checkbox
                  id={`league-${l.league_id}`}
                  checked={!!selected[l.league_id]}
                  onCheckedChange={(v) =>
                    setSelected((prev) => ({ ...prev, [l.league_id]: v === true }))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {l.total_rosters} teams · {search.data!.season} season
                  </span>
                </span>
              </label>
            ))}
          </div>

          <Button
            className="mt-4"
            disabled={busy || !checkedCount}
            onClick={() => importSelected.mutate()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Import {checkedCount} {checkedCount === 1 ? "league" : "leagues"}
          </Button>
        </div>
      )}

      {steps && (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-lg bg-background/50">
          {steps.map((s) => (
            <li key={s.leagueId} className="flex items-center gap-3 p-3 text-sm">
              {s.state === "importing" && <Loader2 className="size-4 animate-spin text-primary" />}
              {s.state === "done" && <Check className="size-4 text-success" aria-hidden="true" />}
              {s.state === "failed" && <X className="size-4 text-destructive" aria-hidden="true" />}
              {s.state === "waiting" && <span className="size-4" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs text-muted-foreground">
                {s.state === "waiting"
                  ? "Waiting"
                  : s.state === "importing"
                    ? "Importing…"
                    : s.state === "done"
                      ? "Imported"
                      : (s.error ?? "Failed")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 border-t border-border pt-4">
        {!byIdOpen ? (
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => setByIdOpen(true)}
          >
            Add by ID
          </button>
        ) : (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (byId.trim()) importById.mutate(byId.trim());
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="sleeper-league-id">Sleeper league ID</Label>
              <Input
                id="sleeper-league-id"
                className="max-w-xs"
                placeholder="1049283746501234567"
                value={byId}
                onChange={(e) => setById(e.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" disabled={importById.isPending}>
              {importById.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Import
            </Button>
          </form>
        )}
        {byIdOpen && (
          <p className="mt-2 text-xs text-muted-foreground">
            Fill in your username above too and we'll still find your team in that league.
          </p>
        )}
      </div>
    </section>
  );
}

function ManualPanel() {
  const navigate = useNavigate();
  const create = useServerFn(createManualLeague);
  const store = useServerFn(saveRoster);
  const scan = useServerFn(readScreenshot);

  const [step, setStep] = useState<1 | 2>(1);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    platform: "yahoo",
    teamCount: 12,
    playoffTeams: 6,
    regularSeasonWeeks: 14,
    currentWeek: 1,
    scoringType: "ppr",
    format: "redraft" as (typeof LEAGUE_FORMATS)[number],
    myTeamName: "My team",
    slots: "QB, RB, RB, WR, WR, TE, FLEX, K, DEF",
  });
  const [scoringRules, setScoringRules] = useState<Record<string, number>>({});
  const [players, setPlayers] = useState<DraftPlayer[]>([]);

  const scanScoring = useMutation({
    mutationFn: (images: string[]) => scan({ data: { mode: "scoring" as const, images } }),
    onSuccess: (res) => {
      if (res.mode !== "scoring" || !res.scoring) return;
      setScoringRules(res.scoring.rules);
      setForm((f) => ({
        ...f,
        scoringType: res.scoring!.scoringType,
        slots: res.scoring!.rosterSlots?.length ? res.scoring!.rosterSlots.join(", ") : f.slots,
      }));
      toast.success("Scoring settings read from your screenshot. Check them before saving.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that screenshot."),
  });

  const scanRoster = useMutation({
    mutationFn: (images: string[]) => scan({ data: { mode: "roster" as const, images } }),
    onSuccess: (res) => {
      if (res.mode !== "roster" || !res.players) return;
      setPlayers((prev) => [
        ...prev,
        ...res.players!.map((p) => ({
          name: p.name,
          position: p.position,
          nflTeam: p.nflTeam,
          isStarter: p.isStarter,
          confidence: p.confidence,
        })),
      ]);
      toast.success(`${res.players.length} players read. Confirm anything flagged below.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that screenshot."),
  });

  const createLeague = useMutation({
    mutationFn: () =>
      create({
        data: {
          name: form.name.trim() || "My league",
          platform: form.platform,
          teamCount: Number(form.teamCount),
          playoffTeams: Number(form.playoffTeams),
          regularSeasonWeeks: Number(form.regularSeasonWeeks),
          currentWeek: Number(form.currentWeek),
          scoringType: form.scoringType,
          scoringRules,
          format: form.format,
          rosterSlots: form.slots
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
          myTeamName: form.myTeamName.trim() || "My team",
        },
      }),
    onSuccess: (res) => {
      setLeagueId(res.leagueId);
      setTeamId(res.myTeamId);
      setStep(2);
      toast.success("League created. Now add your roster.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create the league."),
  });

  const saveRosterMutation = useMutation({
    mutationFn: () =>
      store({
        data: {
          leagueId: leagueId!,
          teamId: teamId!,
          players: players.map((p) => ({
            name: p.name,
            position: p.position,
            nflTeam: p.nflTeam,
            isStarter: p.isStarter,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Roster saved.");
      navigate({ to: "/league/$leagueId", params: { leagueId: leagueId! } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the roster."),
  });

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>, mode: "roster" | "scoring") {
    const files = e.target.files;
    if (!files?.length) return;
    const images = await readFiles(files);
    e.target.value = "";
    if (mode === "roster") scanRoster.mutate(images);
    else scanScoring.mutate(images);
  }

  if (step === 2 && leagueId && teamId) {
    return (
      <section className="rounded-xl bg-card p-6">
        <h2 className="text-2xl font-bold">Your roster</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a screenshot of your roster and we will fill this in. Anything we were unsure about
          is flagged — fix it and save.
        </p>

        <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-lg border-dashed border-border bg-background/50 p-4 text-sm hover:border-primary/60">
          {scanRoster.isPending ? (
            <Loader2 className="size-5 animate-spin text-primary" />
          ) : (
            <ImageUp className="size-5 text-primary" aria-hidden="true" />
          )}
          <span>
            {scanRoster.isPending ? "Reading your screenshot…" : "Upload roster screenshots (up to 4)"}
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(e) => onUpload(e, "roster")}
          />
        </label>

        <div className="mt-6 space-y-2">
          {players.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg bg-secondary/30 border-border bg-background/40 p-2"
            >
              <Input
                value={p.name}
                aria-label="Player name"
                onChange={(e) =>
                  setPlayers((prev) => prev.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <Select
                value={p.position}
                onValueChange={(v) =>
                  setPlayers((prev) => prev.map((x, xi) => (xi === i ? { ...x, position: v } : x)))
                }
              >
                <SelectTrigger className="w-24" aria-label="Position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {p.confidence < 0.75 ? (
                <Badge variant="outline" className="border-warning text-warning">
                  Check
                </Badge>
              ) : (
                <span />
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${p.name}`}
                onClick={() => setPlayers((prev) => prev.filter((_, xi) => xi !== i))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() =>
              setPlayers((prev) => [
                ...prev,
                { name: "", position: "RB", nflTeam: null, isStarter: false, confidence: 1 },
              ])
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a player
          </Button>
          <Button
            disabled={saveRosterMutation.isPending || !players.length}
            onClick={() => saveRosterMutation.mutate()}
          >
            {saveRosterMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save roster and analyze
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-card p-6">
      <h2 className="text-2xl font-bold">League settings</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Got unusual scoring? Upload a screenshot of your league's scoring page and we will read the
        rules for you.
      </p>

      <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-lg border-dashed border-border bg-background/50 p-4 text-sm hover:border-primary/60">
        {scanScoring.isPending ? (
          <Loader2 className="size-5 animate-spin text-primary" />
        ) : (
          <ImageUp className="size-5 text-primary" aria-hidden="true" />
        )}
        <span>
          {scanScoring.isPending ? "Reading your screenshot…" : "Upload scoring settings screenshot"}
        </span>
        <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onUpload(e, "scoring")} />
      </label>

      {Object.keys(scoringRules).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(scoringRules).map(([k, v]) => (
            <Badge key={k} variant="secondary">
              {k.replace(/_/g, " ")}: {v}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="league-name">League name</Label>
          <Input
            id="league-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Sunday Money League"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="platform">Platform</Label>
          <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
            <SelectTrigger id="platform">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yahoo">Yahoo</SelectItem>
              <SelectItem value="espn">ESPN</SelectItem>
              <SelectItem value="nfl">NFL.com</SelectItem>
              <SelectItem value="ffpc">FFPC</SelectItem>
              <SelectItem value="manual">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="team-name">Your team name</Label>
          <Input
            id="team-name"
            value={form.myTeamName}
            onChange={(e) => setForm({ ...form, myTeamName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scoring">Scoring</Label>
          <Select value={form.scoringType} onValueChange={(v) => setForm({ ...form, scoringType: v })}>
            <SelectTrigger id="scoring">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ppr">Full PPR</SelectItem>
              <SelectItem value="half_ppr">Half PPR</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="league-format">League type</Label>
          <Select
            value={form.format}
            onValueChange={(v) => setForm({ ...form, format: v as (typeof LEAGUE_FORMATS)[number] })}
          >
            <SelectTrigger id="league-format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAGUE_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(
          [
            ["teamCount", "Teams"],
            ["playoffTeams", "Playoff spots"],
            ["regularSeasonWeeks", "Regular season weeks"],
            ["currentWeek", "Current week"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              type="number"
              min={1}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
            />
          </div>
        ))}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="slots">Starting lineup slots</Label>
          <Input id="slots" value={form.slots} onChange={(e) => setForm({ ...form, slots: e.target.value })} />
          <p className="text-xs text-muted-foreground">
            Comma separated. Use FLEX for RB/WR/TE and SUPER_FLEX if quarterbacks are allowed.
          </p>
        </div>
      </div>

      <Button className="mt-6" disabled={createLeague.isPending} onClick={() => createLeague.mutate()}>
        {createLeague.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Create league and add roster
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------- ESPN

function EspnPanel() {
  const navigate = useNavigate();
  const preview = useServerFn(previewEspnLeague);
  const doImport = useServerFn(importEspnLeague);

  const [leagueId, setLeagueId] = useState("");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [swid, setSwid] = useState("");
  const [espnS2, setEspnS2] = useState("");
  const [showPrivate, setShowPrivate] = useState(false);

  const creds = () => ({
    ...(swid.trim() ? { swid: swid.trim() } : {}),
    ...(espnS2.trim() ? { espnS2: espnS2.trim() } : {}),
  });

  const look = useMutation({
    mutationFn: () => preview({ data: { leagueId: leagueId.trim(), season, ...creds() } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reach ESPN."),
  });

  const importer = useMutation({
    mutationFn: (myTeamExternalId: string) =>
      doImport({ data: { leagueId: leagueId.trim(), season, myTeamExternalId, ...creds() } }),
    onSuccess: (res) => {
      toast.success(`${res.name} imported.`);
      navigate({ to: "/league/$leagueId", params: { leagueId: res.leagueId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });

  return (
    <section className="rounded-xl bg-card p-6">
      <h2 className="text-2xl font-bold">Connect ESPN</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your league ID is the number in the ESPN league URL after <code>leagueId=</code>. Public
        leagues need nothing else.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="espn-league">League ID</Label>
          <Input
            id="espn-league"
            inputMode="numeric"
            placeholder="1234567"
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="espn-season">Season</Label>
          <Input
            id="espn-season"
            type="number"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
          />
        </div>
      </div>

      <button
        type="button"
        className="mt-4 text-xs tracking-wider text-primary underline-offset-4 hover:underline"
        onClick={() => setShowPrivate((v) => !v)}
      >
        {showPrivate ? "Hide private league settings" : "My league is private"}
      </button>

      {showPrivate && (
        <div className="mt-4 space-y-4 rounded-lg bg-background/50 p-4">
          <p className="text-xs text-muted-foreground">
            Open your ESPN league in a browser while signed in, open the browser's developer tools,
            go to Application → Cookies → fantasy.espn.com, and copy the two values below. They are
            stored privately on your account and never shown again.
          </p>
          <div className="space-y-2">
            <Label htmlFor="espn-swid">SWID</Label>
            <Input
              id="espn-swid"
              placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
              value={swid}
              onChange={(e) => setSwid(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="espn-s2">espn_s2</Label>
            <Input
              id="espn-s2"
              placeholder="AEB..."
              value={espnS2}
              onChange={(e) => setEspnS2(e.target.value)}
            />
          </div>
        </div>
      )}

      <Button
        className="mt-5"
        disabled={look.isPending || leagueId.trim().length < 2}
        onClick={() => look.mutate()}
      >
        {look.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
        Find my league
      </Button>

      {look.data && (
        <div className="mt-6">
          <p className="eyebrow text-primary">{look.data.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Week {look.data.currentWeek} · pick which team is yours.
          </p>
          <div className="mt-4 space-y-3">
            {look.data.teams.map((t) => (
              <div
                key={t.externalId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background/50 p-4"
              >
                <div>
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.ownerName ? `${t.ownerName} · ` : ""}
                    {t.record}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={importer.isPending}
                  onClick={() => importer.mutate(t.externalId)}
                >
                  {importer.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  This is my team
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Yahoo

function YahooPanel() {
  const navigate = useNavigate();
  const status = useServerFn(yahooStatus);
  const start = useServerFn(startYahooSignIn);
  const leagues = useServerFn(listYahooLeagues);
  const doImport = useServerFn(importYahooLeague);
  const doImportAll = useServerFn(importAllYahooLeagues);

  const state = useQuery({ queryKey: ["yahoo-status"], queryFn: () => status({}) });

  const popupRef = useRef<Window | null>(null);

  const signIn = useMutation({
    mutationFn: () => start({ data: { origin: window.location.origin } }),
    onSuccess: (res) => {
      // Inside the preview the app runs in an iframe and Yahoo refuses to be framed,
      // so send the sign-in to a separate tab that was opened on the click itself.
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.location.href = res.url;
        toast.info("Finish signing in on the Yahoo tab, then come back here.");
        return;
      }
      const opened = window.open(res.url, "_blank", "noopener,noreferrer");
      if (opened) {
        toast.info("Finish signing in on the Yahoo tab, then come back here.");
        return;
      }
      try {
        (window.top ?? window).location.href = res.url;
      } catch {
        window.location.href = res.url;
      }
    },
    onError: (e) => {
      popupRef.current?.close();
      popupRef.current = null;
      toast.error(e instanceof Error ? e.message : "Could not start Yahoo sign-in.");
    },
  });

  const beginSignIn = () => {
    // Opened synchronously so browsers don't treat it as a blocked pop-up.
    popupRef.current = window.open("about:blank", "_blank");
    signIn.mutate();
  };

  const find = useMutation({
    mutationFn: () => leagues({}),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read your Yahoo leagues."),
  });

  const importer = useMutation({
    mutationFn: (leagueKey: string) => doImport({ data: { leagueKey } }),
    onSuccess: (res) => {
      toast.success(`${res.name} imported.`);
      navigate({ to: "/league/$leagueId", params: { leagueId: res.leagueId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });

  const importAll = useMutation({
    mutationFn: () => doImportAll({ data: {} }),
    onSuccess: (res) => {
      const ok = res.results.filter((r) => r.leagueId);
      const failed = res.results.length - ok.length;
      if (!ok.length) {
        toast.error("No Yahoo leagues could be imported.");
        return;
      }
      toast.success(
        `${ok.length} Yahoo league${ok.length === 1 ? "" : "s"} imported${failed ? `, ${failed} failed` : ""}.`,
      );
      const first = ok[0]!.leagueId!;
      navigate({ to: "/league/$leagueId", params: { leagueId: first } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("yahoo");
    if (!result) return;
    if (result === "connected") toast.success("Yahoo account connected.");
    else if (result === "expired") toast.error("That Yahoo sign-in timed out. Try again.");
    else if (result === "failed") toast.error("Yahoo turned down the sign-in. Check the app settings.");
    window.history.replaceState({}, "", window.location.pathname);
    void state.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sign-in finishes in a separate tab, so pick the result up on return.
  useEffect(() => {
    const onFocus = () => void state.refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <section className="rounded-xl bg-card p-6">
      <h2 className="text-2xl font-bold">Yahoo</h2>

      <div className="mt-3 rounded-lg bg-secondary/30 border-primary/50 bg-primary/10 p-4 text-sm">
        <p className="font-semibold text-foreground">Add your Yahoo league from a screenshot</p>
        <p className="mt-1 text-muted-foreground">
          Yahoo has paused new Fantasy Sports access for apps like this one, so for now the reliable
          way in is the <span className="font-semibold text-foreground">Screenshot or manual</span>{" "}
          tab — pick Yahoo as the platform and upload your roster (and scoring page, if it's
          unusual). Everything else works the same: live scores, waivers, trades and projections.
        </p>
      </div>

      <details className="mt-4 rounded-lg bg-background/50 p-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">
          Direct Yahoo sign-in (waiting on Yahoo approval)
        </summary>
        <p className="mt-3">
          We've applied to Yahoo for Fantasy Sports access. Until they approve it, sign-in can
          prove who you are but can't read your leagues — use the screenshot route above meanwhile.
        </p>

      {state.data?.configured === false && (
        <p className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-foreground">
          {state.data.notice ?? "Yahoo isn't configured yet."}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          disabled={signIn.isPending || state.isLoading || state.data?.configured === false}
          onClick={beginSignIn}
        >
          {signIn.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {state.data?.connected ? "Reconnect Yahoo" : "Sign in with Yahoo"}
        </Button>
        {state.data?.connected && (
          <>
            <Button variant="outline" disabled={find.isPending} onClick={() => find.mutate()}>
              {find.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Show my Yahoo leagues
            </Button>
            <Button
              variant="outline"
              disabled={importAll.isPending}
              onClick={() => importAll.mutate()}
            >
              {importAll.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Import all my leagues
            </Button>
          </>
        )}
      </div>

      {find.data && (
        <div className="mt-6 space-y-3">
          {!find.data.length && (
            <p className="text-sm text-muted-foreground">No football leagues on that Yahoo account.</p>
          )}
          {find.data.map((l) => (
            <div
              key={l.leagueKey}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background/50 p-4"
            >
              <div>
                <p className="font-semibold">{l.name}</p>
                <p className="text-xs text-muted-foreground">
                  {l.teamCount} teams · {l.season} season
                </p>
              </div>
              <Button size="sm" disabled={importer.isPending} onClick={() => importer.mutate(l.leagueKey)}>
                {importer.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Import
              </Button>
            </div>
          ))}
        </div>
      )}
      </details>
    </section>
  );
}
