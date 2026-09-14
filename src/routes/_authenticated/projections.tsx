/**
 * Projections page: everyone can tune a player's numbers for themselves, and
 * the admin maintains the shared baseline (inline or with a spreadsheet).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ProjectionAdjuster } from "@/components/ProjectionAdjuster";
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
  clearAllOverrides,
  listProjections,
  updateBaseline,
  type BaselineRow,
} from "@/lib/projections.functions";

export const Route = createFileRoute("/_authenticated/projections")({
  head: () => ({
    meta: [
      { title: "Projections — Gridiron Edge" },
      {
        name: "description",
        content:
          "Set the shared baseline projections for every player and tune any player up or down for your own leagues.",
      },
      { property: "og:title", content: "Projections — Gridiron Edge" },
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

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];
const round1 = (n: number) => Math.round(n * 10) / 10;

function ProjectionsPage() {
  const list = useServerFn(listProjections);
  const resetAll = useServerFn(clearAllOverrides);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [adjustedOnly, setAdjustedOnly] = useState(false);
  const [open, setOpen] = useState<BaselineRow | null>(null);

  const players = useQuery({
    queryKey: ["projections", search, position, adjustedOnly],
    queryFn: () => list({ data: { search, position, adjustedOnly, limit: 150 } }),
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
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide">Projections</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every number in the app starts from a shared baseline. Disagree with one? Adjust it here and
          it follows you into all of your leagues — start/sit, waivers, trades and title odds all use
          your version.
        </p>
      </header>

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
        {admin && <CsvUpload />}
      </div>

      {players.isLoading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading players…
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
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
