import type { Direction, ShotPoint, ShotOutcome } from "../shared/types";

export interface PreviewResult {
  ok: boolean;
  source: string;
  direction: Direction;
  points: ShotPoint[];
  outcome: ShotOutcome | null;
  hitPlayerId: string | null;
  hitPlayerName: string | null;
  message: string;
  error: string | null;
  nodeCount: number;
  characterCount: number;
  horizontalDistance: number;
}
