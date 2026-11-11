/**
 * Line chart of chances (0–100%) by week. Tap or hover a week to read every
 * line's value at that week; tap a row in the readout to bring that line forward.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export type OddsChartSeries = {
  key: string;
  label: string;
  color: string;
  dash?: string;
  points: { week: number; value: number }[];
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function OddsChart({
  series,
  height = 220,
  ariaLabel,
  sortReadout = false,
}: {
  series: OddsChartSeries[];
  height?: number;
  ariaLabel: string;
  /** Order the readout by value at the chosen week (used when many lines share one chart). */
  sortReadout?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [pickedWeek, setPickedWeek] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const weeks = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.week)))].sort((a, b) => a - b),
    [series],
  );

  if (!weeks.length) {
    return <p className="text-sm text-muted-foreground">No weeks recorded yet — this builds up as the season runs.</p>;
  }

  const pad = { left: 36, right: 12, top: 10, bottom: 24 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const minWeek = weeks[0]!;
  const maxWeek = weeks[weeks.length - 1]!;
  const xFor = (week: number) =>
    minWeek === maxWeek ? pad.left + innerW / 2 : pad.left + ((week - minWeek) / (maxWeek - minWeek)) * innerW;
  const yFor = (v: number) => pad.top + (1 - v) * innerH;

  const activeWeek = pickedWeek !== null && weeks.includes(pickedWeek) ? pickedWeek : maxWeek;
  const labelEvery = Math.max(1, Math.ceil((weeks.length * 28) / Math.max(innerW, 1)));

  const pickFromPointer = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    let best = weeks[0]!;
    for (const w of weeks) if (Math.abs(xFor(w) - x) < Math.abs(xFor(best) - x)) best = w;
    setPickedWeek(best);
  };

  const readout = series
    .map((s) => ({ s, point: s.points.find((p) => p.week === activeWeek) ?? null }))
    .filter((r) => r.point || !sortReadout);
  if (sortReadout) readout.sort((a, b) => (b.point?.value ?? -1) - (a.point?.value ?? -1));

  return (
    <div className="space-y-3">
      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          className="block touch-pan-y select-none"
          onPointerMove={(e) => pickFromPointer(e.clientX, e.currentTarget)}
          onPointerDown={(e) => pickFromPointer(e.clientX, e.currentTarget)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={yFor(t)}
                y2={yFor(t)}
                stroke="var(--border)"
                strokeDasharray={t === 0 ? undefined : "3 4"}
              />
              <text
                x={pad.left - 6}
                y={yFor(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="var(--muted-foreground)"
              >
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}

          {weeks.map((w, i) =>
            i % labelEvery === 0 || w === maxWeek ? (
              <text
                key={w}
                x={xFor(w)}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                fill={w === activeWeek ? "var(--foreground)" : "var(--muted-foreground)"}
              >
                {i === 0 ? `Wk ${w}` : w}
              </text>
            ) : null,
          )}

          <line
            x1={xFor(activeWeek)}
            x2={xFor(activeWeek)}
            y1={pad.top}
            y2={pad.top + innerH}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.5}
          />

          {series.map((s) => {
            const faded = focus !== null && focus !== s.key;
            const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.week).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(" ");
            const active = s.points.find((p) => p.week === activeWeek);
            return (
              <g key={s.key} opacity={faded ? 0.15 : 1}>
                {s.points.length > 1 && (
                  <path
                    d={d}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={focus === s.key ? 3 : 2}
                    strokeDasharray={s.dash}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )}
                {(s.points.length === 1 || active) && (
                  <circle
                    cx={xFor((active ?? s.points[0]!).week)}
                    cy={yFor((active ?? s.points[0]!).value)}
                    r={3.5}
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={1.5}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div>
        <p className="text-xs font-semibold">Week {activeWeek}</p>
        <ul className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {readout.map(({ s, point }) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setFocus((f) => (f === s.key ? null : s.key))}
                className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-opacity ${
                  focus !== null && focus !== s.key ? "opacity-50" : ""
                }`}
                aria-pressed={focus === s.key}
              >
                <svg width={18} height={8} className="shrink-0" aria-hidden="true">
                  <line x1={1} x2={17} y1={4} y2={4} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dash} strokeLinecap="round" />
                </svg>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">{point ? pct(point.value) : "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
