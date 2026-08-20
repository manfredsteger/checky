import { z } from 'zod';

export const RunStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'healed']);
export type RunStatus = z.infer<typeof RunStatus>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  created_at: z.coerce.date(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const AgentSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string().min(1),
  site: z.string().url(),
  goal_text: z.string().min(1),
  params: z.record(z.any()).nullable().default({}),
  schedule_cron: z.string().min(1),
  jitter_min: z.number().int().default(0),
  enabled: z.boolean().default(true),
  notify: z.record(z.any()).nullable().default({}),
  result_schema: z.record(z.any()).nullable().default({}),
  created_at: z.coerce.date(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const RecipeSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  version: z.number().int(),
  steps: z.array(z.any()),
  healed_from: z.string().uuid().nullable().optional(),
  created_at: z.coerce.date(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RunSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  recipe_id: z.string().uuid().nullable().optional(),
  status: RunStatus,
  started_at: z.coerce.date().nullable().optional(),
  finished_at: z.coerce.date().nullable().optional(),
  error: z.string().nullable().optional(),
  steps_log: z.array(z.any()).nullable().optional(),
  ai_tokens: z.number().int().default(0),
  screenshot_before: z.string().nullable().optional(),
  screenshot_after: z.string().nullable().optional(),
  created_at: z.coerce.date().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const ResultSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  agent_id: z.string().uuid(),
  data: z.record(z.any()),
  data_hash: z.string(),
  changed: z.boolean(),
  created_at: z.coerce.date(),
});
export type Result = z.infer<typeof ResultSchema>;

export const CreateProjectSchema = ProjectSchema.pick({ name: true, description: true });
export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial();
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

export const CreateAgentSchema = AgentSchema.omit({
  id: true,
  project_id: true,
  created_at: true,
});
export type CreateAgent = z.infer<typeof CreateAgentSchema>;

export const UpdateAgentSchema = CreateAgentSchema.partial();
export type UpdateAgent = z.infer<typeof UpdateAgentSchema>;

// Helper to translate JSON Schema to Zod Schema
export function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.any();

  switch (schema.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'object':
      if (schema.properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(schema.properties)) {
          let propZod = jsonSchemaToZod(value);
          if (!schema.required?.includes(key)) {
            propZod = propZod.optional().nullable();
          }
          shape[key] = propZod;
        }
        return z.object(shape);
      }
      return z.record(z.any());
    case 'array':
      if (schema.items) {
        return z.array(jsonSchemaToZod(schema.items));
      }
      return z.array(z.any());
    default:
      return z.any();
  }
}

