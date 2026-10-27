import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import type { ZodType } from "zod";
import {
  CreateSchema,
  EmptySchema,
  HelloSchema,
  JoinSchema,
  ReadySchema,
  RematchSchema,
  ShotSchema,
  type HelloInput,
  type ShotInput,
} from "./protocol";
import type { MatchManager } from "./match-manager";
import type { Store } from "./store";
import { GameError } from "../shared/game/engine";
import type { ActionResult, MatchState, Profile } from "../shared/types";
import { log } from "./logger";

type Ack<T = undefined> = (result: ActionResult<T>) => void;

interface SocketData {
  accountId?: string;
  matchId?: string;
  helloDone?: boolean;
  limiter?: RateLimiter;
  lastActionAt?: number;
}

class RateLimiter {
  private tokens = 40;
  private last = Date.now();

  take(): boolean {
    const now = Date.now();
    const refill = ((now - this.last) / 1000) * 8;
    this.last = now;
    this.tokens = Math.min(40, this.tokens + refill);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function room(matchId: string): string {
  return `match:${matchId}`;
}

function sanitizeName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

function failure(ack: Ack<never>, error: unknown): void {
  if (error instanceof GameError) {
    ack({ ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: Array<{ message?: string }> }).issues;
    ack({ ok: false, error: { code: "INVALID_INPUT", message: issues?.[0]?.message ?? "Invalid input." } });
    return;
  }
  log("error", "socket_action_failed", { message: error instanceof Error ? error.message : String(error) });
  ack({ ok: false, error: { code: "INTERNAL", message: "The server could not complete that action." } });
}

export function attachSocketServer(
  httpServer: HttpServer,
  store: Store,
  manager: MatchManager,
  allowedOrigins: string[],
): SocketServer {
  const io = new SocketServer(httpServer, {
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    cors: {
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error("Origin not allowed"), false);
      },
      methods: ["GET", "POST"],
    },
  });

  const accountSockets = new Map<string, Socket>();
  const rateLimitError = (ack: Ack<never>) =>
    ack({
      ok: false,
      error: { code: "RATE_LIMIT", message: "Too many actions. Wait a moment and try again." },
    });

  function joinAndSend(socket: Socket, match: MatchState | null): void {
    if (match) {
      const previous = socket.data.matchId as string | undefined;
      if (previous && previous !== match.id) socket.leave(room(previous));
      socket.data.matchId = match.id;
      socket.join(room(match.id));
      socket.emit("match:state", match);
    } else {
      const previous = socket.data.matchId as string | undefined;
      if (previous) socket.leave(room(previous));
      socket.data.matchId = undefined;
      socket.emit("match:left");
    }
  }

  function requireAccount(socket: Socket): string {
    const accountId = socket.data.accountId as string | undefined;
    if (!accountId) throw new GameError("NOT_AUTHENTICATED", "Introduce yourself before playing.");
    return accountId;
  }

  function action<T>(
    socket: Socket,
    ack: Ack<{ matchId: string }> | undefined,
    schema: ZodType<T>,
    payload: unknown,
    fn: (input: T, accountId: string) => void,
  ): void {
    if (!ack) return;
    const limiter = socket.data.limiter as RateLimiter;
    if (!limiter.take()) {
      rateLimitError(ack as Ack<never>);
      return;
    }
    try {
      const parsed = schema.parse(payload);
      const accountId = requireAccount(socket);
      fn(parsed, accountId);
      const match = manager.matchForAccount(accountId);
      joinAndSend(socket, match);
      ack({ ok: true, matchId: match?.id ?? "" });
    } catch (error) {
      failure(ack as Ack<never>, error);
    }
  }

  io.on("connection", (socket: Socket) => {
    socket.data.limiter = new RateLimiter() satisfies SocketData["limiter"];

    socket.on("profile:hello", (payload: unknown, ack?: Ack<Profile & { token?: string }>) => {
      if (!ack) return;
      if (socket.data.helloDone) {
        failure(ack as Ack<never>, new GameError("ALREADY_CONNECTED", "This connection is already signed in."));
        return;
      }
      if (!(socket.data.limiter as RateLimiter).take()) {
        rateLimitError(ack as Ack<never>);
        return;
      }
      try {
        const input: HelloInput = HelloSchema.parse(payload);
        const name = sanitizeName(input.name);
        if (!name) throw new GameError("BAD_NAME", "Choose a display name with visible characters.");
        let account;
        let token: string | undefined;
        if (input.accountId && input.token) {
          account = store.authenticate(input.accountId, input.token);
          if (!account) {
            throw new GameError("AUTH_FAILED", "Your saved session expired. Reload and choose a name.");
          }
          if (account.name !== name) {
            store.updateName(account.id, name);
            account.name = name;
          }
        } else if (!input.accountId && !input.token) {
          const newAccount = store.createAccount(name);
          account = newAccount.account;
          token = newAccount.token;
        } else {
          throw new GameError("AUTH_FAILED", "Incomplete saved session. Reload and try again.");
        }

        const previous = accountSockets.get(account.id);
        socket.data.accountId = account.id;
        socket.data.helloDone = true;
        accountSockets.set(account.id, socket);
        if (previous && previous.id !== socket.id) {
          previous.emit("session:replaced", { message: "This session was opened in another tab." });
          previous.disconnect(true);
        }

        const match = manager.reconnect(account.id);
        const profile = manager.profile(account.id);
        if (!profile) throw new GameError("AUTH_FAILED", "Account unavailable.");
        joinAndSend(socket, match);
        ack({
          ok: true,
          ...profile,
          token,
        });
      } catch (error) {
        failure(ack as Ack<never>, error);
      }
    });

    socket.on("match:create", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, CreateSchema, payload, (input, accountId) => {
        const account = store.getAccount(accountId);
        if (!account) throw new GameError("NOT_AUTHENTICATED", "Account not found.");
        manager.createLobby(account, input);
      });
    });

    socket.on("match:join", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, JoinSchema, payload, (input, accountId) => {
        const account = store.getAccount(accountId);
        if (!account) throw new GameError("NOT_AUTHENTICATED", "Account not found.");
        manager.joinByCode(account, input.code);
      });
    });

    socket.on("match:quick", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, EmptySchema, payload ?? {}, (_input, accountId) => {
        const account = store.getAccount(accountId);
        if (!account) throw new GameError("NOT_AUTHENTICATED", "Account not found.");
        manager.quickMatch(account);
      });
    });

    socket.on("match:solo", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, EmptySchema, payload ?? {}, (_input, accountId) => {
        const account = store.getAccount(accountId);
        if (!account) throw new GameError("NOT_AUTHENTICATED", "Account not found.");
        manager.createSolo(account);
      });
    });

    socket.on("match:ready", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, ReadySchema, payload ?? {}, (input, accountId) => {
        manager.setReady(accountId, input.ready);
      });
    });

    socket.on("match:start", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, EmptySchema, payload ?? {}, (_input, accountId) => {
        manager.start(accountId);
      });
    });

    socket.on("match:leave", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, EmptySchema, payload ?? {}, (_input, accountId) => {
        manager.leave(accountId);
      });
    });

    socket.on("match:rematch", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, RematchSchema, payload ?? {}, (_input, accountId) => {
        manager.rematch(accountId);
      });
    });

    socket.on("shot:submit", (payload: unknown, ack?: Ack<{ matchId: string }>) => {
      action(socket, ack, ShotSchema, payload, (input, accountId) => {
        const match = manager.matchForAccount(accountId);
        if (!match) throw new GameError("NOT_IN_MATCH", "You are not in a match.");
        if (match.id !== (input as ShotInput).matchId) {
          throw new GameError("STALE_MATCH", "This match is no longer current.");
        }
        manager.submit(accountId, {
          expression: input.expression,
          direction: input.direction,
          turnNumber: input.turnNumber,
          version: input.version,
        });
      });
    });

    socket.on("disconnect", () => {
      const accountId = socket.data.accountId as string | undefined;
      if (!accountId) return;
      if (accountSockets.get(accountId)?.id === socket.id) {
        accountSockets.delete(accountId);
        try {
          manager.disconnect(accountId);
        } catch (error) {
          log("error", "disconnect_failed", {
            accountId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  });

  manager.onState((match) => {
    io.to(room(match.id)).emit("match:state", match);
  });

  manager.onClosed((matchId, reason) => {
    io.to(room(matchId)).emit("match:closed", { reason });
    io.socketsLeave(room(matchId));
  });

  return io;
}
