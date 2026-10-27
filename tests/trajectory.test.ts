import { describe, expect, it } from "vitest";
import { compileExpression } from "../shared/math/expression";
import { simulateSource, simulateTrajectory } from "../shared/game/trajectory";
import { terrainHeightAt } from "../shared/game/world";
import { WORLD } from "../shared/types";

const shooter = { id: "a", x: 0, y: 25 };
const target = { id: "b", x: 20, y: 25 };

describe("trajectory sampling and collision detection", () => {
  it("starts at the shooter and samples a deterministic bounded path", () => {
    const compiled = compileExpression("5*sin(x/5)");
    const first = simulateTrajectory(compiled, shooter, [target], "right");
    const second = simulateTrajectory(compiled, shooter, [target], "right");
    expect(first.points[0]).toEqual({ x: 0, y: 25 });
    expect(first.points.length).toBeGreaterThan(2);
    expect(first.points.length).toBeLessThanOrEqual(760);
    expect(first.points).toEqual(second.points);
    expect(first.points[1].x).toBeCloseTo(0.2);
    for (const point of first.points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it("detects a direct player collision and stops at impact", () => {
    const result = simulateSource("0", shooter, [target], "right");
    expect(result.outcome).toBe("hit");
    expect(result.hitPlayerId).toBe("b");
    expect(result.points[result.points.length - 1].x).toBeCloseTo(17.8, 0);
    expect(result.horizontalDistance).toBeLessThan(20);
  });

  it("fires in the local left direction", () => {
    const leftTarget = { id: "left", x: -20, y: 25 };
    const result = simulateSource("0", shooter, [leftTarget], "left");
    expect(result.outcome).toBe("hit");
    expect(result.hitPlayerId).toBe("left");
  });

  it("never lets a shooter collide with itself", () => {
    const result = simulateSource("0", shooter, [shooter], "right");
    expect(result.outcome).not.toBe("hit");
    expect(result.hitPlayerId).toBeNull();
  });

  it("ignores eliminated units", () => {
    const result = simulateSource("0", shooter, [{ ...target, eliminated: true }], "right");
    expect(result.outcome).not.toBe("hit");
  });

  it("detects terrain collisions", () => {
    const lowShooter = { id: "a", x: 0, y: terrainHeightAt(0) + 3 };
    const result = simulateSource("-2*x", lowShooter, [], "right");
    expect(result.outcome).toBe("terrain");
    const end = result.points[result.points.length - 1];
    expect(end.y).toBeLessThanOrEqual(terrainHeightAt(end.x) + 0.05);
  });

  it("detects leaving the chart as a bounded miss", () => {
    const result = simulateSource("100", shooter, [], "right");
    expect(result.outcome).toBe("boundary");
    expect(result.points.length).toBe(1);
    expect(result.horizontalDistance).toBeLessThan(WORLD.maxTrajectoryDistance);
  });

  it("stops cleanly in invalid numerical regions", () => {
    const result = simulateSource("sqrt(x-5)", shooter, [], "right");
    expect(result.outcome).toBe("invalid");
    expect(result.message).toMatch(/domain|Trajectory stopped/i);
    expect(result.points.length).toBe(1);
  });

  it("reports a maximum-range miss", () => {
    const result = simulateSource("10", { id: "a", x: -60, y: 40 }, [], "right");
    expect(["range", "boundary"]).toContain(result.outcome);
  });

  it("is symmetric under horizontal direction and use of |x|", () => {
    const right = simulateSource("sqrt(abs(x))*3", { id: "a", x: 0, y: 20 }, [], "right");
    const left = simulateSource("sqrt(abs(x))*3", { id: "a", x: 0, y: 20 }, [], "left");
    expect(right.points.map((p) => p.y)).toEqual(left.points.map((p) => p.y));
    expect(left.points[5].x).toBeCloseTo(-right.points[5].x);
  });

  it("handles a target placed on a curved line", () => {
    const curvedTarget = { id: "b", x: 30, y: 20 };
    const result = simulateSource("-x/6", shooter, [curvedTarget], "right");
    expect(result.outcome).toBe("hit");
  });
});
