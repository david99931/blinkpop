import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Artwork, fmt, useWorldVersion } from "../util.tsx";
import { MiniSpark } from "./StockChart.tsx";

interface TrendingItem {
  providerTrackId: string;
  title: string;
  artistName: string;
  artworkUrl: string | null;
  currentPlays: number | null;
  deltaPlays: number;
  deltaPct: number | null;
  pickersTotal: number;
  pickersRecent: number;
  sparkline: { plays: number; capturedAt: string }[];
}

function pct(p: number): string {
  return `${Math.abs(p) >= 100 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1)}%`;
}

export function Trending() {
  const world = useWorldVersion();
  const [data, setData] = useState<{ windowDays: number; items: TrendingItem[] } | null>(null);

  useEffect(() => {
    void api.get<{ windowDays: number; items: TrendingItem[] }>("/api/trending").then(setData);
  }, [world]);

  if (!data) return <div className="empty">Loading…</div>;

  return (
    <div>
      <h1 className="h1">Trending</h1>
      <p className="sub" style={{ marginBottom: 12 }}>
        What players are calling — ranked by picks in the last {data.windowDays} days.
      </p>
      <div className="stack">
        {data.items.map((t, i) => {
          const up = t.deltaPlays >= 0;
          return (
            <a key={t.providerTrackId} className="trackrow" href={`#/track/${t.providerTrackId}`}>
              <span className="rank num" style={{ width: 22, color: i === 0 ? "var(--gold)" : "var(--text-3)", fontWeight: 700 }}>
                {i + 1}
              </span>
              <Artwork id={t.providerTrackId} title={t.title} url={t.artworkUrl} />
              <div className="meta">
                <div className="title">{t.title}</div>
                <div className="artist" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.artistName}
                </div>
                <div className="sub num" style={{ fontSize: 11 }}>
                  {t.pickersRecent > 0
                    ? `🔥 ${t.pickersRecent} pick${t.pickersRecent === 1 ? "" : "s"} this week`
                    : `${t.pickersTotal} picker${t.pickersTotal === 1 ? "" : "s"} all-time`}
                </div>
              </div>
              <MiniSpark points={t.sparkline} up={up} />
              <div style={{ textAlign: "right", minWidth: 56 }}>
                <div className="plays num" style={{ fontWeight: 700, color: "var(--text)" }}>
                  {fmt(t.currentPlays)}
                </div>
                <div className={`num ${up ? "delta-up" : "delta-down"}`} style={{ fontSize: 12 }}>
                  {up ? "▲" : "▼"} {t.deltaPct === null ? fmt(Math.abs(t.deltaPlays)) : pct(t.deltaPct)}
                </div>
              </div>
            </a>
          );
        })}
        {data.items.length === 0 && (
          <div className="empty">Nothing trending yet — trends appear once people start picking.</div>
        )}
      </div>
    </div>
  );
}
