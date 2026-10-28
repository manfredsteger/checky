import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, ChevronDown, ChevronRight, History } from 'lucide-react';
import { api, type QuickSearch as QS } from '../api/client';
import { ItemRow } from '../pages/AgentResults';

// Schnellsuche: einmal suchen statt dauerhaft beobachten. Läuft im Worker
// (prüft die neuesten N Einträge samt vollem Titel von der Detailseite) und
// zeigt zusätzlich ältere Treffer aus dem Titel-Index — ohne Agent, ohne
// Historie, ohne Tageslimit.

const RANGES = [
  { value: 300, label: 'Neueste 300 (≈ 1½ Tage)' },
  { value: 600, label: 'Neueste 600 (≈ 3 Tage)' },
  { value: 1500, label: 'Neueste 1500 (≈ 1 Woche)' },
];

function progressText(s: QS): string {
  const p = s.progress;
  if (s.status === 'queued' || !p) return 'Wartet auf den Worker …';
  if (p.phase === 'list') return `Liste lesen … ${p.done} / ${p.total} Einträge`;
  if (p.total === 0) return 'Alle Titel schon im Index — werte aus …';
  return `Detailseiten prüfen … ${p.done} / ${p.total} (Rest kommt aus dem Index)`;
}

function progressPct(s: QS): number | null {
  const p = s.progress;
  if (!p || !p.total) return null;
  // Liste = erste 15 %, Detailseiten = Rest.
  return p.phase === 'list' ? (p.done / p.total) * 15 : 15 + (p.done / p.total) * 85;
}

export function QuickSearch({ provider }: { provider: string }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [limit, setLimit] = useState(300);
  const [ownId, setOwnId] = useState<string | null>(null);
  const [olderOpen, setOlderOpen] = useState(false);

  const { data: meta } = useQuery({
    queryKey: ['quick-search-recent', provider],
    queryFn: () => api.getRecentQuickSearches(provider),
  });
  const recent = meta?.recent;
  // Eigene Suche dieser Sitzung, sonst die jüngste überhaupt.
  const searchId = ownId ?? meta?.latest_id ?? null;

  const { data: search } = useQuery({
    queryKey: ['quick-search', searchId],
    queryFn: () => api.getQuickSearch(searchId!),
    enabled: !!searchId,
    retry: false,
    refetchInterval: q => {
      const st = q.state.data?.status;
      return st === 'queued' || st === 'running' ? 1000 : false;
    },
  });

  const start = useMutation({
    mutationFn: (suche: string) => api.startQuickSearch({ provider, suche, limit }),
    onSuccess: s => {
      setOwnId(s.id);
      setOlderOpen(false);
      qc.setQueryData(['quick-search', s.id], s);
      qc.invalidateQueries({ queryKey: ['quick-search-recent', provider] });
    },
  });

  const busy = start.isPending || search?.status === 'queued' || search?.status === 'running';
  const run = (suche: string) => {
    const s = suche.trim();
    if (s.length < 2 || busy) return;
    setTerm(s);
    start.mutate(s);
  };

  const items = search?.result?.items ?? [];
  const older = search?.result?.older_items ?? [];
  const pct = search ? progressPct(search) : null;

  return (
    <div className="mb-8 rounded-xl border border-[#1f2937] bg-[#111318] p-5">
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-4 h-4 text-emerald-400" aria-hidden />
        <h2 className="text-sm font-bold text-white">Schnellsuche</h2>
        <span className="text-xs text-[#6b7280]">sucht einmal im vollen Titel (Studio, Genre, Format) — ohne Agent anzulegen</span>
      </div>

      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); run(term); }}>
        <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Suchbegriff, z. B. 1080p"
          className="flex-1 min-w-[12rem] bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:outline-none focus:border-emerald-500" />
        <select value={limit} onChange={e => setLimit(Number(e.target.value))}
          className="bg-[#0a0a0b] border border-[#374151] rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-emerald-500">
          {RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button type="submit" disabled={busy || term.trim().length < 2}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-4 rounded transition-colors disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Suchen
        </button>
      </form>

      {!!recent?.length && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <History className="w-3.5 h-3.5 text-[#4b5563]" aria-label="Zuletzt gesucht" />
          {recent.map(r => (
            <button key={r} onClick={() => run(r)} disabled={busy}
              className="px-2 py-0.5 rounded text-[11px] border border-[#1f2937] text-[#9ca3af] hover:text-white hover:border-[#374151] disabled:opacity-50">
              {r}
            </button>
          ))}
        </div>
      )}

      {start.isError && (
        <p className="mt-3 text-sm text-red-300">{(start.error as Error).message}</p>
      )}

      {search && (search.status === 'queued' || search.status === 'running') && (
        <div className="mt-4">
          <div className="text-xs text-[#9ca3af] mb-1.5">„{search.params.suche}“ · {progressText(search)}</div>
          <div className="h-1 rounded bg-emerald-500/15 overflow-hidden">
            {pct == null
              ? <div className="h-full w-1/4 bg-emerald-400 checky-indeterminate" />
              : <div className="h-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />}
          </div>
        </div>
      )}

      {search?.status === 'failed' && (
        <div className="mt-4 bg-red-900/20 border border-red-500/40 text-red-200 text-sm p-3 rounded-lg">{search.error}</div>
      )}

      {search?.status === 'succeeded' && search.result && (
        <div className="mt-4">
          <div className="text-xs text-[#9ca3af] mb-2">
            <span className="text-white font-semibold">{items.length} Treffer</span>
            {' '}für „{search.params.suche}“ in den neuesten {search.result.checked_total} Einträgen
            {search.finished_at && <> · {new Date(search.finished_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</>}
          </div>
          {items.length > 0
            ? <div className="divide-y divide-[#1f2937]/60 rounded-lg border border-[#1f2937]/60">{items.map(it => <ItemRow key={it.url} item={it} />)}</div>
            : <div className="text-sm text-[#6b7280] py-4 text-center">Keine Treffer in diesem Bereich.</div>}

          {older.length > 0 && (
            <div className="mt-3">
              <button onClick={() => setOlderOpen(o => !o)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300">
                {olderOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {older.length} ältere Treffer aus dem Index
              </button>
              {olderOpen && (
                <div className="mt-2 divide-y divide-[#1f2937]/60 rounded-lg border border-[#1f2937]/60">
                  {older.map(it => <ItemRow key={it.url} item={it} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
