/** Four-step setup for a league the app tracks by hand. */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ImageUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SlotEditor } from "@/components/SlotEditor";
import { slotsFromCodes, type LeagueSlot } from "@/lib/fantasy/slots";

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
import { Textarea } from "@/components/ui/textarea";
import { FORMAT_LABELS, LEAGUE_FORMATS } from "@/lib/fantasy/format";
import {
  LEAGUE_TYPES,
  LEAGUE_TYPE_LABELS,
  LEAGUE_VARIANTS,
  LEAGUE_VARIANT_LABELS,
  type LeagueType,
  type LeagueVariant,
} from "@/lib/fantasy/league-type";
import type { ManualDraftPreview } from "@/lib/fantasy/manual-types";
import { readScreenshot, updateLeagueSettings } from "@/lib/fantasy.functions";
import {
  CONTEST_DESCRIPTIONS,
  CONTEST_FORMATS,
  CONTEST_LABELS,
  type ContestFormat,
} from "@/lib/fantasy/contest";
import {
  applyDraftBoard,
  copyableLeagues,
  createManualLeagueWizard,
  previewDraftBoard,
  saveManualSchedule,
  setMyManualTeam,
} from "@/lib/manual.functions";

const FFPC_SLOTS = "QB, RB, RB, WR, WR, WR, TE, TE, FLEX, K, DEF";
const FFPC_RULES: Record<string, number> = {
  rec: 1,
  bonus_rec_te: 0.5,
  pass_td: 6,
  pass_yd: 0.04,
  pass_int: -2,
  rush_yd: 0.1,
  rush_td: 6,
  rec_yd: 0.1,
  rec_td: 6,
  fum_lost: -2,
};

const STEPS = ["League", "Draft board", "Format", "Schedule", "My team"];


/** Image-to-text upload used by the draft and schedule steps. */
export function ScreenshotToText({
  label,
  onText,
}: {
  label: string;
  onText: (text: string) => void;
}) {
  const scan = useServerFn(readScreenshot);
  const read = useMutation({
    mutationFn: (images: string[]) => scan({ data: { mode: "text" as const, images } }),
    onSuccess: (res) => {
      if (res.mode !== "text" || !res.text) return;
      onText(res.text);
      toast.success("Screenshot read. Check the rows before saving.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that screenshot."),
  });

  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-background/50 p-3 text-sm hover:text-primary">
      {read.isPending ? (
        <Loader2 className="size-4 animate-spin text-primary" />
      ) : (
        <ImageUp className="size-4 text-primary" aria-hidden="true" />
      )}
      <span>{read.isPending ? "Reading your screenshot…" : label}</span>
      <input
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={async (e) => {
          const files = e.target.files;
          if (!files?.length) return;
          const images = await readFiles(files);
          e.target.value = "";
          read.mutate(images);
        }}
      />
    </label>
  );
}

/** Turns the editor's spots back into the comma list the league is saved with. */
function slotsToCodes(slots: LeagueSlot[]): string {
  const codes: string[] = [];
  for (const slot of slots) {
    const code = slot.eligible.length > 1 ? `${slot.key} (${slot.eligible.join("/")})` : slot.key;
    for (let i = 0; i < slot.count; i += 1) codes.push(code);
  }
  return codes.join(", ");
}

export function ManualLeagueWizard() {
  const navigate = useNavigate();
  const create = useServerFn(createManualLeagueWizard);
  const preview = useServerFn(previewDraftBoard);
  const applyDraft = useServerFn(applyDraftBoard);
  const saveSchedule = useServerFn(saveManualSchedule);
  const setMine = useServerFn(setMyManualTeam);
  const saveSettings = useServerFn(updateLeagueSettings);

  const [step, setStep] = useState(0);
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);

  const [form, setForm] = useState({
    name: "",
    teamCount: 12,
    playoffTeams: 6,
    regularSeasonWeeks: 14,
    currentWeek: 1,
    scoringType: "ppr",
    format: "redraft" as (typeof LEAGUE_FORMATS)[number],
    leagueType: "redraft" as LeagueType,
    variant: "none" as LeagueVariant,
    slots: "QB, RB, RB, WR, WR, TE, FLEX, K, DEF",
  });
  const [scoringRules, setScoringRules] = useState<Record<string, number>>({});
  const [teamNames, setTeamNames] = useState<string>("");

  const [draftText, setDraftText] = useState("");
  const [draft, setDraft] = useState<ManualDraftPreview | null>(null);
  const [scheduleText, setScheduleText] = useState("");

  const [contest, setContest] = useState<ContestFormat>("h2h");
  const [pointsPlayoffTeams, setPointsPlayoffTeams] = useState(0);
  const [pointsPlayoffWeek, setPointsPlayoffWeek] = useState("");
  const [weeklyHighBonus, setWeeklyHighBonus] = useState(false);
  const [weeklyHighLabel, setWeeklyHighLabel] = useState("");

  const copyLeagues = useServerFn(copyableLeagues);
  const copyFrom = useQuery({
    queryKey: ["copyable-leagues"],
    queryFn: () => copyLeagues(),
  });

  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(Number(value) || min)));

  const names = () => {
    const count = clamp(form.teamCount, 2, 20);
    const typed = teamNames
      .split(/[\n,]/)
      .map((n) => n.trim())
      .filter(Boolean);
    const out = [...typed];
    while (out.length < count) out.push(`Team ${out.length + 1}`);
    return out.slice(0, count);
  };


  const createMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          name: form.name.trim() || "My league",
          teamCount: clamp(form.teamCount, 2, 20),
          playoffTeams: clamp(form.playoffTeams, 2, 12),
          regularSeasonWeeks: clamp(form.regularSeasonWeeks, 4, 18),
          currentWeek: clamp(form.currentWeek, 1, 18),
          scoringType: form.scoringType,
          scoringRules,
          format: form.format,
          leagueType: form.leagueType,
          variant: form.variant,
          rosterSlots: form.slots
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
          teamNames: names(),
        },
      }),
    onSuccess: (res) => {
      setLeagueId(res.leagueId);
      setTeams(res.teams);
      setStep(1);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create the league."),
  });

  const previewMutation = useMutation({
    mutationFn: () => preview({ data: { leagueId: leagueId!, text: draftText } }),
    onSuccess: (res) => setDraft(res),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not read that draft board."),
  });

  const applyDraftMutation = useMutation({
    mutationFn: () =>
      applyDraft({
        data: {
          leagueId: leagueId!,
          teams: (draft?.teams ?? []).map((t) => ({
            name: t.name,
            players: t.players.map((p) => ({
              name: p.name,
              position: p.position,
              nflTeam: p.nflTeam,
              matched: p.matched,
            })),
          })),
        },
      }),
    onSuccess: (res) => {
      toast.success(`${res.saved} players saved.`);
      setStep(2);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save those rosters."),
  });

  const scheduleMutation = useMutation({
    mutationFn: (mode: "paste" | "auto") =>
      saveSchedule({
        data: { leagueId: leagueId!, ...(mode === "paste" ? { text: scheduleText } : {}) },
      }),
    onSuccess: (res) => {
      toast.success(`${res.games} games saved.`);
      setStep(4);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the schedule."),
  });

  const formatMutation = useMutation({
    mutationFn: () =>
      saveSettings({
        data: {
          leagueId: leagueId!,
          contestFormat: contest,
          weeklyHighBonus,
          weeklyHighLabel: weeklyHighLabel.trim() || null,
          ...(contest === "h2h"
            ? {}
            : {
                pointsPlayoffTeams: pointsPlayoffTeams || 0,
                pointsPlayoffWeek: pointsPlayoffWeek ? Number(pointsPlayoffWeek) : null,
              }),
        },
      }),
    onSuccess: () => setStep(contest === "points" ? 4 : 3),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the format."),
  });

  const mineMutation = useMutation({
    mutationFn: (teamId: string) => setMine({ data: { leagueId: leagueId!, teamId } }),
    onSuccess: () => {
      toast.success("League ready.");
      navigate({ to: "/league/$leagueId", params: { leagueId: leagueId! } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not set your team."),
  });

  return (
    <section className="rounded-xl bg-card p-6">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${
              i === step
                ? "bg-primary text-primary-foreground"
                : i < step
                  ? "bg-secondary text-foreground"
                  : "bg-secondary/40 text-muted-foreground"
            }`}
          >
            {i < step ? <Check className="size-3" aria-hidden="true" /> : <span>{i + 1}</span>}
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">League basics</h2>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setForm((f) => ({ ...f, slots: FFPC_SLOTS, scoringType: "te_premium", teamCount: 12 }));
                setScoringRules(FFPC_RULES);
                toast.success("FFPC scoring and lineup applied.");
              }}
            >
              Use FFPC preset
            </Button>
            {(copyFrom.data ?? []).length > 0 && (
              <Select
                onValueChange={(id) => {
                  const src = (copyFrom.data ?? []).find((l) => l.id === id);
                  if (!src) return;
                  setScoringRules(src.scoringRules);
                  setForm((f) => ({
                    ...f,
                    scoringType: src.scoringType,
                    slots: src.rosterSlots.length ? src.rosterSlots.join(", ") : f.slots,
                  }));
                  toast.success(`Scoring copied from ${src.name}.`);
                }}
              >
                <SelectTrigger className="w-64" aria-label="Copy scoring from an existing league">
                  <SelectValue placeholder="Copy scoring from a league" />
                </SelectTrigger>
                <SelectContent>
                  {(copyFrom.data ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

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
              <Label htmlFor="m-name">League name</Label>
              <Input
                id="m-name"
                value={form.name}
                placeholder="Sunday Money League"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-scoring">Scoring</Label>
              <Select
                value={form.scoringType}
                onValueChange={(v) => setForm({ ...form, scoringType: v })}
              >
                <SelectTrigger id="m-scoring">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ppr">Full PPR</SelectItem>
                  <SelectItem value="half_ppr">Half PPR</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="te_premium">TE premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-league-type">League type</Label>
              <Select
                value={form.leagueType}
                onValueChange={(v) => setForm({ ...form, leagueType: v as LeagueType })}
              >
                <SelectTrigger id="m-league-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAGUE_TYPES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {LEAGUE_TYPE_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-variant">Variant</Label>
              <Select
                value={form.variant}
                onValueChange={(v) => setForm({ ...form, variant: v as LeagueVariant })}
              >
                <SelectTrigger id="m-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAGUE_VARIANTS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {LEAGUE_VARIANT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="m-format">Lineups</Label>
              <Select
                value={form.format}
                onValueChange={(v) =>
                  setForm({ ...form, format: v as (typeof LEAGUE_FORMATS)[number] })
                }
              >
                <SelectTrigger id="m-format">
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
                <Label htmlFor={`m-${key}`}>{label}</Label>
                <Input
                  id={`m-${key}`}
                  type="number"
                  min={1}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                />
              </div>
            ))}
            <div className="space-y-2 sm:col-span-2">
              <Label>Starting lineup spots</Label>
              <SlotEditor
                slots={slotsFromCodes(
                  form.slots.split(",").map((s) => s.trim()).filter(Boolean),
                  "user",
                )}
                onChange={(next) => setForm({ ...form, slots: slotsToCodes(next) })}
              />
              <p className="text-xs text-muted-foreground">
                Set how many of each spot your league starts and which positions can fill it.
              </p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="m-teams">Team names</Label>
              <Textarea
                id="m-teams"
                rows={4}
                value={teamNames}
                placeholder="One per line. Leave blank and we will use Team 1, Team 2…"
                onChange={(e) => setTeamNames(e.target.value)}
              />
            </div>
          </div>

          <Button
            className="mt-6"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Next: draft board
          </Button>
        </div>
      )}

      {step === 1 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">Draft board</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste the draft results, drop in a CSV, or upload screenshots. Team headings, a team
            column, or a plain pick list in snake order all work.
          </p>

          <ScreenshotToText
            label="Upload draft board screenshots (up to 4)"
            onText={(t) => setDraftText((prev) => (prev ? `${prev}\n${t}` : t))}
          />

          <Textarea
            rows={10}
            className="mt-3 font-mono text-xs"
            value={draftText}
            placeholder={"Team A:\n1.01 Ja'Marr Chase (WR - CIN)\n2.12 Bijan Robinson RB ATL"}
            onChange={(e) => setDraftText(e.target.value)}
          />
          <div className="mt-2">
            <label className="cursor-pointer text-xs text-primary">
              Upload a CSV instead
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) setDraftText(await file.text());
                }}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={!draftText.trim() || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Check the board
            </Button>
            <Button variant="ghost" onClick={() => setStep(2)}>
              Skip for now
            </Button>
          </div>

          {draft && (
            <div className="mt-6">
              <p className="text-sm">
                {draft.total} players read
                {draft.unmatched.length > 0 && (
                  <span className="text-warning">
                    {" "}
                    · {draft.unmatched.length} to check
                  </span>
                )}
              </p>
              {draft.unmatched.length > 0 && (
                <div className="mt-3 space-y-2">
                  {draft.unmatched.slice(0, 20).map((p, i) => (
                    <div
                      key={`${p.name}-${i}`}
                      className="flex items-center justify-between rounded-lg bg-background/40 px-3 py-2 text-sm"
                    >
                      <span>{p.name}</span>
                      <Badge variant="outline" className="border-warning text-warning">
                        No match
                      </Badge>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Unmatched names are kept for review; everything else imports normally.
                  </p>
                </div>
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {draft.teams.map((t) => (
                  <div key={t.name} className="rounded-lg bg-background/40 p-3">
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.players.length
                        ? t.players.map((p) => p.name).join(", ")
                        : "No players read"}
                    </p>
                  </div>
                ))}
              </div>
              <Button
                className="mt-4"
                disabled={applyDraftMutation.isPending}
                onClick={() => applyDraftMutation.mutate()}
              >
                {applyDraftMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save rosters
              </Button>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">How is this league won?</h2>

          <div className="mt-4 space-y-2">
            {CONTEST_FORMATS.map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3 rounded-lg bg-background/40 p-3 text-sm"
              >
                <input
                  type="radio"
                  name="contest"
                  className="mt-1"
                  checked={contest === key}
                  onChange={() => setContest(key)}
                />
                <span>
                  <span className="block font-medium">{CONTEST_LABELS[key]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {CONTEST_DESCRIPTIONS[key]}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {contest === "points" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-pp-teams">Playoff teams by total points</Label>
                <Input
                  id="m-pp-teams"
                  type="number"
                  min={0}
                  max={32}
                  value={pointsPlayoffTeams}
                  onChange={(e) => setPointsPlayoffTeams(Number(e.target.value) || 0)}
                />
                <p className="text-xs text-muted-foreground">Leave at 0 for no playoffs.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="m-pp-week">Qualifying after week</Label>
                <Input
                  id="m-pp-week"
                  type="number"
                  min={1}
                  max={18}
                  value={pointsPlayoffWeek}
                  onChange={(e) => setPointsPlayoffWeek(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="mt-6 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={weeklyHighBonus}
                onChange={(e) => setWeeklyHighBonus(e.target.checked)}
              />
              This league pays a weekly high score bonus
            </label>
            {weeklyHighBonus && (
              <Input
                aria-label="Weekly high payout"
                placeholder="e.g. $20"
                className="max-w-[160px]"
                value={weeklyHighLabel}
                onChange={(e) => setWeeklyHighLabel(e.target.value)}
              />
            )}
          </div>

          <Button
            className="mt-6"
            disabled={formatMutation.isPending}
            onClick={() => formatMutation.mutate()}
          >
            {formatMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {contest === "points" ? "Next: pick your team" : "Next: schedule"}
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">Schedule</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste the league schedule, or let us build a standard round robin.
          </p>

          <ScreenshotToText
            label="Upload schedule screenshots"
            onText={(t) => setScheduleText((prev) => (prev ? `${prev}\n${t}` : t))}
          />
          <Textarea
            rows={8}
            className="mt-3 font-mono text-xs"
            value={scheduleText}
            placeholder={"Week 1:\nTeam A vs Team B\nTeam C vs Team D"}
            onChange={(e) => setScheduleText(e.target.value)}
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              disabled={!scheduleText.trim() || scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate("paste")}
            >
              Use this schedule
            </Button>
            <Button
              variant="outline"
              disabled={scheduleMutation.isPending}
              onClick={() => scheduleMutation.mutate("auto")}
            >
              {scheduleMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Generate a standard schedule
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold">Which team is yours?</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {teams.map((t) => (
              <Button
                key={t.id}
                variant="outline"
                className="justify-start"
                disabled={mineMutation.isPending}
                onClick={() => mineMutation.mutate(t.id)}
              >
                {t.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
