import { useEffect, useState } from "react";
import { api, type DiscoveryData } from "../api.ts";
import { Artwork, fmt } from "../util.tsx";

/**
 * Discovery — tracks small enough to still be worth calling.
 *
 * The reach dial is the whole interface. It is a RISK control rather than a
 * mood one: Moonshot needs 256x growth, so where you start decides which badges
 * are reachable at all. Comfort makes a Moonshot roughly 53x harder than
 * Uncharted, and that cost is shown on every option rather than buried.
 *
 * Refresh is explicit. A full run is ~57 SoundCloud calls and half a minute, so
 * it must never fire as a side effect of opening the page.
 */

const REACH_ORDER = ["comfort", "balanced", "digging", "uncharted"] as const;

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function Discover() {
  const [reach, setReach] = useState<string>("balanced");
  const [data, setData] = useState<DiscoveryData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    void api
      .get<DiscoveryData>(`/api/discover?reach=${reach}`)
      .then(setData)
      .catch(() => setError("Could not load discovery."));
  }, [reach]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const fresh = await api.post<DiscoveryData>(`/api/discover/refresh?reach=${reach}`, {});
      setData((prev) => (prev ? { ...fresh, profile: prev.profile } : fresh));
    } catch {
      setError("Refresh failed — SoundCloud may be unreachable.");
    } finally {
      setBusy(false);
    }
  };

  const option = data?.profile.reachOptions.find((o) => o.mode === reach);

  return (
    <div>
      <h1 className="h1">Discover</h1>
      <p className="sub" style={{ marginTop: -6 }}>
        Tracks small enough that calling them still counts for something.
      </p>

      {/* ── the dial ── */}
      <div className="card section">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <b>How deep?</b>
          {option && (
            <span className="num sub">
              {fmt(option.band.min)} – {fmt(option.band.max)} plays
            </span>
          )}
        </div>

        <div
          style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginTop: 10,
          }}
        >
          {REACH_ORDER.map((m) => {
            const o = data?.profile.reachOptions.find((x) => x.mode === m);
            const active = m === reach;
            return (
              <button
                key={m}
                onClick={() => setReach(m)}
                style={{
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-2)",
                  borderRadius: 8, padding: "8px 4px", font: "inherit",
                  fontWeight: active ? 700 : 400, fontSize: 12,
                }}
              >
                {o?.label ?? m}
              </button>
            );
          })}
        </div>

        {option && (
          <>
            <p className="sub" style={{ fontSize: 12.5, marginTop: 10, marginBottom: 6 }}>
              {option.blurb}
            </p>
            <div
              className="sub num"
              style={{ fontSize: 11.5, paddingTop: 8, borderTop: "1px solid var(--border)" }}
            >
              A Moonshot from here needs <b>{fmt(option.moonshotNeeds)}</b> plays
            </div>
          </>
        )}
      </div>

      {/* ── results ── */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span className="sub">
          {data?.computedAt
            ? `${data.candidates.length} found · ${timeAgo(data.computedAt)}`
            : "Nothing found yet"}
        </span>
        <button className="btn small" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Searching…" : data?.computedAt ? "Refresh" : "Find tracks"}
        </button>
      </div>

      {busy && (
        <p className="sub" style={{ marginTop: 8 }}>
          Walking artist catalogues — this takes about half a minute.
        </p>
      )}
      {error && <div className="empty" style={{ marginTop: 10 }}>{error}</div>}

      {data && !data.candidates.length && !busy && !error && (
        <div className="card section" style={{ marginTop: 10 }}>
          <p style={{ marginTop: 0, marginBottom: 0 }}>
            Nothing cached for this depth yet — hit <b>Find tracks</b>.
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {data?.candidates.slice(0, 60).map((c) => (
          <a
            key={c.providerTrackId}
            className="card"
            href={c.permalinkUrl ?? `#/track/${c.providerTrackId}`}
            target={c.permalinkUrl ? "_blank" : undefined}
            rel={c.permalinkUrl ? "noreferrer" : undefined}
            style={{ display: "block", padding: 11 }}
          >
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              <Artwork id={c.providerTrackId} title={c.title} url={c.artworkUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {c.title}
                </div>
                <div className="sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.artistName}
                  {c.genre && <> · {c.genre}</>}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontWeight: 700 }}>{fmt(c.plays)}</div>
                <div className="sub num" style={{ fontSize: 11 }}>
                  {(c.score * 100).toFixed(1)}% liked
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>

      {data && data.provenance.length > 0 && (
        <p className="sub" style={{ fontSize: 11, marginTop: 14 }}>
          Found via{" "}
          {data.provenance.map((p) => `${p.source} ${p.count}`).join(" · ")} — {data.apiCalls} API
          calls. <b>new</b> means an artist you've never played.
        </p>
      )}
    </div>
  );
}
