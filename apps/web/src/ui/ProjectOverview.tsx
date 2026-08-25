import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { splitSeries } from '../lib/series';
import { api } from '../api/client';
import type { Agent, Project, Manifest, Result } from '@checky/shared';
import type { EChartsOption } from 'echarts';
import { format } from 'date-fns';
import { BarChart3, Table2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
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
interface AgentStatsRow { agent: Agent; color: string; stats: Stats; lastAt: Date; latestSuspect: boolean; latestUrl: string | null; }

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
  // Nur die aktuelle Messreihe je Agent: nach einer Parameteränderung sind
  // ältere Werte zu einer ANDEREN Suche entstanden. Nebeneinander in einer
  // Kurve sähe der Wechsel wie ein Preissprung aus.
  const resultsByAgent = useMemo(() => {
    const m: Record<string, Result[]> = {};
    agents.forEach((a, i) => { m[a.id] = splitSeries(queries[i].data as Result[] | undefined).current; });
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
      const inRange = rs.filter(r => !cutoff || new Date(r.created_at).getTime() >= cutoff);
      const withNum = inRange
        .map(r => ({ r, n: toNumber(r.data?.[field]) }))
        .filter((x): x is { r: Result; n: number } => x.n != null);
      const nums = withNum.map(x => x.n);
      const lastAt = rs[0]?.created_at;
      // Ist die aktuellste Kennzahl selbst als `_suspect` markiert (z.B. ein
      // unbelegter Direktflug)? Fließt in Verdict-Farbe und „Bester"-Kür ein —
      // ein nicht belegter Preis soll weder grün leuchten noch gewinnen.
      const latestSuspect = !!(withNum[0]?.r.data as any)?._suspect;
      // Live-Link des aktuellsten Laufs — dieselbe Quelle wie "Zum Angebot"
      // auf der Agenten-Karte/Ergebnisseite, damit ein Klick auf den Namen
      // hier genauso zur fertig ausgefüllten Suche führt.
      // newest_url: Listen-Manifeste (z.B. "Neue Einträge") haben keinen
      // eigenen Such-Link, sondern verweisen auf den neuesten Treffer.
      const latestUrl: string | null = (withNum[0]?.r.data as any)?.booking_url || (withNum[0]?.r.data as any)?._url || (withNum[0]?.r.data as any)?.newest_url || null;
      return { agent: a, color: seriesColor(i), stats: statsOf(nums), lastAt, latestSuspect, latestUrl };
    }).filter((x): x is AgentStatsRow => x.stats != null);
  }, [agents, resultsByAgent, field, cutoff]);

  const seriesCount = allSeries.length;
  const chartSeries = allSeries.slice(0, MAX_CHART_SERIES);
  const truncated = allSeries.length - chartSeries.length;

  // Projektweite Statistik über alle numerischen Werte im Fenster.
  const globalNums = useMemo(
    () => allSeries.flatMap(s => s.points.map(p => p[1])),
    [allSeries],
  );
  const globalStats = statsOf(globalNums);
  // Ein Chart mit nur einem Punkt insgesamt ist keine Visualisierung, sondern
  // ein einsamer Kreis vor Gitterlinien — dann lieber gleich die Tabelle.
  const mode = modeOverride ?? (seriesCount > 6 || globalNums.length < 2 ? 'table' : 'chart');

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
        // Symbole immer zeigen; Serien mit nur EINEM Messwert bekommen einen
        // deutlich größeren Marker (eine Linie braucht ≥2 Punkte — sonst wirkt
        // der Einzelwert sonst wie „fehlt").
        showSymbol: true,
        symbolSize: s.points.length === 1 ? 11 : 5,
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

type SortKey = 'agent' | 'latest' | 'avg' | 'min' | 'max' | 'trend' | 'count' | 'stand';

// Klickbare Spaltenüberschrift mit Sortier-Pfeil — dieselbe Kopfzelle dient
// als Sortier-Knopf, damit "auf- und absteigend sortierbar" ohne zweite
// Steuerzeile auskommt.
function SortableTh({ label, active, dir, onClick, align = 'right' }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void; align?: 'left' | 'right';
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 hover:text-white transition-colors ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-white' : ''}`}>
      <span>{label}</span>
      {active
        ? (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
        : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );
}

function StatsTable({ rows, resolved }: {
  rows: AgentStatsRow[];
  resolved: ReturnType<typeof resolveDisplay>;
}) {
  const u = resolved.unit ? ` ${resolved.unit}` : '';
  // Beste (günstigste bei trend_good=down) Kennzahl hervorheben — aber nur
  // unter belegten Werten: ein `_suspect`-Preis (z.B. ein als „Direkt"
  // gesuchter, tatsächlich aber unbelegter Umsteigepreis) soll nicht als
  // „Bester" gewinnen, nur weil er zufällig niedrig ist. Erst wenn ALLE Werte
  // unbelegt sind, zählt notgedrungen der niedrigste davon.
  const bestCandidates = rows.some(r => !r.latestSuspect) ? rows.filter(r => !r.latestSuspect) : rows;
  const best = bestCandidates.reduce<null | { id: string; v: number }>((acc, r) => {
    const v = r.stats.latest;
    if (acc == null) return { id: r.agent.id, v };
    return (resolved.trendGood === 'down' ? v < acc.v : v > acc.v) ? { id: r.agent.id, v } : acc;
  }, null);

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortValue = (r: AgentStatsRow, key: SortKey): number | string => {
    switch (key) {
      case 'agent': return r.agent.name.toLowerCase();
      case 'latest': return r.stats.latest;
      case 'avg': return r.stats.avg;
      case 'min': return r.stats.min;
      case 'max': return r.stats.max;
      // Vorzeichenbehafteter Sprung latest-prev, nicht die (absolute) Prozentanzeige.
      case 'trend': return r.stats.prev != null ? r.stats.latest - r.stats.prev : 0;
      case 'count': return r.stats.count;
      case 'stand': return r.lastAt ? new Date(r.lastAt).getTime() : 0;
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sortKey), vb = sortValue(b, sortKey);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <SortableTh label={label} active={sortKey === key} dir={sortDir} align={align} onClick={() => toggleSort(key)} />
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wider text-[#6b7280] border-b border-[#1f2937]">
            <th className="py-2 pr-3">{th('agent', 'Agent', 'left')}</th>
            <th className="py-2 px-3 text-right">{th('latest', `Aktuell${u}`)}</th>
            <th className="py-2 px-3 text-right">{th('avg', 'Ø')}</th>
            <th className="py-2 px-3 text-right">{th('min', 'Min')}</th>
            <th className="py-2 px-3 text-right">{th('max', 'Max')}</th>
            <th className="py-2 px-3 text-right">{th('trend', 'Trend')}</th>
            <th className="py-2 px-3 text-right">{th('count', 'Läufe')}</th>
            <th className="py-2 pl-3 text-right whitespace-nowrap">{th('stand', 'Stand')}</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(({ agent, color, stats, lastAt, latestSuspect, latestUrl }) => {
            // Wie in ResultView: „Wunschpreis erreicht" nicht auf einem unbelegten Preis feiern.
            const rawVerdict = verdictFor(stats.latest, resolved);
            const v = latestSuspect && rawVerdict === 'good' ? 'ok' : rawVerdict;
            const isBest = best?.id === agent.id;
            return (
              <tr key={agent.id} className="border-b border-[#1f2937]/60 hover:bg-[#0f151f]">
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
                    {/* Name führt zur fertig ausgefüllten Suche (wie "Zum Angebot"), sonst zur Checky-Ergebnisseite des Agenten. */}
                    {latestUrl ? (
                      <a href={latestUrl} target="_blank" rel="noopener noreferrer"
                        title="Direktlink zum aktuellen Ergebnis öffnen" className="text-white hover:text-emerald-400 hover:underline">
                        {agent.name}
                      </a>
                    ) : (
                      <Link to={`/agents/${agent.id}/results`} title="Ergebnisse dieses Agenten"
                        className="text-white hover:text-emerald-400 hover:underline">
                        {agent.name}
                      </Link>
                    )}
                    {isBest && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 uppercase tracking-wider">Bester</span>}
                    {latestSuspect && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-300 uppercase tracking-wider" title="Aktuellster Wert ist nicht belegt (z.B. Direktflug-Wunsch, den die Quelle nicht ausweist)">prüfen</span>}
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
