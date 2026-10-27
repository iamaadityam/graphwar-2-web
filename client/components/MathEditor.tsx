import type { FormEvent } from "react";
import type { Direction } from "../../shared/types";
import { MAX_EXPRESSION_LENGTH } from "../../shared/types";
import type { PreviewResult } from "../types";

const EXAMPLES = [
  { label: "Sine wave", value: "10*sin(x/5)+15" },
  { label: "Parabola", value: "0.02*x^2" },
  { label: "Square root", value: "sqrt(abs(x))*3" },
  { label: "Aimed arc", value: "-0.05*(x-20)^2+30" },
];

interface MathEditorProps {
  expression: string;
  onExpressionChange: (value: string) => void;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  preview: PreviewResult | null;
  canFire: boolean;
  waitingReason: string | null;
  busy: boolean;
  onFire: (expression: string, direction: Direction) => void;
}

export function MathEditor({
  expression,
  onExpressionChange,
  direction,
  onDirectionChange,
  preview,
  canFire,
  waitingReason,
  busy,
  onFire,
}: MathEditorProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canFire && preview?.ok && !busy) onFire(expression.trim(), direction);
  };

  const disabled = !canFire || busy;
  const outcomeText = (() => {
    if (!preview) return null;
    if (!preview.ok) return null;
    if (preview.hitPlayerId) return `Predicted direct hit · ${preview.hitPlayerName}`;
    if (preview.outcome === "terrain") return "Predicted terrain impact";
    if (preview.outcome === "boundary") return "Predicted path leaves the chart";
    if (preview.outcome === "invalid") return "Curve enters an invalid numerical region";
    if (preview.outcome === "range") return "Predicted maximum-range miss";
    return "Trajectory computed";
  })();

  return (
    <form className="math-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <span className="eyebrow">TRAJECTORY INPUT</span>
          <h2>Write your shot</h2>
        </div>
        <span className={`editor-state ${preview?.ok ? "valid" : expression ? "invalid" : "idle"}`}>
          {preview?.ok ? "VALID" : expression ? "ERROR" : "WAITING"}
        </span>
      </div>

      <label className="field-label" htmlFor="trajectory-expression">
        Function of x
      </label>
      <div className={`expression-shell ${preview && !preview.ok ? "has-error" : ""}`}>
        <span className="expression-prefix">f(x) =</span>
        <input
          id="trajectory-expression"
          className="expression-input"
          value={expression}
          maxLength={MAX_EXPRESSION_LENGTH}
          placeholder="10*sin(x/5)+15"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          disabled={ disabled && !canFire ? true : false}
          onChange={(event) => onExpressionChange(event.target.value)}
          aria-invalid={Boolean(preview && !preview.ok)}
          aria-describedby="expression-status"
        />
      </div>

      <div className="editor-meta" id="expression-status">
        <span>{preview?.characterCount ?? expression.length}/{MAX_EXPRESSION_LENGTH} chars</span>
        <span>{preview?.nodeCount ? `${preview.nodeCount} AST nodes` : "x = horizontal progress"}</span>
      </div>

      {preview && !preview.ok && (
        <div className="inline-alert error" role="alert">
          <strong>Parse error</strong>
          <span>{preview.error}</span>
        </div>
      )}
      {preview?.ok && outcomeText && (
        <div className={`inline-alert ${preview.hitPlayerId ? "hit" : "info"}`}>
          <strong>{outcomeText}</strong>
          <span>{preview.message}</span>
        </div>
      )}

      <div className="aim-row">
        <div>
          <span className="field-label">Firing direction</span>
          <div className="direction-toggle" role="group" aria-label="Firing direction">
            <button
              type="button"
              className={direction === "left" ? "active" : ""}
              onClick={() => onDirectionChange("left")}
              disabled={disabled}
            >
              ← Left
            </button>
            <button
              type="button"
              className={direction === "right" ? "active" : ""}
              onClick={() => onDirectionChange("right")}
              disabled={disabled}
            >
              Right →
            </button>
          </div>
        </div>
        <div className="trig-note">
          <strong>Radians</strong>
          <span>sin / cos / tan</span>
        </div>
      </div>

      <div className="example-row" aria-label="Example expressions">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className="example-chip"
            onClick={() => onExpressionChange(example.value)}
            disabled={disabled}
            title={example.value}
          >
            {example.label}
          </button>
        ))}
      </div>

      {waitingReason && <div className="waiting-reason">{waitingReason}</div>}

      <button className="btn btn-fire btn-block" type="submit" disabled={!canFire || !preview?.ok || busy}>
        {busy ? "Transmitting shot…" : "Fire projectile"}
        {!busy && <span className="fire-arrow">↗</span>}
      </button>
      <p className="fine-print">
        The server owns the simulation. Hits, damage, and turn order are validated centrally.
      </p>
    </form>
  );
}
