import { useEffect, useState } from "react";
import { api, type FeedItem } from "../api.ts";
import { Artwork, fmt, fmtDate, fmtPts, useWorldVersion } from "../util.tsx";

function FeedCard({ item }: { item: FeedItem }) {
  return (
    <div className="card feeditem">
      <Artwork id={item.providerTrackId} title={item.title} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="when num">{fmtDate(item.at)}</div>
        {item.kind === "pick" ? (
          <p>
            <a href={`#/u/${item.handle}`}><b>@{item.handle}</b></a> locked in{" "}
            {item.superPick && <b style={{ color: "var(--gold)" }}>⚡ super pick </b>}
            <a href={`#/track/${item.providerTrackId}`}><b>{item.title}</b></a>
            <span className="sub num">
              {" "}— {fmt(item.baselinePlays ?? null)} plays
              {item.tierLabel ? ` · ${item.tierLabel}` : ""}
            </span>
          </p>
        ) : (
          <p>
            <a href={`#/u/${item.handle}`}><b>@{item.handle}</b></a>
            {"'s pick "}
            <a href={`#/track/${item.providerTrackId}`}><b>{item.title}</b></a>{" "}
            {item.eventType === "milestone" ? (
              <>
                crossed <b className="num">{fmt(item.milestoneValue ?? null)}</b> 🚀
              </>
            ) : item.eventType === "early_bird" ? (
              <>paid out the early-bird bonus 🐦</>
            ) : (
              <>had a breakout week 📈</>
            )}{" "}
            <span className={(item.points ?? 0) < 0 ? "delta-down num" : "delta-up num"}>
              {(item.points ?? 0) < 0 ? "" : "+"}
              {fmtPts(item.points ?? 0)} pts
            </span>
          </p>
        )}
        <span className="sub">{item.artistName}</span>
      </div>
    </div>
  );
}

export function Feed() {
  const world = useWorldVersion();
  const [items, setItems] = useState<FeedItem[] | null>(null);

  useEffect(() => {
    void api.get<{ items: FeedItem[] }>("/api/feed").then((d) => setItems(d.items));
  }, [world]);

  if (!items) return <div className="empty">Loading…</div>;
  return (
    <div>
      <h1 className="h1">Feed</h1>
      <div className="stack">
        {items.map((f, i) => (
          <FeedCard key={i} item={f} />
        ))}
        {items.length === 0 && (
          <div className="empty">Follow people to see their calls here.</div>
        )}
      </div>
    </div>
  );
}
