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
  params: z.record(z.string(), z.any()).nullable().default({}),
  schedule_cron: z.string().min(1),
  jitter_min: z.number().int().default(0),
  enabled: z.boolean().default(true),
  notify: z.record(z.string(), z.any()).nullable().default({}),
  result_schema: z.record(z.string(), z.any()).nullable().default({}),
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
  data: z.record(z.string(), z.any()),
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
      return z.record(z.string(), z.any());
    case 'array':
      if (schema.items) {
        return z.array(jsonSchemaToZod(schema.items));
      }
      return z.array(z.any());
    default:
      return z.any();
  }
}


// --- AIProvider (Schritt 17): KI nur zum Selbstheilen + JSON-Fallback ---------

// Antwort des Selektor-Reparateurs: ein Playwright-Locator-String in unserer DSL
// (getByRole(...) / getByLabel(...) / CSS), den getLocator() im Executor parst.
export const HealResponseSchema = z.object({
  locator: z.string().min(1),
});
export type HealResponse = z.infer<typeof HealResponseSchema>;

// Ergebnis eines KI-Aufrufs inkl. verbrauchter Tokens (für runs.ai_tokens).
export interface HealResult { locator: string; tokens: number; }
export interface ExtractResult { data: unknown; tokens: number; }

export interface AIProvider {
  // Repariert einen gebrochenen Selektor anhand eines ARIA-Snapshots der Seite.
  healSelector(failedStep: unknown, ariaSnapshot: string): Promise<HealResult>;
  // Extrahiert strukturierte Daten aus dem Seitentext gemäß JSON-Schema (Fallback).
  extractJson(pageText: string, jsonSchema: unknown): Promise<ExtractResult>;
}

// --- Recorder (Schritt 19): Anlernen per Sprache -----------------------------

export const RecorderStatus = z.enum(['running', 'awaiting_instruction', 'awaiting_confirm', 'completed', 'aborted', 'failed']);
export type RecorderStatus = z.infer<typeof RecorderStatus>;

// Ein mitgeschnittenes Ereignis (eine Browseraktion des Anlern-Agenten).
export const RecorderEventSchema = z.object({
  ts: z.number(),                       // Zeitstempel (ms)
  tool: z.string(),                     // MCP-/Tool-Name
  input: z.record(z.string(), z.any()).nullable().optional(),
  result: z.string().nullable().optional(),
  isSubmit: z.boolean().optional(),     // markiert Submit-artige Aktionen (Bestätigungsdialog)
});
export type RecorderEvent = z.infer<typeof RecorderEventSchema>;

export const RecorderSessionSchema = z.object({
  id: z.string().uuid(),
  agent_id: z.string().uuid(),
  status: RecorderStatus,
  mode: z.enum(['auto', 'assisted']).default('auto'),
  pending_instruction: z.string().nullable().optional(),
  events: z.array(RecorderEventSchema).default([]),
  recipe_preview: z.array(z.any()).nullable().optional(),
  result_fields: z.array(z.string()).nullable().optional(),
  screenshot_path: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date().optional(),
});
export type RecorderSession = z.infer<typeof RecorderSessionSchema>;

// --- Settings & Notify (Schritt 21) ------------------------------------------

export const NotifyConfigSchema = z.object({
  webhook_url: z.string().optional(),          // generischer Webhook (POST JSON)
  matrix_homeserver: z.string().optional(),    // z.B. https://matrix.org
  matrix_token: z.string().optional(),
  matrix_room: z.string().optional(),          // !roomid:server
});
export type NotifyConfig = z.infer<typeof NotifyConfigSchema>;

export const AppSettingsSchema = z.object({
  paused: z.boolean().default(false),
  retention_days: z.number().int().min(0).default(30),
  notify: NotifyConfigSchema.default({}),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// WICHTIG: ohne .default(), damit ein Teil-Update weggelassene Keys NICHT
// mit Defaults überschreibt (sonst löscht z.B. ein paused-Toggle die notify-Config).
export const UpdateSettingsSchema = z.object({
  paused: z.boolean().optional(),
  retention_days: z.number().int().min(0).optional(),
  notify: NotifyConfigSchema.optional(),
});
export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;
