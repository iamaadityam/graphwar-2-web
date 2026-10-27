import { useState, type FormEvent } from "react";
import type { PlayerStats, Profile } from "../../shared/types";

interface MenuScreenProps {
  profile: Profile | null;
  stats: PlayerStats | null;
  name: string;
  onNameChange: (name: string) => void;
  onSubmitName: (event: FormEvent) => void;
  connection: "connecting" | "online" | "offline";
  authStatus: "idle" | "signing";
  authError: string | null;
  busy: string | null;
  onCreate: (visibility: "public" | "private", maxPlayers: number) => void;
  onJoin: (code: string) => void;
  onQuick: () => void;
  onSolo: () => void;
}

const EXAMPLES = ["10*sin(x/5)+15", "0.02*x^2", "sqrt(abs(x))*3", "-0.05*(x-20)^2+30"];

export function MenuScreen({
  profile,
  stats,
  name,
  onNameChange,
  onSubmitName,
  connection,
  authStatus,
  authError,
  busy,
  onCreate,
  onJoin,
  onQuick,
  onSolo,
}: MenuScreenProps) {
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [code, setCode] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const canPlay = Boolean(profile) && connection === "online" && !busy;
  const disabled = !canPlay;

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) onJoin(code);
  };

  return (
    <main className="menu-screen">
      <div className="menu-grid-bg" aria-hidden="true" />
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path d="M5 38 Q16 5 24 25 T43 12" fill="none" stroke="currentColor" strokeWidth="3" />
              <circle cx="43" cy="12" r="4" fill="#ff8a3d" />
            </svg>
          </span>
          <span>
            <strong>GRAPH</strong>WAR
            <em>WEB / FUNCTION ARTILLERY</em>
          </span>
        </div>
        <div className="header-right">
          <div className={`status-pill ${connection}`}>
            <span className="status-dot" />
            {connection === "online" ? "Server online" : connection === "connecting" ? "Connecting" : "Offline"}
          </div>
          {profile && (
            <div className="mini-profile">
              <span className="avatar">{profile.name.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{profile.name}</strong>
                <small>
                  {stats?.wins ?? 0}W · {stats?.losses ?? 0}L · {stats?.matches ?? 0} played
                </small>
              </span>
            </div>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">PLOT. FIRE. RECALCULATE.</span>
          <h1>
            Artillery,
            <br />
            <span className="text-gradient">drawn by math.</span>
          </h1>
          <p>
            Write a function. The server plots it. Your projectile rides the curve across a live
            Cartesian battlefield. Out-think your opponent — no aim slider required.
          </p>
          <div className="hero-stats">
            <div>
              <strong>2–4</strong>
              <span>players</span>
            </div>
            <div>
              <strong>30s</strong>
              <span>per turn</span>
            </div>
            <div>
              <strong>∞</strong>
              <span>curves</span>
            </div>
          </div>
          <div className="hero-legend">
            <span><i className="legend-line predicted" /> cyan dashed = preview</span>
            <span><i className="legend-line fired" /> orange solid = live shot</span>
          </div>
        </div>

        <div className="play-panel">
          {!profile ? (
            <form className="identity-card" onSubmit={onSubmitName}>
              <span className="eyebrow">CALL SIGN</span>
              <h2>Identify your unit</h2>
              <p>No email. No password. Your profile is a local session token.</p>
              <label className="field-label" htmlFor="display-name">
                Display name
              </label>
              <input
                id="display-name"
                className="text-input"
                value={name}
                maxLength={20}
                autoComplete="nickname"
                placeholder="e.g. Parabola"
                onChange={(event) => onNameChange(event.target.value)}
              />
              {authError && <div className="form-error">{authError}</div>}
              <button
                className="btn btn-primary btn-lg btn-block"
                type="submit"
                disabled={connection !== "online" || authStatus === "signing"}
              >
                {authStatus === "signing" ? "Registering…" : "Enter the arena"}
              </button>
              <small className="fine-print">
                Session tokens are stored locally. Clearing browser data starts a new profile.
              </small>
            </form>
          ) : (
            <>
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">READY ROOM</span>
                  <h2>Choose a battle</h2>
                </div>
                <span className="pilot-chip">{profile.name}</span>
              </div>

              <button
                className="action-card solo-card"
                disabled={disabled}
                onClick={onSolo}
                type="button"
              >
                <span className="action-icon">◎</span>
                <span>
                  <strong>Solo practice</strong>
                  <small>Instant match vs. Vector Bot</small>
                </span>
                <span className="action-arrow">→</span>
              </button>

              <button
                className="action-card quick-card"
                disabled={disabled}
                onClick={onQuick}
                type="button"
              >
                <span className="action-icon">⚡</span>
                <span>
                  <strong>Quick match</strong>
                  <small>Join a public lobby or open one</small>
                </span>
                <span className="action-arrow">→</span>
              </button>

              <div className="panel-split">
                <div className="sub-panel">
                  <span className="eyebrow">PRIVATE / PUBLIC</span>
                  <h3>Create a match</h3>
                  <div className="segmented">
                    <button
                      type="button"
                      className={visibility === "private" ? "active" : ""}
                      onClick={() => setVisibility("private")}
                    >
                      Private
                    </button>
                    <button
                      type="button"
                      className={visibility === "public" ? "active" : ""}
                      onClick={() => setVisibility("public")}
                    >
                      Public
                    </button>
                  </div>
                  <label className="field-label" htmlFor="max-players">
                    Max players
                  </label>
                  <select
                    id="max-players"
                    className="text-input"
                    value={maxPlayers}
                    onChange={(event) => setMaxPlayers(Number(event.target.value))}
                  >
                    <option value={2}>2 players</option>
                    <option value={3}>3 players</option>
                    <option value={4}>4 players</option>
                  </select>
                  <button
                    className="btn btn-secondary btn-block"
                    disabled={disabled}
                    onClick={() => onCreate(visibility, maxPlayers)}
                    type="button"
                  >
                    Create {visibility} match
                  </button>
                  {visibility === "private" && <small>You will get a six-character join code.</small>}
                </div>

                <form className="sub-panel" onSubmit={join}>
                  <span className="eyebrow">HAVE A CODE?</span>
                  <h3>Join a match</h3>
                  <label className="field-label" htmlFor="join-code">
                    Six-character code
                  </label>
                  <input
                    id="join-code"
                    className="text-input code-input"
                    value={code}
                    maxLength={6}
                    placeholder="A7K2Q9"
                    autoComplete="off"
                    onChange={(event) =>
                      setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                    }
                  />
                  <button
                    className="btn btn-secondary btn-block"
                    type="submit"
                    disabled={disabled || code.length !== 6}
                  >
                    Join match
                  </button>
                  <small>Private lobbies require the host's code.</small>
                </form>
              </div>
            </>
          )}
          {!profile && (
            <p className="panel-footnote">
              You must choose a call sign before creating or joining matches.
            </p>
          )}
        </div>
      </section>

      <section className="menu-lower">
        <button className="guide-toggle" onClick={() => setGuideOpen((open) => !open)} type="button">
          <span>How the mathematics works</span>
          <span>{guideOpen ? "−" : "+"}</span>
        </button>
        <div className={`guide ${guideOpen ? "open" : ""}`}>
          <div className="guide-block">
            <h3>Local trajectory frame</h3>
            <p>
              Your unit is the origin. <code>x</code> is horizontal distance travelled in your chosen
              direction (0 to 132). The curve height is <code>unit.y + f(x)</code>. Choose{" "}
              <strong>Aim left</strong> or <strong>Aim right</strong> before firing.
            </p>
          </div>
          <div className="guide-block">
            <h3>Supported syntax</h3>
            <p>
              <code>+ − * / ^</code>, parentheses, unary minus, <code>sin cos tan asin acos atan</code>,{" "}
              <code>sqrt abs exp ln log floor ceil round sign</code>, constants <code>pi e tau</code>.
              Trigonometry uses radians. Use <code>*</code> for explicit multiplication.
            </p>
          </div>
          <div className="guide-block">
            <h3>Try a curve</h3>
            <div className="example-list">
              {EXAMPLES.map((example) => (
                <code key={example}>{example}</code>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <span>Original browser game · server-authoritative simulation</span>
        <span>No cloud AI · No proprietary Graphwar assets</span>
      </footer>
    </main>
  );
}
