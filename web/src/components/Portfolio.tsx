import { useEffect, useState } from "react";
import { api, type PortfolioData } from "../api.ts";
import { Artwork, fmt, fmtPts, HoverBadge, useWorldVersion, worldChanged } from "../util.tsx";

function PickCard({
  pick,
  pinned,
}: {
  pick: PortfolioData["picks"][number];
  pinned?: boolean;
}) {
  const gained =
    pick.currentPlays !== null && pick.baselinePlays !== null
      ? pick.currentPlays - pick.baselinePlays
      : null;
  const pct =
    gained !== null && pick.baselinePlays! > 0 ? (gained / pick.baselinePlays!) * 100 : null;
  const milestones = pick.events.filter((e) => e.type === "milestone");

  return (
    <a
      className="card"
      href={`#/track/${pick.providerTrackId}`}
      style={pinned ? { borderColor: "var(--gold)" } : undefined}
    >
      {pinned && (
        <div className="sub" style={{ color: "var(--gold)", fontWeight: 700, marginBottom: 8 }}>
          ★ Best call
        </div>
      )}
      <div className="row">
        <Artwork id={pick.providerTrackId} title={pick.title} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pick.title}
          </div>
          <div className="sub">{pick.artistName}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="num" style={{ fontWeight: 800, fontSize: 17 }}>
            {fmtPts(pick.points)} pts
          </div>
          {pick.kind === "super" && (
            <HoverBadge
              icon="⚡"
              text="5×"
              kind="super"
              tip={
                <>
                  <b>Super pick</b> — your weekly 5× swing. Growth, milestones and bonuses on
                  this pick all pay five times over.
                </>
              }
            />
          )}
          <span className="chip">OG #{pick.pickRank}</span>
        </div>
      </div>
      <div className="row num" style={{ marginTop: 10, fontSize: 13, flexWrap: "wrap" }}>
        <span className="sub">
          in at <b style={{ color: "var(--text)" }}>{fmt(pick.baselinePlays)}</b>
        </span>
        <span className="sub">→</span>
        <span>
          now <b>{fmt(pick.currentPlays)}</b>
        </span>
        {pct !== null && pct >= 1 && (
          <span className="delta-up">▲ {pct >= 100 ? Math.round(pct) : pct.toFixed(1)}%</span>
        )}
        <span className="spacer" />
        {pick.status === "expired" && <span className="chip">window closed</span>}
        {pick.tierLabel && <span className="chip">{pick.tierLabel}</span>}
      </div>
      {pick.events.length > 0 && (
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 4 }}>
          {milestones.map((m) => (
            <span key={m.milestoneValue} className="chip won num">
              {fmt(m.milestoneValue!)} ✓
            </span>
          ))}
          {pick.events.some((e) => e.type === "early_bird") && (
            <HoverBadge
              icon="🐦"
              text="early bird"
              kind="early"
              tipLeft
              tip={
                <>
                  <b>Early bird bonus</b> — you were in under 1,000 plays and the track went on
                  to cross a milestone. Paid once, scaled by your tier and pick order.
                </>
              }
            />
          )}
        </div>
      )}
    </a>
  );
}

export function Portfolio({ handle, myHandle }: { handle: string; myHandle: string }) {
  const world = useWorldVersion();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [following, setFollowing] = useState<string[] | null>(null);
  const isMe = handle === myHandle;

  useEffect(() => {
    void api.get<PortfolioData>(`/api/users/${handle}/portfolio`).then(setData);
    if (!isMe) {
      void api.get<{ following: string[] }>("/api/follows/me").then((d) => setFollowing(d.following));
    }
  }, [handle, isMe, world]);

  if (!data) return <div className="empty">Loading…</div>;

  const follows = following?.includes(handle) ?? false;
  const toggleFollow = async () => {
    if (follows) await api.delete(`/api/follows/${handle}`);
    else await api.post("/api/follows", { handle });
    worldChanged();
  };

  const best = data.picks.find((p) => p.id === data.bestPickId) ?? null;
  const rest = data.picks.filter((p) => p.id !== data.bestPickId);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="h1" style={{ marginBottom: 0 }}>@{data.user.handle}</h1>
          <p className="sub">{data.user.displayName}</p>
        </div>
        {!isMe && following !== null && (
          <button className={`btn small${follows ? " ghost" : ""}`} onClick={() => void toggleFollow()}>
            {follows ? "Following ✓" : "Follow"}
          </button>
        )}
      </div>

      <div className="card hero section">
        <div className="v num">{fmtPts(data.totalPoints)}</div>
        <div className="k">total points</div>
      </div>
      <div className="tiles" style={{ marginTop: 8 }}>
        <div className="tile">
          <div className="v num">🔥 {data.currentStreak}</div>
          <div className="k">streak</div>
        </div>
        <div className="tile">
          <div className="v num">{data.longestStreak}</div>
          <div className="k">longest</div>
        </div>
        <div className="tile">
          <div className="v num">{data.picks.length}</div>
          <div className="k">picks</div>
        </div>
      </div>

      <div className="section stack">
        {best && best.points > 0 && <PickCard pick={best} pinned />}
        {rest.map((p) => (
          <PickCard key={p.id} pick={p} />
        ))}
        {data.picks.length === 0 && <div className="empty">No picks yet.</div>}
      </div>
    </div>
  );
}
