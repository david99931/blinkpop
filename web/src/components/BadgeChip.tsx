import { badgeName, type Badge } from "../api.ts";
import { HoverBadge } from "../util.tsx";

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
  const rare = !second && (badge === "moonshot" || badge === "juggernaut");
  return (
    <HoverBadge
      icon={m.icon}
      text={m.label}
      kind={rare ? "super" : second ? "early" : undefined}
      tipLeft={tipLeft}
      tip={
        <>
          <b>{m.label}</b> — {m.blurb}{" "}
          {second ? "A hybrid: the run was strongly two things at once." : "A pure badge — rare."}
        </>
      }
    />
  );
}
