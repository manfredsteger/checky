import { query } from '@anthropic-ai/claude-agent-sdk';
import { HealResponseSchema, type AIProvider, type HealResult, type ExtractResult } from '@checky/shared';

// Alle eingebauten Tools sperren: die KI soll NUR Text (JSON) liefern, nichts ausführen.
const DISALLOWED = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'Agent', 'Skill', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'NotebookEdit', 'TodoWrite',
];

// Ein einzelner, nicht-interaktiver Claude-Aufruf. Liefert finalen Text + Token-Verbrauch.
async function askOnce(prompt: string, systemPrompt: string): Promise<{ text: string; tokens: number }> {
  let text: string | null = null;
  let tokens = 0;

  for await (const message of query({
    prompt,
    options: {
      model: 'haiku',
      systemPrompt,
      disallowedTools: DISALLOWED,
      // Kein permissionMode: 'bypassPermissions' -> das setzt --dangerously-skip-permissions,
      // was Claude Code als root (Playwright-Image) verweigert. Wir sperren Tools ohnehin
      // per disallowedTools und liefern nur Text zurück, also braucht es keine Permission-Prompts.
      maxTurns: 1,
    } as any,
  })) {
    const m = message as any;
    if (m.type === 'result') {
      tokens = (m.usage?.input_tokens || 0) + (m.usage?.output_tokens || 0);
      if (m.subtype === 'success') text = m.result;
      else throw new Error(`Claude-Query fehlgeschlagen: ${m.subtype}`);
    }
  }

  if (text === null) throw new Error('Keine Antwort von Claude erhalten');
  return { text, tokens };
}

// Tolerantes JSON-Parsen: entfernt evtl. Markdown-Fences.
function parseJsonLoose(text: string): unknown {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  return JSON.parse(t);
}

export class ClaudeAgentProvider implements AIProvider {
  async healSelector(failedStep: unknown, ariaSnapshot: string): Promise<HealResult> {
    const systemPrompt =
      'Du reparierst kaputte Playwright-Locators. Antworte AUSSCHLIESSLICH mit JSON der Form {"locator":"..."} und nichts sonst. ' +
      'Der Locator MUSS im Playwright-Format sein: getByRole(\'role\', { name: \'...\' }), getByLabel(\'...\'), ' +
      'getByPlaceholder(\'...\'), getByTestId(\'...\') oder ein CSS-Selektor. Kein XPath, kein Markdown.';
    const basePrompt =
      `Dieser Schritt schlug fehl, weil sein Selektor nicht mehr passt:\n${JSON.stringify(failedStep)}\n\n` +
      `ARIA-Snapshot der aktuellen Seite:\n${ariaSnapshot.slice(0, 12000)}\n\n` +
      `Gib einen neuen, funktionierenden Locator zurück, der dasselbe Element trifft. Nur JSON {"locator":"..."}.`;

    let tokensTotal = 0;
    let lastErr = '';
    // SPEC: genau 1 Retry mit Fehlerhinweis, dann aufgeben.
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nDeine letzte Antwort war ungültig (${lastErr}). Antworte NUR mit JSON {"locator":"..."}.`;
      const { text, tokens } = await askOnce(prompt, systemPrompt);
      tokensTotal += tokens;
      try {
        const parsed = HealResponseSchema.parse(parseJsonLoose(text));
        return { locator: parsed.locator, tokens: tokensTotal };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(`healSelector: ungültige KI-Antwort nach Retry (${lastErr})`);
  }

  async extractJson(pageText: string, jsonSchema: unknown): Promise<ExtractResult> {
    const systemPrompt =
      'Du extrahierst strukturierte Daten aus Seitentext. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ' +
      'das exakt dem vorgegebenen JSON-Schema entspricht. Kein Markdown, keine Erklärung.';
    const basePrompt =
      `JSON-Schema des Ergebnisses:\n${JSON.stringify(jsonSchema)}\n\n` +
      `Seitentext:\n${pageText.slice(0, 15000)}\n\nGib nur das JSON-Objekt zurück.`;

    let tokensTotal = 0;
    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt = attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nDeine letzte Antwort war ungültig (${lastErr}). Nur valides JSON.`;
      const { text, tokens } = await askOnce(prompt, systemPrompt);
      tokensTotal += tokens;
      try {
        return { data: parseJsonLoose(text), tokens: tokensTotal };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(`extractJson: ungültige KI-Antwort nach Retry (${lastErr})`);
  }
}
