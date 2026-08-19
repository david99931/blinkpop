import type { Badge } from "../api.ts";

/**
 * PLACEHOLDER badge artwork — to be replaced by commissioned marks.
 *
 * Each mark is the SHAPE OF ITS OWN TRAJECTORY: a Flatline is flat, a Riser
 * climbs, a Breakout spikes and settles, a Moonshot hockey-sticks, a Juggernaut
 * is a heavy slab that barely tilts. That keeps the placeholder semantically
 * true rather than arbitrary, and it doubles as the brief for the artist.
 *
 * Five shapes cover fifteen badges. A hybrid draws its PRIMARY solid over its
 * SECONDARY as a ghost, so the ten named hybrids need no bespoke drawings —
 * Supernova genuinely looks like a breakout laid over a moonshot.
 *
 * Nothing downstream should depend on these specific paths.
 */

/** Paths are drawn in a 0 0 40 28 box, baseline y=24, ceiling y=4. */
const SHAPES: Record<Badge, string> = {
  // barely moves, with just enough waver to read as a real series
  flatline: "M3 20 L11 19.4 L19 20.2 L27 19.6 L37 20",
  // steady compounding climb
  riser: "M3 21.5 L11 18.6 L19 15 L27 10.4 L37 5",
  // quiet, one violent week, then a new plateau
  breakout: "M3 21 L13 20.4 L18 19.6 L21 6 L26 7.4 L37 6.6",
  // enormous and nearly level — weight carried by stroke, not slope
  juggernaut: "M3 18 L12 17.2 L21 16.2 L29 15.2 L37 14",
  // nothing, nothing, nothing, then everything
  moonshot: "M3 21.6 L14 21 L22 19.6 L28 15 L32 4",
};

/** Juggernaut reads as mass, so it gets a heavier stroke than the rest. */
const WEIGHT: Partial<Record<Badge, number>> = { juggernaut: 3.6 };

export function BadgeMark({
  badge,
  second,
  size = 20,
  title,
}: {
  badge: Badge;
  second?: Badge | null;
  size?: number;
  title?: string;
}) {
  const label = title ?? (second ? `${badge} and ${second}` : badge);
  return (
    <svg
      viewBox="0 0 40 28"
      width={size * (40 / 28)}
      height={size}
      role="img"
      aria-label={label}
      style={{ display: "block", overflow: "visible" }}
    >
      {/* baseline: the entry price every trajectory is measured from */}
      <line
        x1="3" y1="24" x2="37" y2="24"
        stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.2"
        strokeLinecap="round"
      />
      {second && (
        <path
          d={SHAPES[second]}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth={(WEIGHT[second] ?? 2.2) * 0.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="3 2.5"
        />
      )}
      <path
        d={SHAPES[badge]}
        fill="none"
        stroke="currentColor"
        strokeWidth={WEIGHT[badge] ?? 2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
