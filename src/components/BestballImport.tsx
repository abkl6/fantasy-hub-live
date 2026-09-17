/** Upload panel for an Underdog or DraftKings entries export. */

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importBestballFn, previewBestballFn } from "@/lib/bestball.functions";
import { BESTBALL_SITE_LABELS, type BestballSite } from "@/lib/fantasy/bestball";

type Preview = Awaited<ReturnType<typeof previewBestballFn>>;

export function BestballImport({ site }: { site: BestballSite }) {
  const label = BESTBALL_SITE_LABELS[site];
  const navigate = useNavigate();
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const previewFn = useServerFn(previewBestballFn);
  const importFn = useServerFn(importBestballFn);

  const check = useMutation({
    mutationFn: (text: string) => previewFn({ data: { csv: text, site } }),
    onSuccess: (result) => setPreview(result),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that file"),
  });

  const save = useMutation({
    mutationFn: () => importFn({ data: { csv, site } }),
    onSuccess: (result) => {
      const first = result.tournaments[0];
      toast.success(
        `Saved ${result.tournaments.length} ${result.tournaments.length === 1 ? "tournament" : "tournaments"}`,
      );
      if (first) navigate({ to: "/league/$leagueId", params: { leagueId: first.leagueId } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save those entries"),
  });

  const onFile = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setPreview(null);
    check.mutate(text);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Add your {label} best ball entries</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Export your drafts from {label} as a CSV and upload it here. Each tournament becomes its
          own board with every entry's weekly and running score. Uploading again replaces that
          tournament's entries.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`bestball-${site}`}>Entries file (.csv)</Label>
        <Input
          id={`bestball-${site}`}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {check.isPending && <p className="text-sm text-muted-foreground">Reading your file…</p>}

      {preview && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">
            {preview.totalEntries} {preview.totalEntries === 1 ? "entry" : "entries"} across{" "}
            {preview.tournaments.length}{" "}
            {preview.tournaments.length === 1 ? "tournament" : "tournaments"}
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {preview.tournaments.map((t) => (
              <li key={t.name}>
                {t.name} — {t.entries} {t.entries === 1 ? "entry" : "entries"}, {t.players} players
              </li>
            ))}
          </ul>
          {preview.skipped > 0 && (
            <p className="text-xs text-muted-foreground">
              {preview.skipped} rows had no player name and were left out.
            </p>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save entries"}
          </Button>
        </div>
      )}

      {save.data && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
          {save.data.tournaments.map((t) => (
            <p key={t.leagueId}>
              <span className="font-medium">{t.name}</span> — {t.entries} entries, {t.players}{" "}
              picks
              {t.unmatched.length
                ? ` · ${t.unmatched.length} names we couldn't find: ${t.unmatched.slice(0, 6).join(", ")}`
                : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
