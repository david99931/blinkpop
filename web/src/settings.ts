import { useEffect, useState } from "react";

/**
 * Client-side user preferences. Stored in localStorage (per device) — if
 * these ever need to follow a user across devices, move them to a
 * `user_settings` table behind /api/me/settings; the shape here is the
 * contract either way.
 */

export type RangeKey = "1W" | "1M" | "3M" | "All";
export type IntervalKey = "auto" | "1h" | "4h" | "12h" | "1D" | "1W";
/**
 * "total"    = cumulative plays (only ever rises)
 * "momentum" = plays/day (rises AND falls)
 * "relative" = plays ÷ your baseline — the entry multiple, which is exactly
 *              what scales your points. 1× is where you got in.
 */
export type ChartMode = "total" | "momentum" | "relative";

/**
 * Axis for the "vs pace" view. "linear" gives spikes their full height
 * (a 24× week towers over the benchmark); "log" compresses them so that
 * 2× above and 2× below sit the same distance from the centreline.
 */
export type RelativeScale = "linear" | "log";

export interface ChartPrefs {
  defaultRange: RangeKey;
  interval: IntervalKey;
  showVolume: boolean;
  mode: ChartMode;
  relativeScale: RelativeScale;
}

export const DEFAULT_PREFS: ChartPrefs = {
  defaultRange: "All",
  interval: "1D",
  showVolume: true,
  mode: "momentum",
  relativeScale: "log", // benchmark centred — the readable default
};

/** Milliseconds per interval; "auto" is resolved from the visible span. */
export const INTERVAL_MS: Record<Exclude<IntervalKey, "auto">, number> = {
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "12h": 12 * 3_600_000,
  "1D": 86_400_000,
  "1W": 7 * 86_400_000,
};

const KEY = "ff_chart_prefs";
const EVENT = "ff:prefs-changed";

export function getPrefs(): ChartPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ChartPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(patch: Partial<ChartPrefs>): void {
  const next = { ...getPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}

/** Preferences that re-render every consumer when changed anywhere. */
export function usePrefs(): ChartPrefs {
  const [prefs, setState] = useState<ChartPrefs>(getPrefs);
  useEffect(() => {
    const sync = () => setState(getPrefs());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return prefs;
}
