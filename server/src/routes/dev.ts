/**
 * Dev-only controls for the simulated world (Phase 1). These power the demo
 * loop: pick tracks → warp days → watch scores/feed move.
 */

import type { FastifyInstance } from "fastify";
import { simDay, simNow } from "../sim/clock.ts";
import { warp } from "../sim/warp.ts";
import { seedDemo } from "../sim/seed-demo.ts";

export async function devRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dev/clock", async () => ({
    simDay: simDay(),
    simTime: simNow().toISOString(),
  }));

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
