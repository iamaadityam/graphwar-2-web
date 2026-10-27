import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MatchState, PlayerStats } from "../shared/types";

interface AccountRow {
  id: string;
  token_hash: string;
  name: string;
  wins: number;
  losses: number;
  matches: number;
}

interface MatchRow {
  id: string;
  status: string;
  state_json: string;
}

export interface Account {
  id: string;
  name: string;
  stats: PlayerStats;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(resolve(filename)), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        matches INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        status TEXT NOT NULL,
        state_json TEXT NOT NULL,
        stats_recorded INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS matches_status_idx ON matches(status);
      CREATE INDEX IF NOT EXISTS matches_code_idx ON matches(code);
    `);
  }

  createAccount(name: string): { account: Account; token: string } {
    const id = `acc_${crypto.randomUUID()}`;
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO accounts (id, token_hash, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, hashToken(token), name, now);
    return {
      account: { id, name, stats: { wins: 0, losses: 0, matches: 0 } },
      token,
    };
  }

  authenticate(accountId: string, token: string): Account | null {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(accountId) as AccountRow | undefined;
    if (!row || !safeEqual(row.token_hash, hashToken(token))) return null;
    return {
      id: row.id,
      name: row.name,
      stats: { wins: row.wins, losses: row.losses, matches: row.matches },
    };
  }

  getAccount(accountId: string): Account | null {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(accountId) as AccountRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      stats: { wins: row.wins, losses: row.losses, matches: row.matches },
    };
  }

  updateName(accountId: string, name: string): void {
    this.db.prepare("UPDATE accounts SET name = ? WHERE id = ?").run(name, accountId);
  }

  saveMatch(match: MatchState): void {
    this.db
      .prepare(
        `INSERT INTO matches (id, code, status, state_json, stats_recorded, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           code = excluded.code,
           status = excluded.status,
           state_json = excluded.state_json,
           stats_recorded = excluded.stats_recorded,
           updated_at = excluded.updated_at`,
      )
      .run(
        match.id,
        match.code,
        match.status,
        JSON.stringify(match),
        match.statsRecorded ? 1 : 0,
        match.updatedAt,
      );
  }

  loadMatchStates(): MatchState[] {
    const rows = this.db
      .prepare(
        "SELECT id, status, state_json FROM matches WHERE status IN ('waiting','active','finished') ORDER BY updated_at ASC",
      )
      .all() as unknown as MatchRow[];
    const matches: MatchState[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.state_json) as MatchState;
        if (parsed && parsed.id === row.id && Array.isArray(parsed.players)) {
          matches.push(parsed);
        }
      } catch {
        // A corrupt snapshot must not prevent the server from booting.
        this.db.prepare("UPDATE matches SET status = 'abandoned' WHERE id = ?").run(row.id);
      }
    }
    return matches;
  }

  getMatchRecord(matchId: string): { status: string; state: MatchState | null } | null {
    const row = this.db
      .prepare("SELECT id, status, state_json FROM matches WHERE id = ?")
      .get(matchId) as MatchRow | undefined;
    if (!row) return null;
    try {
      return { status: row.status, state: JSON.parse(row.state_json) as MatchState };
    } catch {
      return { status: row.status, state: null };
    }
  }

  findWaitingCode(code: string): MatchState | null {
    const row = this.db
      .prepare("SELECT state_json FROM matches WHERE code = ? AND status = 'waiting' LIMIT 1")
      .get(code) as { state_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.state_json) as MatchState;
    } catch {
      return null;
    }
  }

  /**
   * Record final results exactly once. The flag is stored in the same
   * transaction as the account updates, so a crash cannot award twice.
   */
  recordResultIfNeeded(match: MatchState): boolean {
    const row = this.db
      .prepare("SELECT stats_recorded FROM matches WHERE id = ?")
      .get(match.id) as { stats_recorded: number } | undefined;
    if (!row || row.stats_recorded === 1) {
      if (row?.stats_recorded === 1) match.statsRecorded = true;
      return false;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const player of match.players) {
        if (player.kind !== "human") continue;
        const won = match.winnerId === player.id;
        const draw = match.winnerId === null;
        this.db
          .prepare(
            `UPDATE accounts SET matches = matches + 1,
              wins = wins + ?, losses = losses + ?
             WHERE id = ?`,
          )
          .run(won ? 1 : 0, !won && !draw ? 1 : 0, player.id);
      }
      this.db.prepare("UPDATE matches SET stats_recorded = 1 WHERE id = ?").run(match.id);
      this.db.exec("COMMIT");
      match.statsRecorded = true;
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  abandonMatch(matchId: string): void {
    this.db
      .prepare("UPDATE matches SET status = 'abandoned', updated_at = ? WHERE id = ?")
      .run(Date.now(), matchId);
  }

  close(): void {
    this.db.close();
  }
}
