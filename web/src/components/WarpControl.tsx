import { useEffect, useState } from "react";
import { api, type ClockData } from "../api.ts";
import { useWorldVersion, worldChanged } from "../util.tsx";

/** Dev-only: drive the simulated clock. This is how the demo comes alive. */
export function WarpControl() {
  const world = useWorldVersion();
  const [clock, setClock] = useState<ClockData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<ClockData>("/api/dev/clock").then(setClock);
  }, [world]);

  const warp = async (days: number) => {
    setBusy(true);
    try {
      await api.post("/api/dev/warp", { days });
      worldChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="warp num" title="Simulated time (dev)">
      <span>day {clock?.simDay ?? "…"}</span>
      <button disabled={busy} onClick={() => void warp(1)}>+1d</button>
      <button disabled={busy} onClick={() => void warp(7)}>+7d</button>
      <button disabled={busy} onClick={() => void warp(30)}>+30d</button>
    </div>
  );
}
