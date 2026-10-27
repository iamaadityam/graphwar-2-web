import { createServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import type { Server as SocketServer } from "socket.io";
import { Store } from "./store";
import { MatchManager, type ManagerOptions } from "./match-manager";
import { attachSocketServer } from "./socket";
import { log } from "./logger";

export interface GameServerOptions {
  dbPath?: string;
  serveClient?: boolean;
  allowedOrigins?: string[];
  managerOptions?: Partial<ManagerOptions>;
}

export interface GameServer {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketServer;
  store: Store;
  manager: MatchManager;
  listen: (port?: number, host?: string) => Promise<number>;
  close: () => Promise<void>;
}

export async function createGameServer(options: GameServerOptions = {}): Promise<GameServer> {
  const dbPath = options.dbPath ?? process.env.DB_PATH ?? resolve(process.cwd(), "data", "graphwar.db");
  const store = new Store(dbPath);
  const manager = new MatchManager(store, options.managerOptions);
  const allowedOrigins = options.allowedOrigins ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    ...(process.env.CLIENT_ORIGIN ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];

  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      activeMatches: manager.stats.matches,
      version: "1.0.0",
    });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const httpServer = createServer(app);
  const io = attachSocketServer(httpServer, store, manager, allowedOrigins);

  const distDir = resolve(process.cwd(), "dist");
  const shouldServeClient = options.serveClient ?? existsSync(resolve(distDir, "index.html"));
  if (shouldServeClient && existsSync(resolve(distDir, "index.html"))) {
    app.use(express.static(distDir, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/socket.io")) {
        next();
        return;
      }
      res.sendFile(resolve(distDir, "index.html"));
    });
    log("info", "client_static_enabled", { distDir });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(200)
        .type("text/plain")
        .send("Graphwar Web API is running. Start the Vite client with `npm run dev:client`.");
    });
  }

  let listening = false;
  const gameServer: GameServer = {
    app,
    httpServer,
    io,
    store,
    manager,
    async listen(port = Number(process.env.PORT ?? 3001), host = "0.0.0.0") {
      if (listening) throw new Error("Server is already listening.");
      await new Promise<void>((resolveListen, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          resolveListen();
        });
      });
      listening = true;
      const address = httpServer.address();
      return typeof address === "object" && address ? address.port : port;
    },
    async close() {
      manager.close();
      await new Promise<void>((resolveClose) => {
        io.close(() => resolveClose());
      });
      store.close();
      listening = false;
    },
  };

  return gameServer;
}
