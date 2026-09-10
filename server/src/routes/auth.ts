import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { underdogTierFor } from "@firstfan/shared";
import { deleteLink, getLink, listLinks, saveLink } from "../domain/linked-accounts.ts";
import { OAUTH_PROVIDERS } from "../providers/oauth-registry.ts";
import { createUser, DomainError } from "../domain/users.ts";
import {
  assertPasswordStrength,
  createSession,
  destroySession,
  hashPassword,
  login,
} from "../domain/auth.ts";
import { mapTrack, scUserGet, type ScTrack } from "../providers/soundcloud.ts";
import { soundcloudAccessToken } from "../domain/provider-tokens.ts";
import { buildTasteProfile } from "../domain/taste.ts";
import { listeningStats } from "../domain/listening-stats.ts";
import { domainErrorToReply, requireUser } from "./users.ts";

/** Pending OAuth handshakes: state → who started it + PKCE verifier. */
const pendingConnects = new Map<string, { userId: number; verifier: string; expiresMs: number }>();

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

  // ── Account linking, registered once per provider ──
  //
  // Connect / callback / status / disconnect are identical apart from four
  // calls, so they come from OAUTH_PROVIDERS rather than being copy-pasted.
  // A user may hold ANY combination at once — linking one never displaces
  // another, because connected_accounts is keyed (user_id, provider).

  for (const def of OAUTH_PROVIDERS) {
    const { provider, label, redirectFlag } = def;

    app.get(`/api/auth/${provider}/connect`, async (req, reply) => {
      try {
        const user = requireUser(req);
        if (!def.configured()) {
          return reply.code(503).send({ error: "not_configured", message: `${label} credentials missing` });
        }
        const state = randomBytes(16).toString("base64url");
        const verifier = randomBytes(48).toString("base64url");
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        const url = def.authorizeUrl(state, challenge);
        if (!url) {
          return reply.code(501).send({ error: "not_a_redirect_flow", message: `${label} does not use a redirect handshake` });
        }
        pendingConnects.set(state, { userId: user.id, verifier, expiresMs: Date.now() + 10 * 60_000 });
        return { url };
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    });

    app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
      `/api/auth/${provider}/callback`,
      async (req, reply) => {
        const { code, state, error } = req.query;
        const pending = state ? pendingConnects.get(state) : undefined;
        if (state) pendingConnects.delete(state);
        if (error || !code || !pending || pending.expiresMs < Date.now()) {
          return reply.redirect(`/#/?${redirectFlag}=error`);
        }
        try {
          const tokens = await def.exchange(code, pending.verifier);
          const who = await def.identity(tokens.accessToken);
          saveLink(pending.userId, provider, who.id, who.displayName, tokens);
          return reply.redirect(`/#/?${redirectFlag}=connected`);
        } catch (err) {
          req.log.error(err);
          return reply.redirect(`/#/?${redirectFlag}=error`);
        }
      },
    );

    app.get(`/api/me/${provider}`, async (req, reply) => {
      try {
        const user = requireUser(req);
        const link = getLink(user.id, provider);
        return link
          ? { connected: true, username: link.displayName, connectedAt: link.connectedAt }
          : { connected: false };
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    });

    app.delete(`/api/me/${provider}`, async (req, reply) => {
      try {
        const user = requireUser(req);
        deleteLink(user.id, provider);
        return { disconnected: true };
      } catch (err) {
        const mapped = domainErrorToReply(err);
        if (mapped) return reply.code(mapped.status).send(mapped.body);
        throw err;
      }
    });
  }

  /**
   * Listening statistics from the imported Spotify history.
   *
   * Serves the user's fun facts AND the distribution shapes we need to design
   * discovery around — concentration, the tail, and the mid-tail seed set.
   */
  app.get("/api/me/stats", async (req, reply) => {
    try {
      const user = requireUser(req);
      return listeningStats(user.id);
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      req.log.warn(err);
      return reply.code(500).send({ error: "stats_unavailable" });
    }
  });

  /** Every platform this user has linked, for the settings screen. */
  app.get("/api/me/connections", async (req, reply) => {
    try {
      const user = requireUser(req);
      const linked = new Map(listLinks(user.id).map((l) => [l.provider, l]));
      return {
        providers: OAUTH_PROVIDERS.map((d) => ({
          provider: d.provider,
          label: d.label,
          configured: d.configured(),
          connected: linked.has(d.provider),
          username: linked.get(d.provider)?.displayName ?? null,
          connectedAt: linked.get(d.provider)?.connectedAt ?? null,
        })),
      };
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  /** The user's liked SoundCloud tracks — kept for the home screen. */
  app.get("/api/me/soundcloud/likes", async (req, reply) => {
    try {
      const user = requireUser(req);
      const token = await soundcloudAccessToken(user.id);
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

  /**
   * ONE taste profile across every linked account — not a per-provider view.
   *
   * SoundCloud and Spotify describe the same person from different angles, and
   * the useful signal is their union: Spotify brings a rich genre vocabulary
   * over a commercial catalogue, SoundCloud brings the underground this game
   * lives in. Where they AGREE is the strongest evidence of real taste, so
   * overlap is boosted rather than merely deduplicated.
   */
  app.get<{ Querystring: { range?: string } }>("/api/me/taste", async (req, reply) => {
    try {
      const user = requireUser(req);
      const range =
        req.query.range === "short_term" || req.query.range === "long_term"
          ? req.query.range
          : "medium_term";
      return await buildTasteProfile(user.id, range);
    } catch (err) {
      const mapped = domainErrorToReply(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      req.log.warn(err);
      return { linked: [], genres: [], artists: [], tracks: [], overlapArtists: [], error: "taste_unavailable" };
    }
  });
}
