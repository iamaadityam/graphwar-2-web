import type { MatchState } from "../../shared/types";
import { UNIT_COLORS } from "../../shared/game/world";

interface ResultsOverlayProps {
  match: MatchState;
  accountId: string;
  busy: string | null;
  onRematch: () => void;
  onLeave: () => void;
}

const REASON_LABEL: Record<string, string> = {
  "last-standing": "Last unit standing",
  forfeit: "Opponent forfeited",
  draw: "Mutual elimination",
  abandoned: "Match abandoned",
};

export function ResultsOverlay({ match, accountId, busy, onRematch, onLeave }: ResultsOverlayProps) {
  const winner = match.players.find((player) => player.id === match.winnerId);
  const winnerColor = winner ? UNIT_COLORS[winner.colorIndex % UNIT_COLORS.length] : "#7dffa6";
  const viewerWon = match.winnerId === accountId;
  const humanConnected = match.players.filter((player) => player.kind === "human" && player.connected).length;
  const canRematch = humanConnected >= 2 || (humanConnected >= 1 && match.players.some((p) => p.kind === "bot"));

  return (
    <div className="results-backdrop">
      <div className={`results-card ${viewerWon ? "victory" : ""}`}>
        <span className="eyebrow">{winner ? (viewerWon ? "MISSION COMPLETE" : "MATCH COMPLETE") : "MATCH COMPLETE"}</span>
        <h1>{winner ? (viewerWon ? "Victory" : `${winner.name} wins`) : "Draw"}</h1>
        {winner ? (
          <p className="results-subtitle">
            <span className="winner-dot" style={{ background: winnerColor, boxShadow: `0 0 22px ${winnerColor}` }} />
            {winner.name} is the last unit standing.
          </p>
        ) : (
          <p className="results-subtitle">No units remain operational.</p>
        )}

        <div className="result-meta">
          <div>
            <span>Reason</span>
            <strong>{REASON_LABEL[match.finishReason ?? ""] ?? "Match ended"}</strong>
          </div>
          <div>
            <span>Turns</span>
            <strong>{match.turnNumber}</strong>
          </div>
          <div>
            <span>Shots fired</span>
            <strong>{match.players.reduce((sum, player) => sum + player.shotsFired, 0)}</strong>
          </div>
        </div>

        <div className="result-roster">
          {match.players.map((player) => {
            const color = UNIT_COLORS[player.colorIndex % UNIT_COLORS.length];
            return (
              <div className={`result-player ${player.id === match.winnerId ? "winner" : ""}`} key={player.id}>
                <span className="result-swatch" style={{ background: color }} />
                <span>
                  <strong>{player.name}{player.id === accountId ? " (you)" : ""}</strong>
                  <small>
                    {player.hits} hits · {player.shotsFired} shots
                  </small>
                </span>
                <span className="result-status">{player.id === match.winnerId ? "WINNER" : player.eliminated ? "DOWN" : "SURVIVED"}</span>
              </div>
            );
          })}
        </div>

        <div className="results-actions">
          <button
            className="btn btn-primary btn-lg"
            onClick={onRematch}
            disabled={Boolean(busy) || !canRematch}
            type="button"
          >
            {busy === "rematch" ? "Opening lobby…" : "Rematch"}
          </button>
          <button className="btn btn-ghost btn-lg" onClick={onLeave} disabled={Boolean(busy)} type="button">
            Back to menu
          </button>
        </div>
        {!canRematch && (
          <p className="fine-print centered">Another connected player is required for a rematch.</p>
        )}
      </div>
    </div>
  );
}
