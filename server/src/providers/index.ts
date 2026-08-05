import type { MusicProvider, ProviderName } from "@firstfan/shared";
import { MockProvider } from "./mock.ts";

const providers: Partial<Record<ProviderName, MusicProvider>> = {
  mock: new MockProvider(),
  // soundcloud: added in Phase 2 behind the same interface.
};

export function getProvider(name: ProviderName = "mock"): MusicProvider {
  const p = providers[name];
  if (!p) throw new Error(`Provider not available: ${name}`);
  return p;
}
