import type { MusicProvider, ProviderName } from "@firstfan/shared";
import { MockProvider } from "./mock.ts";
import { SoundCloudProvider, soundCloudConfigFromEnv } from "./soundcloud.ts";

const providers: Partial<Record<ProviderName, MusicProvider>> = {
  mock: new MockProvider(),
};

/**
 * Which provider the app runs against: FIRSTFAN_PROVIDER=soundcloud|mock
 * (default mock). Read lazily — .env is loaded by index.ts at startup.
 */
export function activeProviderName(): ProviderName {
  return process.env.FIRSTFAN_PROVIDER === "soundcloud" ? "soundcloud" : "mock";
}

export function getProvider(name: ProviderName): MusicProvider {
  if (name === "soundcloud" && !providers.soundcloud) {
    const config = soundCloudConfigFromEnv();
    if (!config) {
      throw new Error(
        "FIRSTFAN_PROVIDER=soundcloud but server/.env lacks SOUNDCLOUD_CLIENT_ID / _SECRET",
      );
    }
    providers.soundcloud = new SoundCloudProvider(config);
  }
  const p = providers[name];
  if (!p) throw new Error(`Provider not available: ${name}`);
  return p;
}

export function getActiveProvider(): MusicProvider {
  return getProvider(activeProviderName());
}
