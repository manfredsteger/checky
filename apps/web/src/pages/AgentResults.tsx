import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useParams, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { resolveDisplay, toNumber } from '../lib/resultDisplay';
import { ResultView } from '../ui/ResultView';
import { EChart } from '../ui/EChart';
import { SERIES_COLORS, INK, baseGrid, timeAxis, valueAxis, tooltipStyle, thresholdMarkLine, fmtNum } from '../lib/chartTheme';

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

  // Zeitreihe [ms, Wert] chronologisch für den ECharts-Zeitachsen-Chart.
  const chartOption = useMemo<EChartsOption>(() => {
    const data = (results ?? []).slice().reverse()
      .map(r => [new Date(r.created_at).getTime(), toNumber(r.data?.[activeChart])] as [number, number | null])
      .filter(d => d[1] != null);
    const showThresholds = activeChart === (resolved.chartField || resolved.headlineField);
    return {
      color: [SERIES_COLORS[0]],
      grid: baseGrid(),
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle(),
        axisPointer: { type: 'line', lineStyle: { color: INK.axis, type: 'dashed' } },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const ts = p.value[0];
          const val = p.value[1];
          return `<div style="font-size:11px;color:${INK.muted};margin-bottom:2px">${format(new Date(ts), 'dd.MM.yyyy HH:mm')}</div>`
            + `<div><span style="color:${SERIES_COLORS[0]}">●</span> <b>${fmtNum(val)}</b>${resolved.unit ? ` ${resolved.unit}` : ''}</div>`;
        },
      },
      xAxis: timeAxis(),
      yAxis: valueAxis(resolved.unit),
      dataZoom: data.length > 24
        ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 2, borderColor: INK.axis, fillerColor: 'rgba(57,135,229,0.12)', textStyle: { color: INK.muted, fontSize: 10 } }]
        : undefined,
      series: [{
        type: 'line',
        name: activeChart,
        data,
        smooth: true,
        showSymbol: data.length <= 60,
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: SERIES_COLORS[0] },
        areaStyle: { color: 'rgba(57,135,229,0.10)' },
        markLine: showThresholds ? thresholdMarkLine(resolved) : undefined,
      }],
    };
  }, [results, activeChart, resolved]);

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
            <EChart option={chartOption} height={260} />
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
