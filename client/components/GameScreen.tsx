import { useEffect, useMemo, useRef, useState } from "react";
import type { Direction, MatchState } from "../../shared/types";
import { WORLD } from "../../shared/types";
import { compileExpression, MathExpressionError } from "../../shared/math/expression";
import { simulateTrajectory } from "../../shared/game/trajectory";
import { UNIT_COLORS } from "../../shared/game/world";
import { GameCanvas } from "./GameCanvas";
import { MathEditor } from "./MathEditor";
import { ResultsOverlay } from "./ResultsOverlay";
import type { PreviewResult } from "../types";

interface GameScreenProps {
  match: MatchState;
  accountId: string;
  connection: "connecting" | "online" | "offline";
  busy: string | null;
  onFire: (expression: string, direction: Direction) => void;
  onLeave: () => void;
  onRematch: () => void;
  notify: (message: string, kind?: "info" | "error" | "success") => void;
}

function formatTimer(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function GameScreen({
  match,
  accountId,
  connection,
  busy,
  onFire,
  onLeave,
  onRematch,
  notify,
}: GameScreenProps) {
  const me = match.players.find((player) => player.id === accountId) ?? null;
  const current = match.players.find((player) => player.id === match.currentPlayerId) ?? null;
  const isMyTurn =
    match.status === "active" &&
    match.currentPlayerId === accountId &&
    Boolean(me) &&
    !me?.eliminated &&
    Boolean(me?.connected);
  const [expression, setExpression] = useState("");
  const [direction, setDirection] = useState<Direction>("right");
  const [clock, setClock] = useState(() => Date.now());
  const lastAutoTurn = useRef("");

  useEffect(() => {
    if (match.status !== "active") return;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [match.status]);

  useEffect(() => {
    if (match.status !== "active" || !me) return;
    const key = `${match.currentPlayerId}:${match.turnNumber}`;
    if (lastAutoTurn.current === key) return;
    lastAutoTurn.current = key;
    const enemies = match.players.filter((player) => player.id !== me.id && !player.eliminated);
    if (!enemies.length) return;
    const nearest = enemies.reduce((closest, player) =>
      Math.abs(player.x - me.x) < Math.abs(closest.x - me.x) ? player : closest,
    );
    setDirection(nearest.x >= me.x ? "right" : "left");
  }, [match.currentPlayerId, match.turnNumber, match.status, match.players, me]);

  useEffect(() => {
    const last = match.lastShot;
    if (last && last.playerName && last.outcome === "hit") {
      // Toast feedback works alongside the canvas animation and health update.
      const wasMine = last.playerId === accountId;
      if (!wasMine) notify(`${last.playerName} hit ${last.hitPlayerName ?? "a unit"} for ${last.damage}.`, "info");
    }
    // Only react to a new shot id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.lastShot?.id]);

  const preview = useMemo<PreviewResult | null>(() => {
    const source = expression.trim();
    if (!source || !me) return null;
    try {
      const compiled = compileExpression(source);
      const simulation = simulateTrajectory(compiled, me, match.players, direction);
      const target = simulation.hitPlayerId
        ? match.players.find((player) => player.id === simulation.hitPlayerId)
        : null;
      return {
        ok: true,
        source,
        direction,
        points: simulation.points,
        outcome: simulation.outcome,
        hitPlayerId: simulation.hitPlayerId,
        hitPlayerName: target?.name ?? null,
        message: target
          ? `Impact at x=${simulation.points[simulation.points.length - 1]?.x.toFixed(1) ?? "?"}; ${target.name} has ${target.health} HP.`
          : simulation.message,
        error: null,
        nodeCount: compiled.nodeCount,
        characterCount: source.length,
        horizontalDistance: simulation.horizontalDistance,
      };
    } catch (error) {
      return {
        ok: false,
        source,
        direction,
        points: [],
        outcome: null,
        hitPlayerId: null,
        hitPlayerName: null,
        message: "",
        error: error instanceof MathExpressionError ? error.message : "Invalid expression.",
        nodeCount: 0,
        characterCount: source.length,
        horizontalDistance: 0,
      };
    }
  }, [expression, me, match.players, direction]);

  const remaining = match.turnDeadline ? Math.max(0, Math.ceil((match.turnDeadline - clock) / 1000)) : 0;
  const canFire =
    isMyTurn && connection === "online" && Boolean(me) && !me?.eliminated && !busy;
  const waitingReason =
    match.status === "finished"
      ? "Match finished."
      : !me
        ? "You are not part of this match."
        : me.eliminated
          ? "You were eliminated. You are spectating."
          : connection !== "online"
            ? "Reconnecting to the server…"
            : !isMyTurn
              ? `Waiting for ${current?.name ?? "the next player"} to fire.`
              : null;

  const nearestDistance = useMemo(() => {
    if (!me) return null;
    const enemies = match.players.filter((player) => player.id !== me.id && !player.eliminated);
    if (!enemies.length) return null;
    return Math.min(...enemies.map((player) => Math.abs(player.x - me.x)));
  }, [match.players, me]);

  const timerUrgent = remaining <= 10 && match.status === "active";
  const shotFeed = match.shots.slice(0, 4);

  return (
    <main className="game-screen">
      <header className="game-header">
        <div className="brand compact">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path d="M5 38 Q16 5 24 25 T43 12" fill="none" stroke="currentColor" strokeWidth="3" />
              <circle cx="43" cy="12" r="4" fill="#ff8a3d" />
            </svg>
          </span>
          <span>
            <strong>GRAPH</strong>WAR
            <em>LIVE MATCH</em>
          </span>
        </div>
        <div className="match-id-block">
          <span className="eyebrow">MATCH</span>
          <strong>{match.code}</strong>
        </div>
        <div className="game-header-right">
          <div className={`status-pill ${connection}`}>
            <span className="status-dot" />
            {connection === "online" ? "Live" : connection === "connecting" ? "Connecting" : "Offline"}
          </div>
          <button className="btn btn-ghost btn-small" onClick={onLeave} disabled={Boolean(busy)} type="button">
            Leave
          </button>
        </div>
      </header>

      <section className={`turn-banner ${isMyTurn ? "my-turn" : ""} ${timerUrgent ? "urgent" : ""}`} aria-live="polite">
        <div className="turn-main">
          <span className="turn-kicker">{match.status === "finished" ? "MATCH OVER" : isMyTurn ? "YOUR TURN" : "ENEMY TURN"}</span>
          <strong>
            {match.status === "finished"
              ? match.winnerId === accountId
                ? "Victory secured"
                : "Battle concluded"
              : isMyTurn
                ? "Plot a function and fire"
                : `${current?.name ?? "Next unit"} is calculating`}
          </strong>
          {nearestDistance !== null && (
            <span className="turn-meta">Nearest target {nearestDistance.toFixed(1)} units away</span>
          )}
        </div>
        <div className={`turn-clock ${timerUrgent ? "urgent" : ""}`}>
          <span>TURN CLOCK</span>
          <strong>{match.status === "active" ? formatTimer(remaining) : "—:—"}</strong>
        </div>
      </section>

      <div className="game-layout">
        <div className="stage-column">
          <div className="player-hud">
            {match.players.map((player) => {
              const color = UNIT_COLORS[player.colorIndex % UNIT_COLORS.length];
              const active = match.currentPlayerId === player.id && match.status === "active";
              return (
                <div
                  key={player.id}
                  className={`hud-unit ${active ? "active-current" : ""} ${player.eliminated ? "down" : ""} ${!player.connected ? "offline" : ""}`}
                >
                  <span className="hud-icon" style={{ borderColor: color, color }}>
                    {player.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="hud-unit-body">
                    <div className="hud-unit-top">
                      <strong>
                        {player.name}
                        {player.id === accountId && <em>YOU</em>}
                      </strong>
                      <span>{player.eliminated ? "DOWN" : `${player.health} HP`}</span>
                    </div>
                    <div className="mini-health">
                      <span
                        style={{
                          width: `${Math.max(0, (player.health / player.maxHealth) * 100)}%`,
                          background: color,
                        }}
                      />
                    </div>
                  </div>
                  {active && <span className="active-caret">●</span>}
                </div>
              );
            })}
          </div>

          <div className="canvas-shell">
            <GameCanvas
              match={match}
              viewerId={accountId}
              preview={match.status === "active" && isMyTurn ? preview : null}
            />
            <div className="canvas-corner">
              <span>WIND</span>
              <strong>0.0</strong>
              <span>GRAVITY</span>
              <strong>FUNCTION</strong>
            </div>
            {!isMyTurn && match.status === "active" && (
              <div className="spectator-chip">
                <span className="waiting-pulse" />
                Following {current?.name ?? "next unit"}
              </div>
            )}
          </div>

          <div className="shot-feed">
            <div className="section-heading">
              <span className="eyebrow">BALLISTIC LOG</span>
              <span>{match.shots.length} shots</span>
            </div>
            {shotFeed.length === 0 ? (
              <p className="empty-log">No projectiles fired yet. The grid is waiting.</p>
            ) : (
              <div className="log-list">
                {shotFeed.map((shot) => (
                  <div className={`log-entry ${shot.outcome}`} key={shot.id}>
                    <span className="log-turn">T{shot.turnNumber}</span>
                    <div className="log-body">
                      <div>
                        <strong>{shot.playerName}</strong>
                        <code>{shot.expression}</code>
                        <span className={`log-outcome ${shot.outcome}`}>
                          {shot.auto ? "AUTO" : shot.outcome.toUpperCase()}
                        </span>
                      </div>
                      <small>{shot.message}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="control-column">
          <div className={`turn-panel ${isMyTurn ? "active" : ""}`}>
            <div className="turn-panel-head">
              <span className="eyebrow">CURRENT TURN</span>
              <span className={`turn-lamp ${isMyTurn ? "on" : ""}`} />
            </div>
            <div className="turn-player">
              <span
                className="turn-avatar"
                style={
                  current
                    ? {
                        borderColor: UNIT_COLORS[current.colorIndex % UNIT_COLORS.length],
                        color: UNIT_COLORS[current.colorIndex % UNIT_COLORS.length],
                      }
                    : undefined
                }
              >
                {current?.name.slice(0, 1).toUpperCase() ?? "?"}
              </span>
              <div>
                <strong>{isMyTurn ? "Your shot" : current?.name ?? "No active player"}</strong>
                <small>
                  {match.status === "active"
                    ? `${formatTimer(remaining)} remaining · turn ${match.turnNumber}`
                    : "Match complete"}
                </small>
              </div>
            </div>
            <div className="phase-meta">
              <span>HP {me?.health ?? 0}/{me?.maxHealth ?? 100}</span>
              <span>{match.players.filter((p) => !p.eliminated).length} units alive</span>
            </div>
          </div>

          <MathEditor
            expression={expression}
            onExpressionChange={setExpression}
            direction={direction}
            onDirectionChange={setDirection}
            preview={preview}
            canFire={canFire}
            waitingReason={waitingReason}
            busy={busy === "fire"}
            onFire={onFire}
          />

          <div className="rules-card">
            <span className="eyebrow">QUICK REFERENCE</span>
            <div><code>+ − * / ^</code><span>operators</span></div>
            <div><code>sin cos tan sqrt abs ln log exp</code><span>functions</span></div>
            <div><code>pi e tau</code><span>constants</span></div>
            <p>f(x) is the height offset from your unit at horizontal progress x.</p>
          </div>
        </aside>
      </div>

      {match.status === "finished" && (
        <ResultsOverlay
          match={match}
          accountId={accountId}
          busy={busy ?? ""}
          onRematch={onRematch}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}
