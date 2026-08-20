import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { CronExpressionParser } from 'cron-parser';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Agent } from '@checky/shared';

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

function AgentCard({ agent, projectId, onToggle, onTrigger, triggering }: {
  agent: Agent; projectId: string;
  onToggle: (a: Agent) => void; onTrigger: (id: string) => void; triggering: boolean;
}) {
  const prio = PRIO[(agent.params as any)?._priority] ?? PRIO[3];
  const { data: results } = useQuery({
    queryKey: ['agent-last', agent.id],
    queryFn: () => api.getAgentResults(agent.id),
    staleTime: 15000,
  });
  const last = results?.[0];
  const fields = last ? Object.keys(last.data || {}).filter(k => !k.startsWith('_')).slice(0, 3) : [];

  return (
    <div className={`bg-[#111827] border border-[#1f2937] p-5 rounded-xl flex flex-col gap-3 ${!agent.enabled ? 'opacity-70' : ''}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${prio.cls}`}>{prio.label}</span>
          {agent.enabled
            ? <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold rounded uppercase tracking-wider">Aktiv</span>
            : <span className="px-2 py-0.5 bg-[#374151] text-[#9ca3af] text-[10px] font-bold rounded uppercase tracking-wider">Inaktiv</span>}
        </div>
        <button onClick={() => onToggle(agent)} className="text-[10px] bg-[#1f2937] hover:bg-[#374151] px-2 py-1 rounded text-white">
          {agent.enabled ? 'Pausieren' : 'Aktivieren'}
        </button>
      </div>

      <div>
        <h3 className="text-base font-bold text-white leading-tight">{agent.name}</h3>
        <p className="text-[11px] text-emerald-400/80 font-mono break-all">{agent.site}</p>
      </div>
      <p className="text-xs text-[#9ca3af] line-clamp-2" title={agent.goal_text}>{agent.goal_text}</p>

      {/* Letztes Ergebnis */}
      <div className="rounded-lg bg-[#0f151f] border border-[#1f2937] px-3 py-2 min-h-[42px]">
        {last ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {fields.map(f => (
              <span key={f} className="text-xs"><span className="text-[#6b7280]">{f}:</span> <span className="text-white font-medium">{String(last.data[f])}</span></span>
            ))}
            {fields.length === 0 && <span className="text-xs text-[#6b7280]">Ergebnis ohne Felder</span>}
          </div>
        ) : (
          <span className="text-xs text-[#6b7280]">Noch kein Ergebnis</span>
        )}
      </div>

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-[#1f2937]">
        <div className="flex flex-col">
          <span className="text-[10px] text-[#6b7280] uppercase tracking-wider">Nächster Lauf</span>
          <span className="text-xs font-mono text-white">{nextRunLabel(agent.schedule_cron, agent.enabled)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Link to={`/agents/${agent.id}/results`} className="bg-[#1f2937] hover:bg-[#374151] text-white border border-[#374151] text-[10px] font-bold py-1.5 px-2.5 rounded">Ergebnisse</Link>
          <Link to={`/projects/${projectId}/agents/${agent.id}/recorder`} className="bg-[#1f2937] hover:bg-[#374151] text-white border border-[#374151] text-[10px] font-bold py-1.5 px-2.5 rounded">Anlernen</Link>
          <button disabled={triggering} onClick={() => onTrigger(agent.id)}
            className="bg-[#1f2937] hover:bg-emerald-600/20 text-white hover:text-emerald-400 border border-[#374151] hover:border-emerald-500/50 text-[10px] font-bold py-1.5 px-2.5 rounded">Ausführen</button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDetail() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();

  const { data: project, error: projectError } = useQuery({ queryKey: ['projects', projectId], queryFn: () => api.getProject(projectId!), retry: false });
  const { data: agents, isLoading, error: agentsError } = useQuery({ queryKey: ['agents', projectId], queryFn: () => api.getProjectAgents(projectId!), retry: false });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.updateAgent(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents', projectId] }),
  });
  const triggerMutation = useMutation({
    mutationFn: (id: string) => api.triggerAgentRun(id),
    onSuccess: () => alert('Run eingereiht!'),
    onError: (e) => alert((e as Error).message),
  });

  const error = projectError || agentsError;
  if (error) {
    return (
      <div className="p-8 flex-1 overflow-auto">
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

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="h-16 border-b border-[#1f2937] flex items-center justify-between px-8 bg-[#0a0a0b] shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[#6b7280]">Projekte</span>
          <span className="text-[#4b5563]">/</span>
          <span className="text-white font-medium">{project.name}</span>
          {agents && <span className="text-[#6b7280] text-xs">· {agents.length} Agenten</span>}
        </div>
        <Link to={`/projects/${projectId}/agents/new`} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-4 rounded transition-colors">+ Neuer Agent</Link>
      </header>

      <section className="flex-1 p-8 overflow-y-auto">
        {project.description && <p className="text-sm text-[#9ca3af] mb-6 max-w-3xl">{project.description}</p>}
        {isLoading ? (
          <div className="text-[#6b7280]">Lade Agenten…</div>
        ) : sorted?.length === 0 ? (
          <div className="text-center py-12 text-[#6b7280] border border-dashed border-[#374151] rounded-xl">
            Noch keine Agenten. Erstelle deinen ersten Agenten für dieses Projekt!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {sorted?.map(agent => (
              <AgentCard key={agent.id} agent={agent} projectId={projectId!}
                onToggle={(a) => toggleMutation.mutate({ id: a.id, enabled: !a.enabled })}
                onTrigger={(id) => triggerMutation.mutate(id)}
                triggering={triggerMutation.isPending} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
