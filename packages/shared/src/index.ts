import { z } from 'zod';

export const RunStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'healed']);
export type RunStatus = z.infer<typeof RunStatus>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  manifest_id: z.string().nullable().optional(),
  params: z.record(z.string(), z.any()).nullable().default({}),
  agent_count: z.number().int().optional(),     // von der API mitgeliefert (nicht in DB)
  enabled_count: z.number().int().optional(),   // dito
  created_at: z.coerce.date(),
});
export type Project = z.infer<typeof ProjectSchema>;

// --- Live-Aktivität (laufende/wartende Läufe für Spinner & Fortschritt) ------
export interface ActiveRun {
  run_id: string;
  agent_id: string;
  agent_name: string;
  project_id: string;
  status: 'queued' | 'running';
  created_at: string;
  started_at: string | null;
}
/** Ein gerade beendeter Lauf — kurze Erfolgs-/Fehler-Quittung in der Oberfläche. */
export interface RecentRun {
  run_id: string;
  agent_id: string;
  project_id: string;
  status: 'succeeded' | 'failed' | 'healed';
  finished_at: string;
  error: string | null;
}
export interface Activity {
  runs: ActiveRun[];
  recent: RecentRun[];
  eta: Record<string, number>;   // agent_id -> erwartete Laufdauer in Sekunden
  server_time: string;
}

// --- Manifeste (Tracking-Typ-Vorlagen) ---------------------------------------
export const ManifestParamSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),                       // text | number | date | select
  default: z.any().optional(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});
export type ManifestParam = z.infer<typeof ManifestParamSchema>;

export const ManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  params: z.array(ManifestParamSchema).default([]),
  result_schema: z.any().optional(),
  display: z.record(z.string(), z.any()).optional(),
  goal_template: z.string().optional(),
  default_schedule: z.string().optional(),
  version: z.number().optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// --- Blueprints (Quellen-Vorlagen) -------------------------------------------
// Eine wiederverwendbare Quelle (z.B. „idealo Flug"), die zu einem Manifest
// gehört und einen fertig vorbereiteten Agenten beschreibt (site + goal).
export const BlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  manifest_id: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  // Ausführungsart: "browser" = anlernbares Playwright-Recipe, "api" = Provider-Adapter.
  kind: z.enum(['browser', 'api']).default('browser'),
  provider: z.string().optional(),        // bei kind:api der Adapter-Name (z.B. "kiwi")
  site: z.string(),
  goal_template: z.string().optional(),
  default_schedule: z.string().optional(),
  // Fertiges Recipe („Starthilfe"): Quellen, deren Suche komplett in der URL
  // steht, brauchen kein Anlernen — der Agent läuft ab dem ersten Klick.
  // {{param}} wird beim Ausführen aus Projekt+Agent-Params ersetzt.
  recipe: z.array(z.any()).optional(),
  // Vorbelegte Agent-Parameter (z.B. Selektor-Varianten, _category).
  params: z.record(z.string(), z.any()).optional(),
  // Ergebnis-Schema der Quelle (Felder, die das Recipe liefert).
  result_schema: z.record(z.string(), z.any()).optional(),
  // Freitext-Hinweis, der im Blueprint-Picker unter der Beschreibung steht.
  note: z.string().optional(),
  version: z.number().optional(),
});
export type Blueprint = z.infer<typeof BlueprintSchema>;

// Ein Bundle bündelt Bausteine (Manifeste/Blueprints) zum Teilen/Import.
export const CheckyBundleSchema = z.object({
  kind: z.literal('checky-bundle'),
  version: z.literal(1),
  manifests: z.array(ManifestSchema).optional(),
  blueprints: z.array(BlueprintSchema).optional(),
  recipes: z.array(z.any()).optional(),
});
export type CheckyBundle = z.infer<typeof CheckyBundleSchema>;

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
  provider: z.string().nullable().optional(),   // gesetzt = API-Quelle (kind:api), sonst Browser-Recipe
  has_recipe: z.boolean().optional(),   // wird von der API mitgeliefert (nicht in DB)
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

export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  manifest_id: z.string().nullable().optional(),
  params: z.record(z.string(), z.any()).optional(),
});
export type CreateProject = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial();
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

export const CreateAgentSchema = AgentSchema.omit({
  id: true,
  project_id: true,
  created_at: true,
}).extend({
  // Optional: fertiges Recipe aus einem Blueprint direkt als v1 anlegen.
  recipe: z.array(z.any()).optional(),
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
