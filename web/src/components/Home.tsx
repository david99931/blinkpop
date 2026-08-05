import { useEffect, useState } from "react";
import { api, type MyPicks, type SearchResult } from "../api.ts";
import { Artwork, fmt, TierBadge, useWorldVersion } from "../util.tsx";

export function Home({ handle }: { handle: string }) {
  const world = useWorldVersion();
  const [mine, setMine] = useState<MyPicks | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void api.get<MyPicks>("/api/picks/me").then(setMine);
  }, [world]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearching(true);
      api
        .get<{ results: SearchResult[] }>(`/api/tracks/search?q=${encodeURIComponent(q)}`)
        .then((d) => setResults(d.results))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(t);
  }, [q, world]);

  const streak = mine?.picks.length
    ? undefined // streak shown on portfolio; here we show today's state
    : undefined;
  void streak;

  return (
    <div>
      <div className="card hero">
        {mine === null ? (
          <div className="v num">…</div>
        ) : mine.pickedToday ? (
          <>
            <div className="v">✓</div>
            <div className="k">Today's pick is locked</div>
            <p className="sub" style={{ marginTop: 8 }}>
              {mine.superAvailable
                ? "Your ⚡ super pick is still live this week."
                : "Come back tomorrow — or scout what to call next."}
            </p>
          </>
        ) : (
          <>
            <div className="v" style={{ color: "var(--accent)" }}>
              1
            </div>
            <div className="k">Pick available today</div>
            <p className="sub" style={{ marginTop: 8 }}>
              @{handle} — find something nobody's heard yet.
            </p>
          </>
        )}
        {mine !== null && (
          <p style={{ marginTop: 10, marginBottom: 0 }}>
            <span
              className="chip"
              style={mine.superAvailable ? { color: "var(--gold)", borderColor: "var(--gold)" } : undefined}
            >
              ⚡ super pick {mine.superAvailable ? "ready — 5× points" : "used this week"}
            </span>
          </p>
        )}
      </div>

      <div className="section">
        <input
          className="input"
          placeholder="Search tracks or artists…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="sub" style={{ margin: "8px 2px" }}>
          {q ? (searching ? "Searching…" : `Results for “${q}”`) : "Undiscovered — smallest tracks first"}
        </p>
        <div className="stack">
          {results.map((r) => (
            <a key={r.providerTrackId} className="trackrow" href={`#/track/${r.providerTrackId}`}>
              <Artwork id={r.providerTrackId} title={r.title} url={r.artworkUrl} />
              <div className="meta">
                <div className="title">{r.title}</div>
                <div className="artist">{r.artistName}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="plays num">{fmt(r.currentPlays)} plays</div>
                {r.tier && <TierBadge label={r.tier.label} multiplier={r.tier.multiplier} />}
              </div>
            </a>
          ))}
          {results.length === 0 && !searching && <div className="empty">No tracks found.</div>}
        </div>
      </div>
    </div>
  );
}
