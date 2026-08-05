import { useMemo, useRef, useState } from "react";
import type { SnapshotPoint } from "../api.ts";
import { fmt, fmtDate } from "../util.tsx";

/**
 * Single-series plays-over-time line. One hue (accent), 2px stroke, recessive
 * grid, direct label on the latest value, crosshair + tooltip on hover.
 */
export function Sparkline({ points }: { points: SnapshotPoint[] }) {
  const data = useMemo(
    () =>
      points
        .filter((p): p is { plays: number; capturedAt: string } => p.plays !== null)
        .map((p) => ({ t: Date.parse(p.capturedAt), plays: p.plays, iso: p.capturedAt })),
    [points],
  );
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 440;
  const H = 120;
  const PAD = { l: 6, r: 48, t: 10, b: 18 };

  if (data.length < 2) {
    return <p className="sub">Chart appears once the track has a few days of history.</p>;
  }

  const t0 = data[0]!.t;
  const t1 = data[data.length - 1]!.t;
  const yMax = Math.max(...data.map((d) => d.plays));
  const yMin = Math.min(...data.map((d) => d.plays));
  const ySpan = yMax - yMin || 1;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / ySpan) * (H - PAD.t - PAD.b);

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.t).toFixed(1)},${y(d.plays).toFixed(1)}`).join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${H - PAD.b} L${x(t0).toFixed(1)},${H - PAD.b} Z`;
  const last = data[data.length - 1]!;
  const hovered = hover !== null ? data[hover]! : null;

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
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Plays over time, from ${fmt(data[0]!.plays)} to ${fmt(last.plays)}`}
      >
        {/* recessive grid: min & max only */}
        {[yMin, yMax].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={W - PAD.r + 4} y={y(v) + 4} fontSize="10" fill="var(--text-3)">
              {fmt(v)}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--accent)" opacity="0.10" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {/* direct label: latest value */}
        <circle cx={x(last.t)} cy={y(last.plays)} r="3.5" fill="var(--accent)" />
        {hovered && (
          <g>
            <line
              x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.t} y2={H - PAD.b}
              stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3"
            />
            <circle cx={x(hovered.t)} cy={y(hovered.plays)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
        {/* x labels: first & last date */}
        <text x={PAD.l} y={H - 4} fontSize="10" fill="var(--text-3)">{fmtDate(data[0]!.iso)}</text>
        <text x={W - PAD.r} y={H - 4} fontSize="10" fill="var(--text-3)" textAnchor="end">{fmtDate(last.iso)}</text>
      </svg>
      {hovered && (
        <div
          className="chart-tip num"
          style={{ left: `${(x(hovered.t) / W) * 100}%`, top: `${(y(hovered.plays) / H) * 100}%` }}
        >
          <span className="tv">{fmt(hovered.plays)}</span>{" "}
          <span className="tk">plays · {fmtDate(hovered.iso)}</span>
        </div>
      )}
    </div>
  );
}
