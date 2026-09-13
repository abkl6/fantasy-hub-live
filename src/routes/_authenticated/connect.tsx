import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ImageUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  createManualLeague,
  findSleeperLeagues,
  importSleeperLeague,
  readScreenshot,
  saveRoster,
} from "@/lib/fantasy.functions";

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

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

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
      <p className="eyebrow text-primary">Add a league</p>
      <h1 className="mt-2 text-4xl font-bold uppercase">Bring your teams in</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Sleeper connects from your username, ESPN from your league ID, and Yahoo by signing in with
        your Yahoo account. NFL.com and FFPC have no public way to read a league, so add those from a
        screenshot of your roster — the scoring settings can come from a screenshot too.
      </p>

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

function SleeperPanel() {
  const navigate = useNavigate();
  const find = useServerFn(findSleeperLeagues);
  const doImport = useServerFn(importSleeperLeague);
  const [username, setUsername] = useState("");

  const search = useMutation({
    mutationFn: (name: string) => find({ data: { username: name } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reach Sleeper."),
  });

  const importer = useMutation({
    mutationFn: (vars: { sleeperLeagueId: string; sleeperUserId: string; season: string }) =>
      doImport({ data: vars }),
    onSuccess: (res) => {
      toast.success(`${res.name} imported.`);
      navigate({ to: "/league/$leagueId", params: { leagueId: res.leagueId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Import failed."),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-2xl font-bold uppercase">Connect Sleeper</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your Sleeper username and pick the league to track. Scores refresh every time you open
        it.
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

      {search.data && (
        <div className="mt-6 space-y-3">
          {!search.data.leagues.length && (
            <p className="text-sm text-muted-foreground">No leagues found on that account.</p>
          )}
          {search.data.leagues.map((l) => (
            <div
              key={l.league_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/50 p-4"
            >
              <div>
                <p className="font-semibold">{l.name}</p>
                <p className="text-xs text-muted-foreground">
                  {l.total_rosters} teams · {search.data!.season} season
                </p>
              </div>
              <Button
                size="sm"
                disabled={importer.isPending}
                onClick={() =>
                  importer.mutate({
                    sleeperLeagueId: l.league_id,
                    sleeperUserId: search.data!.userId,
                    season: search.data!.season,
                  })
                }
              >
                {importer.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Import
              </Button>
            </div>
          ))}
        </div>
      )}
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
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-2xl font-bold uppercase">Your roster</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a screenshot of your roster and we will fill this in. Anything we were unsure about
          is flagged — fix it and save.
        </p>

        <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-background/50 p-4 text-sm hover:border-primary/60">
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
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg border border-border bg-background/40 p-2"
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
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-2xl font-bold uppercase">League settings</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Got unusual scoring? Upload a screenshot of your league's scoring page and we will read the
        rules for you.
      </p>

      <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-background/50 p-4 text-sm hover:border-primary/60">
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
