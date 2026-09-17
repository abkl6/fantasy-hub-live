/**
 * Projections page: everyone can tune a player's numbers for themselves, and
 * the admin maintains the shared baseline (inline or with a spreadsheet).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ProjectionAdjuster } from "@/components/ProjectionAdjuster";
import { TrajectoryChip } from "@/components/TrajectoryChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  bulkUpsertBaseline,
  uploadMyProjections,
  uploadOpponentGrid,
  projectionTemplate,
  clearMyProjections,
  setProjectionSourceEverywhere,
  importPlatformProjections,
  clearAllOverrides,
  listProjections,
  updateBaseline,
  type BaselineRow,
} from "@/lib/projections.functions";
import { listTradeValues, refreshTradeValuesNow } from "@/lib/trade-values.functions";

export const Route = createFileRoute("/_authenticated/projections")({
  head: () => ({
    meta: [
      { title: "Stats Hub — Gridiron Edge" },
      {
        name: "description",
        content:
          "Set the shared baseline projections for every player and tune any player up or down for your own leagues.",
      },
      { property: "og:title", content: "Stats Hub — Gridiron Edge" },
      {
        property: "og:description",
        content: "Shared baseline projections plus your own per-player adjustments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectionsPage,
});

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
const round1 = (n: number) => Math.round(n * 10) / 10;

function ProjectionsPage() {
  const list = useServerFn(listProjections);
  const resetAll = useServerFn(clearAllOverrides);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [adjustedOnly, setAdjustedOnly] = useState(false);
  const [open, setOpen] = useState<BaselineRow | null>(null);
  const [source, setSource] = useState<"auto" | "app" | "user">("auto");

  const players = useQuery({
    queryKey: ["projections", search, position, adjustedOnly, source],
    queryFn: () =>
      list({
        data: {
          search,
          position,
          adjustedOnly,
          limit: 150,
          ...(source === "auto" ? {} : { source }),
        },
      }),
  });

  const clearAll = useMutation({
    mutationFn: () => resetAll({}),
    onSuccess: () => {
      toast.success("All of your adjustments are back to standard.");
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reset those."),
  });

  const admin = players.data?.admin ?? false;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-wide">Stats Hub</h1>
      </header>

      <Tabs defaultValue="projections">
        <TabsList>
          <TabsTrigger value="projections">Projections</TabsTrigger>
          <TabsTrigger value="values">Trade values</TabsTrigger>
        </TabsList>
        <TabsContent value="values" className="pt-6">
          <TradeValuesPanel />
        </TabsContent>
        <TabsContent value="projections" className="space-y-6 pt-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="proj-search">Find a player</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="proj-search"
              className="pl-9"
              placeholder="Search by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={position === p ? "default" : "outline"}
              onClick={() => setPosition(p)}
            >
              {p}
            </Button>
          ))}
        </div>
        <Button size="sm" variant={adjustedOnly ? "default" : "outline"} onClick={() => setAdjustedOnly((v) => !v)}>
          My adjustments {players.data ? `(${players.data.adjusted})` : ""}
        </Button>
        {(players.data?.adjusted ?? 0) > 0 && (
          <Button size="sm" variant="ghost" onClick={() => clearAll.mutate()} disabled={clearAll.isPending}>
            Reset all
          </Button>
        )}
        <div>
          <Label htmlFor="proj-source">Numbers shown</Label>
          <select
            id="proj-source"
            className="mt-1 h-9 rounded-md bg-secondary px-3 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value as "auto" | "app" | "user")}
          >
            <option value="auto">
              My projections when uploaded
            </option>
            <option value="user">My projections</option>
            <option value="app">App baseline</option>
          </select>
        </div>
        <MyProjectionsUpload />
        <UseMyProjectionsEverywhere />
        {admin && <CsvUpload />}
        {admin && <PlatformImport />}
      </div>

      {players.data && (
        <p className="text-xs text-muted-foreground">
          {players.data.uploadedCount > 0
            ? players.data.source === "user"
              ? `Showing your uploaded projections for ${players.data.uploadedCount} players; anyone you didn't include falls back to the app baseline.`
              : `Showing the app baseline. You have uploaded projections for ${players.data.uploadedCount} players.`
            : "No uploaded projections on file yet — use “My projections” to add a file, and remember to press Save after checking it."}
        </p>
      )}


      {players.isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading players…
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-secondary/30 border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3">Player</th>
                <th className="px-4 py-3">Pos</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3 text-right">Per week</th>
                <th className="px-4 py-3 text-right">Season</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(players.data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    {row.name}
                    {row.myWeek !== null && (
                      <Badge className="ml-2" variant="secondary">
                        yours
                      </Badge>
                    )}
                    {row.basis === "user" && (
                      <Badge className="ml-2" variant="outline">
                        my file
                      </Badge>
                    )}
                    <TrajectoryChip className="ml-2" trajectory={row.trajectory} playerName={row.name} />
                  </td>
                  <td className="px-4 py-2">{row.position}</td>
                  <td className="px-4 py-2 text-muted-foreground">{row.nflTeam ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {round1(row.myWeek ?? row.baseWeek)}
                    {row.myWeek !== null && (
                      <span className="ml-2 text-xs text-muted-foreground line-through">{round1(row.baseWeek)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {round1(row.mySeason ?? row.baseSeason)}
                    {row.mySeason !== null && (
                      <span className="ml-2 text-xs text-muted-foreground line-through">{round1(row.baseSeason)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Dialog
                      open={open?.id === row.id}
                      onOpenChange={(isOpen) => setOpen(isOpen ? row : null)}
                    >
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          Adjust
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{row.name}</DialogTitle>
                          <DialogDescription>
                            {row.position}
                            {row.nflTeam ? ` · ${row.nflTeam}` : ""} — this change applies to all of your
                            leagues.
                          </DialogDescription>
                        </DialogHeader>
                        <Tabs defaultValue="mine">
                          <TabsList>
                            <TabsTrigger value="mine">My number</TabsTrigger>
                            {admin && <TabsTrigger value="base">Shared baseline</TabsTrigger>}
                          </TabsList>
                          <TabsContent value="mine" className="pt-4">
                            <ProjectionAdjuster player={row} onDone={() => setOpen(null)} />
                          </TabsContent>
                          {admin && (
                            <TabsContent value="base" className="pt-4">
                              <BaselineEditor row={row} onDone={() => setOpen(null)} />
                            </TabsContent>
                          )}
                        </Tabs>
                      </DialogContent>
                    </Dialog>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!players.data?.rows.length && (
            <p className="px-4 py-6 text-muted-foreground">No players match that search.</p>
          )}
        </div>
      )}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function BaselineEditor({ row, onDone }: { row: BaselineRow; onDone: () => void }) {
  const save = useServerFn(updateBaseline);
  const queryClient = useQueryClient();
  const [week, setWeek] = useState(round1(row.baseWeek));
  const [season, setSeason] = useState(round1(row.baseSeason));

  const saving = useMutation({
    mutationFn: () => save({ data: { playerId: row.id, week, season } }),
    onSuccess: () => {
      toast.success(`Baseline updated for ${row.name}.`);
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that."),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        This is the number everyone in the app starts from.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="base-week">Points per week</Label>
          <Input id="base-week" type="number" step="0.1" min="0" value={week} onChange={(e) => setWeek(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="base-season">Points this season</Label>
          <Input id="base-season" type="number" step="1" min="0" value={season} onChange={(e) => setSeason(Number(e.target.value))} />
        </div>
      </div>
      <Button onClick={() => saving.mutate()} disabled={saving.isPending}>
        Save baseline
      </Button>
    </div>
  );
}

/** A member's own weekly stat projections, used by leagues set to "My projections". */
type UploadGroup = "offense" | "dst" | "idp" | "k";

interface PendingFile {
  name: string;
  csv: string;
  kind: "stats" | "opponents" | "unknown";
  group: UploadGroup | null;
}

interface FileOutcome {
  name: string;
  ok: boolean;
  summary: string;
  detail?: string;
  canSave: boolean;
}

/** Reads every CSV out of a picked file — a .zip unpacks into one entry per CSV inside. */
async function readPickedFiles(fileList: FileList): Promise<PendingFile[]> {
  const { detectGroup, detectOpponentGrid } = await import("@/lib/fantasy/projection-templates");
  const classify = (name: string, csv: string): PendingFile => {
    const header = (csv.split(/\r?\n/)[0] ?? "").split(",");
    if (detectOpponentGrid(header)) return { name, csv, kind: "opponents", group: null };
    const group = detectGroup(header);
    return { name, csv, kind: group ? "stats" : "unknown", group };
  };
  const out: PendingFile[] = [];
  for (const file of Array.from(fileList)) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || !entry.name.toLowerCase().endsWith(".csv")) continue;
        out.push(classify(entry.name.split("/").pop() ?? entry.name, await entry.async("string")));
      }
    } else {
      out.push(classify(file.name, await file.text()));
    }
  }
  return out;
}

const GROUP_CHOICES: { value: UploadGroup; label: string }[] = [
  { value: "offense", label: "Offence (QB, RB, WR, TE)" },
  { value: "dst", label: "Team defence" },
  { value: "idp", label: "Individual defenders" },
  { value: "k", label: "Kickers" },
];

function MyProjectionsUpload() {
  const upload = useServerFn(uploadMyProjections);
  const uploadGrid = useServerFn(uploadOpponentGrid);
  const clear = useServerFn(clearMyProjections);
  const template = useServerFn(projectionTemplate);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [group, setGroup] = useState<UploadGroup>("offense");

  const runAll = async (apply: boolean, targets: PendingFile[]): Promise<FileOutcome[]> => {
    const outcomes: FileOutcome[] = [];
    for (const f of targets) {
      try {
        if (f.kind === "opponents") {
          const r = await uploadGrid({ data: { csv: f.csv, apply } });
          outcomes.push({
            name: f.name,
            ok: true,
            canSave: !apply,
            summary: apply
              ? `Season schedule replaced: ${r.teams} teams, ${r.weeks.length} weeks (${r.byes} byes).`
              : `Schedule grid: ${r.teams} teams, weeks ${r.weeks[0]}–${r.weeks[r.weeks.length - 1]}, ${r.byes} byes.`,
          });
        } else if (f.kind === "stats") {
          const r = await upload({ data: { csv: f.csv, apply } });
          const preview = r.preview
            .slice(0, 3)
            .map((p) => `${p.name} ${p.points.toFixed(1)}`)
            .join(" · ");
          outcomes.push({
            name: f.name,
            ok: true,
            canSave: !apply && r.matchedCount > 0,
            summary: apply
              ? `Saved ${r.rowsWritten} ${r.mode === "weekly" ? "weekly lines" : "season totals"} for ${r.matchedCount} ${r.groupLabel.toLowerCase()} players.`
              : `${r.groupLabel}: ${r.matchedCount} players matched (${r.mode === "weekly" ? "week by week" : "season totals"})${r.unmatchedCount ? `, ${r.unmatchedCount} names not recognised` : ""}.`,
            detail:
              `${r.unrecognised.length ? `Ignored columns: ${r.unrecognised.join(", ")}. ` : ""}` +
              `${r.unmatched.length ? `Not recognised: ${r.unmatched.slice(0, 12).join(", ")}${r.unmatched.length > 12 ? "…" : ""}. ` : ""}` +
              `${preview ? `Sanity check: ${preview}` : ""}`,
          });
        } else {
          outcomes.push({
            name: f.name,
            ok: false,
            canSave: false,
            summary: "Columns not recognised — this file was skipped.",
          });
        }
      } catch (e) {
        outcomes.push({
          name: f.name,
          ok: false,
          canSave: false,
          summary: e instanceof Error ? e.message : "Could not read that file.",
        });
      }
    }
    return outcomes;
  };

  const run = useMutation({
    mutationFn: (apply: boolean) => runAll(apply, files),
    onSuccess: (outcomes, apply) => {
      if (apply) {
        const saved = outcomes.filter((o) => o.ok).length;
        toast.success(`Saved ${saved} of ${outcomes.length} files.`);
        void queryClient.invalidateQueries();
        if (saved === outcomes.length) {
          setOpen(false);
          setFiles([]);
        }
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that file."),
  });

  const download = useMutation({
    mutationFn: () => template({ data: { group } }),
    onSuccess: (file) => {
      const url = URL.createObjectURL(new Blob([file.csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${file.label} template with ${file.players} players downloaded.`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not build that template."),
  });

  const wipe = useMutation({
    mutationFn: () => clear({}),
    onSuccess: () => toast.success("Your uploaded projections were removed."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove those."),
  });

  const outcomes = run.data;
  const checkable = files.filter((f) => f.kind !== "unknown");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="size-4" aria-hidden="true" />
          My projections
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload my own projections</DialogTitle>
          <DialogDescription>
            Pick CSV files — or one zip holding several — and each is recognised automatically:
            offence, team defence, individual defenders, kickers, or a season schedule grid.
            Week-by-week files and season totals both work. Only leagues set to &quot;My
            projections&quot; use these.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="proj-group">Blank template</Label>
              <select
                id="proj-group"
                className="mt-1 h-9 w-full rounded-md bg-secondary px-3 text-sm"
                value={group}
                onChange={(e) => setGroup(e.target.value as UploadGroup)}
              >
                {GROUP_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="self-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => download.mutate()}
                disabled={download.isPending}
              >
                Download the {GROUP_CHOICES.find((c) => c.value === group)?.label.toLowerCase()} template
              </Button>
            </div>
          </div>

          <Input
            type="file"
            multiple
            accept=".csv,.zip,text/csv,application/zip"
            onChange={async (e) => {
              const list = e.target.files;
              if (!list?.length) return;
              try {
                setFiles(await readPickedFiles(list));
                run.reset();
              } catch {
                toast.error("Could not open that file — is it a CSV or a zip of CSVs?");
              }
            }}
          />
          {files.length > 0 && (
            <ul className="space-y-1 text-sm">
              {files.map((f) => (
                <li key={f.name} className="flex items-center justify-between gap-2">
                  <span className="truncate">{f.name}</span>
                  <Badge variant={f.kind === "unknown" ? "destructive" : "secondary"}>
                    {f.kind === "opponents"
                      ? "schedule grid"
                      : f.kind === "stats"
                        ? (GROUP_CHOICES.find((c) => c.value === f.group)?.label ?? "stats")
                        : "not recognised"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {checkable.length > 0 && !outcomes && (
            <Button onClick={() => run.mutate(false)} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Check {checkable.length} {checkable.length === 1 ? "file" : "files"}
            </Button>
          )}
          {outcomes && (
            <div className="space-y-3 text-sm">
              {outcomes.map((o) => (
                <div key={o.name} className="space-y-0.5">
                  <p className={o.ok ? "" : "text-destructive"}>
                    <span className="font-medium">{o.name}</span> — {o.summary}
                  </p>
                  {o.detail && <p className="text-xs text-muted-foreground">{o.detail}</p>}
                </div>
              ))}
              {outcomes.some((o) => o.canSave) && (
                <Button onClick={() => run.mutate(true)} disabled={run.isPending}>
                  {run.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  Save all
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => wipe.mutate()} disabled={wipe.isPending}>
              Remove my uploaded projections
            </Button>
            <Link
              to="/projection-guide"
              target="_blank"
              className="text-xs text-muted-foreground underline"
            >
              Printable column guide
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pulls Sleeper or ESPN's published weekly projections into the database. */
function PlatformImport() {
  const importFn = useServerFn(importPlatformProjections);
  const queryClient = useQueryClient();

  const run = useMutation({
    mutationFn: () =>
      importFn({ data: { platform: "sleeper" as const, fromWeek: 1, toWeek: 18 } }),
    onSuccess: (res) => {
      const matched = res.results.reduce((sum, r) => sum + r.matched, 0);
      toast.success(`Imported ${matched} Sleeper projection lines.`);
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not reach Sleeper."),
  });

  return (
    <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
      {run.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      Import Sleeper projections
    </Button>
  );
}

function CsvUpload() {
  const upload = useServerFn(bulkUpsertBaseline);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");

  const preview = useMutation({
    mutationFn: (apply: boolean) => upload({ data: { csv, apply } }),
    onSuccess: (result) => {
      if (result.applied) {
        toast.success(`Updated ${result.matchedCount} players.`);
        void queryClient.invalidateQueries();
        setOpen(false);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that file."),
  });

  const result = preview.data;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="size-4" aria-hidden="true" />
          Upload a spreadsheet
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload baseline projections</DialogTitle>
          <DialogDescription>
            A CSV with columns: player, position, week points, season points. You will see what changes
            before anything is saved.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setCsv(await file.text());
              preview.reset();
            }}
          />
          {csv && !result && (
            <Button onClick={() => preview.mutate(false)} disabled={preview.isPending}>
              Check the file
            </Button>
          )}
          {result && (
            <div className="space-y-3 text-sm">
              <p>
                {result.matchedCount} players matched
                {result.unmatchedCount > 0 ? `, ${result.unmatchedCount} names not recognised` : ""}.
              </p>
              {result.unmatched.length > 0 && (
                <p className="text-muted-foreground">Not recognised: {result.unmatched.join(", ")}</p>
              )}
              <div className="max-h-56 overflow-y-auto rounded border border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {result.matched.slice(0, 60).map((m) => (
                      <tr key={m.playerId} className="border-b border-border last:border-0">
                        <td className="px-3 py-1">{m.name}</td>
                        <td className="px-3 py-1 text-muted-foreground">{m.position}</td>
                        <td className="px-3 py-1 text-right font-mono">
                          {round1(m.fromWeek)} → {round1(m.week)}
                        </td>
                        <td className="px-3 py-1 text-right font-mono">
                          {round1(m.fromSeason)} → {round1(m.season)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button onClick={() => preview.mutate(true)} disabled={preview.isPending || !result.matchedCount}>
                Apply {result.matchedCount} changes
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Trade values tab: the Keep Trade Cut dynasty market, in one-QB and superflex
 * pricing, refreshed weekly and daily for injured players.
 */
function TradeValuesPanel() {
  const load = useServerFn(listTradeValues);
  const refresh = useServerFn(refreshTradeValuesNow);
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<"sf" | "1qb">("sf");
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [gemsFirst, setGemsFirst] = useState(false);

  const values = useQuery({
    queryKey: ["trade-values", format, search, position],
    queryFn: () => load({ data: { format, search, position, limit: 150 } }),
  });

  const rows = [...(values.data?.rows ?? [])].sort((a, b) =>
    gemsFirst ? Number(b.undervalued) - Number(a.undervalued) || (b.gap ?? 0) - (a.gap ?? 0) : 0,
  );

  const refreshing = useMutation({
    mutationFn: () => refresh({}),
    onSuccess: (r) => {
      toast.success(`Updated ${r.players} players and ${r.picks} draft picks.`);
      void queryClient.invalidateQueries({ queryKey: ["trade-values"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not refresh values."),
  });

  const last = values.data?.lastRefresh ?? null;

  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Market prices for every player and every future draft pick. Trade ideas across the app are
        priced and balanced with these numbers.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Label htmlFor="value-search">Find a player or pick</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="value-search" className="pl-9" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={format === "sf" ? "default" : "outline"} onClick={() => setFormat("sf")}>Superflex</Button>
          <Button size="sm" variant={format === "1qb" ? "default" : "outline"} onClick={() => setFormat("1qb")}>One QB</Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((p) => (
            <Button key={p} size="sm" variant={position === p ? "default" : "outline"} onClick={() => setPosition(p)}>{p}</Button>
          ))}
        </div>
        <Button size="sm" variant={gemsFirst ? "secondary" : "outline"} onClick={() => setGemsFirst((v) => !v)}>
          Undervalued first
        </Button>
        {values.data?.admin && (
          <Button size="sm" variant="secondary" onClick={() => refreshing.mutate()} disabled={refreshing.isPending}>
            {refreshing.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null} Refresh now
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {last
          ? `Last updated ${new Date(last.at).toLocaleString()}${last.status === "ok" ? "" : ` — last run had a problem: ${last.error ?? "unknown"}`}`
          : "No refresh has run yet."}
      </p>

      {values.isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading values…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="overflow-x-auto rounded-lg bg-secondary/30 border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3">Team</th>
                  <th className="px-4 py-3 text-right">Market</th>
                  <th className="px-4 py-3 text-right">Our worth</th>
                  <th className="px-4 py-3 text-right">Gap</th>
                  <th className="px-4 py-3 text-right">Rank</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.name}-${row.position}`} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">
                      {row.name}
                      {row.undervalued && (
                        <Badge className="ml-2 text-[10px]">Undervalued</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2">{row.position}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.nflTeam ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{row.value.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                      {row.projValue !== null ? row.projValue.toLocaleString() : "—"}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono ${
                        row.gap !== null && row.gap >= 400
                          ? "text-primary"
                          : row.gap !== null && row.gap <= -400
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }`}
                    >
                      {row.gap !== null ? `${row.gap > 0 ? "+" : ""}${row.gap.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{row.overallRank ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!values.data?.rows.length && (
              <p className="px-4 py-6 text-muted-foreground">
                No values yet. An admin can pull the latest market with “Refresh now”.
              </p>
            )}
          </div>

          <div className="rounded-lg bg-secondary/30 border-border p-4">
            <h2 className="font-display text-lg font-bold">Draft picks</h2>
            <p className="mt-1 text-xs text-muted-foreground">What future picks are worth in this format.</p>
            <ul className="mt-3 space-y-1 text-sm">
              {(values.data?.picks ?? []).slice(0, 24).map((p) => (
                <li key={`${p.season}-${p.round}-${p.slot}`} className="flex items-center justify-between gap-3">
                  <span>{p.season} {p.slot === "unknown" ? "" : `${p.slot} `}round {p.round}</span>
                  <span className="font-mono">{p.value.toLocaleString()}</span>
                </li>
              ))}
              {!values.data?.picks.length && <li className="text-muted-foreground">No pick values yet.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
