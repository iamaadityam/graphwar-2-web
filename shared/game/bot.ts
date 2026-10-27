import { WORLD, type Direction, type MatchState } from "../types";
import { compileExpression } from "../math/expression";
import { simulateTrajectory } from "./trajectory";
import { distance } from "./world";

export interface BotDecision {
  expression: string;
  direction: Direction;
  predictedHit: string | null;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function format(value: number): string {
  const fixed = value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/**
 * Deterministic heuristic bot. It only reads the same public snapshot that a
 * human client receives, generates candidate functions, and simulates them with
 * the authoritative trajectory engine. No hidden state is used.
 */
export function chooseBotShot(match: MatchState, botId: string): BotDecision {
  const bot = match.players.find((p) => p.id === botId);
  if (!bot) return { expression: "0", direction: "right", predictedHit: null };
  const enemies = match.players.filter((p) => p.id !== bot.id && !p.eliminated);
  const rng = createRng(match.botSeed ^ (match.turnNumber * 2654435761) ^ botId.length);
  const candidates: Array<{ expression: string; direction: Direction; score: number; hit: string | null }> = [];

  for (const enemy of enemies) {
    const dx = enemy.x - bot.x;
    if (Math.abs(dx) < 2) continue;
    const direction: Direction = dx >= 0 ? "right" : "left";
    const horizontal = Math.abs(dx);
    if (horizontal > WORLD.maxTrajectoryDistance) continue;
    const dy = enemy.y - bot.y;
    const healthBonus = (1 - enemy.health / enemy.maxHealth) * 120;
    const aimOffsets = [0, -1.8, 1.8];
    const arcs = [0, 10, 24, 40, 58, -10, -24];

    for (const aimOffset of aimOffsets) {
      for (const arc of arcs) {
        const targetOffset = dy + aimOffset;
        // f(0)=0, f(D)=targetOffset; the quadratic term bends the shot over terrain.
        const expression = `${format(targetOffset / horizontal)}*x+${format(arc)}*x*(${format(horizontal)}-x)/${format(horizontal * horizontal)}`;
        let compiled;
        try {
          compiled = compileExpression(expression);
        } catch {
          continue;
        }
        const simulation = simulateTrajectory(
          compiled,
          { id: bot.id, x: bot.x, y: bot.y },
          enemies,
          direction,
        );
        let score: number;
        if (simulation.hitPlayerId) {
          score = 100_000 - simulation.points.length + healthBonus;
          if (simulation.hitPlayerId === enemy.id) score += 35;
        } else {
          let closest = Infinity;
          for (const point of simulation.points) {
            closest = Math.min(closest, distance(point, enemy));
          }
          score = 10_000 - closest * 220 - simulation.points.length * 0.15;
        }
        score += rng() * 3;
        candidates.push({
          expression,
          direction,
          score,
          hit: simulation.hitPlayerId,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  if (!winner) {
    const anyEnemy = enemies[0];
    return {
      expression: "0",
      direction: anyEnemy && anyEnemy.x < bot.x ? "left" : "right",
      predictedHit: null,
    };
  }
  return { expression: winner.expression, direction: winner.direction, predictedHit: winner.hit };
}
