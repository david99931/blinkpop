import Fastify from "fastify";
import cors from "@fastify/cors";
import { migrate } from "./db/migrate.ts";
import { trackRoutes } from "./routes/tracks.ts";
import { devRoutes } from "./routes/dev.ts";
import { userRoutes } from "./routes/users.ts";
import { pickRoutes } from "./routes/picks.ts";
import { socialRoutes } from "./routes/social.ts";
import { leaderboardRoutes } from "./routes/leaderboard.ts";
import { portfolioRoutes } from "./routes/portfolio.ts";
import { notificationRoutes } from "./routes/notifications.ts";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get("/api/health", async () => ({ ok: true, service: "first-fan" }));

migrate();
await app.register(trackRoutes);
await app.register(devRoutes);
await app.register(userRoutes);
await app.register(pickRoutes);
await app.register(socialRoutes);
await app.register(leaderboardRoutes);
await app.register(portfolioRoutes);
await app.register(notificationRoutes);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "127.0.0.1" });
