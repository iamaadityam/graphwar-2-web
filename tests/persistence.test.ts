import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store";
import { MatchManager } from "../server/match-manager";

const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "graphwar-test-"));
  dirs.push(dir);
  return join(dir, "game.db");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can briefly hold WAL files; temp directory cleanup is best effort.
    }
  }
});

describe("persistence and restart recovery", () => {
  it("recovers a live match, keeps stats exactly once, and abandons closed lobbies", () => {
    const dbPath = tempDb();
    let store = new Store(dbPath);
    let manager = new MatchManager(store, { botDelayMs: 10, tickMs: 5_000 });
    const accountA = store.createAccount("Alpha");
    const accountB = store.createAccount("Beta");
    const lobby = manager.createLobby(accountA.account, { visibility: "private", maxPlayers: 2 });
    manager.joinByCode(accountB.account, lobby.code);
    manager.setReady(accountA.account.id, true);
    manager.setReady(accountB.account.id, true);
    const active = manager.start(accountA.account.id);
    active.players[0].x = 0;
    active.players[0].y = 25;
    active.players[1].x = 20;
    active.players[1].y = 25;
    manager.submit(accountA.account.id, {
      expression: "0",
      direction: "right",
      turnNumber: active.turnNumber,
      version: active.version,
    });
    expect(active.players[1].health).toBe(65);
    const recordedVersion = active.version;
    const matchId = active.id;
    manager.close();
    store.close();

    // Simulate a process restart against the same SQLite file.
    store = new Store(dbPath);
    manager = new MatchManager(store, { botDelayMs: 10, tickMs: 5_000 });
    const recovered = manager.getMatch(matchId);
    expect(recovered).not.toBeNull();
    expect(recovered?.status).toBe("active");
    expect(recovered?.version).toBe(recordedVersion);
    expect(recovered?.players.find((p) => p.id === accountB.account.id)?.health).toBe(65);
    expect(recovered?.players.every((p) => p.kind === "bot" || !p.connected)).toBe(true);
    expect(recovered?.turnDeadline).toBeGreaterThan(Date.now());

    expect(manager.reconnect(accountA.account.id)?.id).toBe(matchId);
    expect(manager.reconnect(accountB.account.id)?.id).toBe(matchId);
    const resumed = manager.getMatch(matchId)!;
    expect(resumed.players.every((p) => p.connected)).toBe(true);
    expect(resumed.currentPlayerId).toBe(accountB.account.id);

    // Finish the recovered game through the normal authoritative action.
    resumed.players[0].health = 35;
    manager.submit(accountB.account.id, {
      expression: "0",
      direction: "left",
      turnNumber: resumed.turnNumber,
      version: resumed.version,
    });
    expect(manager.getMatch(matchId)?.status).toBe("finished");
    expect(manager.getMatch(matchId)?.winnerId).toBe(accountB.account.id);
    expect(store.getAccount(accountB.account.id)?.stats.wins).toBe(1);
    expect(store.getAccount(accountA.account.id)?.stats.losses).toBe(1);
    const finishedAt = manager.getMatch(matchId)?.finishedAt ?? Date.now();
    manager.close();
    store.close();

    // A second restart must not award the result again.
    store = new Store(dbPath);
    manager = new MatchManager(store, { botDelayMs: 10, tickMs: 5_000 });
    expect(manager.getMatch(matchId)?.status).toBe("finished");
    expect(store.getAccount(accountB.account.id)?.stats.wins).toBe(1);
    expect(store.getAccount(accountA.account.id)?.stats.losses).toBe(1);

    // Waiting lobbies disappear after their TTL when abandoned.
    const lobbyA = store.createAccount("LobbyA");
    const tempLobby = manager.createLobby(lobbyA.account, { visibility: "public", maxPlayers: 2 });
    manager.disconnect(lobbyA.account.id);
    manager.cleanup(finishedAt + 20 * 60_000);
    expect(manager.getMatch(tempLobby.id)).toBeNull();
    expect(store.getMatchRecord(tempLobby.id)?.status).toBe("abandoned");

    manager.close();
    store.close();
  });

  it("persists a waiting match join code across restart", () => {
    const dbPath = tempDb();
    let store = new Store(dbPath);
    let manager = new MatchManager(store, { botDelayMs: 10, tickMs: 5_000 });
    const host = store.createAccount("Host");
    const guest = store.createAccount("Guest");
    const lobby = manager.createLobby(host.account, { visibility: "private", maxPlayers: 2 });
    const code = lobby.code;
    manager.close();
    store.close();

    store = new Store(dbPath);
    manager = new MatchManager(store, { botDelayMs: 10, tickMs: 5_000 });
    const joined = manager.joinByCode(guest.account, code);
    expect(joined.players.map((p) => p.name)).toContain("Guest");
    expect(joined.status).toBe("waiting");
    manager.close();
    store.close();
  });
});
