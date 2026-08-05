/**
 * SoundCloud credential smoke test (Phase 2 preflight).
 * Run from repo root:  node server/scripts/check-soundcloud.mjs
 *
 * 1. client-credentials token exchange
 * 2. one real search call — prints the stats field names we actually got,
 *    since the spec says not to trust docs-from-memory for those.
 * Never prints the secret; token is masked. Token requests are rate-limited
 * by SoundCloud, so don't run this in a loop.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env"));

const id = process.env.SOUNDCLOUD_CLIENT_ID;
const secret = process.env.SOUNDCLOUD_CLIENT_SECRET;
if (!id || !secret || id.startsWith("paste_")) {
  console.error("✗ server/.env is missing real SOUNDCLOUD_CLIENT_ID / _SECRET");
  process.exit(1);
}

const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
const API = "https://api.soundcloud.com";

console.log(`→ POST ${TOKEN_URL} (grant_type=client_credentials)`);
const tokenRes = await fetch(TOKEN_URL, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json; charset=utf-8",
  },
  body: "grant_type=client_credentials",
});

const tokenBody = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok) {
  console.error(`✗ token exchange failed: HTTP ${tokenRes.status}`);
  console.error(JSON.stringify(tokenBody, null, 2));
  process.exit(1);
}
const token = tokenBody.access_token;
console.log(
  `✓ got access token ${String(token).slice(0, 6)}… ` +
    `(expires_in=${tokenBody.expires_in}s, scope="${tokenBody.scope ?? ""}")`,
);

const q = "lofi";
console.log(`→ GET ${API}/tracks?q=${q}&limit=3`);
const searchRes = await fetch(`${API}/tracks?q=${q}&limit=3&linked_partitioning=false`, {
  headers: { Authorization: `OAuth ${token}`, Accept: "application/json; charset=utf-8" },
});
if (!searchRes.ok) {
  console.error(`✗ search failed: HTTP ${searchRes.status}`);
  console.error((await searchRes.text()).slice(0, 500));
  process.exit(1);
}
const tracks = await searchRes.json();
const list = Array.isArray(tracks) ? tracks : (tracks.collection ?? []);
console.log(`✓ search returned ${list.length} tracks\n`);

for (const t of list) {
  console.log(`  "${t.title}" — ${t.user?.username}`);
  console.log(
    `     plays=${t.playback_count ?? "∅"} likes_count=${t.likes_count ?? "∅"} ` +
      `favoritings_count=${t.favoritings_count ?? "∅"} reposts_count=${t.reposts_count ?? "∅"}`,
  );
}

const sample = list[0] ?? {};
const statFields = Object.keys(sample).filter((k) =>
  /count|favorit|repost|play|like/i.test(k),
);
console.log(`\nstat-ish fields present on a track object: ${statFields.join(", ")}`);
console.log("\n✓ credentials work — Phase 2 is go.");
