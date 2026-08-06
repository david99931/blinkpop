import type { FastifyInstance, FastifyRequest } from "fastify";
import type { User } from "@firstfan/shared";
import { DomainError, getUserById } from "../domain/users.ts";
import { resolveSession } from "../domain/auth.ts";

/** Resolve the authenticated user from `Authorization: Bearer <token>`. */
export function requireUser(req: FastifyRequest): User {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new DomainError("unauthenticated", "Log in first");
  const user = resolveSession(token);
  if (!user) throw new DomainError("unauthenticated", "Session expired — log in again");
  return user;
}

export function domainErrorToReply(err: unknown): { status: number; body: object } | null {
  if (!(err instanceof DomainError)) return null;
  const status =
    err.code === "unauthenticated" || err.code === "invalid_credentials" ? 401
    : err.code === "track_not_found" || err.code === "unknown_user" ? 404
    : err.code === "weak_password" || err.code === "invalid_handle" ? 400
    : 409;
  return { status, body: { error: err.code, message: err.message } };
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
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
