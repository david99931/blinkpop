import { useMemo, useRef, useState } from "react";
import type { SnapshotPoint } from "../api.ts";
import { fmt } from "../util.tsx";

/**
 * Robinhood-register plays chart: big number + signed delta header that
 * scrubs with the crosshair, range tabs, single 2px line colored by the
 * range's direction (direction is ALSO carried by ▲/▼ and signed text —
 * never color alone). Single series → no legend; the header names it.
 */

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "All", days: Infinity },
] as const;

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Axis tick label: time-of-day when the range is short, otherwise the date. */
function fmtTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs <= 3 * 86_400_000) {
    return d.toLocaleString("en-US", { hour: "numeric", timeZone: "UTC" });
  }
  if (spanMs <= 40 * 86_400_000) {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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
  const all = useMemo(
    () =>
      points
        .filter((p): p is { plays: number; capturedAt: string } => p.plays !== null)
        .map((p) => ({ t: Date.parse(p.capturedAt), plays: p.plays, iso: p.capturedAt }))
        .sort((a, b) => a.t - b.t),
    [points],
  );
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("All");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const data = useMemo(() => {
    const r = RANGES.find((x) => x.label === range)!;
    if (!Number.isFinite(r.days) || all.length === 0) return all;
    const cutoff = all[all.length - 1]!.t - r.days * 86_400_000;
    const inRange = all.filter((d) => d.t >= cutoff);
    return inRange.length >= 2 ? inRange : all;
  }, [all, range]);

  if (all.length < 2) {
    return <p className="sub">Chart appears once the track has some tracked history.</p>;
  }

  // Layout: price panel on top, its own baseline; volume panel below sharing
  // the x-axis (a separate panel, NOT a second y-scale on the price marks).
  const W = 440;
  const H = 208;
  const PAD = { l: 6, r: 48, t: 8, b: 6 };
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

  // Volume = plays added since the previous snapshot ("what happened in this
  // interval"), the surge signal the price line alone hides.
  const volumes = data.map((d, i) => (i === 0 ? 0 : Math.max(0, d.plays - data[i - 1]!.plays)));
  const volMax = Math.max(1, ...volumes);
  const barW = Math.max(1.5, (W - PAD.l - PAD.r) / Math.max(data.length, 1) - 1);

  // ~4 evenly spaced time ticks across the visible range.
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount }, (_, i) => t0 + ((t1 - t0) * i) / (tickCount - 1));

  const first = data[0]!;
  const last = data[data.length - 1]!;
  const focus = hover !== null ? data[hover]! : last;
  const delta = focus.plays - first.plays;
  const deltaPct = first.plays > 0 ? (delta / first.plays) * 100 : null;
  const up = delta >= 0;
  const dirColor = up ? "var(--up)" : "var(--down)";

  const path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(d.t).toFixed(1)},${y(d.plays).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${PRICE_H} L${x(t0).toFixed(1)},${PRICE_H} Z`;

  // Plays on the line at an arbitrary time (linear interpolation) — anchors
  // the pick marker to the curve.
  const playsAt = (t: number): number => {
    if (t <= data[0]!.t) return data[0]!.plays;
    for (let i = 1; i < data.length; i++) {
      const a = data[i - 1]!;
      const b = data[i]!;
      if (t <= b.t) {
        const f = (t - a.t) / (b.t - a.t || 1);
        return a.plays + f * (b.plays - a.plays);
      }
    }
    return data[data.length - 1]!.plays;
  };
  const markerVisible = marker !== undefined && marker.t >= t0 && marker.t <= t1;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    data.forEach((d, i) => {
      const dist = Math.abs(x(d.t) - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-end", marginBottom: 6 }}>
        <div>
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
                ? `${fmtWhen(focus.iso)}${volumes[hover]! > 0 ? ` · +${fmt(volumes[hover]!)} this interval` : ""}`
                : `plays, ${range === "All" ? "all time" : `past ${range}`}`}
            </span>
          </div>
        </div>
        <span className="spacer" />
      </div>

      <div className="chart-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block", cursor: "crosshair" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
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

          {/* time axis, shared by both panels */}
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

          {/* volume panel: plays added per interval */}
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

      <div className="tabs" style={{ marginTop: 10, marginBottom: 0 }}>
        {RANGES.map((r) => (
          <button key={r.label} className={range === r.label ? "on" : ""} onClick={() => setRange(r.label)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
