import { useEffect, useState } from "react";
import { api, type LeaderboardData } from "../api.ts";
import { fmtPts, useWorldVersion } from "../util.tsx";

export function Leaderboard({ meId }: { meId: number }) {
  const world = useWorldVersion();
  const [scope, setScope] = useState<"global" | "friends">("global");
  const [period, setPeriod] = useState<"alltime" | "season">("alltime");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const me = meId;

  useEffect(() => {
    void api
      .get<LeaderboardData>(`/api/leaderboard?scope=${scope}&period=${period}`)
      .then(setData);
  }, [scope, period, world]);

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
