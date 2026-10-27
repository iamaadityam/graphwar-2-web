import { randomInt } from "node:crypto";
import type {
  Direction,
  MatchState,
  MatchVisibility,
  PlayerState,
  Profile,
} from "../shared/types";
import { MAX_PLAYERS } from "../shared/types";
import {
  addPlayer,
  canStart,
  connectPlayer,
  createMatch,
  disconnectPlayer,
  GameError,
  isTurnExpired,
  leaveMatch,
  newId,
  requestRematch,
  setReady,
  startMatch,
  submitShot,
  timeoutTurn,
} from "../shared/game/engine";
import { chooseBotShot } from "../shared/game/bot";
import type { Store } from "./store";

export interface ManagerOptions {
  botDelayMs: number;
  tickMs: number;
  waitingTtlMs: number;
  finishedTtlMs: number;
  noHumansTtlMs: number;
  now?: () => number;
}

const DEFAULTS: ManagerOptions = {
  botDelayMs: 1_200,
  tickMs: 750,
  waitingTtlMs: 15 * 60_000,
  finishedTtlMs: 60 * 60_000,
  noHumansTtlMs: 2 * 60_000,
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export type StateListener = (match: MatchState) => void;
export type ClosedListener = (matchId: string, reason: string) => void;

export class MatchManager {
  private readonly matches = new Map<string, MatchState>();
  private readonly memberships = new Map<string, string>();
  private readonly botTimers = new Map<string, NodeJS.Timeout>();
  private readonly noHumansSince = new Map<string, number>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly closedListeners = new Set<ClosedListener>();
  private readonly options: ManagerOptions;
  private readonly now: () => number;
  private ticker: NodeJS.Timeout;

  constructor(
    private readonly store: Store,
    options: Partial<ManagerOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.now = this.options.now ?? Date.now;
    this.restore();
    this.ticker = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        console.error("[manager] tick failed", error);
      }
    }, this.options.tickMs);
    this.ticker.unref();
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onClosed(listener: ClosedListener): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  private restore(): void {
    const restored = this.store.loadMatchStates();
    const now = this.now();
    const statusRank = { active: 3, waiting: 2, finished: 1, abandoned: 0 } as const;
    const membershipRank = new Map<string, number>();

    for (const match of restored) {
      // Sockets do not survive a restart. Preserve the state and mark everyone
      // as disconnected instead of pretending they are still live.
      for (const player of match.players) {
        if (player.kind === "human") {
          player.connected = false;
          player.disconnectedAt = now;
        }
      }
      if (match.status === "active") {
        match.turnDeadline = Math.max(match.turnDeadline ?? 0, now + 30_000);
        this.noHumansSince.set(match.id, now);
      }
      this.matches.set(match.id, match);
      for (const player of match.players) {
        if (player.kind !== "human") continue;
        const rank = statusRank[match.status];
        const existing = membershipRank.get(player.id) ?? -1;
        if (rank > existing) {
          this.memberships.set(player.id, match.id);
          membershipRank.set(player.id, rank);
        }
      }
      try {
        this.store.saveMatch(match);
      } catch (error) {
        console.error(`[manager] could not persist restored match ${match.id}`, error);
      }
    }
  }

  /** Account profile with fresh persisted stats. */
  profile(accountId: string): (Profile & { currentMatchId: string | null }) | null {
    const account = this.store.getAccount(accountId);
    if (!account) return null;
    const matchId = this.memberships.get(accountId) ?? null;
    const match = matchId ? this.matches.get(matchId) : null;
    return {
      accountId: account.id,
      name: account.name,
      stats: account.stats,
      currentMatchId: match ? match.id : null,
    };
  }

  matchForAccount(accountId: string): MatchState | null {
    const id = this.memberships.get(accountId);
    return id ? this.matches.get(id) ?? null : null;
  }

  getMatch(matchId: string): MatchState | null {
    return this.matches.get(matchId) ?? null;
  }

  listMatches(): MatchState[] {
    return [...this.matches.values()];
  }

  private ensureFree(accountId: string): void {
    if (this.memberships.has(accountId)) {
      throw new GameError("IN_MATCH", "Leave your current match before starting another.");
    }
  }

  private nextCode(): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = makeCode();
      const existing = [...this.matches.values()].some((m) => m.code === code && m.status !== "abandoned");
      if (!existing && !this.store.findWaitingCode(code)) return code;
    }
    return makeCode();
  }

  private attach(accountId: string, match: MatchState): void {
    this.memberships.set(accountId, match.id);
    if (match.status === "active" && this.hasConnectedHuman(match)) {
      this.noHumansSince.delete(match.id);
    }
  }

  private persist(match: MatchState): void {
    if (match.status === "finished" && !match.statsRecorded) {
      this.store.recordResultIfNeeded(match);
    }
    this.store.saveMatch(match);
    for (const listener of this.stateListeners) {
      try {
        listener(match);
      } catch (error) {
        console.error("[manager] state listener failed", error);
      }
    }
    this.scheduleBot(match);
  }

  createLobby(
    account: { id: string; name: string },
    options: { visibility: MatchVisibility; maxPlayers?: number },
  ): MatchState {
    this.ensureFree(account.id);
    const now = this.now();
    const match = createMatch({
      id: newId("match"),
      code: this.nextCode(),
      visibility: options.visibility,
      maxPlayers: Math.min(MAX_PLAYERS, Math.max(2, options.maxPlayers ?? MAX_PLAYERS)),
      host: { id: account.id, name: account.name },
      now,
    });
    this.matches.set(match.id, match);
    this.attach(account.id, match);
    this.persist(match);
    return match;
  }

  joinByCode(account: { id: string; name: string }, rawCode: string): MatchState {
    this.ensureFree(account.id);
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) throw new GameError("BAD_CODE", "Enter the six-character match code.");
    const match = [...this.matches.values()].find(
      (m) => m.code === code && m.status === "waiting",
    );
    if (!match) throw new GameError("NOT_FOUND", "No waiting match was found with that code.");
    const now = this.now();
    addPlayer(match, { id: account.id, name: account.name }, now);
    this.attach(account.id, match);
    this.persist(match);
    return match;
  }

  quickMatch(account: { id: string; name: string }): { match: MatchState; created: boolean } {
    const current = this.matchForAccount(account.id);
    if (current) return { match: current, created: false };
    const now = this.now();
    const candidate = [...this.matches.values()]
      .filter(
        (m) =>
          m.status === "waiting" &&
          m.visibility === "public" &&
          m.players.length < m.maxPlayers &&
          now - m.createdAt < this.options.waitingTtlMs &&
          m.players.some((p) => p.kind === "human" && p.connected),
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (candidate) {
      addPlayer(candidate, { id: account.id, name: account.name }, now);
      this.attach(account.id, candidate);
      this.persist(candidate);
      return { match: candidate, created: false };
    }
    return {
      match: this.createLobby(account, { visibility: "public", maxPlayers: MAX_PLAYERS }),
      created: true,
    };
  }

  createSolo(account: { id: string; name: string }): MatchState {
    this.ensureFree(account.id);
    const now = this.now();
    const match = createMatch({
      id: newId("match"),
      code: this.nextCode(),
      visibility: "private",
      maxPlayers: 2,
      host: { id: account.id, name: account.name },
      now,
    });
    this.matches.set(match.id, match);
    this.attach(account.id, match);
    addPlayer(match, { id: newId("bot"), name: "Vector Bot", kind: "bot" }, now);
    setReady(match, account.id, true, now);
    startMatch(match, now);
    this.persist(match);
    return match;
  }

  setReady(accountId: string, ready: boolean): MatchState {
    const match = this.requireMembership(accountId);
    setReady(match, accountId, ready, this.now());
    this.persist(match);
    return match;
  }

  start(accountId: string): MatchState {
    const match = this.requireMembership(accountId);
    if (match.hostId !== accountId) throw new GameError("NOT_HOST", "Only the host can start the match.");
    startMatch(match, this.now());
    this.persist(match);
    return match;
  }

  submit(
    accountId: string,
    input: { expression: string; direction: Direction; turnNumber: number; version: number },
  ): MatchState {
    const match = this.requireMembership(accountId);
    submitShot(match, { ...input, playerId: accountId, now: this.now() });
    this.persist(match);
    return match;
  }

  rematch(accountId: string): MatchState {
    const match = this.requireMembership(accountId);
    requestRematch(match, accountId, this.now());
    this.persist(match);
    return match;
  }

  leave(accountId: string): MatchState | null {
    const match = this.requireMembership(accountId);
    const result = leaveMatch(match, accountId, this.now());
    this.memberships.delete(accountId);
    if (result.removed) {
      this.abandon(match, "Everyone left the match.");
      return null;
    }
    this.persist(match);
    return match;
  }

  reconnect(accountId: string): MatchState | null {
    const match = this.matchForAccount(accountId);
    if (!match) return null;
    connectPlayer(match, accountId, this.now());
    if (this.hasConnectedHuman(match)) this.noHumansSince.delete(match.id);
    this.persist(match);
    return match;
  }

  disconnect(accountId: string): MatchState | null {
    const match = this.matchForAccount(accountId);
    if (!match) return null;
    disconnectPlayer(match, accountId, this.now());
    if (!this.hasConnectedHuman(match)) this.noHumansSince.set(match.id, this.now());
    this.persist(match);
    return match;
  }

  private requireMembership(accountId: string): MatchState {
    const match = this.matchForAccount(accountId);
    if (!match) throw new GameError("NOT_IN_MATCH", "You are not in an active match.");
    if (match.status === "abandoned") throw new GameError("MATCH_CLOSED", "This match was closed.");
    return match;
  }

  private hasConnectedHuman(match: MatchState): boolean {
    return match.players.some((p) => p.kind === "human" && p.connected);
  }

  private scheduleBot(match: MatchState): void {
    if (this.botTimers.has(match.id)) return;
    if (match.status !== "active" || !match.currentPlayerId) return;
    const current = match.players.find((p) => p.id === match.currentPlayerId);
    if (!current || current.kind !== "bot" || !current.connected) return;
    if (!this.hasConnectedHuman(match)) return;
    const timer = setTimeout(() => {
      this.botTimers.delete(match.id);
      this.runBot(match.id);
    }, this.options.botDelayMs);
    this.botTimers.set(match.id, timer);
  }

  private runBot(matchId: string): void {
    const match = this.matches.get(matchId);
    if (!match || match.status !== "active") return;
    const current = match.players.find((p) => p.id === match.currentPlayerId);
    if (!current || current.kind !== "bot") return;
    try {
      const decision = chooseBotShot(match, current.id);
      submitShot(match, {
        playerId: current.id,
        expression: decision.expression,
        direction: decision.direction,
        turnNumber: match.turnNumber,
        version: match.version,
        now: this.now(),
      });
      this.persist(match);
    } catch (error) {
      console.error("[bot] failed to fire; using safe fallback", error);
      try {
        if (match.status === "active" && match.currentPlayerId === current.id) {
          timeoutTurn(match, this.now());
          this.persist(match);
        }
      } catch (fallbackError) {
        console.error("[bot] fallback failed", fallbackError);
      }
    }
  }

  tick(now = this.now()): void {
    for (const match of [...this.matches.values()]) {
      if (match.status === "active") {
        if (!this.hasConnectedHuman(match)) {
          const since = this.noHumansSince.get(match.id) ?? now;
          if (!this.noHumansSince.has(match.id)) this.noHumansSince.set(match.id, since);
          if (now - since >= this.options.noHumansTtlMs) {
            this.abandon(match, "No human players reconnected.");
            continue;
          }
          // Do not let bots or timeouts play out an abandoned match.
          continue;
        }
        this.noHumansSince.delete(match.id);
        if (isTurnExpired(match, now)) {
          try {
            timeoutTurn(match, now);
            this.persist(match);
          } catch (error) {
            console.error(`[manager] timeout failed for ${match.id}`, error);
          }
        } else {
          this.scheduleBot(match);
        }
      } else if (match.status === "waiting") {
        const connected = this.hasConnectedHuman(match);
        if (now - match.createdAt >= this.options.waitingTtlMs && !connected) {
          this.abandon(match, "The lobby expired.");
        }
      } else if (match.status === "finished") {
        if (now - (match.finishedAt ?? match.updatedAt) >= this.options.finishedTtlMs) {
          this.abandon(match, "The finished match expired.");
        }
      }
    }
  }

  cleanup(now = this.now()): void {
    this.tick(now);
  }

  private abandon(match: MatchState, reason: string): void {
    const timer = this.botTimers.get(match.id);
    if (timer) clearTimeout(timer);
    this.botTimers.delete(match.id);
    this.store.abandonMatch(match.id);
    this.matches.delete(match.id);
    this.noHumansSince.delete(match.id);
    for (const player of match.players) {
      if (player.kind === "human" && this.memberships.get(player.id) === match.id) {
        this.memberships.delete(player.id);
      }
    }
    for (const listener of this.closedListeners) {
      try {
        listener(match.id, reason);
      } catch (error) {
        console.error("[manager] closed listener failed", error);
      }
    }
  }

  /** Test and admin support: public match count. */
  get stats(): { matches: number; memberships: number } {
    return { matches: this.matches.size, memberships: this.memberships.size };
  }

  close(): void {
    clearInterval(this.ticker);
    for (const timer of this.botTimers.values()) clearTimeout(timer);
    this.botTimers.clear();
    this.stateListeners.clear();
    this.closedListeners.clear();
  }
}

export function buildProfile(
  account: { id: string; name: string; stats: Profile["stats"] },
  match: MatchState | null,
): Profile & { currentMatchId: string | null } {
  return {
    accountId: account.id,
    name: account.name,
    stats: account.stats,
    currentMatchId: match?.id ?? null,
  };
}

export type { PlayerState };
