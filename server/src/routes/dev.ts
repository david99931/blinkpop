/**
 * Dev-only controls for the simulated world (Phase 1). These power the demo
 * loop: pick tracks → warp days → watch scores/feed move.
 */

import type { FastifyInstance } from "fastify";
import { isRealTime, simDay, simNow } from "../sim/clock.ts";
import { warp } from "../sim/warp.ts";
import { seedDemo } from "../sim/seed-demo.ts";
import { activeProviderName } from "../providers/index.ts";
import { getDb } from "../db/db.ts";
import { settleDay } from "../jobs/settle.ts";

export async function devRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dev/clock", async () => ({
    mode: isRealTime() ? "real" : "sim",
    provider: activeProviderName(),
    simDay: isRealTime() ? null : simDay(),
    simTime: simNow().toISOString(),
  }));

  /**
   * Recompute every pick's score events from snapshot history. Needed after a
   * scoring-rules change, since settlement's INSERT OR IGNORE never restates
   * rows that already exist (migration 008 clears them; this rebuilds them).
   */
  app.post("/api/dev/resettle", async () => {
    const before = getDb().prepare("SELECT COUNT(*) AS n FROM score_events").get() as { n: number };
    const result = settleDay(simDay());
    const after = getDb().prepare("SELECT COUNT(*) AS n FROM score_events").get() as { n: number };
    return { picksExamined: result.picksExamined, eventsBefore: before.n, eventsAfter: after.n };
  });

  app.post("/api/dev/seed-demo", async (_req, reply) => {
    try {
      return await seedDemo();
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Body: { days?: number } }>("/api/dev/warp", async (req, reply) => {
    const days = req.body?.days ?? 1;
    try {
      return warp(days);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
