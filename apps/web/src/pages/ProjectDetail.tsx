import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { CronExpressionParser } from 'cron-parser';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function ProjectDetail() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();

  const { data: project, error: projectError } = useQuery({ 
    queryKey: ['projects', projectId], 
    queryFn: () => api.getProject(projectId!),
    retry: false
  });
  
  const { data: agents, isLoading, error: agentsError } = useQuery({ 
    queryKey: ['agents', projectId], 
    queryFn: () => api.getProjectAgents(projectId!),
    retry: false
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string, enabled: boolean }) => api.updateAgent(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents', projectId] })
  });

  const triggerMutation = useMutation({
    mutationFn: (id: string) => api.triggerAgentRun(id),
    onSuccess: () => alert('Run queued!')
  });

  const error = projectError || agentsError;

  if (error) {
    return (
      <div className="p-8 flex-1 overflow-auto">
        <div className="bg-red-900/20 border border-red-500/50 text-red-200 p-4 rounded-xl mb-8">
          <p className="font-bold">Datenbank-Verbindungsfehler</p>
          <p className="text-sm mt-1">
            {error instanceof Error ? error.message : 'Die Datenbank ist nicht erreichbar.'}
            <br />
            Bitte stelle sicher, dass die Umgebungsvariable <code>DB_URL</code> gesetzt ist.
          </p>
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className='h-16 border-b border-[#1f2937] flex items-center justify-between px-8 bg-[#0a0a0b] shrink-0'>
        <div className='flex items-center gap-2 text-sm'>
          <span className='text-[#6b7280]'>Projekte</span>
          <span className='text-[#4b5563]'>/</span>
          <span className='text-white font-medium'>{project.name}</span>
        </div>
        <div className='flex items-center gap-6'>
          <Link to={`/projects/${projectId}/agents/new`} className='bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-4 rounded transition-colors'>
            + Neuer Agent
          </Link>
        </div>
      </header>

      <section className='flex-1 p-8 overflow-y-auto'>
        {isLoading ? (
          <div className="text-[#6b7280]">Lade Agenten...</div>
        ) : agents?.length === 0 ? (
          <div className="text-center py-12 text-[#6b7280] border border-dashed border-[#374151] rounded-xl">
            Noch keine Agenten. Erstelle deinen ersten Agenten für dieses Projekt!
          </div>
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6'>
            {agents?.map(agent => {
              let nextRun = 'Ungültiger Cron';
              try {
                const interval = CronExpressionParser.parse(agent.schedule_cron);
                nextRun = format(interval.next().toDate(), "dd. MMM, HH:mm 'Uhr'", { locale: de });
              } catch (e) {}

              return (
                <div key={agent.id} className={`bg-[#111827] border border-[#1f2937] p-5 rounded-xl flex flex-col gap-3 relative ${!agent.enabled ? 'opacity-70 grayscale' : ''}`}>
                  <div className='flex justify-between items-start'>
                    {agent.enabled ? (
                      <div className='px-2 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold rounded uppercase tracking-wider'>Aktiv</div>
                    ) : (
                      <div className='px-2 py-1 bg-[#374151] text-[#9ca3af] text-[10px] font-bold rounded uppercase tracking-wider'>Pausiert</div>
                    )}
                    <div className="flex gap-2">
                      <button 
                        onClick={() => toggleMutation.mutate({ id: agent.id, enabled: !agent.enabled })}
                        className="text-[10px] bg-[#1f2937] hover:bg-[#374151] px-2 py-1 rounded text-white"
                      >
                        {agent.enabled ? 'Pausieren' : 'Aktivieren'}
                      </button>
                    </div>
                  </div>
                  
                  <h3 className='text-lg font-bold text-white mt-1'>{agent.name}</h3>
                  <p className='text-xs text-[#emerald-400] font-mono break-all'>{agent.site}</p>
                  <p className='text-xs text-[#9ca3af] line-clamp-2 mt-1' title={agent.goal_text}>{agent.goal_text}</p>
                  
                  <div className='flex items-center justify-between mt-auto pt-3 border-t border-[#1f2937]'>
                    <div className='flex flex-col'>
                      <span className='text-[10px] text-[#6b7280] uppercase tracking-wider'>Nächster Lauf</span>
                      <div className='text-xs font-mono text-white'>{agent.enabled ? nextRun : '-'}</div>
                    </div>
                    <div className='flex items-center gap-2'>
                      <Link 
                        to={`/agents/${agent.id}/results`}
                        className='bg-[#1f2937] hover:bg-[#374151] text-white border border-[#374151] text-[10px] font-bold py-1.5 px-3 rounded transition-colors'
                      >
                        Results
                      </Link>
                      <Link 
                        to={`/projects/${projectId}/agents/${agent.id}/recorder`}
                        className='bg-[#1f2937] hover:bg-[#374151] text-white border border-[#374151] text-[10px] font-bold py-1.5 px-3 rounded transition-colors'
                      >
                        Recorder (M4)
                      </Link>
                      <button 
                        disabled={triggerMutation.isPending}
                        onClick={() => triggerMutation.mutate(agent.id)}
                        className='bg-[#1f2937] hover:bg-emerald-600/20 text-white hover:text-emerald-400 border border-[#374151] hover:border-emerald-500/50 text-[10px] font-bold py-1.5 px-3 rounded transition-colors'
                      >
                        Jetzt ausführen
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
