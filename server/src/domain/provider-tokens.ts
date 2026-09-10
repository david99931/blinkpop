/**
 * Access tokens for a user's linked accounts.
 *
 * Split out of the auth routes so the domain layer can reach provider data
 * without importing a route module — anything that needs to read a user's
 * SoundCloud or Spotify data goes through here.
 */

import { validAccessToken } from "./linked-accounts.ts";
import { refreshUserToken as scRefresh, soundCloudConfigFromEnv } from "../providers/soundcloud.ts";
import { refreshUserToken as spRefresh, spotifyConfigFromEnv } from "../providers/spotify.ts";

export function soundcloudAccessToken(userId: number): Promise<string | null> {
  return validAccessToken(userId, "soundcloud", async (refreshToken) => {
    const config = soundCloudConfigFromEnv();
    if (!config) throw new Error("soundcloud not configured");
    return scRefresh(config, refreshToken);
  });
}

export function spotifyAccessToken(userId: number): Promise<string | null> {
  return validAccessToken(userId, "spotify", async (refreshToken) => {
    const config = spotifyConfigFromEnv();
    if (!config) throw new Error("spotify not configured");
    return spRefresh(config, refreshToken);
  });
}
