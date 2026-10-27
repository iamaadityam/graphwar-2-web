import { WORLD, type Direction, type ShotOutcome, type ShotPoint, type Vec2 } from "../types";
import {
  compileExpression,
  evaluateExpression,
  MathExpressionError,
  type CompiledExpression,
} from "../math/expression";
import { terrainHeightAt } from "./world";

export interface TrajectoryActor {
  id: string;
  x: number;
  y: number;
  eliminated?: boolean;
}

export interface TrajectorySimulation {
  points: ShotPoint[];
  outcome: ShotOutcome;
  hitPlayerId: string | null;
  hitPoint: Vec2 | null;
  message: string;
  horizontalDistance: number;
}

const MAX_POINTS = 760;

function segmentCircleIntersection(
  a: Vec2,
  b: Vec2,
  center: Vec2,
  radius: number,
): { point: Vec2; t: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const a2 = dx * dx + dy * dy;
  if (a2 < 1e-12) {
    return fx * fx + fy * fy <= radius * radius ? { point: a, t: 0 } : null;
  }
  const b2 = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b2 * b2 - 4 * a2 * c;
  if (discriminant < 0) return null;
  const sqrt = Math.sqrt(discriminant);
  const t1 = (-b2 - sqrt) / (2 * a2);
  const t2 = (-b2 + sqrt) / (2 * a2);
  let t: number | null = null;
  if (t1 >= 0 && t1 <= 1) t = t1;
  else if (t2 >= 0 && t2 <= 1) t = t2;
  else if (t1 < 0 && t2 > 1) t = 0;
  if (t === null) return null;
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

function terrainHitBetween(a: Vec2, b: Vec2): Vec2 | null {
  // Check three sub-segments so a steep curve cannot tunnel through a hill.
  let previous = a;
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const current = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (current.y <= terrainHeightAt(current.x)) {
      // Binary search the crossing within this sub-segment.
      let low = 0;
      let high = 1;
      let hit = current;
      for (let iter = 0; iter < 7; iter++) {
        const mid = (low + high) / 2;
        const sample = {
          x: previous.x + (current.x - previous.x) * mid,
          y: previous.y + (current.y - previous.y) * mid,
        };
        if (sample.y <= terrainHeightAt(sample.x)) {
          high = mid;
          hit = sample;
        } else {
          low = mid;
        }
      }
      return hit;
    }
    previous = current;
  }
  return null;
}

/**
 * Evaluate a function over the projectile's local horizontal interval.
 *
 * Local coordinates: u is horizontal distance travelled from the shooter in the
 * chosen direction. World position is (shooter.x + sign * u, shooter.y + f(u)).
 * The shooter is never a collision target. Sampling is bounded and deterministic.
 */
export function simulateTrajectory(
  expression: CompiledExpression,
  shooter: TrajectoryActor,
  targets: TrajectoryActor[],
  direction: Direction,
): TrajectorySimulation {
  const sign = direction === "right" ? 1 : -1;
  const start: ShotPoint = { x: shooter.x, y: shooter.y };
  const points: ShotPoint[] = [start];
  let previous: Vec2 = start;
  let u = 0;
  let outcome: ShotOutcome = "range";
  let hitPlayerId: string | null = null;
  let hitPoint: Vec2 | null = null;
  let message = "The projectile reached its maximum range.";

  const liveTargets = targets.filter((t) => !t.eliminated && t.id !== shooter.id);

  while (u < WORLD.maxTrajectoryDistance && points.length < MAX_POINTS) {
    u = Math.min(WORLD.maxTrajectoryDistance, u + WORLD.step);
    const worldX = shooter.x + sign * u;
    let offset: number;
    try {
      offset = evaluateExpression(expression, u).value;
    } catch (error) {
      outcome = "invalid";
      message =
        error instanceof MathExpressionError
          ? `Trajectory stopped: ${error.message}`
          : "Trajectory stopped at an invalid numerical region.";
      break;
    }

    const current: Vec2 = { x: worldX, y: shooter.y + offset };
    if (
      current.x < WORLD.minX ||
      current.x > WORLD.maxX ||
      current.y < WORLD.minY ||
      current.y > WORLD.maxY
    ) {
      outcome = "boundary";
      message = "The projectile left the chart.";
      break;
    }

    // Players are checked before terrain so a hit at ground level counts.
    let segmentHit: { point: Vec2; actor: TrajectoryActor } | null = null;
    for (const target of liveTargets) {
      const intersection = segmentCircleIntersection(
        previous,
        current,
        target,
        WORLD.unitRadius + WORLD.projectileRadius,
      );
      if (intersection) {
        segmentHit = { point: intersection.point, actor: target };
        break;
      }
    }
    if (segmentHit) {
      points.push(segmentHit.point);
      outcome = "hit";
      hitPlayerId = segmentHit.actor.id;
      hitPoint = segmentHit.point;
      message = `Direct hit on ${segmentHit.actor.id}.`;
      break;
    }

    const groundHit = terrainHitBetween(previous, current);
    if (groundHit) {
      points.push(groundHit);
      outcome = "terrain";
      hitPoint = groundHit;
      message = "The projectile struck the terrain.";
      break;
    }

    points.push(current);
    previous = current;
  }

  return {
    points,
    outcome,
    hitPlayerId,
    hitPoint,
    message,
    horizontalDistance: u,
  };
}

/** Convenience for previews/tests. Invalid functions return a single-point result. */
export function simulateSource(
  source: string,
  shooter: TrajectoryActor,
  targets: TrajectoryActor[],
  direction: Direction,
): TrajectorySimulation {
  try {
    return simulateTrajectory(compileExpression(source), shooter, targets, direction);
  } catch (error) {
    return {
      points: [{ x: shooter.x, y: shooter.y }],
      outcome: "invalid",
      hitPlayerId: null,
      hitPoint: null,
      message: error instanceof Error ? error.message : "Invalid expression.",
      horizontalDistance: 0,
    };
  }
}
