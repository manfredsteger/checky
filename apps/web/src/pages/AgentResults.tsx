import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useParams, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { resolveDisplay, toNumber } from '../lib/resultDisplay';
import { ResultView } from '../ui/ResultView';

export default function AgentResults() {
  const { agentId } = useParams<{ agentId: string }>();
  const [chartField, setChartField] = useState<string>('');

  const { data: agent } = useQuery({ queryKey: ['agent', agentId], queryFn: () => api.getAgent(agentId!), enabled: !!agentId });
  const { data: project } = useQuery({ queryKey: ['projects', agent?.project_id], queryFn: () => api.getProject(agent!.project_id), enabled: !!agent?.project_id });
  const { data: manifest } = useQuery({ queryKey: ['manifest', project?.manifest_id], queryFn: () => api.getManifest(project!.manifest_id!), enabled: !!project?.manifest_id });
  const { data: results, isLoading } = useQuery({
    queryKey: ['agent-results', agentId],
    queryFn: () => api.getAgentResults(agentId!),
    enabled: !!agentId,
    refetchInterval: 10000,
  });

  const resolved = resolveDisplay(manifest, { ...(project?.params || {}), ...((agent?.params as any) || {}) });
  const latest = results?.[0];

  // Alle vorkommenden Felder (stabile Reihenfolge)
  const fields = Array.from(new Set((results ?? []).flatMap(r => Object.keys(r.data || {})))).filter(f => !f.startsWith('_'));

  // Chartbare Felder: mind. ein Wert numerisch parsebar
  const numericFields = fields.filter(f => (results ?? []).some(r => toNumber(r.data?.[f]) !== null));
  const activeChart = chartField || resolved.chartField || numericFields.find(f => /price|preis|amount|value|betrag/i.test(f)) || numericFields[0] || '';

  const chartData = results?.slice().reverse().map(r => ({
    date: format(new Date(r.created_at), 'dd.MM. HH:mm'),
    [activeChart]: toNumber(r.data?.[activeChart]),
    raw: r.data?.[activeChart],
  }));

  const download = (kind: 'csv' | 'json') => {
    if (!results || results.length === 0) return;
    let blob: Blob;
    if (kind === 'json') {
      blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    } else {
      const rows = [['Datum', 'Geändert', ...fields].join(',')];
      results.forEach(r => rows.push([
        format(new Date(r.created_at), 'yyyy-MM-dd HH:mm:ss'),
        r.changed ? 'ja' : 'nein',
        ...fields.map(f => `"${String(r.data?.[f] ?? '').replace(/"/g, '""')}"`),
      ].join(',')));
      blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `results_${agent?.name || agentId}.${kind}`;
    a.click();
  };

  if (isLoading) return <div className="p-8 text-center text-[#6b7280]">Lade Ergebnisse…</div>;

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0b] text-[#d1d5db] overflow-auto">
      <header className="h-16 border-b border-[#1f2937] flex items-center justify-between px-8 shrink-0">
        <div>
          <div className="text-sm text-white font-medium">Ergebnisse — {agent?.name}</div>
          <div className="text-xs text-[#6b7280] font-mono">{agent?.site}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => download('csv')} className="flex items-center gap-2 px-3 py-1.5 bg-[#1f2937] hover:bg-[#374151] rounded text-xs font-medium"><Download className="w-3.5 h-3.5" /> CSV</button>
          <button onClick={() => download('json')} className="flex items-center gap-2 px-3 py-1.5 bg-[#1f2937] hover:bg-[#374151] rounded text-xs font-medium"><Download className="w-3.5 h-3.5" /> JSON</button>
        </div>
      </header>

      <div className="p-8 space-y-6">
        {latest && resolved.headlineField && latest.data?.[resolved.headlineField] != null && (
          <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-5">
            <div className="text-xs uppercase tracking-wider text-[#6b7280] mb-1">Aktuell</div>
            <ResultView results={results} resolved={resolved} size="lg" />
            <div className="text-[11px] text-[#6b7280] mt-1">Stand {format(new Date(latest.created_at), 'dd.MM.yy HH:mm')} Uhr</div>
          </div>
        )}

        {results && results.length === 0 && (
          <div className="border border-dashed border-[#374151] rounded-xl p-10 text-center text-[#6b7280]">
            Noch keine Ergebnisse. Läufe erzeugen hier Einträge — über „Jetzt ausführen" oder den Zeitplan.
          </div>
        )}

        {numericFields.length > 0 && (
          <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Verlauf</h2>
              <select value={activeChart} onChange={e => setChartField(e.target.value)}
                className="bg-[#0a0a0b] border border-[#374151] rounded px-2 py-1 text-sm">
                {numericFields.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#fff' }}
                    formatter={(_v: any, _n: any, p: any) => [p?.payload?.raw ?? _v, activeChart]}
                  />
                  {resolved.target != null && activeChart === (resolved.chartField || resolved.headlineField) && (
                    <ReferenceLine y={resolved.target} stroke="#10b981" strokeDasharray="4 4"
                      label={{ value: `Ziel ${resolved.target}${resolved.unit ? ' ' + resolved.unit : ''}`, position: 'insideTopRight', fill: '#10b981', fontSize: 11 }} />
                  )}
                  {resolved.max != null && activeChart === (resolved.chartField || resolved.headlineField) && (
                    <ReferenceLine y={resolved.max} stroke="#ef4444" strokeDasharray="4 4"
                      label={{ value: `Grenze ${resolved.max}${resolved.unit ? ' ' + resolved.unit : ''}`, position: 'insideBottomRight', fill: '#ef4444', fontSize: 11 }} />
                  )}
                  <Line type="monotone" dataKey={activeChart} stroke="#10b981" strokeWidth={2}
                    dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="bg-[#111827] border border-[#1f2937] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-[#0f151f] border-b border-[#1f2937] text-xs uppercase tracking-wider text-[#6b7280]">
                    <th className="p-3 whitespace-nowrap">Datum</th>
                    <th className="p-3">Status</th>
                    {fields.map(f => <th key={f} className="p-3 whitespace-nowrap">{f}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} className="border-b border-[#1f2937]/60 hover:bg-[#0f151f]">
                      <td className="p-3 text-[#9ca3af] whitespace-nowrap font-mono text-xs">{format(new Date(r.created_at), 'dd.MM.yy HH:mm')}</td>
                      <td className="p-3">
                        {r.changed
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300">geändert</span>
                          : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1f2937] text-[#9ca3af]">gleich</span>}
                      </td>
                      {fields.map(f => (
                        <td key={f} className="p-3 text-white whitespace-nowrap">{r.data?.[f] != null ? String(r.data[f]) : <span className="text-[#4b5563]">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Link to={agent ? `/projects/${agent.project_id}` : '/'} className="inline-block text-xs text-[#6b7280] hover:text-white">← Zurück zum Projekt</Link>
      </div>
    </div>
  );
}
