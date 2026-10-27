import { useEffect, useState } from "react";
import type { MatchState } from "../../shared/types";
import { UNIT_COLORS } from "../../shared/game/world";

interface LobbyScreenProps {
  match: MatchState;
  accountId: string;
  connection: "connecting" | "online" | "offline";
  busy: string | null;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  notify: (message: string, kind?: "info" | "error" | "success") => void;
}

export function LobbyScreen({
  match,
  accountId,
  connection,
  busy,
  onReady,
  onStart,
  onLeave,
  notify,
}: LobbyScreenProps) {
  const [copied, setCopied] = useState(false);
  const me = match.players.find((player) => player.id === accountId);
  const isHost = match.hostId === accountId;
  const humans = match.players.filter((player) => player.kind === "human");
  const allReady = humans.every((player) => player.ready);
  const allConnected = humans.every((player) => player.connected);
  const canStart = isHost && match.players.length >= 2 && allReady && allConnected;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(match.code);
      setCopied(true);
    } catch {
      notify(`Match code: ${match.code}`, "info");
    }
  };

  return (
    <main className="lobby-screen">
      <div className="menu-grid-bg" aria-hidden="true" />
      <header className="site-header">
        <div className="brand compact">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path d="M5 38 Q16 5 24 25 T43 12" fill="none" stroke="currentColor" strokeWidth="3" />
              <circle cx="43" cy="12" r="4" fill="#ff8a3d" />
            </svg>
          </span>
          <span>
            <strong>GRAPH</strong>WAR
            <em>LOBBY</em>
          </span>
        </div>
        <div className={`status-pill ${connection}`}>
          <span className="status-dot" />
          {connection === "online" ? "Connected" : connection === "connecting" ? "Connecting" : "Offline"}
        </div>
      </header>

      <section className="lobby-shell">
        <div className="lobby-main">
          <div className="lobby-heading">
            <span className="eyebrow">{match.visibility === "private" ? "PRIVATE LOBBY" : "PUBLIC LOBBY"}</span>
            <h1>Assemble the battery</h1>
            <p>
              Everyone marks ready. The host launches the match. Four units maximum; last unit
              standing wins.
            </p>
          </div>

          <div className="code-card">
            <div>
              <span className="eyebrow">JOIN CODE</span>
              <strong className="match-code">{match.code}</strong>
            </div>
            <button className="btn btn-ghost" onClick={copyCode} type="button">
              {copied ? "Copied!" : "Copy code"}
            </button>
          </div>

          <div className="player-list">
            {match.players.map((player, index) => {
              const color = UNIT_COLORS[player.colorIndex % UNIT_COLORS.length];
              const isMe = player.id === accountId;
              return (
                <div className={`lobby-player ${!player.connected ? "is-offline" : ""}`} key={player.id}>
                  <div className="player-index">{String(index + 1).padStart(2, "0")}</div>
                  <div className="unit-swatch" style={{ background: color, boxShadow: `0 0 24px ${color}55` }}>
                    {player.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="lobby-player-info">
                    <strong>
                      {player.name}
                      {isMe && <span className="you-tag">YOU</span>}
                      {player.id === match.hostId && <span className="host-tag">HOST</span>}
                    </strong>
                    <small>
                      {player.kind === "bot" ? "Server bot" : player.connected ? "Connected" : "Disconnected"}
                    </small>
                  </div>
                  <span className={`ready-badge ${player.ready ? "ready" : ""}`}>
                    {player.kind === "bot" ? "BOT READY" : player.ready ? "READY" : "WAITING"}
                  </span>
                </div>
              );
            })}
            {Array.from({ length: Math.max(0, match.maxPlayers - match.players.length) }).map((_, index) => (
              <div className="lobby-player empty-slot" key={`empty-${index}`}>
                <div className="player-index">{String(match.players.length + index + 1).padStart(2, "0")}</div>
                <div className="unit-swatch empty">?</div>
                <div className="lobby-player-info">
                  <strong>Open slot</strong>
                  <small>Share the code to invite another unit</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="lobby-side">
          <div className="briefing-card">
            <span className="eyebrow">MISSION BRIEF</span>
            <ul>
              <li><span>01</span> Write a function f(x) for each shot.</li>
              <li><span>02</span> Pick left or right firing direction.</li>
              <li><span>03</span> Direct hits deal 35 damage.</li>
              <li><span>04</span> 100 HP each. Last unit wins.</li>
              <li><span>05</span> 30 seconds per turn.</li>
            </ul>
          </div>

          <div className="lobby-actions">
            {me && me.kind === "human" && (
              <button
                className={`btn btn-block ${me.ready ? "btn-ghost" : "btn-primary"}`}
                disabled={Boolean(busy) || !me.connected}
                onClick={() => onReady(!me.ready)}
                type="button"
              >
                {me.ready ? "Cancel ready" : "Mark ready"}
              </button>
            )}
            {isHost ? (
              <>
                <button
                  className="btn btn-primary btn-block"
                  disabled={!canStart || Boolean(busy)}
                  onClick={onStart}
                  type="button"
                >
                  Start match
                </button>
                {!canStart && (
                  <small className="action-hint">
                    {match.players.length < 2
                      ? "Waiting for at least one more player."
                      : !allConnected
                        ? "All players must be connected."
                        : "Every human must be ready."}
                  </small>
                )}
              </>
            ) : (
              <div className="waiting-card">
                <span className="waiting-pulse" />
                Waiting for host to launch
              </div>
            )}
            <button className="btn btn-danger-ghost btn-block" onClick={onLeave} disabled={Boolean(busy)} type="button">
              Leave lobby
            </button>
          </div>

          <div className="lobby-tip">
            <strong>Math tip</strong>
            <p>
              Your target is at horizontal distance <code>D</code>. A curve like{" "}
              <code>a*x + k*x*(D-x)/D²</code> starts at your unit, passes through the target at{" "}
              <code>x=D</code>, and can arc over terrain.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
