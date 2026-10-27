export const WORLD = {
  minX: -64,
  maxX: 64,
  minY: -12,
  maxY: 52,
  unitRadius: 2.25,
  projectileRadius: 0.35,
  maxTrajectoryDistance: 132,
  step: 0.2,
} as const;

export const MAX_HEALTH = 100;
export const SHOT_DAMAGE = 35;
export const TURN_SECONDS = 30;
export const DISCONNECT_GRACE_MS = 5_000;
export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;
export const MAX_EXPRESSION_LENGTH = 120;
export const MAX_SHOT_HISTORY = 12;

export type Direction = "left" | "right";
export type PlayerKind = "human" | "bot";
export type MatchStatus = "waiting" | "active" | "finished" | "abandoned";
export type MatchVisibility = "public" | "private";
export type ShotOutcome = "hit" | "terrain" | "boundary" | "range" | "invalid";
export type MatchFinishReason = "last-standing" | "forfeit" | "draw" | "abandoned";

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id: string;
  name: string;
  kind: PlayerKind;
  colorIndex: number;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
  /** Server-assigned world position. Zero while still in the lobby. */
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  eliminated: boolean;
  shotsFired: number;
  hits: number;
}

export interface ShotPoint {
  x: number;
  y: number;
}

export interface ShotResult {
  id: string;
  turnNumber: number;
  playerId: string;
  playerName: string;
  expression: string;
  direction: Direction;
  points: ShotPoint[];
  outcome: ShotOutcome;
  hitPlayerId: string | null;
  hitPlayerName: string | null;
  damage: number;
  message: string;
  auto: boolean;
  createdAt: number;
}

export interface MatchEvent {
  id: string;
  at: number;
  kind: "join" | "leave" | "start" | "shot" | "timeout" | "disconnect" | "reconnect" | "finish" | "rematch";
  message: string;
}

export interface MatchState {
  id: string;
  code: string;
  visibility: MatchVisibility;
  status: MatchStatus;
  maxPlayers: number;
  hostId: string;
  players: PlayerState[];
  currentPlayerId: string | null;
  turnNumber: number;
  version: number;
  turnStartedAt: number | null;
  turnDeadline: number | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  winnerId: string | null;
  finishReason: MatchFinishReason | null;
  lastShot: ShotResult | null;
  shots: ShotResult[];
  events: MatchEvent[];
  botSeed: number;
  statsRecorded: boolean;
}

export interface PlayerStats {
  wins: number;
  losses: number;
  matches: number;
}

export interface Profile {
  accountId: string;
  name: string;
  stats: PlayerStats;
}

export interface GameErrorPayload {
  code: string;
  message: string;
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : T))
  | { ok: false; error: GameErrorPayload };
