import { BADGE_META, type Badge } from "../api.ts";
import { HoverBadge } from "../util.tsx";

/** The status object itself — icon + name, explaining itself on hover. */
export function BadgeChip({ badge, tipLeft }: { badge: Badge; tipLeft?: boolean }) {
  const m = BADGE_META[badge];
  return (
    <HoverBadge
      icon={m.icon}
      text={m.label}
      kind={badge === "moonshot" || badge === "juggernaut" ? "super" : undefined}
      tipLeft={tipLeft}
      tip={
        <>
          <b>{m.label}</b> — {m.blurb} Scores only compare against other {m.label} picks.
        </>
      }
    />
  );
}
