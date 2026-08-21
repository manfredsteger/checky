import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useToast } from '../ui/toast';
import type { Blueprint } from '@checky/shared';
import { CATEGORIES } from '../lib/categories';

export default function CreateAgent() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [goal, setGoal] = useState('');
  const [resultSchema, setResultSchema] = useState('{\n  "value": "string"\n}');
  const [paramsJson, setParamsJson] = useState('{}');
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [blueprintId, setBlueprintId] = useState('');
  const [category, setCategory] = useState('price');

  // Blueprints (Quellen-Vorlagen) für den Tracking-Typ des Projekts.
  const projectQ = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.getProject(projectId!), enabled: !!projectId });
  const blueprintsQ = useQuery({ queryKey: ['blueprints', projectQ.data?.manifest_id], queryFn: () => api.getBlueprints(projectQ.data?.manifest_id || undefined), enabled: !!projectQ.data });

  const applyBlueprint = (bp: Blueprint | undefined) => {
    setBlueprintId(bp?.id || '');
    if (!bp) { setProvider(null); return; }
    setName(bp.name);
    setSite(bp.site);
    setGoal(bp.goal_template || '');
    setProvider(bp.kind === 'api' ? (bp.provider || null) : null);
    if (bp.default_schedule) { setScheduleMode('expert'); setExpertCron(bp.default_schedule); }
    if (bp.kind === 'api') setEnabled(true); // API-Quellen brauchen kein Anlernen -> gleich aktiv
  };

  const SCHEMA_TEMPLATES: Record<string, string> = {
    'Frei': '{\n  "value": "string"\n}',
    'Preis': '{\n  "price": "string",\n  "currency": "string",\n  "note": "string"\n}',
    'Flug': '{\n  "price": "string",\n  "currency": "string",\n  "airline": "string",\n  "stops": "string",\n  "duration": "string"\n}',
    'Verfügbarkeit': '{\n  "available": "string",\n  "note": "string"\n}',
    'Buch': '{\n  "title": "string",\n  "price": "string",\n  "availability": "string"\n}',
  };

  // Schedule Builder State
  const [scheduleMode, setScheduleMode] = useState<'daily' | 'hourly' | 'weekly' | 'monthly' | 'expert'>('daily');
  const [dailyTime, setDailyTime] = useState('08:00');
  const [hourlyInterval, setHourlyInterval] = useState('6');
  const [weeklyDay, setWeeklyDay] = useState('1'); // 1 = Monday
  const [weeklyTime, setWeeklyTime] = useState('08:00');
  const [monthlyDay, setMonthlyDay] = useState('1');
  const [monthlyTime, setMonthlyTime] = useState('08:00');
  const [expertCron, setExpertCron] = useState('0 8 * * *');

  const generatedCron = useMemo(() => {
    if (scheduleMode === 'expert') return expertCron;
    
    if (scheduleMode === 'daily') {
      const [h, m] = dailyTime.split(':');
      return `${parseInt(m || '0')} ${parseInt(h || '8')} * * *`;
    }
    if (scheduleMode === 'hourly') {
      return `0 */${hourlyInterval || '1'} * * *`;
    }
    if (scheduleMode === 'weekly') {
      const [h, m] = weeklyTime.split(':');
      return `${parseInt(m || '0')} ${parseInt(h || '8')} * * ${weeklyDay}`;
    }
    if (scheduleMode === 'monthly') {
      const [h, m] = monthlyTime.split(':');
      return `${parseInt(m || '0')} ${parseInt(h || '8')} ${monthlyDay} * *`;
    }
    return '0 8 * * *';
  }, [scheduleMode, dailyTime, hourlyInterval, weeklyDay, weeklyTime, monthlyDay, monthlyTime, expertCron]);

  const createMutation = useMutation({
    mutationFn: () => {
      let schemaObj = {};
      try { schemaObj = JSON.parse(resultSchema); } catch (e) { toast('error', 'Ungültiges JSON im Result-Schema'); throw e; }
      let paramsObj: Record<string, any> = {};
      try { paramsObj = JSON.parse(paramsJson || '{}'); } catch (e) { toast('error', 'Ungültiges JSON in den Parametern'); throw e; }
      if (category) paramsObj._category = category;   // Klassifizierung mitspeichern

      return api.createAgent(projectId!, {
        name,
        site,
        goal_text: goal,
        schedule_cron: generatedCron,
        result_schema: schemaObj,
        params: paramsObj,
        notify: {},
        jitter_min: 0,
        enabled,
        provider: provider ?? undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', projectId] });
      navigate(`/projects/${projectId}`);
    }
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#0a0a0b] text-[#d1d5db]">
      <header className='h-16 border-b border-[#1f2937] flex items-center justify-between px-8 bg-[#0a0a0b] shrink-0'>
        <div className='flex items-center gap-2 text-sm'>
          <Link to={`/projects/${projectId}`} className='text-[#6b7280] hover:text-white transition-colors'>Zurück zum Projekt</Link>
          <span className='text-[#4b5563]'>/</span>
          <span className='text-white font-medium'>Neuer Agent</span>
        </div>
      </header>

      <div className="p-8 max-w-3xl mx-auto w-full overflow-y-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Agent anlegen</h1>

        {(blueprintsQ.data?.length ?? 0) > 0 && (
          <div className="bg-[#111827] border border-sky-500/30 p-6 rounded-xl mb-6">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Vorlage (Blueprint)</h2>
            <p className="text-xs text-[#6b7280] mb-3">Fertige Quelle wählen — füllt URL, Ziel und Zeitplan automatisch. API-Quellen (z.&nbsp;B. Kiwi) brauchen kein Anlernen.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => applyBlueprint(undefined)}
                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${!blueprintId ? 'bg-[#1f2937] border-[#374151] text-white' : 'bg-transparent border-[#1f2937] text-[#9ca3af] hover:text-white'}`}>
                Frei / manuell
              </button>
              {blueprintsQ.data!.map(bp => (
                <button key={bp.id} onClick={() => applyBlueprint(bp)}
                  className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors flex items-center gap-1.5 ${blueprintId === bp.id ? 'bg-sky-500/15 border-sky-500/50 text-sky-200' : 'bg-transparent border-[#1f2937] text-[#9ca3af] hover:text-white'}`}>
                  {bp.name}
                  {bp.kind === 'api' && <span className="px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[9px] uppercase">API</span>}
                </button>
              ))}
            </div>
            {blueprintId && provider && (
              <p className="text-xs text-sky-300 mt-3">✓ API-Quelle „{provider}" — kein Anlernen nötig; die Parameter kommen aus den Projekt-Einstellungen (Zahnrad).</p>
            )}
          </div>
        )}

        {createMutation.error && (
          <div className="bg-red-900/20 border border-red-500/50 text-red-200 p-4 rounded-xl mb-6">
            <p className="font-bold">Datenbank-Verbindungsfehler</p>
            <p className="text-sm mt-1">
              {createMutation.error instanceof Error ? createMutation.error.message : 'Konnte Agent nicht anlegen.'}
              <br />
              Bitte stelle sicher, dass die Umgebungsvariable <code>DB_URL</code> gesetzt ist.
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div className="bg-[#111827] border border-[#1f2937] p-6 rounded-xl space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2">Basisdaten</h2>
            
            <div>
              <label className="block text-xs font-bold text-[#9ca3af] mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-[#1f2937] border border-[#374151] rounded px-4 py-2 text-white focus:outline-none focus:border-emerald-500" placeholder="z.B. Bücher-Preis-Check" />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#9ca3af] mb-1">Ziel-URL (Site)</label>
              <input value={site} onChange={e => setSite(e.target.value)} className="w-full bg-[#1f2937] border border-[#374151] rounded px-4 py-2 text-white font-mono focus:outline-none focus:border-emerald-500" placeholder="https://books.toscrape.com" />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#9ca3af] mb-1">Zielvorgabe (Prompt / Goal)</label>
              <textarea value={goal} onChange={e => setGoal(e.target.value)} className="w-full h-24 bg-[#1f2937] border border-[#374151] rounded px-4 py-2 text-white focus:outline-none focus:border-emerald-500" placeholder="Was soll der Agent auf der Seite tun?" />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#9ca3af] mb-1">Kategorie</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button key={c.key} type="button" onClick={() => setCategory(c.key)}
                    className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${category === c.key ? c.badge + ' border-transparent' : 'bg-transparent border-[#1f2937] text-[#9ca3af] hover:text-white'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-[#111827] border border-[#1f2937] p-6 rounded-xl space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Ergebnis-Felder (Schema)</h2>
            <div className="flex flex-wrap gap-2">
              {Object.keys(SCHEMA_TEMPLATES).map(t => (
                <button key={t} onClick={() => setResultSchema(SCHEMA_TEMPLATES[t])}
                  className="px-2.5 py-1 rounded text-xs bg-[#1f2937] text-[#9ca3af] hover:text-white hover:bg-[#374151] transition-colors">
                  {t}
                </button>
              ))}
            </div>
            <textarea value={resultSchema} onChange={e => setResultSchema(e.target.value)} className="w-full h-28 bg-[#1f2937] border border-[#374151] rounded px-4 py-2 text-emerald-400 font-mono text-sm focus:outline-none focus:border-emerald-500" />
            <p className="text-xs text-[#6b7280]">Welche Felder soll ein Ergebnis enthalten? Vorlage wählen oder anpassen.</p>
          </div>

          <div className="bg-[#111827] border border-[#1f2937] p-6 rounded-xl space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Parameter (JSON, optional)</h2>
            <textarea value={paramsJson} onChange={e => setParamsJson(e.target.value)} className="w-full h-24 bg-[#1f2937] border border-[#374151] rounded px-4 py-2 text-sky-300 font-mono text-sm focus:outline-none focus:border-emerald-500" placeholder='{ "origin": "BER", "outbound": "2027-01-01" }' />
            <p className="text-xs text-[#6b7280]">Werte, die im Recipe als <code className="text-sky-300">{'{{platzhalter}}'}</code> in URLs, Eingaben und Selektoren eingesetzt werden.</p>
          </div>

          <div className="bg-[#111827] border border-[#1f2937] p-6 rounded-xl space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-2">Zeitplan</h2>
            
            <div className="flex gap-2 border-b border-[#1f2937] pb-4 mb-4">
              {(['daily', 'hourly', 'weekly', 'monthly', 'expert'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setScheduleMode(mode)}
                  className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${scheduleMode === mode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#1f2937] text-[#9ca3af] hover:text-white'}`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            <div className="min-h-[80px]">
              {scheduleMode === 'daily' && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#9ca3af]">Jeden Tag um</span>
                  <input type="time" value={dailyTime} onChange={e => setDailyTime(e.target.value)} className="bg-[#1f2937] border border-[#374151] rounded px-3 py-1 text-white" />
                  <span className="text-sm text-[#9ca3af]">Uhr</span>
                </div>
              )}
              {scheduleMode === 'hourly' && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#9ca3af]">Alle</span>
                  <input type="number" min="1" max="23" value={hourlyInterval} onChange={e => setHourlyInterval(e.target.value)} className="w-20 bg-[#1f2937] border border-[#374151] rounded px-3 py-1 text-white" />
                  <span className="text-sm text-[#9ca3af]">Stunden</span>
                </div>
              )}
              {scheduleMode === 'weekly' && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#9ca3af]">Jeden</span>
                  <select value={weeklyDay} onChange={e => setWeeklyDay(e.target.value)} className="bg-[#1f2937] border border-[#374151] rounded px-3 py-1 text-white">
                    <option value="1">Montag</option>
                    <option value="2">Dienstag</option>
                    <option value="3">Mittwoch</option>
                    <option value="4">Donnerstag</option>
                    <option value="5">Freitag</option>
                    <option value="6">Samstag</option>
                    <option value="0">Sonntag</option>
                  </select>
                  <span className="text-sm text-[#9ca3af]">um</span>
                  <input type="time" value={weeklyTime} onChange={e => setWeeklyTime(e.target.value)} className="bg-[#1f2937] border border-[#374151] rounded px-3 py-1 text-white" />
                </div>
              )}
              {scheduleMode === 'monthly' && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#9ca3af]">Jeden</span>
                  <input type="number" min="1" max="31" value={monthlyDay} onChange={e => setMonthlyDay(e.target.value)} className="w-16 bg-[#1f2937] border border-[#374151] rounded px-3 py-1 text-white" />
                  <span className="text-sm text-[#9ca3af]">. des Monats um</span>
                  <input type="time" value={monthlyTime} onChange={e => setMonthlyTime(e.target.value)} className="bg-[#1f2937] border border-[#374151] rounded px-3 py-1 text-white" />
                </div>
              )}
              {scheduleMode === 'expert' && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-[#9ca3af]">Roher Cron-Ausdruck:</span>
                  <input value={expertCron} onChange={e => setExpertCron(e.target.value)} className="font-mono bg-[#1f2937] border border-[#374151] rounded px-3 py-2 text-emerald-400" placeholder="* * * * *" />
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-[#1f2937] flex items-center justify-between">
              <span className="text-xs text-[#6b7280]">Erzeugter Cron:</span>
              <span className="font-mono text-sm text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded">{generatedCron}</span>
            </div>
          </div>

          <label className="flex items-center gap-3 bg-[#111827] border border-[#1f2937] p-4 rounded-xl cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
            <span className="text-sm">
              Sofort aktivieren
              <span className="block text-xs text-[#6b7280]">Empfehlung: aus lassen und erst per „Neu anlernen" ein Recipe aufnehmen — sonst laufen geplante Checks ohne Recipe ins Leere.</span>
            </span>
          </label>

          <button
            disabled={!name || !site || !goal || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl transition-colors"
          >
            {createMutation.isPending ? 'Speichern...' : 'Agent anlegen'}
          </button>
        </div>
      </div>
    </div>
  );
}
