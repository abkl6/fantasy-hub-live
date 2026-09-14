import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Maximize2, Sun, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useCountUp } from "@/components/GameDayBoard";
import { Button } from "@/components/ui/button";
import { getGameDayFn } from "@/lib/fantasy.functions";
import { pollInterval } from "@/lib/fantasy/gamewindow";
import type { LiveMatchup } from "@/lib/fantasy/live-types";
import { leagueColor, leagueInitials } from "@/lib/league-colors";

/** Keep the screen awake while the TV board is open. */
function useWakeLock() {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "wakeLock" in navigator);
  }, []);

  const request = useCallback(async () => {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    if (!nav.wakeLock) return null;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      setActive(true);
      return sentinel;
    } catch {
      setActive(false);
      return null;
    }
  }, []);

  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const acquire = async () => {
      const next = await request();
      if (cancelled) void next?.release();
      else sentinel = next;
    };
    void acquire();

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
      setActive(false);
    };
  }, [request]);

  return { active, supported, request: () => void request() };
}

/** Try full screen on open; expose a manual trigger when the browser refuses. */
function useFullscreen() {
  const [isFull, setIsFull] = useState(false);

  const enter = useCallback(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const sync = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  return { isFull, enter };
}

function TvTile({ m, size }: { m: LiveMatchup; size: "lg" | "md" | "sm" }) {
  const mine = useCountUp(m.myScore);
  const theirs = useCountUp(m.oppScore);
  const color = leagueColor(m.color, m.leagueId);
  const live = m.gameState === "in";
  const final = m.gameState === "post";
  const odds = m.winProbability === null ? null : Math.round(m.winProbability * 100);
  const scoreSize = size === "lg" ? "text-7xl" : size === "md" ? "text-6xl" : "text-5xl";

  return (
    <article
      className={`flex flex-col justify-center overflow-hidden rounded-xl bg-card px-5 py-4 transition-opacity ${
        final ? "opacity-60" : ""
      } ${live ? "shadow-lg shadow-black/40 ring-1 ring-primary/25" : ""} ${
        mine.changed || theirs.changed ? "row-flash" : ""
      }`}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="flex items-center gap-2">
        {live && <span className="live-dot size-2 rounded-full bg-primary" aria-hidden="true" />}
        <span className="text-sm font-semibold tracking-wide" style={{ color }}>
          {leagueInitials(m.leagueName)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{m.leagueName}</span>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{m.myTeam}</p>
          <p className={`stat-num font-bold leading-none ${scoreSize}`}>{mine.display.toFixed(1)}</p>
        </div>
        <div className="w-16">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${odds ?? 0}%`, backgroundColor: color }}
            />
          </div>
          <p className="mt-1 text-center text-[11px] tabular-nums text-muted-foreground">
            {odds === null ? "—" : `${odds}%`}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-xs text-muted-foreground">{m.oppTeam ?? "Opponent"}</p>
          <p className={`stat-num font-bold leading-none ${scoreSize}`}>{theirs.display.toFixed(1)}</p>
        </div>
      </div>
    </article>
  );
}

export function TvBoard() {
  const fetchGameDay = useServerFn(getGameDayFn);
  const interval = pollInterval();
  const wake = useWakeLock();
  const full = useFullscreen();
  const [showControls, setShowControls] = useState(true);

  const { data } = useQuery({
    queryKey: ["gameday", "tv"],
    queryFn: () => fetchGameDay({ data: { refresh: true } }),
    refetchOnWindowFocus: true,
    refetchInterval: interval || false,
  });

  const matchups = useMemo(() => {
    const rows = [...(data?.matchups ?? [])];
    return rows.sort((a, b) => (b.winProbability ?? -1) - (a.winProbability ?? -1));
  }, [data]);

  useEffect(() => {
    if (!showControls) return;
    const timer = setTimeout(() => setShowControls(false), 4000);
    return () => clearTimeout(timer);
  }, [showControls]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowControls(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const count = matchups.length;
  const columns = count <= 2 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-2 xl:grid-cols-3";
  const size = count <= 2 ? "lg" : count <= 4 ? "md" : "sm";
  const events = (data?.events ?? []).slice(0, 12);

  return (
    <div
      className="relative flex min-h-screen flex-col bg-background p-4 pb-16"
      onClick={() => setShowControls(true)}
    >
      <div
        className={`absolute right-4 top-4 z-10 flex items-center gap-2 transition-opacity ${
          showControls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {!full.isFull && (
          <Button size="sm" variant="secondary" onClick={full.enter}>
            <Maximize2 className="size-4" aria-hidden="true" />
            Full screen
          </Button>
        )}
        {wake.supported && !wake.active && (
          <Button size="sm" variant="secondary" onClick={wake.request}>
            <Sun className="size-4" aria-hidden="true" />
            Keep awake
          </Button>
        )}
        <Button size="sm" variant="secondary" asChild>
          <Link to="/gameday">
            <X className="size-4" aria-hidden="true" />
            Exit
          </Link>
        </Button>
      </div>

      {!count ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">Waiting for live matchups…</p>
        </div>
      ) : (
        <div className={`grid flex-1 gap-4 ${columns}`}>
          {matchups.map((m) => (
            <TvTile key={m.leagueId} m={m} size={size} />
          ))}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 overflow-x-auto px-4 py-2">
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="live-dot size-2 rounded-full bg-primary" aria-hidden="true" />
            Live
          </span>
          {!events.length && <span className="text-xs text-muted-foreground">No scoring updates yet.</span>}
          {events.map((e) => (
            <span key={`${e.leagueId}-${e.id}`} className="ticker-in flex shrink-0 items-baseline gap-1.5 text-sm">
              <span
                className={`stat-num font-bold ${
                  e.side === "opponent" ? "text-destructive" : e.points >= 0 ? "text-primary" : "text-destructive"
                }`}
              >
                {e.points >= 0 ? "+" : ""}
                {e.points.toFixed(1)}
              </span>
              <span className="font-medium">{e.playerName}</span>
              <span className="text-muted-foreground">{e.description}</span>
              <span className="text-muted-foreground/60">· {e.leagueName}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
