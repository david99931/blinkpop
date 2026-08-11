import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { migrate } from "./db/migrate.ts";

// Load server/.env (SoundCloud credentials etc.); fine if it doesn't exist.
// Parsed by hand rather than process.loadEnvFile: a UTF-8 BOM (which some
// Windows editors and `Set-Content -Encoding utf8` prepend) would otherwise
// become part of the FIRST key's name, silently blanking it.
try {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  const raw = readFileSync(envPath, "utf8").replace(/^﻿/, "");
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2]!.trim().replace(/^["'](.*)["']$/, "$1");
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
} catch {
  /* no .env yet — mock provider needs nothing */
}
import { trackRoutes } from "./routes/tracks.ts";
import { devRoutes } from "./routes/dev.ts";
import { userRoutes } from "./routes/users.ts";
import { authRoutes } from "./routes/auth.ts";
import { pickRoutes } from "./routes/picks.ts";
import { socialRoutes } from "./routes/social.ts";
import { leaderboardRoutes } from "./routes/leaderboard.ts";
import { portfolioRoutes } from "./routes/portfolio.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { trendingRoutes } from "./routes/trending.ts";
import { startPollingJobs } from "./jobs/poll.ts";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/api/health", async () => ({ ok: true, service: "first-fan" }));

migrate();
await app.register(trackRoutes);
await app.register(devRoutes);
await app.register(userRoutes);
await app.register(authRoutes);
await app.register(pickRoutes);
await app.register(socialRoutes);
await app.register(leaderboardRoutes);
await app.register(portfolioRoutes);
await app.register(notificationRoutes);
await app.register(trendingRoutes);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
startPollingJobs(app.log);
