import { useEffect, useState } from "react";
import { api, type ListenerProfile, type ListeningStats } from "../api.ts";
import { fmt } from "../util.tsx";

/**
 * Your listening, from the imported Spotify history.
 *
 * Two audiences on one screen. The top half is fun facts for the user. The
 * lower half — concentration, the tail, the seed set — is the shape of their
 * taste, which is what a discovery algorithm has to be designed around. It is
 * on the page rather than hidden in a script because the answer is genuinely
 * surprising and worth looking at with real numbers.
 */

const yearShort = (iso: string): string => new Date(iso).getUTCFullYear().toString();
const monthYear = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function Bar({ share, muted }: { share: number; muted?: boolean }) {
  return (
    <span
      style={{
        display: "block", height: 6, borderRadius: 3,
        background: "var(--surface-3)", overflow: "hidden",
      }}
    >
      <span
        style={{
          display: "block", height: "100%", width: `${Math.min(100, share)}%`,
          background: muted ? "var(--text-3)" : "var(--accent)", borderRadius: 3,
        }}
      />
    </span>
  );
}

export function Stats() {
  const [data, setData] = useState<ListeningStats | null>(null);
  const [profile, setProfile] = useState<ListenerProfile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api.get<ListeningStats>("/api/me/stats").then(setData).catch(() => setFailed(true));
    void api.get<ListenerProfile>("/api/me/listener-profile").then(setProfile).catch(() => setProfile(null));
  }, []);

  if (failed) return <div className="empty">Could not load your listening stats.</div>;
  if (!data) return <div className="empty">Loading…</div>;

  if (!data.imported) {
    return (
      <div>
        <h1 className="h1">Your listening</h1>
        <div className="card section">
          <p style={{ marginTop: 0 }}>
            No Spotify history imported yet. Spotify's API only exposes a top-50 list with no
            counts — your <b>data export</b> has every play since you joined, with dates.
          </p>
          <p className="sub" style={{ marginBottom: 0 }}>
            Request it from Spotify → Privacy Settings → Extended streaming history. It takes a
            few days to arrive.
          </p>
        </div>
      </div>
    );
  }

  const { totals } = data;
  const peakYear = data.byYear.reduce((a, b) => (b.newArtists > a.newArtists ? b : a), data.byYear[0]!);

  return (
    <div>
      <h1 className="h1">Your listening</h1>
      <p className="sub" style={{ marginTop: -6 }}>
        {monthYear(totals.spanStart!)} — {monthYear(totals.spanEnd!)}
      </p>

      <div className="tiles" style={{ marginTop: 10 }}>
        <div className="tile">
          <div className="v num">{Math.round(totals.hours).toLocaleString()}</div>
          <div className="k">hours</div>
        </div>
        <div className="tile">
          <div className="v num">{fmt(totals.tracks)}</div>
          <div className="k">tracks</div>
        </div>
        <div className="tile">
          <div className="v num">{fmt(totals.artists)}</div>
          <div className="k">artists</div>
        </div>
      </div>

      {/* ── fun facts ── */}
      <div className="card section">
        <h2 className="h2">Fun facts</h2>
        {data.loyalties[0] && (
          <p style={{ marginTop: 0 }}>
            You've been listening to <b>{data.loyalties[0].name}</b> since{" "}
            <b>{monthYear(data.loyalties[0].firstPlayed)}</b> — {data.loyalties[0].plays.toLocaleString()}{" "}
            plays and {Math.round(data.loyalties[0].hours)} hours since.
          </p>
        )}
        {data.topArtists[0] && (
          <p>
            <b>{data.topArtists[0].name}</b> has taken more of your life than anyone:{" "}
            <b>{Math.round(data.topArtists[0].hours)} hours</b> across{" "}
            {data.topArtists[0].trackCount} tracks.
          </p>
        )}
        {peakYear && (
          <p style={{ marginBottom: 0 }}>
            <b>{peakYear.year}</b> was your biggest year of discovery —{" "}
            <b>{peakYear.newArtists.toLocaleString()} new artists</b> and{" "}
            {peakYear.newTracks.toLocaleString()} new tracks.
          </p>
        )}
      </div>

      {/* ── top artists ── */}
      <div className="card section">
        <h2 className="h2">Most played artists</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
          {data.topArtists.slice(0, 10).map((a, i) => (
            <div key={a.name}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span className="sub num" style={{ marginRight: 7 }}>{i + 1}</span>
                  <b>{a.name}</b>
                </div>
                <div className="num sub" style={{ whiteSpace: "nowrap" }}>
                  {Math.round(a.hours)}h · since {yearShort(a.firstPlayed)}
                </div>
              </div>
              <div style={{ marginTop: 4 }}>
                <Bar share={(a.hours / data.topArtists[0]!.hours) * 100} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── on repeat ── */}
      <div className="card section">
        <h2 className="h2">On repeat</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
          {data.topTracks.slice(0, 8).map((t) => (
            <div key={t.title + t.artist} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <b>{t.title}</b> <span className="sub">{t.artist}</span>
              </div>
              <div className="num sub" style={{ whiteSpace: "nowrap" }}>
                {t.plays}× · {yearShort(t.firstPlayed)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── discovery rate ── */}
      <div className="card section">
        <h2 className="h2">New artists per year</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {data.byYear.map((y) => {
            const max = Math.max(...data.byYear.map((x) => x.newArtists));
            return (
              <div key={y.year} className="row" style={{ gap: 10, alignItems: "center" }}>
                <span className="num sub" style={{ width: 34 }}>{y.year}</span>
                <span style={{ flex: 1 }}>
                  <Bar share={(y.newArtists / max) * 100} />
                </span>
                <span className="num sub" style={{ width: 42, textAlign: "right" }}>{y.newArtists}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── the shape: what discovery has to work with ── */}
      <div className="card section">
        <h2 className="h2">The shape of your taste</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          How concentrated your listening is — and where the room to explore actually sits.
        </p>

        <div style={{ marginTop: 12 }}>
          <div className="sub" style={{ marginBottom: 6 }}>Share of all listening time</div>
          {data.concentration.map((c) => (
            <div key={c.topN} className="row" style={{ gap: 10, alignItems: "center", marginBottom: 5 }}>
              <span className="num sub" style={{ width: 62 }}>top {c.topN}</span>
              <span style={{ flex: 1 }}><Bar share={c.share} muted /></span>
              <span className="num sub" style={{ width: 44, textAlign: "right" }}>{c.share}%</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="sub" style={{ marginBottom: 6 }}>Artists by how often you played them</div>
          {data.tail.map((t) => (
            <div key={t.bucket} className="row" style={{ gap: 10, alignItems: "center", marginBottom: 5 }}>
              <span className="num sub" style={{ width: 62 }}>{t.bucket}</span>
              <span style={{ flex: 1 }}><Bar share={t.share} muted /></span>
              <span className="num sub" style={{ width: 78, textAlign: "right" }}>
                {t.artists} · {t.share}%
              </span>
            </div>
          ))}
        </div>

        <p className="sub" style={{ marginTop: 14, marginBottom: 0 }}>
          {data.oneAndDone.share}% of your tracks ({fmt(data.oneAndDone.tracks)}) were played exactly
          once. You sample far more than you repeat.
        </p>
      </div>

      {/* ── the profile: what discovery does with all this ── */}
      {profile && (
        <div className="card section">
          <h2 className="h2">Your listener profile</h2>
          <p style={{ marginTop: 0 }}>
            <b>{profile.label}</b>
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
            {(["digging", "breadth", "activity", "mainstream"] as const).map((k) => {
              const a = profile[k];
              return (
                <div key={k}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <span>
                      <b>{k}</b>{" "}
                      {k === "digging" && <span className="sub">— matters most</span>}
                    </span>
                    <span className="num sub">
                      {a.confidence === 0 ? "no data" : a.value.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, opacity: a.confidence === 0 ? 0.3 : 1 }}>
                    <Bar share={a.value * 100} muted={a.confidence === 0} />
                  </div>
                  <div className="sub" style={{ fontSize: 11, marginTop: 3 }}>{a.note}</div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 16, paddingTop: 13, borderTop: "1px solid var(--border)",
            }}
          >
            <div className="sub" style={{ marginBottom: 4 }}>Discovery would start you at</div>
            <div className="num" style={{ fontSize: 19, fontWeight: 800 }}>
              {fmt(profile.targetBand.min)} – {fmt(profile.targetBand.max)} plays
            </div>
            <p className="sub" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
              {profile.reasoning}
            </p>
          </div>
        </div>
      )}

      {/* ── the seed set ── */}
      <div className="card section">
        <h2 className="h2">What we'd search from</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Not your top artists — those are mainstream and already exhausted. These are the ones you
          played enough to mean it, but not so much that there's nothing left: real interest, still
          specific enough to lead somewhere new.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {data.seedArtists.slice(0, 24).map((a) => (
            <span
              key={a.name}
              className="tier"
              title={`${a.plays} plays · first played ${monthYear(a.firstPlayed)}`}
            >
              {a.name} <span className="num sub">{a.plays}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
