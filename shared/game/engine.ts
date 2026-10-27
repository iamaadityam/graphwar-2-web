import {
  DISCONNECT_GRACE_MS,
  MAX_HEALTH,
  MAX_PLAYERS,
  MAX_SHOT_HISTORY,
  MIN_PLAYERS,
  SHOT_DAMAGE,
  TURN_SECONDS,
  type Direction,
  type MatchEvent,
  type MatchFinishReason,
  type MatchState,
  type MatchVisibility,
  type PlayerKind,
  type PlayerState,
  type ShotResult,
} from "../types";
import { compileExpression, MathExpressionError } from "../math/expression";
import { simulateTrajectory } from "./trajectory";
import { spawnPositions } from "./world";

export class GameError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GameError";
    this.code = code;
  }
}

let fallbackCounter = 0;

export function newId(prefix = ""): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `id-${Date.now().toString(36)}-${(fallbackCounter++).toString(36)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export interface NewPlayer {
  id: string;
  name: string;
  kind?: PlayerKind;
}

export interface CreateMatchOptions {
  id: string;
  code: string;
  visibility: MatchVisibility;
  maxPlayers?: number;
  host: NewPlayer;
  now: number;
  botSeed?: number;
}

function basePlayer(player: NewPlayer, colorIndex: number, now: number): PlayerState {
  return {
    id: player.id,
    name: player.name,
    kind: player.kind ?? "human",
    colorIndex,
    ready: player.kind === "bot",
    connected: true,
    disconnectedAt: null,
    joinedAt: now,
    x: 0,
    y: 0,
    health: MAX_HEALTH,
    maxHealth: MAX_HEALTH,
    eliminated: false,
    shotsFired: 0,
    hits: 0,
  };
}

function event(match: MatchState, kind: MatchEvent["kind"], message: string, at: number): void {
  match.events.unshift({ id: newId("evt"), at, kind, message });
  match.events = match.events.slice(0, 14);
}

function bump(match: MatchState, at: number): void {
  match.version++;
  match.updatedAt = at;
}

export function createMatch(options: CreateMatchOptions): MatchState {
  const now = options.now;
  const host = {
    ...basePlayer(options.host, 0, now),
    kind: options.host.kind ?? "human",
    ready: false,
    // The creator is present when the match is created.
    connected: true,
  };
  const match: MatchState = {
    id: options.id,
    code: options.code,
    visibility: options.visibility,
    status: "waiting",
    maxPlayers: Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, options.maxPlayers ?? MAX_PLAYERS)),
    hostId: host.id,
    players: [host],
    currentPlayerId: null,
    turnNumber: 0,
    version: 1,
    turnStartedAt: null,
    turnDeadline: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    winnerId: null,
    finishReason: null,
    lastShot: null,
    shots: [],
    events: [],
    botSeed: options.botSeed ?? Math.floor(Math.random() * 2_000_000_000),
    statsRecorded: false,
  };
  event(match, "join", `${host.name} created the match.`, now);
  return match;
}

export function addPlayer(match: MatchState, player: NewPlayer, now: number): PlayerState {
  if (match.status !== "waiting") throw new GameError("MATCH_STARTED", "This match has already started.");
  if (match.players.length >= match.maxPlayers) throw new GameError("MATCH_FULL", "This match is full.");
  if (match.players.some((p) => p.id === player.id)) {
    throw new GameError("ALREADY_JOINED", "You are already in this match.");
  }
  const usedColors = new Set(match.players.map((p) => p.colorIndex));
  let colorIndex = 0;
  while (usedColors.has(colorIndex) && colorIndex < 8) colorIndex++;
  const added = basePlayer(player, colorIndex, now);
  if (player.kind !== "bot") added.ready = false;
  match.players.push(added);
  if (player.kind !== "bot") event(match, "join", `${added.name} joined the lobby.`, now);
  bump(match, now);
  return added;
}

export function setReady(match: MatchState, playerId: string, ready: boolean, now: number): void {
  if (match.status !== "waiting") throw new GameError("MATCH_STARTED", "The match is not in the lobby.");
  const player = match.players.find((p) => p.id === playerId);
  if (!player) throw new GameError("NOT_IN_MATCH", "You are not in this match.");
  if (player.kind === "bot") throw new GameError("BOT_READY", "Bots are always ready.");
  player.ready = ready;
  bump(match, now);
}

export function canStart(match: MatchState): { ok: true } | { ok: false; message: string } {
  if (match.status !== "waiting") return { ok: false, message: "The match has already started." };
  if (match.players.length < MIN_PLAYERS) return { ok: false, message: "At least two players are required." };
  const humans = match.players.filter((p) => p.kind === "human");
  if (!humans.every((p) => p.ready)) return { ok: false, message: "Every human player must be ready." };
  if (!humans.every((p) => p.connected)) return { ok: false, message: "Every player must be connected." };
  if (!match.players.some((p) => !p.eliminated)) return { ok: false, message: "No players are available." };
  return { ok: true };
}

export function startMatch(match: MatchState, now: number): void {
  const check = canStart(match);
  if (!check.ok) throw new GameError("CANNOT_START", check.message);
  const positions = spawnPositions(match.players.length);
  match.players.forEach((player, index) => {
    player.x = positions[index].x;
    player.y = positions[index].y;
    player.health = MAX_HEALTH;
    player.eliminated = false;
    player.shotsFired = 0;
    player.hits = 0;
  });
  match.status = "active";
  match.startedAt = now;
  match.finishedAt = null;
  match.winnerId = null;
  match.finishReason = null;
  match.lastShot = null;
  match.shots = [];
  match.turnNumber = 1;
  const starter = match.players.find((p) => p.id === match.hostId && !p.eliminated) ?? match.players[0];
  match.currentPlayerId = starter.id;
  match.turnStartedAt = now;
  match.turnDeadline = now + TURN_SECONDS * 1000;
  event(match, "start", "Match started. Write a function and fire!", now);
  bump(match, now);
}

function livingPlayers(match: MatchState): PlayerState[] {
  return match.players.filter((p) => !p.eliminated);
}

function finishMatch(match: MatchState, reason: MatchFinishReason, now: number): void {
  if (match.status === "finished") return;
  const living = livingPlayers(match);
  match.status = "finished";
  match.finishedAt = now;
  match.turnDeadline = null;
  match.turnStartedAt = null;
  match.currentPlayerId = null;
  match.finishReason = living.length === 0 ? "draw" : reason;
  match.winnerId = living.length === 1 ? living[0].id : null;
  const winner = match.players.find((p) => p.id === match.winnerId);
  event(
    match,
    "finish",
    winner ? `${winner.name} wins the match!` : "The match ended in a draw.",
    now,
  );
  bump(match, now);
}

export function checkVictory(match: MatchState, now: number): boolean {
  if (match.status !== "active") return false;
  const living = livingPlayers(match);
  if (living.length <= 1) {
    finishMatch(match, living.length === 1 ? "last-standing" : "draw", now);
    return true;
  }
  return false;
}

function nextTurn(match: MatchState, now: number): void {
  const currentIndex = match.players.findIndex((p) => p.id === match.currentPlayerId);
  const count = match.players.length;
  const activate = (candidate: PlayerState): void => {
    match.currentPlayerId = candidate.id;
    match.turnNumber++;
    match.turnStartedAt = now;
    match.turnDeadline = now + TURN_SECONDS * 1000;
  };

  // Prefer another connected living player. Never wrap back to the shooter.
  for (let offset = 1; offset < count; offset++) {
    const candidate = match.players[(currentIndex + offset + count) % count];
    if (!candidate.eliminated && candidate.connected) {
      activate(candidate);
      return;
    }
  }

  // Nobody else is connected. Do not let the last connected player take
  // repeated shots: pass the turn to a living disconnected player instead.
  // The timeout tick will auto-fire for them after the disconnect grace.
  for (let offset = 1; offset < count; offset++) {
    const candidate = match.players[(currentIndex + offset + count) % count];
    if (!candidate.eliminated) {
      activate(candidate);
      return;
    }
  }

  // No living player remains; victory resolution should normally prevent this.
  match.turnStartedAt = now;
  match.turnDeadline = now + TURN_SECONDS * 1000;
}

export interface SubmitShotInput {
  playerId: string;
  expression: string;
  direction: Direction;
  turnNumber: number;
  version: number;
  now: number;
  auto?: boolean;
}

export interface ShotResolution {
  shot: ShotResult;
  match: MatchState;
}

export function submitShot(match: MatchState, input: SubmitShotInput): ShotResolution {
  if (match.status !== "active") throw new GameError("NOT_ACTIVE", "The match is not active.");
  if (match.version !== input.version) {
    throw new GameError("STALE_STATE", "The game state changed. Wait for the latest update and try again.");
  }
  if (match.turnNumber !== input.turnNumber) {
    throw new GameError("STALE_TURN", "That turn has already ended.");
  }
  if (match.currentPlayerId !== input.playerId) {
    throw new GameError("NOT_YOUR_TURN", "It is not your turn.");
  }
  const shooter = match.players.find((p) => p.id === input.playerId);
  if (!shooter) throw new GameError("NOT_IN_MATCH", "You are not in this match.");
  if (shooter.eliminated) throw new GameError("ELIMINATED", "Eliminated players cannot fire.");
  if (!input.auto && !shooter.connected) throw new GameError("DISCONNECTED", "You are not connected.");
  if (input.direction !== "left" && input.direction !== "right") {
    throw new GameError("BAD_DIRECTION", "Choose a valid firing direction.");
  }

  let expression;
  try {
    expression = compileExpression(input.expression);
  } catch (error) {
    if (error instanceof MathExpressionError) {
      throw new GameError("BAD_EXPRESSION", error.message);
    }
    throw new GameError("BAD_EXPRESSION", "The expression could not be parsed.");
  }

  const simulation = simulateTrajectory(
    expression,
    shooter,
    match.players,
    input.direction,
  );
  const target = simulation.hitPlayerId
    ? match.players.find((p) => p.id === simulation.hitPlayerId) ?? null
    : null;
  let damage = 0;
  let message = simulation.message;
  if (target) {
    damage = Math.min(SHOT_DAMAGE, target.health);
    target.health = Math.max(0, target.health - SHOT_DAMAGE);
    shooter.hits++;
    if (target.health === 0) target.eliminated = true;
    message = target.eliminated
      ? `Direct hit! ${target.name} was eliminated.`
      : `Direct hit on ${target.name} for ${damage} damage.`;
  } else if (simulation.outcome === "invalid") {
    message = simulation.message;
  } else if (simulation.outcome === "boundary") {
    message = "The projectile left the chart.";
  } else if (simulation.outcome === "terrain") {
    message = "The projectile struck the terrain.";
  } else {
    message = "The projectile reached maximum range without a hit.";
  }

  shooter.shotsFired++;
  const shot: ShotResult = {
    id: newId("shot"),
    turnNumber: match.turnNumber,
    playerId: shooter.id,
    playerName: shooter.name,
    expression: expression.source,
    direction: input.direction,
    points: simulation.points,
    outcome: simulation.outcome,
    hitPlayerId: target?.id ?? null,
    hitPlayerName: target?.name ?? null,
    damage,
    message,
    auto: input.auto ?? false,
    createdAt: input.now,
  };
  match.lastShot = shot;
  match.shots.unshift(shot);
  match.shots = match.shots.slice(0, MAX_SHOT_HISTORY);
  event(match, input.auto ? "timeout" : "shot", `${shooter.name}: ${message}`, input.now);

  if (!checkVictory(match, input.now)) {
    nextTurn(match, input.now);
  }
  bump(match, input.now);
  return { shot, match };
}

export function isTurnExpired(match: MatchState, now: number, disconnectedGrace = DISCONNECT_GRACE_MS): boolean {
  if (match.status !== "active" || !match.turnDeadline) return false;
  if (now >= match.turnDeadline) return true;
  const current = match.players.find((p) => p.id === match.currentPlayerId);
  return Boolean(
    current &&
      !current.connected &&
      current.disconnectedAt !== null &&
      now - current.disconnectedAt >= disconnectedGrace,
  );
}

/** Auto-fire a guaranteed-harmless shot so a match can never stall. */
export function timeoutTurn(match: MatchState, now: number): ShotResolution | null {
  if (match.status !== "active" || !match.currentPlayerId) return null;
  const current = match.players.find((p) => p.id === match.currentPlayerId);
  if (!current) return null;
  const direction: Direction = current.x <= 0 ? "right" : "left";
  return submitShot(match, {
    playerId: current.id,
    // The projectile immediately leaves the top of the chart, so a timeout
    // cannot damage another player or accidentally decide the match.
    expression: "100",
    direction,
    turnNumber: match.turnNumber,
    version: match.version,
    now,
    auto: true,
  });
}

function promoteHost(match: MatchState): void {
  if (match.players.some((p) => p.id === match.hostId)) return;
  const next = match.players.find((p) => p.kind === "human") ?? match.players[0];
  if (next) match.hostId = next.id;
}

export function leaveMatch(match: MatchState, playerId: string, now: number): { removed: boolean } {
  const index = match.players.findIndex((p) => p.id === playerId);
  if (index < 0) throw new GameError("NOT_IN_MATCH", "You are not in this match.");
  const player = match.players[index];

  if (match.status === "waiting") {
    match.players.splice(index, 1);
    promoteHost(match);
    event(match, "leave", `${player.name} left the lobby.`, now);
    bump(match, now);
    return { removed: match.players.length === 0 };
  }

  if (match.status === "active") {
    if (!player.eliminated) {
      player.eliminated = true;
      player.health = 0;
    }
    player.connected = false;
    player.disconnectedAt = now;
    event(match, "leave", `${player.name} left and forfeited.`, now);
    const won = checkVictory(match, now);
    if (!won && match.currentPlayerId === player.id) {
      nextTurn(match, now);
    }
    bump(match, now);
    return { removed: false };
  }

  // Finished matches: remove the participant; the result remains for everyone else.
  match.players.splice(index, 1);
  promoteHost(match);
  bump(match, now);
  return { removed: match.players.length === 0 };
}

export function connectPlayer(match: MatchState, playerId: string, now: number): void {
  const player = match.players.find((p) => p.id === playerId);
  if (!player) throw new GameError("NOT_IN_MATCH", "You are not in this match.");
  if (!player.connected) {
    player.connected = true;
    player.disconnectedAt = null;
    if (match.status === "active") event(match, "reconnect", `${player.name} reconnected.`, now);
    bump(match, now);
  }
}

export function disconnectPlayer(match: MatchState, playerId: string, now: number): void {
  const player = match.players.find((p) => p.id === playerId);
  if (!player || !player.connected) return;
  player.connected = false;
  player.disconnectedAt = now;
  if (match.status === "active") event(match, "disconnect", `${player.name} disconnected.`, now);
  bump(match, now);
}

export function requestRematch(match: MatchState, playerId: string, now: number): void {
  if (match.status !== "finished") throw new GameError("NOT_FINISHED", "The match has not finished.");
  if (!match.players.some((p) => p.id === playerId)) {
    throw new GameError("NOT_IN_MATCH", "You are not in this match.");
  }
  const remaining = match.players.filter((p) => p.connected || p.kind === "bot");
  if (remaining.length < MIN_PLAYERS) {
    throw new GameError("NOT_ENOUGH_PLAYERS", "Not enough connected players for a rematch.");
  }
  match.players = remaining.map((p, index) => {
    p.colorIndex = index;
    p.ready = p.kind === "bot";
    p.health = MAX_HEALTH;
    p.eliminated = false;
    p.connected = p.kind === "human" ? p.connected : true;
    p.disconnectedAt = null;
    p.x = 0;
    p.y = 0;
    p.shotsFired = 0;
    p.hits = 0;
    return p;
  });
  if (!match.players.some((p) => p.id === match.hostId)) {
    match.hostId = match.players.find((p) => p.kind === "human")?.id ?? match.players[0].id;
  }
  match.status = "waiting";
  match.currentPlayerId = null;
  match.turnNumber = 0;
  match.turnStartedAt = null;
  match.turnDeadline = null;
  match.startedAt = null;
  match.finishedAt = null;
  match.winnerId = null;
  match.finishReason = null;
  match.lastShot = null;
  match.shots = [];
  match.statsRecorded = false;
  event(match, "rematch", "Rematch lobby opened.", now);
  bump(match, now);
}

export function matchSummary(match: MatchState): {
  id: string;
  code: string;
  status: MatchState["status"];
  playerCount: number;
} {
  return { id: match.id, code: match.code, status: match.status, playerCount: match.players.length };
}
