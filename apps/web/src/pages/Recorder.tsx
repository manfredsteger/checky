import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

const STATUS_LABEL: Record<string, string> = {
  running: 'Agent arbeitet…',
  awaiting_instruction: 'Wartet auf Anweisung',
  awaiting_confirm: 'Bereit zur Übernahme',
  completed: 'Übernommen',
  aborted: 'Abgebrochen',
  failed: 'Fehlgeschlagen',
};

export default function RecorderPage() {
  const { projectId, agentId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [sid, setSid] = useState<string | null>(null);
  const [instr, setInstr] = useState('');

  const agentQ = useQuery({ queryKey: ['agent', agentId], queryFn: () => api.getAgent(agentId!), enabled: !!agentId });

  const start = useMutation({
    mutationFn: (mode: 'auto' | 'assisted') => api.startRecorder(agentId!, mode),
    onSuccess: (s) => setSid(s.id),
  });

  const session = useQuery({
    queryKey: ['recorder', sid],
    queryFn: () => api.getRecorder(sid!),
    enabled: !!sid,
    refetchInterval: (q) => {
      const st = (q.state.data as any)?.status;
      return st === 'running' || st === 'awaiting_confirm' || st === 'awaiting_instruction' ? 1500 : false;
    },
  });

  const confirm = useMutation({
    mutationFn: () => api.confirmRecorder(sid!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recorder', sid] }); },
  });
  const abort = useMutation({
    mutationFn: () => api.abortRecorder(sid!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recorder', sid] }); },
  });
  const instruct = useMutation({
    mutationFn: (text: string) => api.instructRecorder(sid!, text),
    onSuccess: () => { setInstr(''); qc.invalidateQueries({ queryKey: ['recorder', sid] }); },
    onError: (e) => alert((e as Error).message),
  });
  const finish = useMutation({
    mutationFn: () => api.finishRecorder(sid!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recorder', sid] }); },
  });

  const s = session.data as any;
  const status: string | undefined = s?.status;
  const isAssisted = s?.mode === 'assisted';

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0b] text-white p-6 gap-4 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Recorder — {agentQ.data?.name ?? 'Agent'}</h1>
          <p className="text-sm text-[#9ca3af]">{agentQ.data?.goal_text}</p>
        </div>
        <Link to={`/projects/${projectId}`} className="text-sm bg-[#1f2937] hover:bg-[#374151] px-4 py-2 rounded">Zurück</Link>
      </div>

      {!sid && (
        <div className="border border-dashed border-[#374151] rounded-xl p-10 text-center">
          <p className="text-[#9ca3af] mb-6 max-w-2xl mx-auto">
            Ein KI-Agent lernt den Check im Browser an (nur auf {agentQ.data?.site}). Am Ende wird der Ablauf als
            deterministisches Recipe gespeichert.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-2xl mx-auto">
            <div className="flex-1 bg-[#111827] border border-[#1f2937] rounded-xl p-4 text-left">
              <h3 className="font-semibold mb-1">Autonom</h3>
              <p className="text-xs text-[#9ca3af] mb-3">Der Agent macht alles selbst in einem Durchlauf. Gut für einfache Seiten.</p>
              <button onClick={() => start.mutate('auto')} disabled={start.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded font-semibold">
                {start.isPending ? 'Starte…' : 'Autonom starten'}
              </button>
            </div>
            <div className="flex-1 bg-[#111827] border border-sky-500/40 rounded-xl p-4 text-left">
              <h3 className="font-semibold mb-1">Assistiert</h3>
              <p className="text-xs text-[#9ca3af] mb-3">Du gibst Schritt für Schritt Anweisungen und korrigierst live. Gut für komplexe Formulare (Flüge, Datumswähler).</p>
              <button onClick={() => start.mutate('assisted')} disabled={start.isPending}
                className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-4 py-2 rounded font-semibold">
                {start.isPending ? 'Starte…' : 'Assistiert starten'}
              </button>
            </div>
          </div>
          {start.isError && <p className="text-red-400 text-sm mt-3">{(start.error as Error).message}</p>}
        </div>
      )}

      {sid && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Live-View */}
          <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase tracking-wider text-[#9ca3af]">Live-Ansicht</span>
              <span className={`text-xs px-2 py-1 rounded ${status === 'running' ? 'bg-blue-500/20 text-blue-300' : status === 'awaiting_confirm' ? 'bg-amber-500/20 text-amber-300' : status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-[#374151] text-[#9ca3af]'}`}>
                {STATUS_LABEL[status ?? ''] ?? status ?? '…'}
              </span>
            </div>
            {s?.screenshot_path ? (
              <img
                src={`/api/screenshots/${s.screenshot_path.split('/').pop()}?t=${encodeURIComponent(s.updated_at ?? '')}`}
                alt="Live-Screenshot"
                className="w-full rounded border border-[#1f2937]"
              />
            ) : (
              <div className="h-64 flex items-center justify-center text-[#6b7280]">Warte auf ersten Screenshot…</div>
            )}
          </div>

          {/* Events + Aktionen */}
          <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-3 flex flex-col">
            <span className="text-xs uppercase tracking-wider text-[#9ca3af] mb-2">Aktionen ({s?.events?.length ?? 0})</span>
            <div className="flex-1 overflow-auto max-h-72 text-sm font-mono space-y-1">
              {(s?.events ?? []).map((e: any, i: number) => (
                <div key={i} className="flex gap-2">
                  <span className="text-emerald-400">{e.tool}</span>
                  <span className="text-[#9ca3af] truncate">{e.input?.url || e.input?.selector || (e.input?.name ? `${e.input.name}` : '')}</span>
                  {e.isSubmit && <span className="text-amber-400 text-xs">⚠ submit</span>}
                </div>
              ))}
              {(!s?.events || s.events.length === 0) && <div className="text-[#6b7280]">Noch keine Aktionen…</div>}
            </div>

            {(status === 'running' || status === 'awaiting_instruction') && (
              <button onClick={() => abort.mutate()} className="mt-3 self-start text-sm bg-red-600/80 hover:bg-red-500 px-4 py-2 rounded">
                Abbrechen
              </button>
            )}
          </div>

          {/* Assistierter Modus: Anweisungs-Eingabe */}
          {isAssisted && (status === 'awaiting_instruction' || status === 'running') && (
            <div className="lg:col-span-2 bg-[#111827] border border-sky-500/40 rounded-xl p-4">
              <h2 className="font-semibold mb-2">Assistiert — nächste Anweisung</h2>
              {status === 'running' ? (
                <p className="text-sky-300 text-sm">Der Agent führt deine Anweisung aus… (Screenshot & Aktionen aktualisieren sich)</p>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={instr}
                    onChange={e => setInstr(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && instr.trim()) instruct.mutate(instr); }}
                    placeholder="z.B. Trage München ins Von-Feld ein und wähle MUC aus der Vorschlagsliste"
                    className="flex-1 bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm"
                    autoFocus
                  />
                  <button onClick={() => instr.trim() && instruct.mutate(instr)} disabled={instruct.isPending || !instr.trim()}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded text-sm font-semibold">Senden</button>
                  <button onClick={() => finish.mutate()} disabled={finish.isPending}
                    className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 rounded text-sm font-semibold">Fertig – Recipe</button>
                </div>
              )}
              <p className="text-xs text-[#6b7280] mt-2">Schritt für Schritt anweisen und korrigieren. Ergebnisfelder benennen (z.B. „lies den Gesamtpreis als price aus"). Am Ende „Fertig – Recipe".</p>
            </div>
          )}

          {/* Recipe-Vorschau + Übernahme */}
          {status === 'awaiting_confirm' && (
            <div className="lg:col-span-2 bg-[#111827] border border-amber-500/40 rounded-xl p-4">
              <h2 className="font-semibold mb-2">Recipe-Vorschau — {s.result_fields?.length ? `Felder: ${s.result_fields.join(', ')}` : ''}</h2>
              <pre className="text-xs bg-[#0a0a0b] rounded p-3 overflow-auto max-h-64 border border-[#1f2937]">{JSON.stringify(s.recipe_preview, null, 2)}</pre>
              <div className="flex gap-3 mt-3">
                <button onClick={() => confirm.mutate()} disabled={confirm.isPending} className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2 rounded font-semibold">
                  {confirm.isPending ? 'Speichere…' : 'Recipe übernehmen'}
                </button>
                <button onClick={() => abort.mutate()} className="bg-[#1f2937] hover:bg-[#374151] px-5 py-2 rounded">Verwerfen</button>
              </div>
            </div>
          )}

          {status === 'completed' && (
            <div className="lg:col-span-2 bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex items-center justify-between">
              <span className="text-emerald-300">✅ Recipe übernommen{confirm.data ? ` (v${confirm.data.version})` : ''}. Der Agent ist bereit.</span>
              <button onClick={() => navigate(`/projects/${projectId}`)} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded">Zum Projekt</button>
            </div>
          )}

          {(status === 'aborted' || status === 'failed') && (
            <div className="lg:col-span-2 bg-red-500/10 border border-red-500/40 rounded-xl p-4">
              <p className="text-red-300">{status === 'failed' ? `Fehlgeschlagen: ${s.error}` : 'Session abgebrochen.'}</p>
              <button onClick={() => { setSid(null); }} className="mt-3 bg-[#1f2937] hover:bg-[#374151] px-4 py-2 rounded">Neu starten</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
