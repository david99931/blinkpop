import { useState } from "react";
import { BADGE_ORDER, badgeName, type Badge, type PickView } from "../api.ts";
import { fmtRarity, rarityFor } from "@firstfan/shared";
import { BadgeMark } from "./BadgeMark.tsx";
import { Artwork, fmt, fmtPts } from "../util.tsx";

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
  // Every pick per badge, best first — a slot opens into the full list rather
  // than jumping to one track, so holding three Moonshots is legible as three.
  const owned = new Map<string, PickView[]>();
  for (const p of picks) {
    const k = keyOf(p.badge, p.badgeSecond);
    owned.set(k, [...(owned.get(k) ?? []), p]);
  }
  for (const list of owned.values()) list.sort((a, b) => b.points - a.points);

  const [open, setOpen] = useState<string | null>(null);
  const openList = open ? owned.get(open) : null;

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
              {has && has.length > 1 && (
                <div
                  className="num"
                  style={{ fontSize: 11, textAlign: "center", marginTop: 3, fontWeight: 800 }}
                >
                  ×{has.length}
                </div>
              )}
            </>
          );

          const isOpen = open === slot.key;
          const style: React.CSSProperties = {
            border: `1px solid ${isOpen ? "var(--gold)" : "var(--line)"}`,
            borderRadius: 8,
            padding: "11px 8px 10px",
            background: has ? "var(--bg-2)" : "transparent",
            borderStyle: has ? "solid" : "dashed",
            display: "block",
            width: "100%",
            textAlign: "inherit",
            font: "inherit",
            color: "inherit",
            cursor: has ? "pointer" : "default",
          };

          // Earned slots open the list of picks that earned them; locked ones
          // are inert, but still readable so the goal stays visible.
          return has ? (
            <button
              key={slot.key}
              type="button"
              style={style}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : slot.key)}
              title={`${meta.label} — ${meta.blurb}`}
            >
              {body}
            </button>
          ) : (
            <div key={slot.key} style={style} title={`${meta.label} — not yet called`}>
              {body}
            </div>
          );
        })}
      </div>

      {open && openList && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontWeight: 700 }}>
              {badgeName(
                SLOTS.find((s) => s.key === open)!.primary,
                SLOTS.find((s) => s.key === open)!.second,
              ).label}
              <span className="sub" style={{ fontWeight: 400 }}>
                {" "}· {openList.length} {openList.length === 1 ? "call" : "calls"}
              </span>
            </div>
            <button className="btn small ghost" onClick={() => setOpen(null)}>Close</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {openList.map((p) => (
              <a
                key={p.id}
                className="row"
                href={`#/track/${p.providerTrackId}`}
                style={{
                  gap: 10, alignItems: "center", textDecoration: "none",
                  color: "inherit", padding: "6px 4px", borderRadius: 6,
                }}
              >
                <Artwork id={p.providerTrackId} title={p.title} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {p.title}
                  </div>
                  <div className="sub">
                    {p.artistName}
                    {p.baselinePlays !== null && ` · called at ${fmt(p.baselinePlays)}`}
                  </div>
                </div>
                <div className="num" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                  {fmtPts(p.points)} pts
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
