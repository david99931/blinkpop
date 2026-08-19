/**
 * Regression: a pick whose FIRST classification is a flatline-primary hybrid
 * must keep its secondary.
 *
 * `picks.badge` defaults to 'flatline' with a null secondary, which is exactly
 * what an already-earned pure Flatline looks like. The sticky-purity guard in
 * settlement therefore mistook "never classified" for "earned pure", stripped
 * the secondary, and — because purity is sticky — locked it that way forever.
 *
 * The cost was real: Bolt (flatline+moonshot) became unearnable outright, since
 * moonshot's affinity can never clear minTopAffinity while flatline is still
 * non-zero, so flatline is always its primary. Ember and One Hit degraded to
 * pure Flatline whenever flatline happened to lead.
 */

import { beforeEach, describe, expect, it } from "vitest";

process.env.FIRSTFAN_DB = ":memory:";

const { migrate } = await import("../src/db/migrate.ts");
const { getDb } = await import("../src/db/db.ts");
const { settleDay } = await import("../src/jobs/settle.ts");
const { classifyByAffinity, trajectorySignals } = await import("../src/scoring/badges.ts");

const DAY = 86_400_000;

/**
 * A run that classifies as a flatline-primary hybrid: ~1.1 doublings puts
 * flatline just above minTopAffinity while moonshot sits close behind, and the
 * coarse steps keep sustain low enough that riser doesn't take the lead.
 */
function bolt(startMs: number): { plays: number; capturedAt: string }[] {
  const baseline = 2_000;
  const total = Math.round(baseline * (2.14 - 1));
  const pts: { plays: number; capturedAt: string }[] = [];
  for (let t = 0; t <= 180; t++) {
    const frac = Math.floor((t / 180) * 4) / 4; // four coarse steps
    pts.push({ plays: Math.round(baseline + total * frac), capturedAt: new Date(startMs + t * DAY).toISOString() });
  }
  return pts;
}

function seedPick(): { pickId: number; expected: { primary: string; secondary: string | null } } {
  const db = getDb();
  const start = Date.now() - 220 * DAY;
  const pts = bolt(start);

  const userId = Number(
    (db
      .prepare("INSERT INTO users (handle, display_name, email, tz, created_at) VALUES (?,?,?,?,?) RETURNING id")
      .get("bolt", "Bolt", "bolt@t.dev", "UTC", new Date(start).toISOString()) as { id: number }).id,
  );
  const trackId = Number(
    (db
      .prepare("INSERT INTO tracks (provider, provider_track_id, title, artist_name, first_seen_at) VALUES (?,?,?,?,?) RETURNING id")
      .get("mock", "bolt-1", "Bolt", "Artist", new Date(start).toISOString()) as { id: number }).id,
  );

  let baselineSnapId = 0;
  const insSnap = db.prepare(
    "INSERT INTO track_snapshots (track_id, plays, likes, reposts, captured_at) VALUES (?,?,?,?,?) RETURNING id",
  );
  for (const p of pts) {
    const id = Number((insSnap.get(trackId, p.plays, 0, 0, p.capturedAt) as { id: number }).id);
    if (!baselineSnapId) baselineSnapId = id;
  }

  const pickedAt = new Date(start).toISOString();
  const pickId = Number(
    (db
      .prepare(
        `INSERT INTO picks (user_id, track_id, picked_at, pick_date, pick_week, kind,
                            baseline_snapshot_id, pick_rank, expires_at, status, artist_avg_plays)
         VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      )
      .get(
        userId, trackId, pickedAt, pickedAt.slice(0, 10), "2026-W01", "daily",
        baselineSnapId, 1, new Date(start + 180 * DAY).toISOString(), "expired", 2_000,
      ) as { id: number }).id,
  );

  const signals = trajectorySignals(2_000, pickedAt, new Date(start + 180 * DAY).toISOString(), pts);
  const c = classifyByAffinity(signals);
  return { pickId, expected: { primary: c.primary, secondary: c.secondary } };
}

describe("first classification of a flatline-primary hybrid", () => {
  beforeEach(() => {
    migrate();
    const db = getDb();
    for (const t of ["score_events", "notifications", "picks", "track_snapshots", "tracks", "streaks", "users"]) {
      db.exec(`DELETE FROM ${t}`);
    }
  });

  it("is a hybrid before settlement even runs", () => {
    const { expected } = seedPick();
    // Guards the fixture itself: if tuning ever makes this run pure, the test
    // below would pass for the wrong reason.
    expect(expected.primary).toBe("flatline");
    expect(expected.secondary).not.toBeNull();
  });

  it("keeps its secondary through the first settlement", () => {
    const { pickId, expected } = seedPick();
    settleDay(0);
    const row = getDb()
      .prepare("SELECT badge, badge_second FROM picks WHERE id = ?")
      .get(pickId) as { badge: string; badge_second: string | null };

    expect(row.badge).toBe(expected.primary);
    expect(row.badge_second).toBe(expected.secondary);
  });

  it("stays a hybrid when settlement is re-run", () => {
    const { pickId, expected } = seedPick();
    settleDay(0);
    settleDay(0); // idempotent — and must not strip the secondary on pass two
    const row = getDb()
      .prepare("SELECT badge, badge_second FROM picks WHERE id = ?")
      .get(pickId) as { badge: string; badge_second: string | null };

    expect(row.badge_second).toBe(expected.secondary);
  });
});
