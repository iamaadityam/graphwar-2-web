import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw lastError instanceof Error ? lastError : new Error("Server did not become healthy");
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const { spawnSync } = await import("node:child_process");
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStop();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort on Windows where sqlite WAL files can briefly remain open.
    }
  }
});

describe("application startup", () => {
  it("starts the real entry point, serves health and security headers, and hosts the built client", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graphwar-app-"));
    tempDirs.push(dir);
    const port = await getFreePort();
    const url = `http://127.0.0.1:${port}`;
    const root = resolve(process.cwd());
    const child = spawn(
      process.execPath,
      [resolve(root, "node_modules", "tsx", "dist", "cli.mjs"), resolve(root, "server", "index.ts")],
      {
        cwd: root,
        env: {
          ...process.env,
          PORT: String(port),
          DB_PATH: join(dir, "application.db"),
          NODE_ENV: "production",
          CLIENT_ORIGIN: "http://localhost:5173",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    try {
      const health = await waitForHealth(url);
      expect(health.status).toBe(200);
      expect(health.headers.get("x-content-type-options")).toBe("nosniff");
      expect(health.headers.get("x-frame-options")).toBe("DENY");
      const body = (await health.json()) as { status: string; version: string };
      expect(body.status).toBe("ok");
      expect(body.version).toBe("1.0.0");

      const missing = await fetch(`${url}/api/not-a-route`);
      expect(missing.status).toBe(404);

      const index = await fetch(`${url}/`);
      expect(index.status).toBe(200);
      if (existsSync(join(root, "dist", "index.html"))) {
        expect(index.headers.get("content-type")).toContain("text/html");
        const html = await index.text();
        expect(html).toContain('id="root"');
        expect(html).toContain("Graphwar Web");
      } else {
        expect(await index.text()).toContain("Graphwar Web API is running");
      }
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nserver stderr:\n${stderr}`,
      );
    } finally {
      await stopChild(child);
    }
  }, 30_000);
});
