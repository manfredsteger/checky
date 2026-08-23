import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../ui/toast';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ProjectParamsEditor } from '../ui/ProjectParamsEditor';
import { AgentParamsEditor } from '../ui/AgentParamsEditor';
import { Settings2, LineChart, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { ProjectOverview } from '../ui/ProjectOverview';
import { splitSeries } from '../lib/series';
import { CronExpressionParser } from 'cron-parser';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Agent } from '@checky/shared';
import { resolveDisplay, type Resolved } from '../lib/resultDisplay';
import { ResultView } from '../ui/ResultView';
import { CATEGORIES, categoryOf } from '../lib/categories';
import { useAgentActivity, useAgentOutcome, useProjectActivity, useActivity, formatElapsed } from '../lib/activity';
import { RunProgressBar, RunStatusChip, RunOutcomeChip } from '../ui/RunActivity';

const PRIO: Record<number, { label: string; cls: string }> = {
  1: { label: 'P1', cls: 'bg-red-500/15 text-red-300' },
  2: { label: 'P2', cls: 'bg-amber-500/15 text-amber-300' },
  3: { label: 'P3', cls: 'bg-sky-500/15 text-sky-300' },
  4: { label: 'P4', cls: 'bg-[#374151] text-[#9ca3af]' },
};

function nextRunLabel(cron: string, enabled: boolean): string {
  if (!enabled) return '—';
  try {
    return format(CronExpressionParser.parse(cron).next().toDate(), "dd. MMM, HH:mm 'Uhr'", { locale: de });
  } catch { return 'Ungültiger Cron'; }
}

function AgentCard({ agent, projectId, resolved, onToggle, onTrigger, onEdit, onDelete, triggering }: {
  agent: Agent; projectId: string; resolved: Resolved;
  onToggle: (a: Agent) => void; onTrigger: (id: string) => void; onEdit: (a: Agent) => void;
  onDelete: (a: Agent) => void; triggering: boolean;
}) {
  const prio = PRIO[(agent.params as any)?._priority] ?? PRIO[3];
  const activity = useAgentActivity(agent.id);
  const outcome = useAgentOutcome(agent.id);
  const { data: results } = useQuery({
    queryKey: ['agent-last', agent.id],
    queryFn: () => api.getAgentResults(agent.id),
    staleTime: 15000,
  });
  // Nur die aktuelle Messreihe — sonst vergleicht der Trendpfeil über eine
  // Parameteränderung hinweg und meldet einen Sprung, den es nie gab.
  const series = splitSeries(results);
  const last = series.current[0];
  // Manifest-Kennzahl bevorzugt; sonst generische Felder als Fallback.
  const hasHeadline = !!(last && resolved.headlineField && last.data?.[resolved.headlineField] != null);
  const fields = last ? Object.keys(last.data || {}).filter(k => !k.startsWith('_') && k !== resolved.headlineField).slice(0, 3) : [];
  // API-Quellen (provider) brauchen kein angelerntes Recipe.
  const notLearned = agent.has_recipe === false && !agent.provider;
  // „Zum Angebot": Buchungslink der API-Quelle, sonst die Seite, auf der die
  // Werte im letzten Lauf tatsächlich standen (vom Executor mitgeschrieben).
  const liveUrl: string | undefined = (last?.data as any)?.booking_url || (last?.data as any)?._url;

  return (
    <div className={`relative bg-[#111827] border p-5 rounded-xl flex flex-col gap-3 overflow-hidden transition-colors
      ${activity ? (activity.stalled ? 'border-amber-500/60 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]' : 'border-emerald-500/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]')
        : outcome ? (outcome.status === 'failed' ? 'border-red-500/50' : 'border-emerald-500/40')
        : notLearned ? 'border-amber-500/40' : 'border-[#1f2937]'}
      ${!agent.enabled && !activity ? 'opacity-70' : ''}`}>
      {activity && <RunProgressBar activity={activity} className="absolute inset-x-0 top-0 rounded-none" />}

      <div className="flex justify-between items-start gap-2">
        {/* Abzeichen dürfen umbrechen, die Aktionen nicht — sonst wird bei vielen
            Abzeichen („Nicht angelernt") der Aktivieren-Knopf abgeschnitten. */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${prio.cls}`}>{prio.label}</span>
          {activity
            ? <RunStatusChip activity={activity} />
            : outcome
            ? <RunOutcomeChip outcome={outcome} />
            : agent.enabled
              ? <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold rounded uppercase tracking-wider">Aktiv</span>
              : <span className="px-2 py-0.5 bg-[#374151] text-[#9ca3af] text-[10px] font-bold rounded uppercase tracking-wider">Inaktiv</span>}
          {notLearned && <span className="px-2 py-0.5 bg-amber-500/15 text-amber-300 text-[10px] font-bold rounded uppercase tracking-wider">Nicht angelernt</span>}
          {agent.provider && <span className="px-2 py-0.5 bg-sky-500/15 text-sky-300 text-[10px] font-bold rounded uppercase tracking-wider">API · {agent.provider}</span>}
          {categoryOf((agent.params as any)?._category) && (
            <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${categoryOf((agent.params as any)?._category)!.badge}`}>{categoryOf((agent.params as any)?._category)!.label}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => onEdit(agent)} title="Agent bearbeiten"
            className="text-[#6b7280] hover:text-white bg-[#1f2937] hover:bg-[#374151] p-1.5 rounded">
            <Settings2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onToggle(agent)} className="text-[10px] bg-[#1f2937] hover:bg-[#374151] px-2 py-1 rounded text-white">
            {agent.enabled ? 'Pausieren' : 'Aktivieren'}
          </button>
          <button onClick={() => onDelete(agent)} title="Agent löschen"
            className="text-[#6b7280] hover:text-red-400 bg-[#1f2937] hover:bg-red-500/15 p-1.5 rounded">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-base font-bold text-white leading-tight">{agent.name}</h3>
        <p className="text-[11px] text-emerald-400/80 font-mono break-all">{agent.site}</p>
      </div>
      <p className="text-xs text-[#9ca3af] line-clamp-2" title={agent.goal_text}>{agent.goal_text}</p>

      {/* Letztes Ergebnis — mit Direktlink auf genau diese Suche */}
      <div className="rounded-lg bg-[#0f151f] border border-[#1f2937] px-3 py-2 min-h-[42px]">
        {last ? (
          hasHeadline ? (
            <ResultView results={series.current} resolved={resolved} size="sm" />
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {fields.map(f => (
                <span key={f} className="text-xs"><span className="text-[#6b7280]">{f}:</span> <span className="text-white font-medium">{String(last.data[f])}</span></span>
              ))}
              {fields.length === 0 && <span className="text-xs text-[#6b7280]">Ergebnis ohne Felder</span>}
            </div>
          )
        ) : notLearned ? (
          <span className="text-xs text-amber-300/90">⚠ Noch nicht angelernt — erst per „Anlernen" ein Recipe aufnehmen, dann kommen Ergebnisse.</span>
        ) : (
          <span className="text-xs text-[#6b7280]">Noch kein Ergebnis</span>
        )}
        {liveUrl && (
          <a href={liveUrl} target="_blank" rel="noopener noreferrer"
            title="Diese Suche im Browser öffnen — Route, Datum und Reisende sind schon eingetragen"
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 hover:underline">
            Zum Angebot <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-[#1f2937]">
        <div className="flex flex-col min-w-0">
          {activity ? (
            <>
              <span className={`text-[10px] uppercase tracking-wider ${activity.stalled ? 'text-amber-400/80' : 'text-emerald-400/80'}`}>
                {activity.status === 'queued' ? 'Wartet auf Worker' : 'Läuft gerade'}
              </span>
              <span className="text-xs font-mono text-white flex items-center gap-1.5">
                <Loader2 className={`w-3 h-3 animate-spin ${activity.stalled ? 'text-amber-400' : 'text-emerald-400'}`} />
                {formatElapsed(activity.elapsed)}
                {activity.remaining != null && <span className="text-[#6b7280]">/ ~{formatElapsed(activity.elapsed + activity.remaining)}</span>}
              </span>
            </>
          ) : (
            <>
              <span className="text-[10px] text-[#6b7280] uppercase tracking-wider">Nächster Lauf</span>
              <span className="text-xs font-mono text-white">{nextRunLabel(agent.schedule_cron, agent.enabled)}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Link to={`/agents/${agent.id}/results`} className="bg-[#1f2937] hover:bg-[#374151] text-white border border-[#374151] text-[10px] font-bold py-1.5 px-2.5 rounded">Ergebnisse</Link>
          {!agent.provider && (
            <Link to={`/projects/${projectId}/agents/${agent.id}/recorder`}
              className={notLearned
                ? "bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold py-1.5 px-2.5 rounded"
                : "bg-[#1f2937] hover:bg-[#374151] text-white border border-[#374151] text-[10px] font-bold py-1.5 px-2.5 rounded"}>
              Anlernen
            </Link>
          )}
          <button disabled={triggering || !!activity} onClick={() => onTrigger(agent.id)}
            title={activity ? 'Ein Lauf ist bereits unterwegs' : 'Jetzt einen Lauf einreihen'}
            className="bg-[#1f2937] hover:bg-emerald-600/20 text-white hover:text-emerald-400 border border-[#374151] hover:border-emerald-500/50 text-[10px] font-bold py-1.5 px-2.5 rounded disabled:opacity-50 disabled:hover:bg-[#1f2937] disabled:hover:text-white inline-flex items-center gap-1.5">
            {activity && <Loader2 className="w-3 h-3 animate-spin" />}
            {activity ? 'Läuft…' : 'Ausführen'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmRunAll, setConfirmRunAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  const projectActivity = useProjectActivity(projectId!);

  const { data: project, error: projectError } = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.getProject(projectId!), retry: false });
  const { data: agents, isLoading, error: agentsError } = useQuery({ queryKey: ['agents', projectId], queryFn: () => api.getProjectAgents(projectId!), retry: false });
  const { data: manifest } = useQuery({ queryKey: ['manifest', project?.manifest_id], queryFn: () => api.getManifest(project!.manifest_id!), enabled: !!project?.manifest_id });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.updateAgent(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents', projectId] }),
  });
  const { markPending } = useActivity();

  const triggerMutation = useMutation({
    mutationFn: (id: string) => { markPending(id); return api.triggerAgentRun(id); },
    // Aktivität sofort nachladen, damit Spinner/Balken nicht erst beim nächsten Poll erscheinen.
    onSuccess: () => { toast('success', 'Lauf eingereiht.'); queryClient.invalidateQueries({ queryKey: ['activity'] }); },
    onError: (e) => toast('error', (e as Error).message),
  });

  // Agent endgültig entfernen. Läufe, Ergebnisse und Recipes hängen per
  // ON DELETE CASCADE daran und verschwinden mit — deshalb Rückfrage.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAgent(id),
    onSuccess: (_d, id) => {
      const name = (agents ?? []).find(a => a.id === id)?.name ?? 'Agent';
      toast('success', `„${name}" gelöscht.`);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['agents', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast('error', (e as Error).message),
  });

  const bulkEnable = useMutation({
    mutationFn: async (enabled: boolean) => {
      await Promise.allSettled((agents ?? []).map(a => api.updateAgent(a.id, { enabled })));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents', projectId] }),
  });

  const runAll = useMutation({
    mutationFn: async () => {
      const enabled = (agents ?? []).filter(a => a.enabled);
      enabled.forEach(a => markPending(a.id));
      const res = await Promise.allSettled(enabled.map(a => api.triggerAgentRun(a.id)));
      return { ok: res.filter(r => r.status === 'fulfilled').length, total: enabled.length };
    },
    onSuccess: (r) => { toast('success', `${r.ok}/${r.total} Läufe eingereiht.`); queryClient.invalidateQueries({ queryKey: ['activity'] }); },
    onError: (e) => toast('error', (e as Error).message),
  });

  const error = projectError || agentsError;
  if (error) {
    return (
      <div className="p-8 flex-1 min-h-0 overflow-auto">
        <div className="bg-red-900/20 border border-red-500/50 text-red-200 p-4 rounded-xl">
          <p className="font-bold">Datenbank-Verbindungsfehler</p>
          <p className="text-sm mt-1">{error instanceof Error ? error.message : 'Die Datenbank ist nicht erreichbar.'}</p>
        </div>
      </div>
    );
  }
  if (!project) return null;

  // Nach Priorität sortieren, dann Name
  const sorted = agents?.slice().sort((a, b) => {
    const pa = (a.params as any)?._priority ?? 3, pb = (b.params as any)?._priority ?? 3;
    return pa - pb || a.name.localeCompare(b.name);
  });
  // Vorkommende Kategorien (für die Filterleiste) + gefilterte Sicht
  const presentCats = CATEGORIES.filter(c => (agents ?? []).some(a => (a.params as any)?._category === c.key));
  const visible = catFilter ? sorted?.filter(a => (a.params as any)?._category === catFilter) : sorted;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="relative h-16 border-b border-[#1f2937] flex items-center justify-between px-8 bg-[#0a0a0b] shrink-0">
        {/* Laufender Balken über die ganze Breite: „im Projekt passiert gerade etwas". */}
        {projectActivity.active && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-emerald-500/15">
            <div className="h-full w-1/4 bg-emerald-400 checky-indeterminate" />
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[#6b7280]">Projekte</span>
          <span className="text-[#4b5563]">/</span>
          <span className="text-white font-medium">{project.name}</span>
          {agents && <span className="text-[#6b7280] text-xs">· {agents.length} Agenten</span>}
          {projectActivity.active && (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
              {projectActivity.running > 0 && `${projectActivity.running} läuft`}
              {projectActivity.running > 0 && projectActivity.queued > 0 && ' · '}
              {projectActivity.queued > 0 && `${projectActivity.queued} wartet`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOverviewOpen(o => !o)} title="Projekt-Übersicht (Charts & Statistik)"
            className={`flex items-center gap-1.5 border text-xs font-bold py-2 px-3 rounded transition-colors ${overviewOpen ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-400' : 'bg-[#1f2937] hover:bg-[#374151] border-[#374151] text-white'}`}>
            <LineChart className="w-4 h-4" /> Übersicht
          </button>
          <button onClick={() => setSettingsOpen(true)} title="Projekt-Einstellungen"
            className="bg-[#1f2937] hover:bg-[#374151] border border-[#374151] text-white p-2 rounded transition-colors">
            <Settings2 className="w-4 h-4" />
          </button>
          <button onClick={() => bulkEnable.mutate(true)} disabled={bulkEnable.isPending}
            className="bg-[#1f2937] hover:bg-emerald-600/20 hover:text-emerald-400 border border-[#374151] text-white text-xs font-bold py-2 px-3 rounded transition-colors disabled:opacity-50">
            Alle aktivieren
          </button>
          <button onClick={() => bulkEnable.mutate(false)} disabled={bulkEnable.isPending}
            className="bg-[#1f2937] hover:bg-red-600/20 hover:text-red-300 border border-[#374151] text-white text-xs font-bold py-2 px-3 rounded transition-colors disabled:opacity-50">
            Alle pausieren
          </button>
          <button onClick={() => setConfirmRunAll(true)} disabled={runAll.isPending}
            className="bg-[#1f2937] hover:bg-[#374151] border border-[#374151] text-white text-xs font-bold py-2 px-3 rounded transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
            {runAll.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Alle ausführen
          </button>
          <Link to={`/projects/${projectId}/agents/new`} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-4 rounded transition-colors">+ Neuer Agent</Link>
        </div>
      </header>

      <section className="flex-1 min-h-0 p-8 overflow-y-auto">
        {project.description && <p className="text-sm text-[#9ca3af] mb-6 max-w-3xl">{project.description}</p>}
        {overviewOpen && agents && agents.length > 0 && (
          <ProjectOverview project={project} agents={agents} manifest={manifest} />
        )}
        {presentCats.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <button onClick={() => setCatFilter(null)}
              className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${!catFilter ? 'bg-[#1f2937] border-[#374151] text-white' : 'bg-transparent border-[#1f2937] text-[#9ca3af] hover:text-white'}`}>
              Alle ({agents?.length ?? 0})
            </button>
            {presentCats.map(c => {
              const n = (agents ?? []).filter(a => (a.params as any)?._category === c.key).length;
              return (
                <button key={c.key} onClick={() => setCatFilter(c.key)}
                  className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${catFilter === c.key ? c.badge + ' border-transparent' : 'bg-transparent border-[#1f2937] text-[#9ca3af] hover:text-white'}`}>
                  {c.label} ({n})
                </button>
              );
            })}
          </div>
        )}
        {isLoading ? (
          <div className="text-[#6b7280]">Lade Agenten…</div>
        ) : sorted?.length === 0 ? (
          <div className="text-center py-12 text-[#6b7280] border border-dashed border-[#374151] rounded-xl">
            Noch keine Agenten. Erstelle deinen ersten Agenten für dieses Projekt!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {visible?.map(agent => (
              <AgentCard key={agent.id} agent={agent} projectId={projectId!} onDelete={setDeleteTarget}
                resolved={resolveDisplay(manifest, { ...(project.params || {}), ...(agent.params || {}) })}
                onToggle={(a) => toggleMutation.mutate({ id: a.id, enabled: !a.enabled })}
                onTrigger={(id) => triggerMutation.mutate(id)}
                onEdit={setEditAgent}
                triggering={triggerMutation.isPending} />
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`„${deleteTarget?.name ?? ''}" löschen?`}
        message={'Der Agent wird mit allen Läufen, Ergebnissen und angelernten Recipes entfernt. Das lässt sich nicht rückgängig machen. Nur pausieren? Dann abbrechen und stattdessen den Pausieren-Knopf nutzen.'}
        confirmLabel="Endgültig löschen"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={confirmRunAll}
        title="Alle aktiven Agenten ausführen?"
        message={`Für jeden aktiven Agenten in „${project.name}" wird jetzt ein Lauf eingereiht.`}
        confirmLabel="Ausführen"
        loading={runAll.isPending}
        onCancel={() => setConfirmRunAll(false)}
        onConfirm={() => { setConfirmRunAll(false); runAll.mutate(); }}
      />

      {settingsOpen && <ProjectParamsEditor project={project} onClose={() => setSettingsOpen(false)} />}
      {editAgent && <AgentParamsEditor agent={editAgent} manifest={manifest} projectParams={project.params} onClose={() => setEditAgent(null)} />}
    </div>
  );
}
