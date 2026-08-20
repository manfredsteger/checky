import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useState } from 'react';
import { Link } from 'react-router-dom';

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
          {projects?.map(p => (
            <Link key={p.id} to={`/projects/${p.id}`} className="bg-[#111827] border border-[#1f2937] hover:border-emerald-500/50 p-5 rounded-xl flex flex-col gap-3 transition-colors block">
              <h3 className="text-lg font-bold text-white">{p.name}</h3>
              <p className="text-xs text-[#9ca3af]">{p.description || 'Keine Beschreibung'}</p>
              <div className="mt-2 text-xs text-[#6b7280]">
                Erstellt: {new Date(p.created_at).toLocaleDateString('de-DE')}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
