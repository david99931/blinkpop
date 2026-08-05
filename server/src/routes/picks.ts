import type { FastifyInstance } from "fastify";
import { isoWeekOf, listPicksForUser, localDate, makePick } from "../domain/picks.ts";
import { simNow } from "../sim/clock.ts";
import { domainErrorToReply, requireUser } from "./users.ts";
import { getUserById } from "../domain/users.ts";

export async function pickRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { providerTrackId?: string; kind?: string } }>(
    "/api/picks",
    async (req, reply) => {
      try {
        const user = requireUser(req);
        const providerTrackId = req.body?.providerTrackId;
        if (!providerTrackId) {
          return reply.code(400).send({ error: "bad_request", message: "providerTrackId required" });
        }
        const kind = req.body?.kind ?? "daily";
        if (kind !== "daily" && kind !== "super") {
          return reply.code(400).send({ error: "bad_request", message: "kind must be daily|super" });
        }
        const pick = await makePick(user.id, providerTrackId, kind);
        return reply.code(201).send(pick);
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    },
  );

  app.get("/api/picks/me", async (req, reply) => {
    try {
      const user = requireUser(req);
      const full = getUserById(user.id)!;
      const today = localDate(simNow(), full.tz);
      const thisWeek = isoWeekOf(today);
      const picks = listPicksForUser(user.id);
      return {
        picks,
        pickedToday: picks.some((p) => p.kind === "daily" && p.pickDate === today),
        superAvailable: !picks.some((p) => p.kind === "super" && p.pickWeek === thisWeek),
        today,
        week: thisWeek,
      };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });
}
