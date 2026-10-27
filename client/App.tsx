import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import type {
  ActionResult,
  MatchState,
  PlayerStats,
  Profile,
} from "../shared/types";
import { MenuScreen } from "./components/MenuScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { GameScreen } from "./components/GameScreen";

const SESSION_KEY = "gw.session.v1";
const NAME_KEY = "gw.name.v1";

interface StoredSession {
  accountId: string;
  token: string;
  name: string;
}

type ConnectionState = "connecting" | "online" | "offline";
type ToastKind = "info" | "error" | "success";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.accountId === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.name === "string"
    ) {
      return { accountId: parsed.accountId, token: parsed.token, name: parsed.name };
    }
  } catch {
    // Ignore malformed local data.
  }
  return null;
}

export function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [name, setName] = useState(() => loadSession()?.name ?? localStorage.getItem(NAME_KEY) ?? "");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [authStatus, setAuthStatus] = useState<"idle" | "signing">("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [blocked, setBlocked] = useState(false);
  const sessionRef = useRef(session);
  const nameRef = useRef(name);
  const signingRef = useRef(false);
  const toastId = useRef(0);

  sessionRef.current = session;
  nameRef.current = name;

  const notify = useCallback((message: string, kind: ToastKind = "info") => {
    toastId.current += 1;
    setToast({ id: toastId.current, message, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const signIn = useCallback(
    (requestedName: string, saved: StoredSession | null, allowNewProfile = true) => {
      const cleanName = requestedName.trim();
      if (!cleanName || signingRef.current) return;
      if (!socket.connected) {
        notify("Not connected to the server yet. Reconnecting…", "error");
        socket.connect();
        return;
      }
      signingRef.current = true;
      setAuthStatus("signing");
      setAuthError(null);
      const payload = saved
        ? { name: cleanName, accountId: saved.accountId, token: saved.token }
        : { name: cleanName };
      socket.timeout(8_000).emit(
        "profile:hello",
        payload,
        (timeoutError: Error | null, response: ActionResult<Profile & { token?: string }>) => {
          signingRef.current = false;
          setAuthStatus("idle");
          if (timeoutError || !response) {
            setAuthError("The server did not answer. Check your connection and try again.");
            notify("Could not sign in — server timeout.", "error");
            return;
          }
          if (!response.ok) {
            if (response.error.code === "AUTH_FAILED" && saved && allowNewProfile) {
              localStorage.removeItem(SESSION_KEY);
              setSession(null);
              setProfile(null);
              notify("Saved session expired — starting a fresh profile.", "info");
              signIn(cleanName, null, false);
              return;
            }
            setAuthError(response.error.message);
            notify(response.error.message, "error");
            return;
          }
          const token = response.token ?? saved?.token;
          if (!token) {
            setAuthError("The server did not return a session token.");
            return;
          }
          const next: StoredSession = {
            accountId: response.accountId,
            token,
            name: response.name,
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
          localStorage.setItem(NAME_KEY, response.name);
          sessionRef.current = next;
          setSession(next);
          setName(response.name);
          setProfile({
            accountId: response.accountId,
            name: response.name,
            stats: response.stats,
          });
          setAuthError(null);
        },
      );
    },
    [notify],
  );

  useEffect(() => {
    const onConnect = () => {
      setConnection("online");
      setBlocked(false);
      const saved = sessionRef.current;
      if (saved) signIn(nameRef.current || saved.name, saved);
    };
    const onDisconnect = () => setConnection("offline");
    const onConnectError = () => setConnection("offline");
    const onState = (state: MatchState) => setMatch(state);
    const onLeft = () => setMatch(null);
    const onClosed = (payload: { reason?: string }) => {
      setMatch(null);
      notify(payload.reason ?? "The match was closed.", "info");
    };
    const onReplaced = () => {
      setBlocked(true);
      socket.disconnect();
      setConnection("offline");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("match:state", onState);
    socket.on("match:left", onLeft);
    socket.on("match:closed", onClosed);
    socket.on("session:replaced", onReplaced);
    socket.connect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("match:state", onState);
      socket.off("match:left", onLeft);
      socket.off("match:closed", onClosed);
      socket.off("session:replaced", onReplaced);
      socket.disconnect();
    };
  }, [notify, signIn]);

  const request = useCallback(
    <T,>(event: string, payload: unknown, label: string): Promise<ActionResult<T> | null> => {
      if (!socket.connected) {
        notify("You are offline. Reconnecting…", "error");
        socket.connect();
        return Promise.resolve(null);
      }
      setBusy(label);
      return new Promise((resolve) => {
        socket.timeout(10_000).emit(
          event,
          payload,
          (timeoutError: Error | null, response: ActionResult<T>) => {
            setBusy(null);
            if (timeoutError || !response) {
              notify("The server did not respond. Please try again.", "error");
              resolve(null);
              return;
            }
            if (!response.ok) {
              notify(response.error.message, "error");
              resolve(response);
              return;
            }
            resolve(response);
          },
        );
      });
    },
    [notify],
  );

  const submitName = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setAuthError("Enter a display name first.");
      return;
    }
    localStorage.setItem(NAME_KEY, name.trim());
    signIn(name, sessionRef.current);
  };

  const createMatch = (visibility: "public" | "private", maxPlayers: number) => {
    void request("match:create", { visibility, maxPlayers }, "create");
  };
  const joinMatch = (code: string) => {
    void request("match:join", { code }, "join");
  };
  const quickMatch = () => {
    void request("match:quick", {}, "quick");
  };
  const soloMatch = () => {
    void request("match:solo", {}, "solo");
  };
  const toggleReady = (ready: boolean) => {
    void request("match:ready", { ready }, "ready");
  };
  const startMatch = () => {
    void request("match:start", {}, "start");
  };
  const leaveMatch = () => {
    void request("match:leave", {}, "leave");
  };
  const rematch = () => {
    void request("match:rematch", {}, "rematch");
  };
  const fire = (expression: string, direction: "left" | "right") => {
    if (!match) return;
    void request(
      "shot:submit",
      {
        matchId: match.id,
        turnNumber: match.turnNumber,
        version: match.version,
        expression,
        direction,
      },
      "fire",
    );
  };

  const accountId = profile?.accountId ?? session?.accountId ?? "";
  const stats: PlayerStats | null = profile?.stats ?? null;

  let content;
  if (blocked) {
    content = (
      <div className="full-message">
        <div className="full-message-card">
          <span className="eyebrow">SESSION MOVED</span>
          <h1>Game open in another tab</h1>
          <p>Only one live connection is allowed for a profile. You can take the session back here.</p>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => {
              setBlocked(false);
              socket.connect();
            }}
          >
            Use this tab
          </button>
        </div>
      </div>
    );
  } else if (!match) {
    content = (
      <MenuScreen
        profile={profile}
        stats={stats}
        name={name}
        onNameChange={setName}
        onSubmitName={submitName}
        connection={connection}
        authStatus={authStatus}
        authError={authError}
        busy={busy}
        onCreate={createMatch}
        onJoin={joinMatch}
        onQuick={quickMatch}
        onSolo={soloMatch}
      />
    );
  } else if (match.status === "waiting") {
    content = (
      <LobbyScreen
        match={match}
        accountId={accountId}
        connection={connection}
        busy={busy}
        onReady={toggleReady}
        onStart={startMatch}
        onLeave={leaveMatch}
        notify={notify}
      />
    );
  } else {
    content = (
      <GameScreen
        match={match}
        accountId={accountId}
        connection={connection}
        busy={busy}
        onFire={fire}
        onLeave={leaveMatch}
        onRematch={rematch}
        notify={notify}
      />
    );
  }

  return (
    <div className="app">
      {content}
      {connection !== "online" && !blocked && (
        <div className={`connection-banner ${connection}`}>
          <span className="connection-dot" />
          {connection === "connecting"
            ? "Connecting to game server…"
            : "Connection lost — reconnecting. Your match is preserved."}
        </div>
      )}
      {toast && (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
          <span>{toast.message}</span>
          <button aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
