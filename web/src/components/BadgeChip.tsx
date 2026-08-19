import { badgeName, type Badge } from "../api.ts";
import { HoverBadge } from "../util.tsx";
import { BadgeMark } from "./BadgeMark.tsx";
import { fmtRarity, rarityFor } from "@firstfan/shared";

/**
 * The status object itself. A pure badge shows its archetype; a hybrid shows
 * its own name (Ascendant, Supernova, Titan…) — the collectible surface.
 */
export function BadgeChip({
  badge,
  second,
  tipLeft,
}: {
  badge: Badge;
  second?: Badge | null;
  tipLeft?: boolean;
}) {
  const m = badgeName(badge, second);
  // Read live from BADGE_RARITY — never snapshotted onto the pick, so correcting
  // a number updates every badge everywhere at once.
  const rarity = rarityFor(badge, second ?? null);
  const rare = !second && (badge === "moonshot" || badge === "juggernaut");
  return (
    <HoverBadge
      icon={<BadgeMark badge={badge} second={second} size={13} title={m.label} />}
      text={m.label}
      kind={rare ? "super" : second ? "early" : undefined}
      tipLeft={tipLeft}
      tip={
        <>
          <b>{m.label}</b> — {m.blurb}{" "}
          {second ? "A hybrid: the run was strongly two things at once." : "A pure badge — rare."}
          {rarity && (
            <>
              {" "}
              <b>Only {fmtRarity(rarity.trackShare)} of tracks</b> ever earn this
              {rarity.source === "estimated" ? " (estimated — real data still landing)." : "."}
            </>
          )}
        </>
      }
    />
  );
}
