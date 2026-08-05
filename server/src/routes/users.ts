import type { FastifyInstance, FastifyRequest } from "fastify";
import { createUser, DomainError, getUserById, listUsers } from "../domain/users.ts";

/**
 * Phase 1 identity: the client sends `x-user-id`. Real auth (email/password
 * or magic link) replaces this before anything goes multi-user; every route
 * already resolves identity through requireUser() so the swap is localized.
 */
export function requireUser(req: FastifyRequest): { id: number } {
  const raw = req.headers["x-user-id"];
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new DomainError("unauthenticated", "Send x-user-id (Phase 1 dev identity)");
  }
  const user = getUserById(id);
  if (!user) throw new DomainError("unauthenticated", "Unknown user id");
  return user;
}

export function domainErrorToReply(err: unknown): { status: number; body: object } | null {
  if (!(err instanceof DomainError)) return null;
  const status =
    err.code === "unauthenticated" ? 401
    : err.code === "track_not_found" || err.code === "unknown_user" ? 404
    : 409;
  return { status, body: { error: err.code, message: err.message } };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { handle?: string; displayName?: string; email?: string; tz?: string } }>(
    "/api/users",
    async (req, reply) => {
      const { handle, displayName, email, tz } = req.body ?? {};
      if (!handle || !email) {
        return reply.code(400).send({ error: "bad_request", message: "handle and email required" });
      }
      try {
        return createUser({ handle, displayName, email, tz });
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    },
  );

  app.get("/api/users", async () => ({ users: listUsers() }));

  app.get("/api/me", async (req, reply) => {
    try {
      return getUserById(requireUser(req).id);
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });
}
