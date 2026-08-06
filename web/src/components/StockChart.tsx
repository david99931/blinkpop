import { useEffect, useMemo, useRef, useState } from "react";
import type { SnapshotPoint } from "../api.ts";
import { fmt } from "../util.tsx";
import { INTERVAL_MS, usePrefs, type IntervalKey, type RangeKey } from "../settings.ts";

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

export function StockChart({ points, marker }: { points: SnapshotPoint[]; marker?: ChartMarker }) {
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
  const yMax = Math.max(...data.map((d) => d.plays));
  const yMin = Math.min(...data.map((d) => d.plays));
  const ySpan = yMax - yMin || 1;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / ySpan) * (PRICE_H - PAD.t);

  const volumes = data.map((d, i) => (i === 0 ? 0 : Math.max(0, d.plays - data[i - 1]!.plays)));
  const volMax = Math.max(1, ...volumes);
  const barW = Math.max(1.2, (W - PAD.l - PAD.r) / Math.max(data.length, 1) - 1);

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount }, (_, i) => t0 + ((t1 - t0) * i) / (tickCount - 1));

  const first = data[0]!;
  const last = data[data.length - 1]!;
  const focus = hover !== null ? data[hover] ?? last : last;
  const delta = focus.plays - first.plays;
  const deltaPct = first.plays > 0 ? (delta / first.plays) * 100 : null;
  const up = delta >= 0;
  const dirColor = up ? "var(--up)" : "var(--down)";

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.t).toFixed(1)},${y(d.plays).toFixed(1)}`).join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${PRICE_H} L${x(t0).toFixed(1)},${PRICE_H} Z`;

  const playsAt = (t: number): number => {
    if (t <= data[0]!.t) return data[0]!.plays;
    for (let i = 1; i < data.length; i++) {
      const a = data[i - 1]!;
      const b = data[i]!;
      if (t <= b.t) return a.plays + ((t - a.t) / (b.t - a.t || 1)) * (b.plays - a.plays);
    }
    return data[data.length - 1]!.plays;
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
          <div className="num" style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>
            {fmt(focus.plays)}
          </div>
          <div className="num" style={{ fontSize: 13, color: dirColor, fontWeight: 700 }}>
            {up ? "▲" : "▼"} {delta >= 0 ? "+" : "−"}
            {fmt(Math.abs(delta))}
            {deltaPct !== null && (
              <> ({deltaPct >= 0 ? "+" : ""}{Math.abs(deltaPct) >= 100 ? Math.round(deltaPct) : deltaPct.toFixed(1)}%)</>
            )}
            <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
              {" "}·{" "}
              {hover !== null
                ? `${fmtWhen(focus.iso)}${volumes[hover] ? ` · +${fmt(volumes[hover]!)}` : ""}`
                : zoomed
                  ? "plays, zoomed"
                  : `plays, ${range === "All" ? "all time" : `past ${range}`}`}
            </span>
          </div>
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
          aria-label={`Plays over time, ${fmt(first.plays)} to ${fmt(last.plays)}`}
        >
          {[yMin, yMax].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
              <text x={W - PAD.r + 4} y={y(v) + 4} fontSize="10" fill="var(--text-3)">
                {fmt(v)}
              </text>
            </g>
          ))}
          <path d={area} fill={dirColor} opacity="0.08" />
          <path d={path} fill="none" stroke={dirColor} strokeWidth="2" strokeLinejoin="round" />
          <circle cx={x(last.t)} cy={y(last.plays)} r="3.5" fill={dirColor} />

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
                    fill={dirColor}
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
                cx={x(marker.t)} cy={y(playsAt(marker.t))} r="5"
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
              <circle cx={x(focus.t)} cy={y(focus.plays)} r="4.5" fill={dirColor} stroke="var(--surface)" strokeWidth="2" />
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
