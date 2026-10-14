import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@bookleaf/db";
import { createApp } from "./app.js";
import { AiAttemptService } from "./ai/attempts.js";
import { loadPackageEngine } from "./ai/engine.js";
import { TicketEventHub } from "./events/hub.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./http/logger.js";

// Local development convenience: load apps/api/.env if present. Real environments inject variables directly.
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const logger = createLogger();

async function main(): Promise<void> {
  const config = loadConfig();
  // The Prisma client reads DATABASE_URL itself; config validated it is present.
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  await prisma.$connect();

  // AI is optional: if the package or its configuration is unavailable the engine records safe FAILED attempts.
  const events = new TicketEventHub();
  const ai = new AiAttemptService({ prisma, engine: await loadPackageEngine(process.env, logger), events, logger });
  ai.start();

  const server = createApp({ config, prisma, logger, ai, events }).listen(config.port, () => {
    logger.log("info", "api listening", { port: config.port, env: config.nodeEnv });
  });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.log("info", "shutting down", { signal });
    events.closeAll(); // open event streams would otherwise keep server.close() waiting
    server.close(() => {
      ai.stop().finally(() => prisma.$disconnect().finally(() => process.exit(0)));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // Config errors list variable names only; anything else is reduced to its class name.
  if (error instanceof ConfigError) logger.log("error", error.message);
  else logger.log("error", "startup failed", { errorName: error instanceof Error ? error.name : "unknown" });
  process.exit(1);
});
