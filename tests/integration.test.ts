import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { createGameServer, type GameServer } from "../server/create-server";
import type { ActionResult, Direction, MatchState, Profile } from "../shared/types";
import { compileExpression } from "../shared/math/expression";
import { simulateTrajectory } from "../shared/game/trajectory";

interface TestClient {
  name: string;
  socket: Socket;
  profile: Profile;
  token: string;
  lastState: MatchState | null;
  states: MatchState[];
}

let server: GameServer;
let url = "";
const clients: TestClient[] = [];

function onceConnect(socket: Socket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket connect timeout")), 5_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function ack<T>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeout = 8_000,
): Promise<ActionResult<T>> {
  return new Promise((resolve, reject) => {
    socket.timeout(timeout).emit(event, payload, (error: Error | null, response: ActionResult<T>) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function connectClient(
  name: string,
  credentials?: { accountId: string; token: string },
): Promise<TestClient> {
  const socket = io(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    timeout: 5_000,
  });
  const client: TestClient = {
    name,
    socket,
    profile: { accountId: "", name, stats: { wins: 0, losses: 0, matches: 0 } },
    token: "",
    lastState: null,
    states: [],
  };
  socket.on("match:state", (state: MatchState) => {
    client.lastState = state;
    client.states.push(state);
  });
  await onceConnect(socket);
  const response = await ack<Profile & { token?: string }>(socket, "profile:hello", {
    name,
    ...(credentials ?? {}),
  });
  if (!response.ok) throw new Error(`hello failed: ${response.error.message}`);
  client.profile = {
    accountId: response.accountId,
    name: response.name,
    stats: response.stats,
  };
  client.token = response.token ?? credentials?.token ?? "";
  clients.push(client);
  return client;
}

function waitForState(
  client: TestClient,
  predicate: (state: MatchState) => boolean,
  timeout = 5_000,
): Promise<MatchState> {
  if (client.lastState && predicate(client.lastState)) return Promise.resolve(client.lastState);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.socket.off("match:state", listener);
      reject(new Error(`Timed out waiting for state (last: ${client.lastState?.status ?? "none"})`));
    }, timeout);
    const listener = (state: MatchState) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      client.socket.off("match:state", listener);
      resolve(state);
    };
    client.socket.on("match:state", listener);
  });
}

function format(value: number): string {
  const fixed = value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/**
 * Finds a legal function that the deterministic engine predicts will hit an
 * opponent. This is test-side aiming, not a server shortcut: the same public
 * state and trajectory engine are used before submitting through Socket.IO.
 */
function findAimingShot(
  match: MatchState,
  playerId: string,
): { expression: string; direction: Direction; targetId: string } | null {
  const shooter = match.players.find((player) => player.id === playerId);
  if (!shooter) return null;
  const enemies = match.players
    .filter((player) => player.id !== playerId && !player.eliminated)
    .sort((a, b) => a.health - b.health);
  for (const enemy of enemies) {
    const dx = enemy.x - shooter.x;
    const horizontal = Math.abs(dx);
    if (horizontal < 2 || horizontal > 130) continue;
    const direction: Direction = dx >= 0 ? "right" : "left";
    const dy = enemy.y - shooter.y;
    for (const arc of [0, 10, 20, 30, 40, 55, 70, -10, -25]) {
      const expression = `${format(dy / horizontal)}*x+${format(arc)}*x*(${format(horizontal)}-x)/${format(horizontal * horizontal)}`;
      try {
        const simulation = simulateTrajectory(
          compileExpression(expression),
          shooter,
          match.players,
          direction,
        );
        if (simulation.hitPlayerId) {
          return { expression, direction, targetId: simulation.hitPlayerId };
        }
      } catch {
        // Candidate rejected; try the next arc.
      }
    }
  }
  return null;
}

async function createStartedMatch() {
  const alpha = await connectClient("Alpha");
  const beta = await connectClient("Beta");
  const created = await ack<{ matchId: string }>(alpha.socket, "match:create", {
    visibility: "private",
    maxPlayers: 2,
  });
  expect(created.ok).toBe(true);
  const waiting = await waitForState(alpha, (state) => state.status === "waiting");
  const joined = await ack<{ matchId: string }>(beta.socket, "match:join", { code: waiting.code });
  expect(joined.ok).toBe(true);
  await waitForState(beta, (state) => state.players.length === 2);
  await ack(alpha.socket, "match:ready", { ready: true });
  await ack(beta.socket, "match:ready", { ready: true });
  await waitForState(alpha, (state) => state.players.every((p) => p.ready));
  const started = await ack(alpha.socket, "match:start", {});
  expect(started.ok).toBe(true);
  const active = await waitForState(alpha, (state) => state.status === "active");
  await waitForState(beta, (state) => state.status === "active");
  return { alpha, beta, active };
}

beforeAll(async () => {
  server = await createGameServer({
    dbPath: ":memory:",
    serveClient: false,
    managerOptions: {
      botDelayMs: 60,
      tickMs: 50,
      noHumansTtlMs: 60_000,
      waitingTtlMs: 15 * 60_000,
      finishedTtlMs: 60 * 60_000,
    },
  });
  const port = await server.listen(0, "127.0.0.1");
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.socket.disconnect();
  }
  await new Promise((resolve) => setTimeout(resolve, 30));
});

afterAll(async () => {
  await server.close();
});

describe("multiplayer integration", () => {
  it("lets two independent clients join, synchronize and reject unauthorized or duplicate shots", async () => {
    const { alpha, beta, active } = await createStartedMatch();
    expect(active.players).toHaveLength(2);
    expect(active.currentPlayerId).toBe(alpha.profile.accountId);
    expect(beta.lastState?.version).toBe(active.version);

    const unauthorized = await ack(beta.socket, "shot:submit", {
      matchId: active.id,
      turnNumber: active.turnNumber,
      version: active.version,
      expression: "0",
      direction: "right",
    });
    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) expect(unauthorized.error.code).toBe("NOT_YOUR_TURN");

    const aim = findAimingShot(active, alpha.profile.accountId);
    expect(aim).not.toBeNull();
    const payload = {
      matchId: active.id,
      turnNumber: active.turnNumber,
      version: active.version,
      expression: aim!.expression,
      direction: aim!.direction,
    };
    const [first, second] = await Promise.all([
      ack(alpha.socket, "shot:submit", payload),
      ack(alpha.socket, "shot:submit", payload),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const failed = [first, second].find((response) => !response.ok);
    expect(failed && !failed.ok ? failed.error.code : "").toMatch(/STALE_|NOT_YOUR_TURN/);

    const afterShot = await waitForState(alpha, (state) => state.version > active.version);
    const betaState = await waitForState(beta, (state) => state.version > active.version);
    expect(afterShot.turnNumber).toBe(active.turnNumber + 1);
    expect(afterShot.players.map((p) => p.health)).toEqual(betaState.players.map((p) => p.health));
    expect(afterShot.lastShot?.id).toBe(betaState.lastShot?.id);
    expect(afterShot.players.filter((p) => p.health < 100)).toHaveLength(1);
    expect(afterShot.players.find((p) => p.id === aim!.targetId)?.health).toBe(65);

    // Play the match to completion through the normal public action.
    let state = afterShot;
    let guard = 0;
    while (state.status === "active" && guard < 12) {
      guard++;
      const currentId = state.currentPlayerId!;
      const author = currentId === alpha.profile.accountId ? alpha : beta;
      const shot = findAimingShot(state, currentId);
      expect(shot).not.toBeNull();
      const versionBefore = state.version;
      const response = await ack(author.socket, "shot:submit", {
        matchId: state.id,
        turnNumber: state.turnNumber,
        version: state.version,
        expression: shot!.expression,
        direction: shot!.direction,
      });
      expect(response.ok).toBe(true);
      state = await waitForState(alpha, (next) => next.version > versionBefore);
      await waitForState(beta, (next) => next.version > versionBefore);
    }
    expect(state.status).toBe("finished");
    expect(state.winnerId).toBeTruthy();
    expect(state.finishReason).toBe("last-standing");
    expect(alpha.lastState?.version).toBe(beta.lastState?.version);
    expect(alpha.lastState?.winnerId).toBe(beta.lastState?.winnerId);
    expect(alpha.lastState?.players).toEqual(beta.lastState?.players);
  });

  it("handles disconnect and reconnect without duplicating players or turns", async () => {
    const { alpha, beta, active } = await createStartedMatch();
    const betaId = beta.profile.accountId;
    beta.socket.disconnect();
    const disconnected = await waitForState(
      alpha,
      (state) => state.players.find((p) => p.id === betaId)?.connected === false,
    );
    expect(disconnected.players.filter((p) => p.id === betaId)).toHaveLength(1);
    const versionAfterDisconnect = disconnected.version;

    const reconnected = await connectClient("Beta", {
      accountId: betaId,
      token: beta.token,
    });
    expect(reconnected.profile.accountId).toBe(betaId);
    const stateWithBeta = await waitForState(
      alpha,
      (state) => state.version > versionAfterDisconnect && state.players.find((p) => p.id === betaId)?.connected === true,
    );
    expect(stateWithBeta.players.filter((p) => p.id === betaId)).toHaveLength(1);
    expect(stateWithBeta.currentPlayerId).toBe(active.currentPlayerId);
    expect(stateWithBeta.turnNumber).toBe(active.turnNumber);
    expect(reconnected.lastState?.id).toBe(active.id);
  });

  it("supports public matchmaking and solo practice against a bot", async () => {
    const alpha = await connectClient("QuickA");
    const beta = await connectClient("QuickB");
    const quick = await ack<{ matchId: string }>(alpha.socket, "match:quick", {});
    expect(quick.ok).toBe(true);
    const queueState = await waitForState(alpha, (state) => state.status === "waiting");
    expect(queueState.visibility).toBe("public");
    const joined = await ack<{ matchId: string }>(beta.socket, "match:quick", {});
    expect(joined.ok).toBe(true);
    const shared = await waitForState(beta, (state) => state.players.length === 2);
    expect(shared.id).toBe(queueState.id);
    expect(await waitForState(alpha, (state) => state.players.length === 2)).toBeTruthy();

    const soloClient = await connectClient("Soloist");
    const solo = await ack<{ matchId: string }>(soloClient.socket, "match:solo", {});
    expect(solo.ok).toBe(true);
    const soloState = await waitForState(soloClient, (state) => state.status === "active");
    expect(soloState.players.some((p) => p.kind === "bot")).toBe(true);
    expect(soloState.currentPlayerId).toBe(soloClient.profile.accountId);
    const bot = soloState.players.find((p) => p.kind === "bot")!;
    const aim = findAimingShot(soloState, soloClient.profile.accountId);
    expect(aim).not.toBeNull();
    const response = await ack(soloClient.socket, "shot:submit", {
      matchId: soloState.id,
      turnNumber: soloState.turnNumber,
      version: soloState.version,
      expression: aim!.expression,
      direction: aim!.direction,
    });
    expect(response.ok).toBe(true);
    const botFired = await waitForState(
      soloClient,
      (state) => state.players.find((p) => p.id === bot.id)?.shotsFired === 1,
      5_000,
    );
    const botShot = botFired.shots.find((shot) => shot.playerId === bot.id);
    expect(botShot).toBeTruthy();
    expect(botShot?.expression.length).toBeLessThanOrEqual(120);
    expect(botFired.turnNumber).toBeGreaterThan(soloState.turnNumber);
    expect(["left", "right"]).toContain(botShot?.direction);
  });

  it("rejects malformed messages and cleans up abandoned matches", async () => {
    const alpha = await connectClient("CleanupA");
    const beta = await connectClient("CleanupB");
    const created = await ack<{ matchId: string }>(alpha.socket, "match:create", {
      visibility: "private",
      maxPlayers: 2,
    });
    expect(created.ok).toBe(true);
    const lobby = await waitForState(alpha, (state) => state.status === "waiting");

    const malformed = await ack(alpha.socket, "shot:submit", { nonsense: true });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe("INVALID_INPUT");

    await ack(beta.socket, "match:join", { code: lobby.code });
    beta.socket.disconnect();
    alpha.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 80));
    server.manager.cleanup(Date.now() + 20 * 60_000);
    expect(server.manager.getMatch(lobby.id)).toBeNull();
    expect(server.store.getMatchRecord(lobby.id)?.status).toBe("abandoned");
  });
});
