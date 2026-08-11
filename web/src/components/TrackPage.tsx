import { useEffect, useState } from "react";
import { api, ApiError, type MyPicks, type TrackPageData } from "../api.ts";
import { Artwork, fmt, fmtDate, fmtPts, HoverBadge, TierBadge, useWorldVersion, worldChanged } from "../util.tsx";
import { BadgeChip } from "./BadgeChip.tsx";
import { StockChart, type ChartMarker } from "./StockChart.tsx";
import { underdogTierFor } from "@firstfan/shared";

function FakePlayer() {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setPos((p) => (p >= 100 ? 0 : p + 2)), 300);
    return () => clearInterval(t);
  }, [playing]);
  return (
    <div className="fake-player">
      <button className="play" onClick={() => setPlaying((p) => !p)} aria-label="Play/pause">
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="bar">
        <i style={{ width: `${pos}%` }} />
      </div>
      <span className="sub num">{playing ? "playing…" : "preview"}</span>
    </div>
  );
}

export function TrackPage({ id }: { id: string }) {
  const world = useWorldVersion();
  const [data, setData] = useState<TrackPageData | null>(null);
  const [mine, setMine] = useState<MyPicks | null>(null);
  const [confirming, setConfirming] = useState<"daily" | "super" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    void api.get<TrackPageData>(`/api/tracks/t/${id}`).then(setData);
    void api.get<MyPicks>("/api/picks/me").then(setMine);
  }, [id, world]);

  if (!data || !mine) return <div className="empty">Loading…</div>;

  const { track, tier } = data;
  const myPick = mine.picks.find((p) => p.providerTrackId === id);
  const alreadyPickedThis = myPick !== undefined;
  const marker: ChartMarker | undefined = myPick
    ? { t: Date.parse(myPick.pickedAt), label: `you · in at ${fmt(myPick.baselinePlays)}` }
    : undefined;

  /**
   * If you own a pick here, judge the track against the tier YOUR pick was
   * locked into — the artist may have grown since, but the scoring engine
   * still uses the average captured at pick time. Otherwise show the tier a
   * new picker would get today.
   */
  const benchmark =
    myPick && myPick.baselinePlays !== null
      ? { baselinePlays: myPick.baselinePlays, label: myPick.tierLabel ?? "" }
      : undefined;
  const canPick = (!mine.pickedToday || mine.superAvailable) && !alreadyPickedThis;
  const earlyBird =
    track.stats.plays !== null && track.stats.plays < 1000
      ? track.stats.plays < 100
        ? "first 100"
        : "first 1k"
      : null;

  const lockIn = async (kind: "daily" | "super") => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/picks", { providerTrackId: id, kind });
      setConfirming(null);
      setLocked(true);
      worldChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Artwork id={id} title={track.title} large url={track.artworkUrl} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="h1" style={{ marginBottom: 2 }}>{track.title}</h1>
          <p className="sub">{track.artistName}</p>
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
            {tier && <TierBadge label={tier.label} multiplier={tier.multiplier} />}
            {earlyBird && (
              <HoverBadge
                icon="🐦"
                text={earlyBird}
                kind="early"
                tip={
                  <>
                    <b>Early bird</b> — this track is still under{" "}
                    {earlyBird === "first 100" ? "100" : "1,000"} plays. Pick it now and you
                    earn a bonus, paid out when it crosses its first milestone.
                  </>
                }
              />
            )}
          </div>
        </div>
      </div>

      <div className="tiles section">
        <div className="tile">
          <div className="v num">{fmt(track.stats.plays)}</div>
          <div className="k">plays</div>
        </div>
        <div className="tile">
          <div className="v num">{fmt(track.stats.likes)}</div>
          <div className="k">likes</div>
        </div>
        <div className="tile">
          <div className="v num">{fmt(track.stats.reposts)}</div>
          <div className="k">reposts</div>
        </div>
      </div>

      <div className="section">
        {data.embed.kind === "widget" && data.embed.embedUrl ? (
          <iframe
            title={`Play ${track.title} on SoundCloud`}
            src={data.embed.embedUrl}
            width="100%"
            height="166"
            style={{ border: "none", borderRadius: 10, display: "block" }}
            allow="autoplay"
          />
        ) : (
          <FakePlayer />
        )}
      </div>

      {data.sparkline.length > 1 && (
        <div className="section card">
          <StockChart
            points={data.sparkline}
            marker={marker}
            benchmark={benchmark}
          />
        </div>
      )}

      <div className="section stack">
        {locked || alreadyPickedThis ? (
          <button className="btn" disabled>
            ✓ {locked ? "Locked in — this one's yours" : "Already in your portfolio"}
          </button>
        ) : (
          <>
            {mine.pickedToday ? (
              <button className="btn" disabled>
                Today's pick already used
              </button>
            ) : (
              <button className="btn" onClick={() => setConfirming("daily")}>
                Lock in today's pick
              </button>
            )}
            {mine.superAvailable && (
              <button
                className="btn ghost"
                style={{ borderColor: "var(--gold)", color: "var(--gold)" }}
                onClick={() => setConfirming("super")}
              >
                ⚡ Use weekly super pick — 5× points
              </button>
            )}
          </>
        )}
        {tier && tier.multiplier <= 0.3 && canPick && (
          <p className="sub" style={{ marginTop: 8, textAlign: "center" }}>
            ⚠ This artist is already popular — low point potential ({tier.multiplier}×).
          </p>
        )}
        {error && <p className="err">{error}</p>}
      </div>

      {data.pickers.length > 0 && (
        <div className="section card" style={{ padding: 0 }}>
          <h2 className="h2" style={{ padding: "14px 14px 0" }}>Early birds</h2>
          <p className="sub" style={{ padding: "0 14px 6px", margin: 0 }}>
            Who got in, where — ranked by points made.
          </p>
          {[...data.pickers]
            .sort((a, b) => b.points - a.points)
            .map((p, i) => {
              const multiple =
                p.baselinePlays !== null && p.baselinePlays > 0 && track.stats.plays !== null
                  ? track.stats.plays / p.baselinePlays
                  : null;
              return (
                <a key={p.rank} className="lb-row" href={`#/u/${p.handle}`}>
                  <span className="rank num" style={i === 0 ? { color: "var(--gold)" } : undefined}>
                    {i === 0 ? "👑" : i + 1}
                  </span>
                  <div className="who">
                    <div className="row" style={{ gap: 5, fontWeight: 700 }}>
                      @{p.handle}
                      {p.baselinePlays !== null && p.baselinePlays < 1000 && (
                        <HoverBadge
                          icon="🐦"
                          kind="early"
                          tipLeft
                          tip={
                            <>
                              <b>Early bird</b> — got in under {p.baselinePlays < 100 ? "100" : "1,000"} plays.
                              Pays a bonus once the track crosses its first milestone.
                            </>
                          }
                        />
                      )}
                      {p.kind === "super" && (
                        <HoverBadge
                          icon="⚡"
                          kind="super"
                          tipLeft
                          tip={
                            <>
                              <b>Super pick</b> — spent their one weekly super pick here.
                              Everything it earns is multiplied 5×.
                            </>
                          }
                        />
                      )}
                    </div>
                    <div className="sub num">
                      in at {fmt(p.baselinePlays)} · {fmtDate(p.pickedAt)} · OG #{p.rank}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ marginBottom: 3 }}><BadgeChip badge={p.badge} /></div>
                    <div className="pts num">{fmtPts(p.points)} pts</div>
                    {multiple !== null && multiple >= 1.01 && (
                      <div className="delta-up num" style={{ fontSize: 12 }}>
                        ▲ {multiple >= 10 ? `${fmt(Math.round(multiple))}×` : `+${Math.round((multiple - 1) * 100)}%`}
                      </div>
                    )}
                  </div>
                </a>
              );
            })}
        </div>
      )}

      {confirming && (
        <div className="modal-back" onClick={() => !busy && setConfirming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{confirming === "super" ? "⚡ Burn this week's super pick?" : "Lock it in?"}</h3>
            <p className="sub">
              <b style={{ color: "var(--text)" }}>{track.title}</b> — {track.artistName}
            </p>
            <div className="card" style={{ margin: "12px 0", background: "var(--surface)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="sub">Your baseline</span>
                <b className="num">{fmt(track.stats.plays)} plays</b>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                <span className="sub">{track.artistName} averages</span>
                <b className="num">{fmt(track.artistAvgPlays)} plays</b>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                <span className="sub">Underdog tier</span>
                {tier ? <TierBadge label={tier.label} multiplier={tier.multiplier} /> : "—"}
              </div>
              {earlyBird && (
                <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                  <span className="sub">Early bird</span>
                  <span className="chip">🐦 {earlyBird}</span>
                </div>
              )}
              {confirming === "super" && (
                <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                  <span className="sub">Super pick</span>
                  <b style={{ color: "var(--gold)" }}>5× on everything</b>
                </div>
              )}
            </div>
            <p className="sub" style={{ marginBottom: 14 }}>
              {confirming === "super" ? (
                <>
                  This is your <b>one super pick this week</b> — it doesn't use today's daily
                  pick, and everything it earns is multiplied 5×.
                </>
              ) : (
                <>This is your <b>one pick for today</b>.</>
              )}{" "}
              Picks are permanent — they can never be edited or deleted, and this track is spent
              for you forever. Points accrue for 180 days from everything it crosses{" "}
              <i>after</i> this moment.
            </p>
            <button className="btn" disabled={busy} onClick={() => void lockIn(confirming)}>
              {busy ? "Locking…" : confirming === "super" ? "⚡ I'm sure — go super" : "I'm sure — lock it in"}
            </button>
            <button
              className="btn ghost"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              Not yet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
