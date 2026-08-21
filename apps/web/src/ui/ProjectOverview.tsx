import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Agent, Project, Manifest, Result } from '@checky/shared';
import type { EChartsOption } from 'echarts';
import { format } from 'date-fns';
import { BarChart3, Table2 } from 'lucide-react';
import { EChart } from './EChart';
import { resolveDisplay, toNumber, verdictFor, trendOf, VERDICT_STYLE } from '../lib/resultDisplay';
import { seriesColor, INK, baseGrid, timeAxis, valueAxis, tooltipStyle, thresholdMarkLine, fmtNum } from '../lib/chartTheme';

// Globale Projekt-Übersicht: vergleicht die im Manifest deklarierte Kennzahl
// (z.B. Heizöl €/100L) ÜBER ALLE AGENTEN eines Projekts hinweg — als
// Mehrlinien-Verlaufschart ODER als Statistik-Tabelle. Genau der Fall, wenn
// „unten überall die gleichen Parameter" gemessen werden (esyoil vs heizoel24).

const RANGES: { key: number; label: string }[] = [
  { key: 0, label: 'Alles' },
  { key: 7, label: '7 T' },
  { key: 30, label: '30 T' },
  { key: 90, label: '90 T' },
];

// Für die Chart-Ansicht sinnvoll darstellbare Serien (Token-Ceiling der Palette).
const MAX_CHART_SERIES = 8;

interface AgentSeries {
  agent: Agent;
  color: string;
  points: [number, number][];   // [ms, wert] chronologisch, im Zeitfenster
}

type Stats = NonNullable<ReturnType<typeof statsOf>>;
interface AgentStatsRow { agent: Agent; color: string; stats: Stats; lastAt: Date; }

function statsOf(nums: number[]) {
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { latest: nums[0], prev: nums[1] ?? null, min, max, avg, count: nums.length };
}

export function ProjectOverview({ project, agents, manifest }: {
  project: Project; agents: Agent[]; manifest?: Manifest;
}) {
  const resolved = resolveDisplay(manifest, project.params);
  const [fieldOverride, setFieldOverride] = useState('');
  const [modeOverride, setModeOverride] = useState<null | 'chart' | 'table'>(null);
  const [rangeDays, setRangeDays] = useState(0);

  // Ergebnisse aller Agenten (geteilter Cache mit der Ergebnis-Seite).
  const queries = useQueries({
    queries: agents.map(a => ({
      queryKey: ['agent-results', a.id],
      queryFn: () => api.getAgentResults(a.id),
      staleTime: 15000,
    })),
  });
  const isLoading = queries.some(q => q.isLoading);
  const resultsByAgent = useMemo(() => {
    const m: Record<string, Result[]> = {};
    agents.forEach((a, i) => { m[a.id] = (queries[i].data as Result[] | undefined) ?? []; });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, queries.map(q => q.dataUpdatedAt).join(',')]);

  // Vergleichbare (numerische) Felder über alle Agenten sammeln.
  const numericFields = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents)
      for (const r of resultsByAgent[a.id] ?? [])
        for (const [k, v] of Object.entries(r.data || {}))
          if (!k.startsWith('_') && toNumber(v) != null) set.add(k);
    // Manifest-Kennzahl nach vorne.
    const arr = Array.from(set);
    const pref = resolved.chartField || resolved.headlineField;
    if (pref && arr.includes(pref)) return [pref, ...arr.filter(f => f !== pref)];
    return arr;
  }, [agents, resultsByAgent, resolved.chartField, resolved.headlineField]);

  const field = fieldOverride && numericFields.includes(fieldOverride)
    ? fieldOverride
    : (resolved.chartField && numericFields.includes(resolved.chartField) ? resolved.chartField
      : numericFields.find(f => /price|preis|amount|value|betrag|total/i.test(f)) || numericFields[0] || '');
  const isMetricField = field === (resolved.chartField || resolved.headlineField);

  const cutoff = rangeDays ? Date.now() - rangeDays * 86400000 : 0;

  // Pro Agent: Zeitreihe (chronologisch) + numerische Werte (neueste zuerst) für Statistik.
  const allSeries = useMemo<AgentSeries[]>(() => {
    return agents.map((a, i) => {
      const rs = resultsByAgent[a.id] ?? [];
      const points = rs.slice().reverse()
        .map(r => [new Date(r.created_at).getTime(), toNumber(r.data?.[field])] as [number, number | null])
        .filter((d): d is [number, number] => d[1] != null && (!cutoff || d[0] >= cutoff));
      return { agent: a, color: seriesColor(i), points };
    }).filter(s => s.points.length > 0);
  }, [agents, resultsByAgent, field, cutoff]);

  const perAgentStats = useMemo(() => {
    return agents.map((a, i) => {
      const rs = resultsByAgent[a.id] ?? [];
      const nums = rs
        .filter(r => !cutoff || new Date(r.created_at).getTime() >= cutoff)
        .map(r => toNumber(r.data?.[field]))
        .filter((n): n is number => n != null);
      const lastAt = rs[0]?.created_at;
      return { agent: a, color: seriesColor(i), stats: statsOf(nums), lastAt };
    }).filter((x): x is AgentStatsRow => x.stats != null);
  }, [agents, resultsByAgent, field, cutoff]);

  const seriesCount = allSeries.length;
  const mode = modeOverride ?? (seriesCount > 6 ? 'table' : 'chart');
  const chartSeries = allSeries.slice(0, MAX_CHART_SERIES);
  const truncated = allSeries.length - chartSeries.length;

  // Projektweite Statistik über alle numerischen Werte im Fenster.
  const globalNums = useMemo(
    () => allSeries.flatMap(s => s.points.map(p => p[1])),
    [allSeries],
  );
  const globalStats = statsOf(globalNums);

  const option = useMemo<EChartsOption>(() => {
    return {
      color: chartSeries.map(s => s.color),
      grid: { ...baseGrid(), top: 34, right: seriesCount <= 4 ? 84 : 24 },
      legend: {
        type: 'scroll', top: 0, left: 0, right: 90,
        textStyle: { color: INK.secondary, fontSize: 11 },
        inactiveColor: INK.axis,
        icon: 'roundRect', itemWidth: 12, itemHeight: 3,
      },
      tooltip: {
        trigger: 'axis',
        ...tooltipStyle(),
        axisPointer: { type: 'line', lineStyle: { color: INK.axis, type: 'dashed' } },
        formatter: (params: any) => {
          const arr = Array.isArray(params) ? params : [params];
          const ts = arr[0]?.value?.[0];
          let s = `<div style="font-size:11px;color:${INK.muted};margin-bottom:3px">${ts ? format(new Date(ts), 'dd.MM.yyyy HH:mm') : ''}</div>`;
          for (const p of arr)
            s += `<div style="display:flex;justify-content:space-between;gap:14px;line-height:1.6"><span>${p.marker} ${p.seriesName}</span><b>${fmtNum(p.value?.[1])}${resolved.unit ? ` ${resolved.unit}` : ''}</b></div>`;
          return s;
        },
      },
      xAxis: timeAxis(),
      // Einheit steht bereits im Panel-Titel + Tooltip — kein Achsenname (kollidiert sonst mit der Legende).
      yAxis: valueAxis(),
      dataZoom: globalNums.length > 24
        ? [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 2, borderColor: INK.axis, fillerColor: 'rgba(57,135,229,0.12)', textStyle: { color: INK.muted, fontSize: 10 } }]
        : undefined,
      series: chartSeries.map((s, i) => ({
        type: 'line' as const,
        name: s.agent.name,
        data: s.points,
        smooth: true,
        showSymbol: s.points.length <= 40,
        symbolSize: 5,
        lineStyle: { width: 2 },
        itemStyle: { color: s.color },
        emphasis: { focus: 'series' as const },
        endLabel: chartSeries.length <= 4
          ? { show: true, formatter: () => s.agent.name.length > 16 ? s.agent.name.slice(0, 15) + '…' : s.agent.name, color: s.color, fontSize: 10 }
          : undefined,
        // Schwellenlinien (Ziel/Grenze) nur einmal, an die erste Serie gehängt.
        markLine: i === 0 && isMetricField ? thresholdMarkLine(resolved) : undefined,
      })),
    };
  }, [chartSeries, seriesCount, resolved, isMetricField, globalNums.length]);

  return (
    <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-white flex items-center gap-2">
            Projekt-Übersicht
            {field && <span className="text-xs font-normal text-[#6b7280]">· {field}{resolved.unit ? ` (${resolved.unit})` : ''}</span>}
          </h2>
          {globalStats && (
            <p className="text-[11px] text-[#6b7280] mt-0.5">
              {perAgentStats.length} Agenten · Ø {fmtNum(globalStats.avg)} · min {fmtNum(globalStats.min)} · max {fmtNum(globalStats.max)}{resolved.unit ? ` ${resolved.unit}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {numericFields.length > 1 && (
            <select value={field} onChange={e => setFieldOverride(e.target.value)}
              className="bg-[#0a0a0b] border border-[#374151] rounded px-2 py-1 text-xs text-white">
              {numericFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          <div className="flex rounded overflow-hidden border border-[#374151]">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRangeDays(r.key)}
                className={`px-2 py-1 text-[11px] font-medium transition-colors ${rangeDays === r.key ? 'bg-[#1f2937] text-white' : 'bg-[#0a0a0b] text-[#6b7280] hover:text-white'}`}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex rounded overflow-hidden border border-[#374151]">
            <button onClick={() => setModeOverride('chart')} title="Diagramm"
              className={`px-2 py-1 flex items-center gap-1 text-[11px] font-medium transition-colors ${mode === 'chart' ? 'bg-[#1f2937] text-white' : 'bg-[#0a0a0b] text-[#6b7280] hover:text-white'}`}>
              <BarChart3 className="w-3.5 h-3.5" /> Chart
            </button>
            <button onClick={() => setModeOverride('table')} title="Tabelle"
              className={`px-2 py-1 flex items-center gap-1 text-[11px] font-medium transition-colors ${mode === 'table' ? 'bg-[#1f2937] text-white' : 'bg-[#0a0a0b] text-[#6b7280] hover:text-white'}`}>
              <Table2 className="w-3.5 h-3.5" /> Tabelle
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-[#6b7280] text-sm">Lade Ergebnisse…</div>
      ) : numericFields.length === 0 || perAgentStats.length === 0 ? (
        <div className="border border-dashed border-[#374151] rounded-lg p-8 text-center text-sm text-[#6b7280]">
          Noch keine vergleichbaren Messwerte. Sobald mehrere Agenten dieselbe Kennzahl liefern
          (z.&nbsp;B. Heizölpreis €/100L), erscheint hier der Vergleich.
        </div>
      ) : mode === 'chart' ? (
        <>
          <EChart option={option} height={300} />
          {truncated > 0 && (
            <p className="text-[11px] text-amber-300/80 mt-2">
              Nur die ersten {MAX_CHART_SERIES} Agenten im Chart · {truncated} weitere ausgeblendet — für den vollständigen Vergleich die Tabelle nutzen.
            </p>
          )}
        </>
      ) : (
        <StatsTable rows={perAgentStats} resolved={resolved} />
      )}
    </div>
  );
}

function TrendCell({ latest, prev, trendGood }: { latest: number; prev: number | null; trendGood: 'up' | 'down' }) {
  const t = trendOf(latest, prev, trendGood);
  if (!t || t.dir === 'flat') return <span className="text-[#4b5563]">→</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${t.good ? 'text-emerald-400' : 'text-red-400'}`}>
      {t.dir === 'up' ? '▲' : '▼'}{t.deltaPct != null ? ` ${t.deltaPct.toFixed(1)}%` : ''}
    </span>
  );
}

function StatsTable({ rows, resolved }: {
  rows: AgentStatsRow[];
  resolved: ReturnType<typeof resolveDisplay>;
}) {
  const u = resolved.unit ? ` ${resolved.unit}` : '';
  // Beste (günstigste bei trend_good=down) Kennzahl hervorheben.
  const best = rows.reduce<null | { id: string; v: number }>((acc, r) => {
    const v = r.stats.latest;
    if (acc == null) return { id: r.agent.id, v };
    return (resolved.trendGood === 'down' ? v < acc.v : v > acc.v) ? { id: r.agent.id, v } : acc;
  }, null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-[#6b7280] border-b border-[#1f2937]">
            <th className="py-2 pr-3">Agent</th>
            <th className="py-2 px-3 text-right">Aktuell{u}</th>
            <th className="py-2 px-3 text-right">Ø</th>
            <th className="py-2 px-3 text-right">Min</th>
            <th className="py-2 px-3 text-right">Max</th>
            <th className="py-2 px-3 text-right">Trend</th>
            <th className="py-2 px-3 text-right">Läufe</th>
            <th className="py-2 pl-3 text-right whitespace-nowrap">Stand</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ agent, color, stats, lastAt }) => {
            const v = verdictFor(stats.latest, resolved);
            const isBest = best?.id === agent.id;
            return (
              <tr key={agent.id} className="border-b border-[#1f2937]/60 hover:bg-[#0f151f]">
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                    <span className="text-white">{agent.name}</span>
                    {isBest && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 uppercase tracking-wider">Bester</span>}
                  </span>
                </td>
                <td className={`py-2 px-3 text-right font-bold tabular-nums ${VERDICT_STYLE[v].text}`}>{fmtNum(stats.latest)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-[#9ca3af]">{fmtNum(stats.avg)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-[#9ca3af]">{fmtNum(stats.min)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-[#9ca3af]">{fmtNum(stats.max)}</td>
                <td className="py-2 px-3 text-right tabular-nums"><TrendCell latest={stats.latest} prev={stats.prev} trendGood={resolved.trendGood} /></td>
                <td className="py-2 px-3 text-right tabular-nums text-[#6b7280]">{stats.count}</td>
                <td className="py-2 pl-3 text-right text-[11px] text-[#6b7280] whitespace-nowrap font-mono">{lastAt ? format(new Date(lastAt), 'dd.MM. HH:mm') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
