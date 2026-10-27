import { describe, expect, it } from "vitest";
import type { MatchState } from "../shared/types";
import {
  addPlayer,
  createMatch,
  disconnectPlayer,
  GameError,
  isTurnExpired,
  leaveMatch,
  requestRematch,
  setReady,
  startMatch,
  submitShot,
  timeoutTurn,
} from "../shared/game/engine";
import { chooseBotShot } from "../shared/game/bot";
import { compileExpression } from "../shared/math/expression";

const NOW = 1_700_000_000_000;

function makeLobby(): MatchState {
  const match = createMatch({
    id: "m1",
    code: "ABC123",
    visibility: "private",
    maxPlayers: 2,
    host: { id: "a", name: "Alpha" },
    now: NOW,
  });
  addPlayer(match, { id: "b", name: "Beta" }, NOW);
  setReady(match, "a", true, NOW);
  setReady(match, "b", true, NOW);
  startMatch(match, NOW);
  return match;
}

function placeDuel(match: MatchState): void {
  match.players[0].x = 0;
  match.players[0].y = 25;
  match.players[1].x = 20;
  match.players[1].y = 25;
}

function submit(match: MatchState, playerId: string, expression = "0", now = NOW + 1) {
  return submitShot(match, {
    playerId,
    expression,
    direction: "right",
    turnNumber: match.turnNumber,
    version: match.version,
    now,
  });
}

describe("authoritative game engine", () => {
  it("creates a lobby with readiness and starts positions", () => {
    const match = makeLobby();
    expect(match.status).toBe("active");
    expect(match.players).toHaveLength(2);
    expect(match.currentPlayerId).toBe("a");
    expect(match.players[0].x).not.toBe(match.players[1].x);
    expect(match.players.every((player) => player.health === 100)).toBe(true);
    expect(match.turnDeadline).toBeGreaterThan(NOW);
  });

  it("accepts a valid shot, applies damage and advances the turn", () => {
    const match = makeLobby();
    placeDuel(match);
    const beforeVersion = match.version;
    const result = submit(match, "a");
    expect(result.shot.outcome).toBe("hit");
    expect(result.shot.hitPlayerId).toBe("b");
    expect(result.shot.damage).toBe(35);
    expect(match.players[1].health).toBe(65);
    expect(match.players[0].shotsFired).toBe(1);
    expect(match.players[0].hits).toBe(1);
    expect(match.currentPlayerId).toBe("b");
    expect(match.turnNumber).toBe(2);
    expect(match.version).toBe(beforeVersion + 1);
    expect(match.lastShot?.id).toBe(result.shot.id);
  });

  it("rejects shots from the wrong player", () => {
    const match = makeLobby();
    placeDuel(match);
    try {
      submit(match, "b");
      throw new Error("Expected an error");
    } catch (error) {
      expect(error).toBeInstanceOf(GameError);
      expect((error as GameError).code).toBe("NOT_YOUR_TURN");
    }
  });

  it("rejects duplicate and stale submissions", () => {
    const match = makeLobby();
    placeDuel(match);
    const turnNumber = match.turnNumber;
    const version = match.version;
    submitShot(match, {
      playerId: "a",
      expression: "0",
      direction: "right",
      turnNumber,
      version,
      now: NOW + 1,
    });
    expect(() =>
      submitShot(match, {
        playerId: "a",
        expression: "0",
        direction: "right",
        turnNumber,
        version,
        now: NOW + 2,
      }),
    ).toThrowError(/state changed|already ended/i);
    expect(() => submit(match, "a")).toThrowError(/not your turn/i);
    expect(() => submit(match, "b", "0", NOW + 3)).not.toThrow();
  });

  it("rejects invalid expressions without mutating state", () => {
    const match = makeLobby();
    placeDuel(match);
    const before = JSON.stringify(match);
    try {
      submit(match, "a", "sin(");
      throw new Error("Expected an error");
    } catch (error) {
      expect(error).toBeInstanceOf(GameError);
      expect((error as GameError).code).toBe("BAD_EXPRESSION");
    }
    expect(JSON.stringify(match)).toBe(before);
  });

  it("treats a valid function that enters a bad numerical region as a miss", () => {
    const match = makeLobby();
    placeDuel(match);
    const result = submit(match, "a", "sqrt(x-10)");
    expect(result.shot.outcome).toBe("invalid");
    expect(result.shot.damage).toBe(0);
    expect(match.players[1].health).toBe(100);
    expect(match.currentPlayerId).toBe("b");
  });

  it("eliminates units and determines the winner", () => {
    const match = makeLobby();
    placeDuel(match);
    match.players[1].health = 35;
    submit(match, "a");
    expect(match.players[1].health).toBe(0);
    expect(match.players[1].eliminated).toBe(true);
    expect(match.status).toBe("finished");
    expect(match.winnerId).toBe("a");
    expect(match.finishReason).toBe("last-standing");
    expect(match.turnDeadline).toBeNull();
  });

  it("handles turn timeouts with an automatic valid shot", () => {
    const match = makeLobby();
    placeDuel(match);
    match.turnDeadline = NOW - 1;
    expect(isTurnExpired(match, NOW)).toBe(true);
    const resolution = timeoutTurn(match, NOW);
    expect(resolution?.shot.auto).toBe(true);
    expect(resolution?.shot.expression).toBe("100");
    expect(resolution?.shot.outcome).toBe("boundary");
    expect(resolution?.shot.damage).toBe(0);
    expect(match.players[1].health).toBe(100);
    expect(match.currentPlayerId).toBe("b");
    expect(match.turnNumber).toBe(2);
  });

  it("skips a disconnected player's turn after grace", () => {
    const match = makeLobby();
    disconnectPlayer(match, "a", NOW);
    expect(isTurnExpired(match, NOW + 1)).toBe(false);
    expect(isTurnExpired(match, NOW + 6_000)).toBe(true);
  });

  it("does not let the connected player take repeated shots after an opponent disconnects", () => {
    const match = makeLobby();
    placeDuel(match);
    disconnectPlayer(match, "b", NOW);
    submit(match, "a");
    expect(match.currentPlayerId).toBe("b");
    expect(match.turnNumber).toBe(2);
    expect(isTurnExpired(match, NOW + 6_000)).toBe(true);
    const auto = timeoutTurn(match, NOW + 6_000);
    expect(auto?.shot.playerId).toBe("b");
    expect(auto?.shot.damage).toBe(0);
    expect(match.currentPlayerId).toBe("a");
    expect(match.players[0].health).toBe(100);
  });

  it("forfeits a player who leaves an active match", () => {
    const match = makeLobby();
    placeDuel(match);
    const result = leaveMatch(match, "a", NOW + 1);
    expect(result.removed).toBe(false);
    expect(match.players[0].eliminated).toBe(true);
    expect(match.status).toBe("finished");
    expect(match.winnerId).toBe("b");
  });

  it("resets a finished match into a rematch lobby", () => {
    const match = makeLobby();
    placeDuel(match);
    match.players[1].health = 35;
    submit(match, "a");
    expect(match.status).toBe("finished");
    requestRematch(match, "b", NOW + 5);
    expect(match.status).toBe("waiting");
    expect(match.winnerId).toBeNull();
    expect(match.turnNumber).toBe(0);
    expect(match.players.every((p) => p.health === 100 && !p.eliminated)).toBe(true);
    expect(match.players.every((p) => !p.ready)).toBe(true);
  });

  it("produces a valid bot shot using only public match state", () => {
    const match = makeLobby();
    placeDuel(match);
    match.currentPlayerId = "b";
    match.turnNumber = 2;
    const decision = chooseBotShot(match, "b");
    expect(["left", "right"]).toContain(decision.direction);
    expect(() => compileExpression(decision.expression)).not.toThrow();
    expect(decision.expression.length).toBeLessThanOrEqual(120);
    const before = match.version;
    const result = submitShot(match, {
      playerId: "b",
      expression: decision.expression,
      direction: decision.direction,
      turnNumber: match.turnNumber,
      version: match.version,
      now: NOW + 10,
    });
    expect(result.shot.playerId).toBe("b");
    expect(match.version).toBe(before + 1);
  });

  it("supports a three-player turn cycle", () => {
    const match = createMatch({
      id: "m3",
      code: "XYZ789",
      visibility: "public",
      maxPlayers: 3,
      host: { id: "a", name: "A" },
      now: NOW,
    });
    addPlayer(match, { id: "b", name: "B" }, NOW);
    addPlayer(match, { id: "c", name: "C" }, NOW);
    for (const id of ["a", "b", "c"]) setReady(match, id, true, NOW);
    startMatch(match, NOW);
    match.players.forEach((p, index) => {
      p.x = index * 30 - 30;
      p.y = 25;
    });
    expect(match.currentPlayerId).toBe("a");
    submit(match, "a", "100", NOW + 1);
    expect(match.currentPlayerId).toBe("b");
    submit(match, "b", "100", NOW + 2);
    expect(match.currentPlayerId).toBe("c");
    submit(match, "c", "100", NOW + 3);
    expect(match.currentPlayerId).toBe("a");
    expect(match.turnNumber).toBe(4);
  });
});
