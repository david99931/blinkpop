/**
 * What the account-linking routes need to know about a platform.
 *
 * Connect, callback, status and disconnect are identical for every provider
 * apart from four calls, so they are registered once from this list rather than
 * copy-pasted per platform. Adding one means adding an entry here — the route
 * layer never learns how many exist.
 *
 * Not every platform is OAuth2. Apple Music's MusicKit issues a long-lived user
 * token with no refresh and no authorization-code exchange, so `beginAuth` is
 * allowed to return null to mean "this one is not a redirect flow" and its
 * routes are skipped. The storage layer already copes: refresh_token and
 * token_expires_at are both nullable.
 */

import type { LinkProvider, LinkTokens } from "../domain/linked-accounts.ts";
import {
  authorizeUrl as scAuthorizeUrl,
  exchangeAuthCode as scExchange,
  scUserGet,
  soundCloudConfigFromEnv,
} from "./soundcloud.ts";
import {
  authorizeUrl as spAuthorizeUrl,
  currentUser as spCurrentUser,
  exchangeAuthCode as spExchange,
  spotifyConfigFromEnv,
} from "./spotify.ts";

export interface OAuthProviderDef {
  provider: LinkProvider;
  /** Human name for messages. */
  label: string;
  /** False when credentials are missing — routes then answer 503, not 500. */
  configured(): boolean;
  /** Null when this platform does not use a redirect handshake at all. */
  authorizeUrl(state: string, codeChallenge: string): string | null;
  exchange(code: string, verifier: string): Promise<LinkTokens>;
  /** Who just linked — provider-side id and a display name. */
  identity(accessToken: string): Promise<{ id: string; displayName: string | null }>;
  /** Query flag on the redirect back to the app, e.g. `?sc=connected`. */
  redirectFlag: string;
}

function soundcloudRedirectUri(): string {
  return (
    process.env.SOUNDCLOUD_REDIRECT_URI ?? "http://localhost:5173/api/auth/soundcloud/callback"
  );
}

export const OAUTH_PROVIDERS: OAuthProviderDef[] = [
  {
    provider: "soundcloud",
    label: "SoundCloud",
    redirectFlag: "sc",
    configured: () => soundCloudConfigFromEnv() !== null,
    authorizeUrl: (state, challenge) => {
      const config = soundCloudConfigFromEnv();
      return config ? scAuthorizeUrl(config, soundcloudRedirectUri(), state, challenge) : null;
    },
    exchange: async (code, verifier) => {
      const config = soundCloudConfigFromEnv();
      if (!config) throw new Error("soundcloud not configured");
      return scExchange(config, code, soundcloudRedirectUri(), verifier);
    },
    identity: async (accessToken) => {
      const me = await scUserGet<{ id: number; username?: string }>("/me", accessToken);
      return { id: String(me.id), displayName: me.username ?? null };
    },
  },
  {
    provider: "spotify",
    label: "Spotify",
    redirectFlag: "spotify",
    configured: () => spotifyConfigFromEnv() !== null,
    authorizeUrl: (state, challenge) => {
      const config = spotifyConfigFromEnv();
      return config ? spAuthorizeUrl(config, state, challenge) : null;
    },
    exchange: async (code, verifier) => {
      const config = spotifyConfigFromEnv();
      if (!config) throw new Error("spotify not configured");
      return spExchange(config, code, verifier);
    },
    identity: async (accessToken) => {
      const me = await spCurrentUser(accessToken);
      return { id: me.id, displayName: me.display_name ?? null };
    },
  },
];
