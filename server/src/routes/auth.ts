import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { underdogTierFor } from "@firstfan/shared";
import { deleteLink, getLink, saveLink, validAccessToken } from "../domain/linked-accounts.ts";
import { createUser, DomainError } from "../domain/users.ts";
import {
  assertPasswordStrength,
  createSession,
  destroySession,
  hashPassword,
  login,
} from "../domain/auth.ts";
import {
  authorizeUrl,
  exchangeAuthCode,
  mapTrack,
  refreshUserToken,
  scUserGet,
  soundCloudConfigFromEnv,
  type ScTrack,
  type ScUserTokens,
} from "../providers/soundcloud.ts";
import { domainErrorToReply, requireUser } from "./users.ts";

function redirectUri(): string {
  return (
    process.env.SOUNDCLOUD_REDIRECT_URI ?? "http://localhost:5173/api/auth/soundcloud/callback"
  );
}

/** Pending OAuth handshakes: state → who started it + PKCE verifier. */
const pendingConnects = new Map<string, { userId: number; verifier: string; expiresMs: number }>();

function saveTokens(userId: number, providerUserId: string, displayName: string | null, t: ScUserTokens): void {
  saveLink(userId, "soundcloud", providerUserId, displayName, t);
}

/**
 * Valid SoundCloud access token for this user, refreshing if stale.
 *
 * Storage and the staleness rule live in `linked-accounts`; only the refresh
 * call is SoundCloud-specific, so it is passed in. Spotify will supply its own
 * and reuse everything else.
 */
async function userAccessToken(userId: number): Promise<string | null> {
  return validAccessToken(userId, "soundcloud", async (refreshToken) => {
    const config = soundCloudConfigFromEnv();
    if (!config) throw new Error("soundcloud not configured");
    return refreshUserToken(config, refreshToken);
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { handle?: string; email?: string; password?: string; tz?: string } }>(
    "/api/auth/signup",
    async (req, reply) => {
      try {
        const { handle, email, password, tz } = req.body ?? {};
        if (!handle || !email || !password) {
          return reply
            .code(400)
            .send({ error: "bad_request", message: "handle, email, password required" });
        }
        assertPasswordStrength(password);
        const user = createUser({ handle, email, tz, passwordHash: hashPassword(password) });
        return reply.code(201).send({ user, token: createSession(user.id) });
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    },
  );

  app.post<{ Body: { identifier?: string; password?: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      try {
        const { identifier, password } = req.body ?? {};
        if (!identifier || !password) {
          return reply
            .code(400)
            .send({ error: "bad_request", message: "identifier and password required" });
        }
        return login(identifier, password);
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    },
  );

  app.post("/api/auth/logout", async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) destroySession(header.slice(7));
    return { ok: true };
  });

  // ── SoundCloud account linking ──

  app.get("/api/auth/soundcloud/connect", async (req, reply) => {
    try {
      const user = requireUser(req);
      const config = soundCloudConfigFromEnv();
      if (!config) {
        return reply.code(503).send({ error: "not_configured", message: "SoundCloud credentials missing" });
      }
      const state = randomBytes(16).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      pendingConnects.set(state, { userId: user.id, verifier, expiresMs: Date.now() + 10 * 60_000 });
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      return { url: authorizeUrl(config, redirectUri(), state, challenge) };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/soundcloud/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      const pending = state ? pendingConnects.get(state) : undefined;
      if (state) pendingConnects.delete(state);
      if (error || !code || !pending || pending.expiresMs < Date.now()) {
        return reply.redirect("/#/?sc=error");
      }
      try {
        const config = soundCloudConfigFromEnv()!;
        const tokens = await exchangeAuthCode(config, code, redirectUri(), pending.verifier);
        const me = await scUserGet<{ id: number; username?: string }>("/me", tokens.accessToken);
        saveTokens(pending.userId, String(me.id), me.username ?? null, tokens);
        return reply.redirect("/#/?sc=connected");
      } catch (err) {
        req.log.error(err);
        return reply.redirect("/#/?sc=error");
      }
    },
  );

  app.get("/api/me/soundcloud", async (req, reply) => {
    try {
      const user = requireUser(req);
      const link = getLink(user.id, "soundcloud");
      return link
        ? { connected: true, username: link.displayName, connectedAt: link.connectedAt }
        : { connected: false };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  app.delete("/api/me/soundcloud", async (req, reply) => {
    try {
      const user = requireUser(req);
      deleteLink(user.id, "soundcloud");
      return { disconnected: true };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  /** The user's liked tracks — seed of the suggestions/stats features. */
  app.get("/api/me/soundcloud/likes", async (req, reply) => {
    try {
      const user = requireUser(req);
      const token = await userAccessToken(user.id);
      if (!token) return { connected: false, tracks: [] };
      const raw = await scUserGet<ScTrack[] | { collection: ScTrack[] }>(
        "/me/likes/tracks?limit=12&linked_partitioning=false",
        token,
      );
      const list = Array.isArray(raw) ? raw : (raw.collection ?? []);
      return {
        connected: true,
        tracks: list.map((t) => {
          const mapped = mapTrack(t);
          return {
            ...mapped,
            artistAvgPlays: null,
            tier: mapped.currentPlays === null ? null : underdogTierFor(mapped.currentPlays),
          };
        }),
      };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      req.log.warn(err);
      return { connected: true, tracks: [], error: "likes_unavailable" };
    }
  });
}
