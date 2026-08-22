import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjectActivity } from '../lib/activity';
import { RunDot } from '../ui/RunActivity';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { Project } from '@checky/shared';

/** Projekt-Kachel mit Live-Anzeige, ob dort gerade Agenten laufen. */
function ProjectCard({ project }: { project: Project }) {
  const act = useProjectActivity(project.id);
  const total = project.agent_count ?? 0;

  return (
    <Link to={`/projects/${project.id}`}
      className={`relative overflow-hidden bg-[#111827] border p-5 rounded-xl flex flex-col gap-3 transition-colors block
        ${act.active ? 'border-emerald-500/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]'
          : act.justFinished > 0 ? (act.justFailed > 0 ? 'border-red-500/50' : 'border-emerald-500/40')
          : 'border-[#1f2937] hover:border-emerald-500/50'}`}>
      {act.active && (
        <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-emerald-500/15">
          <div className="h-full w-1/3 bg-emerald-400 checky-indeterminate" />
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-bold text-white">{project.name}</h3>
        {act.active && <RunDot title="Hier läuft gerade etwas" className="mt-2" />}
      </div>
      <p className="text-xs text-[#9ca3af]">{project.description || 'Keine Beschreibung'}</p>

      {act.active ? (
        <div className="mt-1 inline-flex items-center gap-1.5 self-start rounded bg-emerald-500/15 text-emerald-300 px-2 py-1 text-[10px] font-bold uppercase tracking-wider">
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
          {act.running > 0 && `${act.running} von ${total || act.total} laufen`}
          {act.running > 0 && act.queued > 0 && ' · '}
          {act.queued > 0 && `${act.queued} in Warteschlange`}
        </div>
      ) : act.justFinished > 0 ? (
        <div className={`mt-1 inline-flex items-center gap-1.5 self-start rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider
          ${act.justFailed > 0 ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
          {act.justFailed > 0 ? <XCircle className="w-3 h-3" aria-hidden /> : <CheckCircle2 className="w-3 h-3" aria-hidden />}
          {act.justFailed > 0
            ? `${act.justFailed} von ${act.justFinished} fehlgeschlagen`
            : `${act.justFinished} gerade aktualisiert`}
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-[#6b7280] uppercase tracking-wider">
          {total} {total === 1 ? 'Agent' : 'Agenten'}
          {project.enabled_count != null && total > 0 && ` · ${project.enabled_count} aktiv`}
        </div>
      )}

      <div className="mt-auto pt-2 text-xs text-[#6b7280]">
        Erstellt: {new Date(project.created_at).toLocaleDateString('de-DE')}
      </div>
    </Link>
  );
}

export default function ProjectList() {
  const { data: projects, isLoading, error } = useQuery({ queryKey: ['projects'], queryFn: api.getProjects, retry: false });
  const [name, setName] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setName('');
    }
  });

  return (
    <div className="p-8 flex-1 overflow-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Alle Projekte</h1>
      
      {error ? (
        <div className="bg-red-900/20 border border-red-500/50 text-red-200 p-4 rounded-xl mb-8">
          <p className="font-bold">Datenbank-Verbindungsfehler</p>
          <p className="text-sm mt-1">
            {error instanceof Error ? error.message : 'Die Datenbank ist nicht erreichbar.'}
            <br />
            Bitte stelle sicher, dass die Umgebungsvariable <code>DB_URL</code> gesetzt ist.
          </p>
        </div>
      ) : null}

      <div className="bg-[#111827] border border-[#1f2937] p-5 rounded-xl mb-8">
        <h2 className="text-sm font-bold text-white mb-4">Neues Projekt</h2>
        <div className="flex gap-4">
          <input 
            value={name} 
            onChange={e => setName(e.target.value)} 
            placeholder="Projektname..."
            className="flex-1 bg-[#1f2937] border border-[#374151] rounded px-4 py-2 text-white focus:outline-none focus:border-emerald-500"
          />
          <button 
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate({ name })}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-2 px-6 rounded transition-colors"
          >
            Anlegen
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-[#6b7280]">Lade Projekte...</div>
      ) : projects?.length === 0 ? (
        <div className="text-center py-12 text-[#6b7280] border border-dashed border-[#374151] rounded-xl">
          Keine Projekte vorhanden. Lege dein erstes Projekt an!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  );
}
