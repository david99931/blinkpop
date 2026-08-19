/**
 * Third-party account links, for any provider.
 *
 * `connected_accounts` was always keyed `(user_id, provider)` with a generic
 * provider column — it was only the QUERIES that hardcoded 'soundcloud'. This
 * lifts that literal into a parameter so Spotify (and anything after it) needs
 * no migration and no second copy of the token-refresh dance.
 *
 * Refreshing is deliberately injected rather than switched on here: this module
 * knows how to STORE a link and when a token is stale, and nothing about any
 * particular OAuth flow.
 */

import { getDb } from "../db/db.ts";
import { simNow } from "../sim/clock.ts";

/** Providers a user can link. The game provider is separate — see MusicProvider. */
export type LinkProvider = "soundcloud" | "spotify";

export interface LinkTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp, or null when the provider issues non-expiring tokens. */
  expiresAtIso: string | null;
}

export interface LinkedAccount {
  providerUserId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string;
}

interface LinkRow {
  provider_user_id: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  connected_at: string;
}

const toLink = (r: LinkRow): LinkedAccount => ({
  providerUserId: r.provider_user_id,
  displayName: r.display_name,
  accessToken: r.access_token,
  refreshToken: r.refresh_token,
  tokenExpiresAt: r.token_expires_at,
  connectedAt: r.connected_at,
});

export function saveLink(
  userId: number,
  provider: LinkProvider,
  providerUserId: string,
  displayName: string | null,
  t: LinkTokens,
): void {
  getDb()
    .prepare(
      `INSERT INTO connected_accounts
         (user_id, provider, provider_user_id, display_name, access_token,
          refresh_token, token_expires_at, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET
         provider_user_id = excluded.provider_user_id,
         display_name = excluded.display_name,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         token_expires_at = excluded.token_expires_at`,
    )
    .run(
      userId, provider, providerUserId, displayName,
      t.accessToken, t.refreshToken, t.expiresAtIso, simNow().toISOString(),
    );
}

export function getLink(userId: number, provider: LinkProvider): LinkedAccount | null {
  const row = getDb()
    .prepare(
      `SELECT provider_user_id, display_name, access_token, refresh_token,
              token_expires_at, connected_at
         FROM connected_accounts WHERE user_id = ? AND provider = ?`,
    )
    .get(userId, provider) as LinkRow | undefined;
  return row ? toLink(row) : null;
}

export function deleteLink(userId: number, provider: LinkProvider): boolean {
  const res = getDb()
    .prepare("DELETE FROM connected_accounts WHERE user_id = ? AND provider = ?")
    .run(userId, provider);
  return res.changes > 0;
}

/** Which providers this user has linked — for the settings screen. */
export function listLinks(userId: number): { provider: LinkProvider; displayName: string | null; connectedAt: string }[] {
  return getDb()
    .prepare(
      "SELECT provider, display_name, connected_at FROM connected_accounts WHERE user_id = ? ORDER BY connected_at",
    )
    .all(userId) as unknown as { provider: LinkProvider; displayName: string | null; connectedAt: string }[];
}

/** A minute of slack, so a token can't expire mid-request. */
const STALE_MS = 60_000;

/**
 * A usable access token, refreshing first if it is about to expire.
 *
 * `refresh` is supplied by the caller because the OAuth details differ per
 * provider; this function owns only the staleness rule and the write-back.
 * Returns null when there is no link, no refresh token, or the refresh fails —
 * all of which mean the same thing to a caller: ask the user to reconnect.
 */
export async function validAccessToken(
  userId: number,
  provider: LinkProvider,
  refresh: (refreshToken: string) => Promise<LinkTokens>,
): Promise<string | null> {
  const link = getLink(userId, provider);
  if (!link) return null;

  const stale =
    link.tokenExpiresAt !== null && Date.parse(link.tokenExpiresAt) < Date.now() + STALE_MS;
  if (!stale) return link.accessToken;
  if (!link.refreshToken) return null;

  try {
    const fresh = await refresh(link.refreshToken);
    saveLink(userId, provider, link.providerUserId, link.displayName, fresh);
    return fresh.accessToken;
  } catch {
    // A revoked or rotated refresh token is a reconnect prompt, not a crash.
    return null;
  }
}
