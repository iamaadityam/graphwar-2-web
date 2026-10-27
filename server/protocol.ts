import { z } from "zod";
import { MAX_EXPRESSION_LENGTH } from "../shared/types";

export const HelloSchema = z
  .object({
    name: z.string().trim().min(1, "Choose a display name.").max(32, "Display name is too long."),
    accountId: z.string().max(100).optional(),
    token: z.string().max(300).optional(),
  })
  .strict();

export const CreateSchema = z
  .object({
    visibility: z.enum(["public", "private"]),
    maxPlayers: z.number().int().min(2).max(4).optional(),
  })
  .strict();

export const JoinSchema = z.object({ code: z.string().trim().min(1).max(12) }).strict();
export const ReadySchema = z.object({ ready: z.boolean() }).strict();
export const EmptySchema = z.object({}).strict();

export const ShotSchema = z
  .object({
    matchId: z.string().min(1).max(100),
    turnNumber: z.number().int().min(1).max(1_000_000),
    version: z.number().int().min(1).max(100_000_000),
    expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH),
    direction: z.enum(["left", "right"]),
  })
  .strict();

export const RematchSchema = EmptySchema;

export type HelloInput = z.infer<typeof HelloSchema>;
export type ShotInput = z.infer<typeof ShotSchema>;
