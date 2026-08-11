import { useEffect, useMemo, useRef, useState } from "react";
import type { SnapshotPoint } from "../api.ts";
import { fmt } from "../util.tsx";
import {
  INTERVAL_MS,
  usePrefs,
  type ChartMode,
  type IntervalKey,
  type RangeKey,
  type RelativeScale,
} from "../settings.ts";

/**
 * Robinhood-register plays chart: big number + signed delta header that
 * scrubs with the crosshair, range tabs, interval (candle) aggregation,
 * wheel/pinch zoom and drag-pan. Single 2px line colored by the window's
 * direction — direction is ALSO carried by ▲/▼ and signed text, never color
 * alone. Volume sits in its own panel sharing the x-axis (never a second
 * y-scale on the price marks).
 */

const RANGES: { label: RangeKey; days: number }[] = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "All", days: Infinity },
];

const INTERVAL_CHOICES: IntervalKey[] = ["auto", "1h", "4h", "12h", "1D", "1W"];
const DAY = 86_400_000;

interface P {
  t: number;
  plays: number;
  iso: string;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC",
  });
}

/** Compact ratio label: 12×, 3.4×, 0.25×. */
function fmtRatio(r: number): string {
  if (r >= 10) return String(Math.round(r));
  if (r >= 1) return r.toFixed(1).replace(/\.0$/, "");
  if (r >= 0.1) return r.toFixed(2).replace(/0$/, "");
  return r.toFixed(3);
}

function fmtTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs <= 2 * DAY) {
    return d.toLocaleString("en-US", { hour: "numeric", timeZone: "UTC" });
  }
  if (spanMs <= 5 * DAY) {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Pick a sensible bucket size so a window renders ~50–140 points. */
function autoIntervalMs(spanMs: number): number | null {
  const candidates = [0, INTERVAL_MS["1h"], INTERVAL_MS["4h"], INTERVAL_MS["12h"], INTERVAL_MS["1D"], INTERVAL_MS["1W"]];
  for (const ms of candidates) {
    if (ms === 0) continue;
    if (spanMs / ms <= 140) return ms;
  }
  return INTERVAL_MS["1W"];
}

/**
 * Collapse points into interval buckets, keeping the LAST point of each —
 * correct for a cumulative metric like play count (a bucket's value is where
 * the counter stood when the bucket closed). Aggregation only ever coarsens;
 * asking for 1h when the data is 4h just returns the raw points.
 */
function aggregate(points: P[], intervalMs: number | null): P[] {
  if (!intervalMs || points.length === 0) return points;
  const out: P[] = [];
  let bucket = Number.NaN;
  for (const p of points) {
    const b = Math.floor(p.t / intervalMs);
    if (b !== bucket) {
      out.push(p);
      bucket = b;
    } else {
      out[out.length - 1] = p;
    }
  }
  // always keep the true latest point so the header matches reality
  const lastRaw = points[points.length - 1]!;
  if (out[out.length - 1]!.t !== lastRaw.t) out.push(lastRaw);
  return out;
}

export function MiniSpark({ points, up }: { points: { plays: number }[]; up: boolean }) {
  if (points.length < 2) return null;
  const W = 64;
  const H = 32;
  const min = Math.min(...points.map((p) => p.plays));
  const max = Math.max(...points.map((p) => p.plays));
  const span = max - min || 1;
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * W).toFixed(1)},${(
          2 + (1 - (p.plays - min) / span) * (H - 4)
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <path d={path} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export interface ChartMarker {
  /** ms timestamp of the moment (e.g. when you locked the pick) */
  t: number;
  label: string;
}

/** The pick this chart is measured against — its baseline is the 1× line. */
export interface Benchmark {
  /** Plays at the moment of the pick; the entry multiple is plays ÷ this. */
  baselinePlays: number;
  label: string;
}

export function StockChart({
  points,
  marker,
  benchmark,
}: {
  points: SnapshotPoint[];
  marker?: ChartMarker;
  benchmark?: Benchmark;
}) {
  const prefs = usePrefs();
  const all = useMemo<P[]>(
    () =>
      points
        .filter((p): p is { plays: number; capturedAt: string } => p.plays !== null)
        .map((p) => ({ t: Date.parse(p.capturedAt), plays: p.plays, iso: p.capturedAt }))
        .sort((a, b) => a.t - b.t),
    [points],
  );

  const [range, setRange] = useState<RangeKey>(prefs.defaultRange);
  const [interval, setIntervalKey] = useState<IntervalKey>(prefs.interval);
  const [mode, setMode] = useState<ChartMode>(prefs.mode);
  const [relScale, setRelScale] = useState<RelativeScale>(prefs.relativeScale);
  /** Explicit zoom/pan window; null = follow the range preset. */
  const [view, setView] = useState<{ s: number; e: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number }>());
  const drag = useRef<{ x: number; s: number; e: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; s: number; e: number } | null>(null);

  // Follow preference changes made in Settings while a chart is open.
  useEffect(() => setRange(prefs.defaultRange), [prefs.defaultRange]);
  useEffect(() => setIntervalKey(prefs.interval), [prefs.interval]);
  useEffect(() => setMode(prefs.mode), [prefs.mode]);
  useEffect(() => setRelScale(prefs.relativeScale), [prefs.relativeScale]);

  const bounds = useMemo(() => {
    if (all.length === 0) return { s: 0, e: 1 };
    return { s: all[0]!.t, e: all[all.length - 1]!.t };
  }, [all]);

  const window_ = useMemo(() => {
    if (view) return view;
    const r = RANGES.find((x) => x.label === range)!;
    if (!Number.isFinite(r.days)) return bounds;
    const s = Math.max(bounds.s, bounds.e - r.days * DAY);
    return s >= bounds.e ? bounds : { s, e: bounds.e };
  }, [view, range, bounds]);

  const spanMs = Math.max(1, window_.e - window_.s);
  const intervalMs = interval === "auto" ? autoIntervalMs(spanMs) : INTERVAL_MS[interval];

  const data = useMemo(() => {
    const inWindow = all.filter((d) => d.t >= window_.s && d.t <= window_.e);
    const base = inWindow.length >= 2 ? inWindow : all;
    return aggregate(base, intervalMs);
  }, [all, window_, intervalMs]);

  if (all.length < 2) {
    return <p className="sub">Chart appears once the track has some tracked history.</p>;
  }

  const W = 440;
  const H = prefs.showVolume ? 208 : 152;
  const PAD = { l: 6, r: 48, t: 8 };
  const PRICE_H = 116;
  const AXIS_Y = PRICE_H + 14;
  const VOL_LABEL_Y = AXIS_Y + 13;
  const VOL_TOP = AXIS_Y + 17;
  const VOL_H = H - VOL_TOP - 2;

  const t0 = data[0]!.t;
  const t1 = data[data.length - 1]!.t;

  // Momentum = plays gained per day over each interval. Unlike the running
  // total (a counter that can only rise), this genuinely falls when a track
  // goes cold — which is the whole point of showing it.
  const rates = data.map((d, i) => {
    if (i === 0) return 0;
    const prev = data[i - 1]!;
    const days = Math.max((d.t - prev.t) / DAY, 1 / 24);
    return Math.max(0, (d.plays - prev.plays) / days);
  });
  if (rates.length > 1) rates[0] = rates[1]!; // avoid a phantom zero at the left edge

  /**
   * Entry multiple: plays ÷ the baseline you got in at. This is literally the
   * factor the scoring engine scales every event by, so the chart and the
   * ledger agree by construction. Above 1× you're in profit on the call.
   */
  const multiples = benchmark
    ? data.map((d) => d.plays / Math.max(1, benchmark.baselinePlays))
    : null;
  /**
   * Green where the track is still adding plays at a rate that earns —
   * i.e. this interval beat the pick's own average pace so far. No fixed
   * threshold, so it can't be biased by how old the track is.
   */
  const avgRate = rates.reduce((s, r) => s + r, 0) / Math.max(1, rates.length);
  const beating = rates.map((r) => r >= avgRate * 0.5);

  /**
   * "vs pace": actual ÷ expected, so the benchmark is a flat line and every
   * track reads on the same scale whatever its size. Linear gives spikes
   * their full height; log compresses them so 2× above and 2× below sit the
   * same distance from the line. `ratios` stays raw either way — only the
   * plotted values change — so the header reads the same in both.
   */
  const ratios = multiples;
  const logScale = relScale === "log";
  const relValues = ratios ? (logScale ? ratios.map((r) => Math.log2(r)) : ratios) : null;
  /**
   * Log axis: symmetric around the benchmark and sized to THIS window's
   * excursion, so the line always fills the plot instead of hugging one edge
   * inside a fixed domain. The floor stops a track sitting on the benchmark
   * from zooming into meaningless noise.
   */
  const relSpan =
    relValues && logScale
      ? Math.max(0.6, ...relValues.map((v) => Math.abs(v)))
      : 1;

  /**
   * The cumulative benchmark for the TOTAL view: where tier pace would have
   * carried the track from the anchor (your entry if you own a pick, else
   * the left edge). It compounds — `anchor × (1 + rate)^days` — which is a
   * curve on a linear axis and a STRAIGHT LINE on a log one. That's the
   * whole reason to offer a log y-axis: exponential growth plots straight,
   * so "am I keeping pace?" becomes "is my line steeper than the reference?"
   */
  const anchorIdx =
    marker && marker.t >= data[0]!.t
      ? Math.max(0, data.findIndex((d) => d.t >= marker.t))
      : 0;
  const anchorT = data[anchorIdx]?.t ?? t0;
  const anchorPlays = data[anchorIdx]?.plays ?? data[0]!.plays;
  /** In "total" view, mark where you got in as a flat reference line. */
  const idealPlays =
    benchmark && mode === "total" ? data.map(() => benchmark.baselinePlays) : null;
  void anchorT;
  void anchorPlays;

  /** Raw, scale-independent values — what the header always reports. */
  const rawValues =
    mode === "relative" ? (ratios ?? data.map(() => 1)) : mode === "momentum" ? rates : data.map((d) => d.plays);

  const values =
    mode === "relative" && relValues
      ? relValues
      : mode === "momentum"
        ? rates
        : data.map((d) => d.plays);
  const idealPlotted = idealPlays;

  const yMax =
    mode === "relative"
      ? logScale
        ? relSpan
        : Math.max(1.15, ...(relValues ?? [1])) // always leave the 1× line visible
      : Math.max(...values, ...(idealPlotted ?? []));
  const yMin =
    mode === "relative"
      ? logScale
        ? -relSpan
        : 0
      : mode === "momentum"
        ? 0
        : Math.min(...values, ...(idealPlotted ?? []));
  const ySpan = yMax - yMin || 1;
  /** Where the benchmark sits in plotted units: 0 on log, 1 on linear. */
  const benchmarkValue = logScale ? 0 : 1;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / ySpan) * (PRICE_H - PAD.t);

  const volumes = data.map((d, i) => (i === 0 ? 0 : Math.max(0, d.plays - data[i - 1]!.plays)));
  const volMax = Math.max(1, ...volumes);
  const barW = Math.max(1.2, (W - PAD.l - PAD.r) / Math.max(data.length, 1) - 1);

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount }, (_, i) => t0 + ((t1 - t0) * i) / (tickCount - 1));

  // Y ticks, benchmark first so it survives collision pruning. Candidates
  // that would land within a label's height of one already kept are dropped
  // — otherwise a 41× axis stacks "0×" on "1×", and a window entirely below
  // pace stacks the axis top on the benchmark.
  const yTicks: number[] = [];
  const yCandidates =
    mode === "relative" ? [benchmarkValue, yMax, ...(logScale ? [yMin] : [])] : [yMin, yMax];
  for (const v of yCandidates) {
    if (yTicks.every((k) => Math.abs(y(k) - y(v)) > 18)) yTicks.push(v);
  }

  const lastIdx = data.length - 1;
  const focusIdx = hover !== null && hover <= lastIdx ? hover : lastIdx;
  const first = data[0]!;
  const last = data[lastIdx]!;
  const focus = data[focusIdx]!;

  const firstValue = rawValues[0]!;
  const focusValue = rawValues[focusIdx]!;
  const delta = focusValue - firstValue;
  const deltaPct = firstValue > 0 ? (delta / firstValue) * 100 : null;

  /** Is the track still adding plays at a rate worth anything? */
  const onPace = beating[lastIdx] ?? true;
  const up = benchmark ? onPace : delta >= 0;
  const dirColor = up ? "var(--up)" : "var(--down)";

  const pt = (i: number) => `${x(data[i]!.t).toFixed(1)},${y(values[i]!).toFixed(1)}`;
  const fullPath = data.map((_, i) => `${i === 0 ? "M" : "L"}${pt(i)}`).join(" ");

  /**
   * Split the line into runs that are above vs below the benchmark, so each
   * PORTION carries its own color instead of the whole line taking one.
   * Runs overlap by a point so there are no gaps at the crossings.
   */
  const segments: { above: boolean; d: string }[] = [];
  if (multiples && data.length > 1) {
    // Each drawn segment spans points [i-1, i] and takes the state at i.
    const segAbove = data.slice(1).map((_, i) => beating[i + 1]!);
    let run = 0;
    for (let i = 0; i < segAbove.length; i++) {
      if (i === segAbove.length - 1 || segAbove[i] !== segAbove[i + 1]) {
        const pts: string[] = [];
        for (let k = run; k <= i + 1; k++) pts.push(`${k === run ? "M" : "L"}${pt(k)}`);
        segments.push({ above: segAbove[i]!, d: pts.join(" ") });
        run = i + 1; // next run reuses the crossing point → no gap
      }
    }
  }
  const area = `${fullPath} L${x(t1).toFixed(1)},${PRICE_H} L${x(t0).toFixed(1)},${PRICE_H} Z`;

  const valueAt = (t: number): number => {
    if (t <= data[0]!.t) return values[0]!;
    for (let i = 1; i < data.length; i++) {
      const a = data[i - 1]!;
      const b = data[i]!;
      if (t <= b.t) return values[i - 1]! + ((t - a.t) / (b.t - a.t || 1)) * (values[i]! - values[i - 1]!);
    }
    return values[values.length - 1]!;
  };
  const markerVisible = marker !== undefined && marker.t >= t0 && marker.t <= t1;

  // ── zoom / pan ──
  const MIN_SPAN = 2 * 3_600_000; // don't zoom past a 2-hour window
  const clampWindow = (s: number, e: number): { s: number; e: number } => {
    let span = Math.min(Math.max(e - s, MIN_SPAN), bounds.e - bounds.s || MIN_SPAN);
    let start = Math.max(bounds.s, Math.min(s, bounds.e - span));
    return { s: start, e: start + span };
  };
  const timeAtClientX = (clientX: number): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    const f = (clientX - rect.left) / rect.width;
    const px = f * W;
    const frac = (px - PAD.l) / (W - PAD.l - PAD.r);
    return window_.s + Math.min(1, Math.max(0, frac)) * spanMs;
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const anchor = timeAtClientX(e.clientX);
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const newSpan = spanMs * factor;
    const f = (anchor - window_.s) / spanMs;
    setView(clampWindow(anchor - f * newSpan, anchor - f * newSpan + newSpan));
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX });
    svgRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.abs(a!.x - b!.x) || 1, s: window_.s, e: window_.e };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, s: window_.s, e: window_.e, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX });

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.abs(a!.x - b!.x) || 1;
      const startSpan = pinch.current.e - pinch.current.s;
      const newSpan = startSpan * (pinch.current.dist / dist);
      const mid = pinch.current.s + startSpan / 2;
      setView(clampWindow(mid - newSpan / 2, mid + newSpan / 2));
      setHover(null);
      return;
    }

    if (drag.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const dt = ((e.clientX - drag.current.x) / rect.width) * spanMs;
      if (Math.abs(e.clientX - drag.current.x) > 3) drag.current.moved = true;
      setView(clampWindow(drag.current.s - dt, drag.current.e - dt));
      setHover(null);
      return;
    }

    // no button held → scrub the crosshair
    const t = timeAtClientX(e.clientX);
    let best = 0;
    let bestDist = Infinity;
    data.forEach((d, i) => {
      const dist = Math.abs(d.t - t);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHover(best);
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  const zoomed = view !== null;

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-end", marginBottom: 6 }}>
        <div style={{ minWidth: 0 }}>
          {mode === "relative" ? (
            <>
              <div className="num" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>
                {fmtRatio(ratios?.[focusIdx] ?? 1)}×
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)" }}>
                  {" "}since your entry
                </span>
              </div>
              <div className="num" style={{ fontSize: 13, color: dirColor, fontWeight: 700 }}>
                {(ratios?.[focusIdx] ?? 1) >= 1 ? "▲ above" : "▼ below"} the line
                <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
                  {" "}·{" "}
                  {hover !== null
                    ? `${fmtWhen(focus.iso)}${volumes[focusIdx] ? ` · +${fmt(volumes[focusIdx]!)} plays` : ""}`
                    : `${fmt(data[focusIdx]!.plays)} plays vs ${fmt(benchmark?.baselinePlays ?? 0)} at pick`}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="num" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>
                {fmt(Math.round(focusValue))}
                {mode === "momentum" && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)" }}> /day</span>
                )}
              </div>
              <div className="num" style={{ fontSize: 13, color: dirColor, fontWeight: 700 }}>
                {delta >= 0 ? "▲" : "▼"} {delta >= 0 ? "+" : "−"}
                {fmt(Math.round(Math.abs(delta)))}
                {deltaPct !== null && Math.abs(deltaPct) < 100000 && (
                  <> ({deltaPct >= 0 ? "+" : ""}{Math.abs(deltaPct) >= 100 ? Math.round(deltaPct) : deltaPct.toFixed(1)}%)</>
                )}
                <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
                  {" "}·{" "}
                  {hover !== null
                    ? `${fmtWhen(focus.iso)}${volumes[focusIdx] ? ` · +${fmt(volumes[focusIdx]!)}` : ""}`
                    : `${mode === "momentum" ? "pace" : "plays"}, ${zoomed ? "zoomed" : range === "All" ? "all time" : `past ${range}`}`}
                </span>
              </div>
            </>
          )}
          {benchmark && (
            <div
              className="num"
              style={{ fontSize: 12, color: onPace ? "var(--up)" : "var(--down)", fontWeight: 700, marginTop: 2 }}
            >
              {onPace ? "▲ still climbing" : "▼ cooled off"}
            </div>
          )}
        </div>
        <span className="spacer" />
        {zoomed && (
          <button className="btn ghost small" style={{ padding: "4px 10px" }} onClick={() => setView(null)}>
            Reset
          </button>
        )}
      </div>

      <div className="chart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair", touchAction: "none" }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onPointerLeave={(e) => {
            endPointer(e);
            setHover(null);
          }}
          onDoubleClick={() => setView(null)}
          role="img"
          aria-label={
            `${mode === "momentum" ? "Plays per day" : "Total plays"} over time, ` +
            `${fmt(Math.round(firstValue))} to ${fmt(Math.round(values[lastIdx]!))}` +
            (benchmark ? `, currently ${onPace ? "climbing" : "cooled off"}` : "")
          }
        >
          {yTicks.map((v) => {
            const isBenchmark = mode === "relative" && v === benchmarkValue;
            return (
              <g key={v}>
                <line
                  x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)}
                  stroke={isBenchmark ? "var(--text-3)" : "var(--border)"}
                  strokeWidth={isBenchmark ? 1.5 : 1}
                  strokeDasharray={isBenchmark ? "4 4" : undefined}
                  opacity={isBenchmark ? 0.85 : 1}
                />
                <text x={W - PAD.r + 4} y={y(v) + 4} fontSize="10" fill="var(--text-3)">
                  {mode === "relative"
                    ? `${fmtRatio(logScale ? Math.pow(2, v) : v)}×`
                    : fmt(Math.round(v))}
                </text>
              </g>
            );
          })}
          <path d={area} fill={dirColor} opacity="0.07" />
          {/* cumulative benchmark — a straight diagonal on the log axis */}
          {idealPlotted && (
            <path
              d={idealPlotted
                .map((v, i) => `${i === 0 ? "M" : "L"}${x(data[i]!.t).toFixed(1)},${y(v).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke="var(--text-3)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.85"
            />
          )}
          {idealPlotted && (
            <text x={W - PAD.r} y={PAD.t + 8} fontSize="9" fill="var(--text-3)" textAnchor="end">
              ╌ your entry
            </text>
          )}
          {segments.length > 0 ? (
            segments.map((s, i) => (
              <path
                key={i}
                d={s.d}
                fill="none"
                stroke={s.above ? "var(--up)" : "var(--down)"}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))
          ) : (
            <path d={fullPath} fill="none" stroke={dirColor} strokeWidth="2" strokeLinejoin="round" />
          )}
          <circle cx={x(last.t)} cy={y(values[lastIdx]!)} r="3.5" fill={dirColor} />

          <line x1={PAD.l} x2={W - PAD.r} y1={AXIS_Y} y2={AXIS_Y} stroke="var(--border)" strokeWidth="1" />
          {ticks.map((t, i) => (
            <text
              key={t}
              x={i === 0 ? PAD.l : i === ticks.length - 1 ? W - PAD.r : x(t)}
              y={AXIS_Y - 4}
              fontSize="9"
              fill="var(--text-3)"
              textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
            >
              {fmtTick(t, t1 - t0)}
            </text>
          ))}

          {prefs.showVolume && (
            <>
              <text x={PAD.l} y={VOL_LABEL_Y} fontSize="9" fill="var(--text-3)">
                plays added
              </text>
              <text x={W - PAD.r} y={VOL_LABEL_Y} fontSize="9" fill="var(--text-3)" textAnchor="end">
                peak {fmt(volMax)}
              </text>
              {data.map((d, i) =>
                volumes[i]! > 0 ? (
                  <rect
                    key={d.t}
                    x={x(d.t) - barW / 2}
                    y={VOL_TOP + (1 - volumes[i]! / volMax) * VOL_H}
                    width={barW}
                    height={Math.max(1, (volumes[i]! / volMax) * VOL_H)}
                    fill={beating[i] ? "var(--up)" : "var(--down)"}
                    opacity={hover === i ? 0.95 : 0.4}
                    rx="1"
                  />
                ) : null,
              )}
            </>
          )}

          {markerVisible && (
            <g>
              <line
                x1={x(marker.t)} x2={x(marker.t)} y1={PAD.t + 12} y2={PRICE_H}
                stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="2 3"
              />
              <circle
                cx={x(marker.t)} cy={y(valueAt(marker.t))} r="5"
                fill="var(--accent)" stroke="var(--surface)" strokeWidth="2"
              />
              <text
                x={Math.min(x(marker.t) + 5, W - PAD.r - 62)} y={PAD.t + 9}
                fontSize="10" fontWeight="700" fill="var(--accent)"
              >
                ▼ {marker.label}
              </text>
            </g>
          )}
          {hover !== null && (
            <g>
              <line
                x1={x(focus.t)} x2={x(focus.t)} y1={PAD.t} y2={H - 2}
                stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3"
              />
              <circle cx={x(focus.t)} cy={y(focusValue)} r="4.5" fill={dirColor} stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
        </svg>
      </div>

      <div className="tabs" style={{ marginTop: 10, marginBottom: 6 }}>
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={!zoomed && range === r.label ? "on" : ""}
            onClick={() => {
              setView(null);
              setRange(r.label);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
        <span className="sub" style={{ fontSize: 11 }}>View</span>
        {(["total", "momentum", "relative"] as ChartMode[]).map((m) => (
          <button
            key={m}
            className={`chip${mode === m ? " won" : ""}`}
            style={{ cursor: "pointer", background: mode === m ? undefined : "transparent" }}
            onClick={() => setMode(m)}
            disabled={m === "relative" && !benchmark}
          >
            {m === "total" ? "total plays" : m === "momentum" ? "momentum" : "vs entry"}
          </button>
        ))}
        {mode === "relative" && (
          <>
            <span className="sub" style={{ fontSize: 11, marginLeft: 4 }}>Axis</span>
            {(["log", "linear"] as RelativeScale[]).map((s) => (
              <button
                key={s}
                className={`chip${relScale === s ? " won" : ""}`}
                style={{ cursor: "pointer", background: relScale === s ? undefined : "transparent" }}
                onClick={() => setRelScale(s)}
                title={
                  s === "log"
                    ? "Benchmark centred, equal room above and below"
                    : "Scaled to the peak; spikes tower, below-pace crowds the floor"
                }
              >
                {s === "log" ? "centred" : "peak"}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        <span className="sub" style={{ fontSize: 11 }}>Interval</span>
        {INTERVAL_CHOICES.map((key) => (
          <button
            key={key}
            className={`chip${interval === key ? " won" : ""}`}
            style={{ cursor: "pointer", background: interval === key ? undefined : "transparent" }}
            onClick={() => setIntervalKey(key)}
          >
            {key}
          </button>
        ))}
      </div>
      <p className="sub" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
        Scroll or pinch to zoom · drag to pan · double-tap to reset
      </p>
    </div>
  );
}
