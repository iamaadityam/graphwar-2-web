import { WORLD, type Vec2 } from "../types";

/**
 * A smooth, deterministic landscape. Values are world-Y heights.
 * The function is intentionally public and identical on client and server.
 */
export function terrainHeightAt(x: number): number {
  return (
    7 +
    3.1 * Math.sin(x / 9.5) +
    1.9 * Math.cos(x / 5.8) +
    0.9 * Math.sin(x / 2.7) +
    1.2 * Math.exp(-((x / 31) ** 2))
  );
}

export const UNIT_COLORS = ["#ffb000", "#5ce1ff", "#65ff8f", "#ff6b9d"] as const;

export function spawnPositions(count: number): Vec2[] {
  const xs =
    count <= 1
      ? [0]
      : count === 2
        ? [-37, 37]
        : count === 3
          ? [-45, 0, 45]
          : [-49, -17, 17, 49];
  return xs.map((x) => ({ x, y: terrainHeightAt(x) + WORLD.unitRadius }));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Clamp an evaluated curve to the visible world for rendering and playback. */
export function isInsideWorld(point: Vec2): boolean {
  return (
    point.x >= WORLD.minX &&
    point.x <= WORLD.maxX &&
    point.y >= WORLD.minY &&
    point.y <= WORLD.maxY
  );
}
