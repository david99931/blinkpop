import { useEffect, useState } from "react";
import { api, BADGE_META, BADGE_ORDER, type Badge, type LeaderboardData } from "../api.ts";
import { fmtPts, useWorldVersion } from "../util.tsx";

export function Leaderboard({ meId }: { meId: number }) {
  const world = useWorldVersion();
  const [scope, setScope] = useState<"global" | "friends">("global");
  const [period, setPeriod] = useState<"alltime" | "season">("alltime");
  const [badge, setBadge] = useState<Badge | "all">("all");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const me = meId;

  useEffect(() => {
    const q = badge === "all" ? "" : `&badge=${badge}`;
    void api
      .get<LeaderboardData>(`/api/leaderboard?scope=${scope}&period=${period}${q}`)
      .then(setData);
  }, [scope, period, badge, world]);

  return (
    <div>
      <h1 className="h1">Leaderboard</h1>
      <div className="tabs">
        <button className={scope === "global" ? "on" : ""} onClick={() => setScope("global")}>
          Global
        </button>
        <button className={scope === "friends" ? "on" : ""} onClick={() => setScope("friends")}>
          Friends
        </button>
      </div>
      <div className="tabs">
        <button className={period === "alltime" ? "on" : ""} onClick={() => setPeriod("alltime")}>
          All-time
        </button>
        <button className={period === "season" ? "on" : ""} onClick={() => setPeriod("season")}>
          Season{data?.season ? ` (${data.season})` : ""}
        </button>
      </div>
      <div className="row" style={{ gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          className={`chip${badge === "all" ? " won" : ""}`}
          style={{ cursor: "pointer", background: badge === "all" ? undefined : "transparent" }}
          onClick={() => setBadge("all")}
        >
          all
        </button>
        {BADGE_ORDER.map((b) => (
          <button
            key={b}
            className={`chip${badge === b ? " won" : ""}`}
            style={{ cursor: "pointer", background: badge === b ? undefined : "transparent" }}
            onClick={() => setBadge(b)}
          >
            {BADGE_META[b].icon} {BADGE_META[b].label}
          </button>
        ))}
      </div>
      {badge !== "all" && (
        <p className="sub" style={{ fontSize: 12, marginTop: -4, marginBottom: 12 }}>
          {BADGE_META[badge].blurb} Only {BADGE_META[badge].label} picks count here.
        </p>
      )}
      <div className="card" style={{ padding: 0 }}>
        {data?.rows.map((r) => (
          <a
            key={r.userId}
            className={`lb-row${r.rank === 1 ? " top1" : ""}${r.userId === me ? " me" : ""}`}
            href={`#/u/${r.handle}`}
          >
            <span className="rank num">{r.rank === 1 ? "👑" : r.rank}</span>
            <div className="who">
              <div style={{ fontWeight: 700 }}>@{r.handle}</div>
              <div className="sub num">{r.picks} picks</div>
            </div>
            <span className="pts num">{fmtPts(r.points)}</span>
          </a>
        ))}
        {data && data.rows.length === 0 && <div className="empty">Nobody here yet.</div>}
      </div>
    </div>
  );
}
