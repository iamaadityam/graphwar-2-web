import { createGameServer } from "./create-server";
import { log } from "./logger";

// Node's built-in .env loader keeps deployment configuration dependency-free.
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const server = await createGameServer();
const port = Number(process.env.PORT ?? 3001);
const actualPort = await server.listen(port);

log("info", "server_started", {
  port: actualPort,
  db: process.env.DB_PATH ?? "./data/graphwar.db",
  client: process.env.NODE_ENV === "production" ? "bundled dist/" : "Vite dev server",
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "server_stopping", { signal });
  try {
    await server.close();
  } catch (error) {
    log("error", "shutdown_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
