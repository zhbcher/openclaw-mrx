/**
 * API Validators — zod schemas for all endpoints
 */

import { z } from "zod";

// ============================================================
// Common
// ============================================================

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const StatusFilterSchema = z.object({
  status: z.enum([
    "created", "planning", "ready", "running", "paused", "completed", "failed", "archived",
  ]).optional(),
});

// ============================================================
// Objectives
// ============================================================

export const CreateObjectiveSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  tags: z.array(z.string().max(50)).max(20).optional(),
  context: z.object({
    repo: z.string().max(500).optional(),
    working_dir: z.string().max(500).optional(),
    constraints: z.array(z.string().max(200)).max(50).optional(),
  }).optional(),
});

export const ListObjectivesSchema = PaginationSchema.merge(StatusFilterSchema).extend({
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

// ============================================================
// Goals
// ============================================================

export const CreateGoalSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  deliverable: z.string().min(1).max(120),
  estimated_complexity: z.enum(["low", "medium", "high"]).default("medium"),
  depends_on: z.array(z.string()).max(7).default([]),
});

export const UpdateGoalSchema = z.object({
  status: z.enum(["ready", "running", "blocked", "completed", "failed", "skipped"]).optional(),
  error: z.string().max(500).optional(),
});

export const ListGoalsSchema = z.object({
  status: z.enum(["pending", "ready", "running", "blocked", "completed", "failed", "skipped"]).optional(),
});

// ============================================================
// Missions
// ============================================================

export const CreateMissionSchema = z.object({
  objective_id: z.string().min(1),
  config_path: z.string().max(500).optional(),
});

export const ListMissionsSchema = PaginationSchema.extend({
  status: z.enum(["created", "planning", "ready", "running", "paused", "completed", "failed", "archived"]).optional(),
});

// ============================================================
// Checkpoints
// ============================================================

export const RollbackSchema = z.object({
  checkpoint_id: z.string().min(1),
});

// ============================================================
// Validator helper
// ============================================================

export type ValidationResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

export function validate<T>(schema: z.ZodSchema<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { 
    success: false, 
    error: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}
