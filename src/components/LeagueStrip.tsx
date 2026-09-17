/**
 * A persistent tile per league under the header (a vertical rail on desktop).
 * Shows live scores on game days and a record + to-do badge otherwise.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";

import { getLeagueStripFn, recordLeagueOpenFn } from "@/lib/strip.functions";
import type { LeagueStripTile, StripTab } from "@/lib/fantasy/strip-types";
import { leagueColor } from "@/lib/league-colors";

const TABS: StripTab[] = ["lineup", "waivers", "trade", "league", "live"];

/** Which league tab a tile should open, given where the user is standing. */
export function stripTargetTab(
  pathname: string,
  currentTab: string | undefined,
  fallback: StripTab,
): StripTab {
  if (pathname.startsWith("/league/") && currentTab === "moves") return "waivers";
  if (pathname.startsWith("/league/") && currentTab && (TABS as string[]).includes(currentTab)) {
    return currentTab as StripTab;
  }
  if (pathname.startsWith("/gameday")) return "live";
  if (pathname.startsWith("/this-week") || pathname.startsWith("/waivers")) return "waivers";
  if (pathname.startsWith("/lineup-check")) return "lineup";
  if (pathname.startsWith("/trade-desk")) return "trade";
  return fallback;
}

/** Shared query so the strip and the swipe handler read the same list. */
export function useLeagueStrip() {
  const fetchStrip = useServerFn(getLeagueStripFn);
  return useQuery({
    queryKey: ["league-strip"],
    queryFn: () => fetchStrip(),
    refetchInterval: (q) => (q.state.data?.gameDay ? 45_000 : 5 * 60_000),
    staleTime: 20_000,
  });
}

export function LeagueStrip() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchTab = useRouterState({
    select: (s) => (s.location.search as { tab?: string }).tab,
  });
  const strip = useLeagueStrip();
  const recordOpen = useServerFn(recordLeagueOpenFn);
  const bump = useMutation({ mutationFn: (leagueId: string) => recordOpen({ data: { leagueId } }) });

  const [collapsed, setCollapsed] = useState(false);
  const [peek, setPeek] = useState<LeagueStripTile | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const lastY = useRef(0);

  const activeId = pathname.startsWith("/league/") ? pathname.split("/")[2] : undefined;

  // Collapse while reading down the page, come back on the way up.
  useEffect(() => {
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 40) setCollapsed(false);
      else if (y > lastY.current + 8) setCollapsed(true);
      else if (y < lastY.current - 8) setCollapsed(false);
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeId, strip.data]);

  const tiles = strip.data?.tiles ?? [];
  if (!tiles.length) return null;

  const open = (tile: LeagueStripTile) => {
    bump.mutate(tile.id);
    navigate({
      to: "/league/$leagueId",
      params: { leagueId: tile.id },
      search: { tab: stripTargetTab(pathname, searchTab, tile.defaultTab) },
    });
  };

  const startHold = (tile: LeagueStripTile) => {
    holdRef.current = setTimeout(() => setPeek(tile), 450);
  };
  const endHold = () => {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
  };

  return (
    <>
      <div
        aria-label="Your leagues"
        onClick={() => collapsed && setCollapsed(false)}
        className={[
          "sticky top-[57px] z-20 border-b border-border bg-background/95 backdrop-blur transition-all",
          collapsed ? "h-2 overflow-hidden" : "py-2",
          "md:fixed md:inset-y-0 md:left-0 md:top-0 md:z-30 md:h-full md:w-20 md:overflow-y-auto md:border-b-0 md:border-r md:pt-20",
          collapsed ? "md:h-full md:w-2 md:overflow-hidden" : "",
        ].join(" ")}
      >
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-3 md:mx-0 md:max-w-none md:flex-col md:overflow-visible md:px-2">
          {tiles.map((tile) => {
            const active = tile.id === activeId;
            const color = leagueColor(tile.color, tile.id);
            const liveNow = tile.live?.state === "in";
            const final = tile.live?.state === "post";
            return (
              <button
                key={tile.id}
                type="button"
                ref={active ? activeRef : undefined}
                onClick={() => open(tile)}
                onTouchStart={() => startHold(tile)}
                onTouchEnd={endHold}
                onTouchMove={endHold}
                onMouseDown={() => startHold(tile)}
                onMouseUp={endHold}
                onMouseLeave={endHold}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setPeek(tile);
                }}
                aria-current={active ? "page" : undefined}
                title={tile.name}
                className={`relative shrink-0 overflow-hidden rounded-lg px-3 py-2 text-left transition md:w-full md:px-2 ${
                  active ? "bg-secondary ring-2 ring-primary" : "bg-secondary/40 hover:bg-secondary/70"
                } ${final ? "opacity-60" : ""}`}
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="flex items-center gap-1.5 pl-1.5 text-xs font-bold tracking-wide">
                  {tile.abbrev}
                  {liveNow && (
                    <span
                      className="size-1.5 animate-pulse rounded-full bg-primary"
                      aria-label="Live"
                    />
                  )}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap pl-1.5 text-[11px] text-muted-foreground">
                  {tile.live ? (
                    <>
                      <span className="font-mono text-foreground">{tile.live.myScore}</span>
                      <span>–</span>
                      <span className="font-mono">{tile.live.oppScore}</span>
                      {tile.live.winProbability !== null && (
                        <span>{Math.round(tile.live.winProbability * 100)}%</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span>{tile.record ?? "—"}</span>
                      {tile.standing && <span>#{tile.standing}</span>}
                      {tile.todoCount > 0 && (
                        <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                          {tile.todoCount}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </button>
            );
          })}

          <Link
            to="/connect"
            aria-label="Add a league"
            className="flex shrink-0 items-center justify-center rounded-lg bg-secondary/40 px-3 text-muted-foreground hover:bg-secondary/70 md:w-full md:py-3"
          >
            <Plus className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {peek && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/60 p-4 backdrop-blur-sm md:items-center"
          onClick={() => setPeek(null)}
          role="presentation"
        >
          <div className="w-full max-w-sm rounded-xl bg-card p-4 shadow-xl">
            <p className="text-sm font-semibold">{peek.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{peek.peek}</p>
          </div>
        </div>
      )}
    </>
  );
}

/** Horizontal swipe on a league page moves to the next league, same tab. */
export function useLeagueSwipe(tab: string) {
  const navigate = useNavigate();
  const { leagueId } = useParams({ strict: false }) as { leagueId?: string };
  const strip = useLeagueStrip();
  const tiles = useMemo(() => strip.data?.tiles ?? [], [strip.data]);
  const start = useRef<{ x: number; y: number } | null>(null);

  const go = (direction: 1 | -1) => {
    if (!leagueId || tiles.length < 2) return;
    const index = tiles.findIndex((t) => t.id === leagueId);
    if (index < 0) return;
    const next = tiles[(index + direction + tiles.length) % tiles.length]!;
    navigate({
      to: "/league/$leagueId",
      params: { leagueId: next.id },
      search: { tab },
    });
  };

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      const t = e.changedTouches[0];
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      go(dx < 0 ? 1 : -1);
    },
  };
}
