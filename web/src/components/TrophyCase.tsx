import { BADGE_ORDER, badgeName, type Badge, type PickView } from "../api.ts";
import { fmtRarity, rarityFor } from "@firstfan/shared";
import { BadgeMark } from "./BadgeMark.tsx";

/**
 * The collection surface — every badge that EXISTS, not just the ones you have.
 *
 * Showing the locked slots is the point: a shelf of five things you own is a
 * summary, whereas fifteen slots with gaps in them is a collection, and the
 * gaps are what make the rare ones worth chasing. Rarity is read live from
 * BADGE_RARITY, so a corrected number moves every slot at once.
 *
 * Built entirely from `picks` — badge and badgeSecond are already on every
 * pick, so the collection needs no extra endpoint.
 */

/** A pure badge keys on its own name; a hybrid on its sorted pair. */
function keyOf(primary: Badge, second: Badge | null): string {
  return second ? [primary, second].sort().join("|") : primary;
}

/** Every badge in the game, commonest first, so the rare ones read as the goal. */
function allSlots(): { key: string; primary: Badge; second: Badge | null }[] {
  const slots: { key: string; primary: Badge; second: Badge | null }[] = BADGE_ORDER.map((b) => ({
    key: b,
    primary: b,
    second: null,
  }));
  for (let i = 0; i < BADGE_ORDER.length; i++) {
    for (let j = i + 1; j < BADGE_ORDER.length; j++) {
      const a = BADGE_ORDER[i]!, b = BADGE_ORDER[j]!;
      slots.push({ key: [a, b].sort().join("|"), primary: b, second: a });
    }
  }
  return slots.sort(
    (x, y) => (rarityFor(y.primary, y.second)?.trackShare ?? 0) -
      (rarityFor(x.primary, x.second)?.trackShare ?? 0),
  );
}

const SLOTS = allSlots();

export function TrophyCase({ picks }: { picks: PickView[] }) {
  // count + the highest-scoring pick that earned each badge
  const owned = new Map<string, { count: number; best: PickView }>();
  for (const p of picks) {
    const k = keyOf(p.badge, p.badgeSecond);
    const cur = owned.get(k);
    if (!cur) owned.set(k, { count: 1, best: p });
    else owned.set(k, { count: cur.count + 1, best: p.points > cur.best.points ? p : cur.best });
  }

  const collected = SLOTS.filter((s) => owned.has(s.key)).length;

  return (
    <div className="card section">
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}
      >
        <div
          className="k"
          style={{
            fontSize: 11, color: "var(--text-3)",
            letterSpacing: "0.08em", textTransform: "uppercase",
          }}
        >
          Trophy case
        </div>
        <div className="num sub" style={{ fontSize: 12 }}>
          {collected} of {SLOTS.length} collected
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
          gap: 8,
          marginTop: 12,
        }}
      >
        {SLOTS.map((slot) => {
          const has = owned.get(slot.key);
          const meta = badgeName(slot.primary, slot.second);
          const rarity = rarityFor(slot.primary, slot.second);
          const body = (
            <>
              <div
                style={{
                  display: "flex", justifyContent: "center",
                  color: has ? "var(--text-1)" : "var(--text-3)",
                  opacity: has ? 1 : 0.35,
                }}
              >
                <BadgeMark badge={slot.primary} second={slot.second} size={26} title={meta.label} />
              </div>
              <div
                style={{
                  fontWeight: 700, fontSize: 12, textAlign: "center",
                  marginTop: 7, opacity: has ? 1 : 0.4,
                }}
              >
                {meta.label}
              </div>
              <div
                className="sub num"
                style={{ fontSize: 10, textAlign: "center", marginTop: 2 }}
              >
                {rarity ? fmtRarity(rarity.trackShare) : "—"} of tracks
              </div>
              {has && has.count > 1 && (
                <div
                  className="num"
                  style={{ fontSize: 11, textAlign: "center", marginTop: 3, fontWeight: 800 }}
                >
                  ×{has.count}
                </div>
              )}
            </>
          );

          const style: React.CSSProperties = {
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "11px 8px 10px",
            background: has ? "var(--bg-2)" : "transparent",
            borderStyle: has ? "solid" : "dashed",
            display: "block",
            textDecoration: "none",
            color: "inherit",
          };

          // Earned slots link to the pick that earned them; locked ones are inert.
          return has ? (
            <a
              key={slot.key}
              href={`#/track/${has.best.providerTrackId}`}
              style={style}
              title={`${meta.label} — ${meta.blurb}`}
            >
              {body}
            </a>
          ) : (
            <div key={slot.key} style={style} title={`${meta.label} — not yet called`}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
