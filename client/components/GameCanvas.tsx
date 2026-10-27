import { useEffect, useRef } from "react";
import type { MatchState, ShotPoint, ShotResult } from "../../shared/types";
import { WORLD } from "../../shared/types";
import { terrainHeightAt, UNIT_COLORS } from "../../shared/game/world";
import type { PreviewResult } from "../types";

const WIDTH = 1280;
const HEIGHT = 640;
const MAX_ANIMATION_MS = 3_100;
const MIN_ANIMATION_MS = 950;

interface GameCanvasProps {
  match: MatchState;
  viewerId: string;
  preview: PreviewResult | null;
}

interface AnimState {
  shot: ShotResult;
  progress: number;
  elapsed: number;
  duration: number;
  finished: boolean;
}

const sx = (x: number) => ((x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * WIDTH;
const sy = (y: number) => HEIGHT - ((y - WORLD.minY) / (WORLD.maxY - WORLD.minY)) * HEIGHT;

function pathFromPoints(ctx: CanvasRenderingContext2D, points: ShotPoint[], fraction = 1): void {
  if (points.length === 0) return;
  const count = Math.max(1, Math.min(points.length, Math.ceil(points.length * fraction)));
  ctx.moveTo(sx(points[0].x), sy(points[0].y));
  for (let i = 1; i < count; i++) {
    ctx.lineTo(sx(points[i].x), sy(points[i].y));
  }
}

function trailTo(
  ctx: CanvasRenderingContext2D,
  points: ShotPoint[],
  progress: number,
): ShotPoint | null {
  if (points.length === 0) return null;
  if (progress >= 1) return points[points.length - 1];
  const index = Math.max(0, Math.min(points.length - 1, progress * (points.length - 1)));
  const whole = Math.floor(index);
  const frac = index - whole;
  ctx.moveTo(sx(points[0].x), sy(points[0].y));
  for (let i = 1; i <= whole; i++) ctx.lineTo(sx(points[i].x), sy(points[i].y));
  if (whole < points.length - 1) {
    const next = points[whole + 1];
    const current = points[whole];
    const pos = {
      x: current.x + (next.x - current.x) * frac,
      y: current.y + (next.y - current.y) * frac,
    };
    ctx.lineTo(sx(pos.x), sy(pos.y));
    return pos;
  }
  return points[points.length - 1];
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, "#06101b");
  bg.addColorStop(0.65, "#081722");
  bg.addColorStop(1, "#040b12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const glow = ctx.createRadialGradient(WIDTH * 0.55, HEIGHT * 0.4, 40, WIDTH * 0.55, HEIGHT * 0.45, 620);
  glow.addColorStop(0, "rgba(29, 106, 129, 0.16)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  for (let x = Math.ceil(WORLD.minX / 5) * 5; x <= WORLD.maxX; x += 5) {
    const major = x % 10 === 0;
    ctx.beginPath();
    ctx.strokeStyle = major ? "rgba(82, 182, 210, 0.15)" : "rgba(82, 182, 210, 0.055)";
    ctx.lineWidth = major ? 1 : 0.7;
    ctx.moveTo(sx(x), 0);
    ctx.lineTo(sx(x), HEIGHT);
    ctx.stroke();
  }
  for (let y = Math.ceil(WORLD.minY / 5) * 5; y <= WORLD.maxY; y += 5) {
    const major = y % 10 === 0;
    ctx.beginPath();
    ctx.strokeStyle = major ? "rgba(82, 182, 210, 0.15)" : "rgba(82, 182, 210, 0.055)";
    ctx.lineWidth = major ? 1 : 0.7;
    ctx.moveTo(0, sy(y));
    ctx.lineTo(WIDTH, sy(y));
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrain(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, HEIGHT);
  for (let x = WORLD.minX; x <= WORLD.maxX; x += 0.5) {
    ctx.lineTo(sx(x), sy(terrainHeightAt(x)));
  }
  ctx.lineTo(WIDTH, HEIGHT);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, sy(12), 0, HEIGHT);
  fill.addColorStop(0, "rgba(21, 88, 83, 0.58)");
  fill.addColorStop(0.4, "rgba(13, 52, 58, 0.86)");
  fill.addColorStop(1, "rgba(3, 13, 20, 0.98)");
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  for (let x = WORLD.minX; x <= WORLD.maxX; x += 0.35) {
    const px = sx(x);
    const py = sy(terrainHeightAt(x));
    if (x === WORLD.minX) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = "#37d3a3";
  ctx.shadowColor = "rgba(55,211,163,.5)";
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();

  // Fine contour texture.
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = "#7ef7ce";
  ctx.lineWidth = 1;
  for (let offset = 3; offset <= 12; offset += 3.5) {
    ctx.beginPath();
    for (let x = WORLD.minX; x <= WORLD.maxX; x += 1) {
      const py = sy(terrainHeightAt(x) - offset);
      if (x === WORLD.minX) ctx.moveTo(sx(x), py);
      else ctx.lineTo(sx(x), py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawAxes(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.font = "600 13px 'Cascadia Code', 'SFMono-Regular', Consolas, monospace";
  ctx.fillStyle = "rgba(139, 211, 228, 0.78)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let x = -60; x <= 60; x += 20) {
    const px = sx(x);
    ctx.strokeStyle = "rgba(137, 208, 225, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, HEIGHT - 27);
    ctx.lineTo(px, HEIGHT - 20);
    ctx.stroke();
    ctx.fillText(String(x), px, HEIGHT - 16);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = -10; y <= 50; y += 10) {
    const py = sy(y);
    ctx.strokeStyle = "rgba(137, 208, 225, 0.3)";
    ctx.beginPath();
    ctx.moveTo(4, py);
    ctx.lineTo(12, py);
    ctx.stroke();
    ctx.fillStyle = "rgba(139, 211, 228, 0.7)";
    ctx.fillText(String(y), 18, py);
  }

  // Axis reference lines sit above the terrain as a graph overlay.
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = "rgba(116, 201, 222, 0.34)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, sy(0));
  ctx.lineTo(WIDTH, sy(0));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx(0), 0);
  ctx.lineTo(sx(0), HEIGHT);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "700 12px 'Cascadia Code', Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(116, 201, 222, 0.6)";
  ctx.fillText("x", WIDTH - 16, sy(0) - 12);
  ctx.textAlign = "left";
  ctx.fillText("y", sx(0) + 12, 16);
  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, expression: string | null, animating: boolean): void {
  ctx.save();
  ctx.font = "600 12px 'Cascadia Code', Consolas, monospace";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(6, 16, 27, 0.78)";
  ctx.strokeStyle = "rgba(87, 169, 193, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(22, 18, 236, 58, 8);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#39d9ff";
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 36);
  ctx.lineTo(70, 36);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(190, 234, 243, 0.82)";
  ctx.fillText("PREDICTED", 80, 37);
  ctx.strokeStyle = "#ff8a3d";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(36, 58);
  ctx.lineTo(70, 58);
  ctx.stroke();
  ctx.fillStyle = "rgba(190, 234, 243, 0.82)";
  ctx.fillText(animating ? "FIRING…" : "LAST SHOT", 80, 59);

  if (expression) {
    ctx.font = "600 12px 'Cascadia Code', Consolas, monospace";
    const label = `f(x) = ${expression}`;
    const width = Math.min(480, ctx.measureText(label).width + 30);
    ctx.fillStyle = "rgba(6, 16, 27, 0.8)";
    ctx.strokeStyle = "rgba(255,138,61,.35)";
    ctx.beginPath();
    ctx.roundRect(WIDTH - width - 22, 18, width, 34, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffae72";
    ctx.textAlign = "left";
    ctx.fillText(label, WIDTH - width - 7, 35, width - 24);
  }
  ctx.restore();
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  match: MatchState,
  playerId: string,
  viewerId: string,
  now: number,
): void {
  const player = match.players.find((p) => p.id === playerId);
  if (!player) return;
  const px = sx(player.x);
  const py = sy(player.y);
  const color = UNIT_COLORS[player.colorIndex % UNIT_COLORS.length];
  const active = match.currentPlayerId === player.id && match.status === "active";
  const radius = WORLD.unitRadius * 10;

  ctx.save();
  if (active) {
    const pulse = (Math.sin(now / 260) + 1) / 2;
    ctx.beginPath();
    ctx.arc(px, py, radius + 8 + pulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.18 + pulse * 0.28})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, radius + 12, 0, Math.PI * 2);
    ctx.strokeStyle = `${color}55`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.globalAlpha = player.eliminated ? 0.38 : 1;
  ctx.beginPath();
  ctx.arc(px, py, radius, 0, Math.PI * 2);
  ctx.fillStyle = `${color}24`;
  ctx.fill();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = active ? 24 : 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.beginPath();
  ctx.arc(px, py, radius - 6, 0, Math.PI * 2);
  ctx.fillStyle = "#07131f";
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 18px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(player.name.slice(0, 1).toUpperCase(), px, py + 1);

  if (player.eliminated) {
    ctx.strokeStyle = "#ff5e73";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px - 11, py - 11);
    ctx.lineTo(px + 11, py + 11);
    ctx.moveTo(px + 11, py - 11);
    ctx.lineTo(px - 11, py + 11);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  const barWidth = 66;
  const barX = px - barWidth / 2;
  const barY = py + radius + 9;
  ctx.fillStyle = "rgba(2, 8, 14, 0.9)";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, 7, 3);
  ctx.fill();
  const health = Math.max(0, player.health / player.maxHealth);
  if (health > 0) {
    ctx.fillStyle = health > 0.6 ? "#58df9d" : health > 0.3 ? "#ffd166" : "#ff5e73";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth * health, 7, 3);
    ctx.fill();
  }

  ctx.font = "700 11px 'Cascadia Code', Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = player.eliminated ? "rgba(255,255,255,.35)" : "rgba(224, 243, 247, 0.9)";
  const tag = `${player.name.toUpperCase()}${player.id === viewerId ? " / YOU" : ""}`;
  ctx.fillText(tag, px, barY + 12, 176);

  if (!player.connected) {
    ctx.font = "700 10px 'Cascadia Code', Consolas, monospace";
    ctx.fillStyle = "#ff5e73";
    ctx.fillText("OFFLINE", px, barY + 27);
  }
  ctx.restore();
}

function drawPredicted(ctx: CanvasRenderingContext2D, preview: PreviewResult | null): void {
  if (!preview || !preview.ok || preview.points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  pathFromPoints(ctx, preview.points);
  ctx.setLineDash([9, 8]);
  ctx.lineDashOffset = -performance.now() / 90;
  ctx.strokeStyle = "rgba(57, 217, 255, 0.85)";
  ctx.lineWidth = 2.4;
  ctx.shadowColor = "rgba(57,217,255,.7)";
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  const end = preview.points[preview.points.length - 1];
  const start = preview.points[0];
  ctx.beginPath();
  ctx.arc(sx(start.x), sy(start.y), 5, 0, Math.PI * 2);
  ctx.fillStyle = "#39d9ff";
  ctx.fill();

  if (preview.hitPlayerId) {
    ctx.beginPath();
    ctx.arc(sx(end.x), sy(end.y), 14, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 94, 115, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(57,217,255,.7)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx(end.x) - 6, sy(end.y) - 6);
    ctx.lineTo(sx(end.x) + 6, sy(end.y) + 6);
    ctx.moveTo(sx(end.x) + 6, sy(end.y) - 6);
    ctx.lineTo(sx(end.x) - 6, sy(end.y) + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnimation(ctx: CanvasRenderingContext2D, anim: AnimState | null, now: number): void {
  if (!anim) return;
  const { shot, progress, elapsed, duration } = anim;
  const points = shot.points;
  if (points.length < 2) return;
  const color = shot.outcome === "hit" ? "#ff8a3d" : "#ffb15e";

  ctx.save();
  ctx.beginPath();
  pathFromPoints(ctx, points);
  ctx.strokeStyle = "rgba(255, 138, 61, 0.18)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([2, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  const head = trailTo(ctx, points, progress);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.1;
  ctx.shadowColor = "rgba(255, 138, 61, 0.85)";
  ctx.shadowBlur = 13;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (head) {
    const hx = sx(head.x);
    const hy = sy(head.y);
    if (progress < 1) {
      const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 20);
      glow.addColorStop(0, "rgba(255,255,255,1)");
      glow.addColorStop(0.25, "rgba(255, 174, 96, 0.95)");
      glow.addColorStop(1, "rgba(255, 138, 61, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(hx, hy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff4e8";
      ctx.fill();
    }
  }

  if (progress >= 1) {
    const impactElapsed = elapsed - duration;
    const impactT = Math.min(1, Math.max(0, impactElapsed / 650));
    const end = points[points.length - 1];
    const ex = sx(end.x);
    const ey = sy(end.y);
    const radius = 10 + impactT * 44;
    ctx.beginPath();
    ctx.arc(ex, ey, radius, 0, Math.PI * 2);
    ctx.strokeStyle =
      shot.outcome === "hit"
        ? `rgba(255, 94, 115, ${1 - impactT})`
        : `rgba(255, 177, 94, ${0.8 - impactT * 0.8})`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 6 + impactT * 16, 0, Math.PI * 2);
    ctx.fillStyle =
      shot.outcome === "hit"
        ? `rgba(255, 94, 115, ${0.45 * (1 - impactT)})`
        : `rgba(255, 177, 94, ${0.35 * (1 - impactT)})`;
    ctx.fill();
  }
  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  match: MatchState,
  viewerId: string,
  preview: PreviewResult | null,
  anim: AnimState | null,
  now: number,
): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawGrid(ctx);
  drawTerrain(ctx);
  drawAxes(ctx);
  if (!anim) drawPredicted(ctx, preview);
  drawAnimation(ctx, anim, now);
  for (const player of match.players) {
    drawUnit(ctx, match, player.id, viewerId, now);
  }
  const expression = anim ? anim.shot.expression : preview?.source ?? match.lastShot?.expression ?? null;
  drawLegend(ctx, expression, Boolean(anim && anim.progress < 1));
}

export function GameCanvas({ match, viewerId, preview }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<{ id: string; startedAt: number } | null>(null);
  const propsRef = useRef({ match, viewerId, preview });
  propsRef.current = { match, viewerId, preview };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    let raf = 0;
    let stopped = false;

    const frame = (now: number) => {
      if (stopped) return;
      const { match: currentMatch, viewerId: currentViewer, preview: currentPreview } = propsRef.current;
      const shot = currentMatch.lastShot;
      if (shot && (!animationRef.current || animationRef.current.id !== shot.id)) {
        animationRef.current = { id: shot.id, startedAt: now };
      }
      let anim: AnimState | null = null;
      if (shot && animationRef.current?.id === shot.id) {
        const duration = Math.min(
          MAX_ANIMATION_MS,
          Math.max(MIN_ANIMATION_MS, shot.points.length * 3.1),
        );
        const elapsed = now - animationRef.current.startedAt;
        anim = {
          shot,
          progress: Math.min(1, Math.max(0, elapsed / duration)),
          elapsed,
          duration,
          finished: elapsed > duration + 700,
        };
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(ctx, currentMatch, currentViewer, currentPreview, anim, now);
      if (anim && !anim.finished) {
        raf = requestAnimationFrame(frame);
      }
    };

    frame(performance.now());
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [match, preview, viewerId]);

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      aria-label="Cartesian battlefield with terrain, units, predicted trajectory and projectile animation. Tap to skip the shot animation."
      onPointerDown={() => {
        if (animationRef.current) {
          animationRef.current = {
            id: animationRef.current.id,
            startedAt: performance.now() - 100_000,
          };
        }
      }}
    />
  );
}
