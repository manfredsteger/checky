import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useParams, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { useMemo, useState, type MouseEvent } from 'react';
import { Download, ExternalLink, ChevronDown, ChevronRight, Star, Copy, Check, Library } from 'lucide-react';
import type { LibraryInfo } from '@checky/shared';
import { useToast } from '../ui/toast';
import type { EChartsOption } from 'echarts';
import { resolveDisplay, toNumber } from '../lib/resultDisplay';
import { ResultView } from '../ui/ResultView';
import { splitSeries, diffToOlder } from '../lib/series';
import { EChart } from '../ui/EChart';
import { SERIES_COLORS, INK, baseGrid, timeAxis, valueAxis, tooltipStyle, thresholdMarkLine, fmtNum } from '../lib/chartTheme';

// Manche Manifeste liefern kein einzelnes Skalar, sondern eine Liste (z.B.
// neu erschienene Einträge mit Link) — dafür eine echte Listen-Darstellung
// statt eines rohen key:value-Feldes.

const LANG_STYLE: Record<string, string> = {
  Dub: 'bg-emerald-500/15 text-emerald-300',
  Sub: 'bg-sky-500/15 text-sky-300',
};

function LanguageBadge({ lang }: { lang: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${LANG_STYLE[lang] || 'bg-[#1f2937] text-[#9ca3af]'}`}>
      {lang}
    </span>
  );
}

// Höchstens 2 Genres in der Zeile — mehr würde die Titelspalte auf Kosten der
// Lesbarkeit verdrängen; die volle Liste steckt trotzdem im Ergebnis (CSV/JSON).
function GenreBadges({ genres }: { genres: string[] }) {
  if (!genres.length) return null;
  return (
    <>
      {genres.slice(0, 2).map(g => (
        <span key={g} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-500/10 text-violet-300 shrink-0 hidden md:inline">
          {g}
        </span>
      ))}
    </>
  );
}

// Farbcodiert nach TMDB-Bewertung (0-10) — genau der Blick, der einen
// 3,5er-Film sofort als "eher nicht" erkennen lassen soll, statt erst den
// Titel anzuklicken.
function ratingStyle(rating: number): string {
  if (rating >= 7) return 'bg-emerald-500/15 text-emerald-300';
  if (rating >= 5) return 'bg-amber-500/15 text-amber-300';
  return 'bg-red-500/15 text-red-300';
}

function RatingBadge({ rating }: { rating: number | null | undefined }) {
  if (rating == null) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${ratingStyle(rating)}`}
      title="TMDB-Bewertung">
      <Star className="w-2.5 h-2.5 fill-current" />{rating.toFixed(1)}
    </span>
  );
}

// Bibliotheks-Abgleich (Jellyfin/Emby/Plex): „✓" = dieser Eintrag ist da und
// die Staffel lückenlos, „+3" = so viele Folgen fehlen bis zur neuesten
// gelisteten, grau = Serie/Film gar nicht in der Sammlung. Der Badge ist ein
// eigener Link in die Bibliothek (stopPropagation, damit nicht die Zeile
// zur Quelle springt).
function libraryText(lib: LibraryInfo): { label: string; cls: string; title: string } {
  const range = (ns: number[]) => ns.length <= 6 ? ns.map(n => `E${String(n).padStart(2, '0')}`).join(', ') : `E${String(ns[0]).padStart(2, '0')}–E${String(ns[ns.length - 1]).padStart(2, '0')} (${ns.length})`;
  const via = lib.match === 'title' ? ' · Zuordnung über Titel, nicht sicher' : '';
  switch (lib.status) {
    case 'present':
      return lib.missing_count > 0
        ? { label: `✓ +${lib.missing_count}`, cls: 'bg-amber-500/15 text-amber-300', title: `Diese Folge ist da, aber es fehlen ${range(lib.missing)}${via}` }
        : { label: '✓', cls: 'bg-emerald-500/15 text-emerald-300', title: `In der Bibliothek${lib.have_until != null ? ` — Staffel komplett bis E${String(lib.have_until).padStart(2, '0')}` : ''}${via}` };
    case 'missing':
      return { label: `+${lib.missing_count}`, cls: 'bg-amber-500/15 text-amber-300', title: `Bibliothek hat die Staffel bis E${String(lib.have_until ?? 0).padStart(2, '0')} — fehlen ${range(lib.missing)}${via}` };
    case 'season_missing':
      return { label: `+${lib.missing_count} · Staffel fehlt`, cls: 'bg-amber-500/15 text-amber-300', title: `Serie ist da, diese Staffel aber noch gar nicht (${lib.missing_count} Folgen)${via}` };
    case 'series_missing':
      return { label: 'nicht in Bibliothek', cls: 'bg-[#1f2937] text-[#9ca3af]', title: 'Weder per TMDB-ID noch per Titel in der Bibliothek gefunden' };
    default:
      return { label: '?', cls: 'bg-[#1f2937] text-[#6b7280]', title: lib.note || 'Kein Abgleich möglich' };
  }
}

function LibraryBadge({ lib }: { lib: LibraryInfo | null | undefined }) {
  if (!lib || (lib.status === 'unknown' && lib.note?.startsWith('AniWorld-Film'))) return null;
  const t = libraryText(lib);
  const inner = (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 whitespace-nowrap ${t.cls}`} title={t.title}>
      <Library className="w-2.5 h-2.5" />{t.label}
    </span>
  );
  return lib.url
    ? <a href={lib.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="shrink-0 hover:opacity-80">{inner}</a>
    : inner;
}

// Eine Zeile innerhalb einer Item-Liste: Titel (verlinkt, falls url vorhanden),
// Sprach-Badges, Datum rechtsbündig — statt eines rohen "Titel (Sprache)"-Texthaufens.
// Link in die Zwischenablage — mit Fallback für http-Zugriff aus dem LAN,
// wo navigator.clipboard (secure context) nicht verfügbar ist.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fallback unten */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// Kleiner Copy-Button links neben dem Extern-Symbol: kopiert nur die URL,
// ohne den Zeilen-Link auszulösen. Kurzes Häkchen + dezenter Toast als Feedback.
function CopyUrlButton({ url }: { url: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const onClick = async (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const ok = await copyText(url);
    if (ok) {
      setDone(true); setTimeout(() => setDone(false), 1500);
      toast('info', 'Link kopiert.', 1800);
    } else {
      toast('error', 'Kopieren fehlgeschlagen.');
    }
  };
  return (
    <button type="button" onClick={onClick} title="Link kopieren" aria-label="Link kopieren"
      className="shrink-0 p-1 -m-1 rounded text-[#4b5563] hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
      {done ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ItemRow({ item }: { item: any }) {
  const title = item && typeof item === 'object' ? (item.title ?? item.url ?? JSON.stringify(item)) : String(item);
  const url = item && typeof item === 'object' ? item.url : null;
  const languages: string[] = item && Array.isArray(item.languages) ? item.languages : [];
  const genres: string[] = item && Array.isArray(item.genres) ? item.genres : [];
  const rating: number | null = item && typeof item.rating === 'number' ? item.rating : null;
  const date = item && typeof item === 'object' ? item.date : null;
  const size: string | null = item && typeof item.size === 'string' && item.size ? item.size : null;
  const lib: LibraryInfo | null = item && item.library && typeof item.library === 'object' ? item.library : null;
  const content = (
    <>
      <span className="flex-1 min-w-0 truncate text-sm text-white group-hover:text-emerald-300">{title}</span>
      <LibraryBadge lib={lib} />
      <RatingBadge rating={rating} />
      {size && <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-[#9ca3af] bg-[#1f2937]/70 shrink-0" title="Dateigröße">{size}</span>}
      {languages.map(l => <LanguageBadge key={l} lang={l} />)}
      <GenreBadges genres={genres} />
      {date && <span className="text-[11px] text-[#6b7280] shrink-0 min-w-24 text-right hidden sm:inline whitespace-nowrap">{date}</span>}
      {url && <CopyUrlButton url={url} />}
      {url && <ExternalLink className="w-3.5 h-3.5 text-[#4b5563] group-hover:text-emerald-400 shrink-0" />}
    </>
  );
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="group flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#0f151f] transition-colors">
      {content}
    </a>
  ) : (
    <div className="flex items-center gap-2.5 px-3 py-2">{content}</div>
  );
}

// Prominente Liste für den aktuellsten Lauf — das ist der eigentliche Inhalt
// bei Listen-Manifesten, kein Nebenprodukt einer Tabellenzelle.
function ItemsPreview({ items }: { items: any[] }) {
  if (!items.length) return <div className="text-sm text-[#6b7280] py-6 text-center">Keine Einträge in diesem Lauf.</div>;
  return (
    <div className="divide-y divide-[#1f2937]/60">
      {items.map((it, i) => <ItemRow key={i} item={it} />)}
    </div>
  );
}

// In der Verlaufstabelle: eingeklappt starten (sonst reißt ein 100-Einträge-
// Ergebnis die ganze Zeile auf und lässt die Nachbarspalten wie leer wirken,
// weil sie mittig in einer riesigen Zeile "versinken").
function ItemsCell({ items }: { items: any[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return <span className="text-[#4b5563]">— (leer)</span>;
  return (
    <div className="min-w-[16rem]">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300">
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {items.length} {items.length === 1 ? 'Eintrag' : 'Einträge'}
      </button>
      {open && (
        <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-[#1f2937]/60 border border-[#1f2937] rounded-lg bg-[#0a0a0b]">
          {items.map((it, i) => <ItemRow key={i} item={it} />)}
        </div>
      )}
    </div>
  );
}

function renderCell(value: any) {
  if (value == null || value === '') return <span className="text-[#4b5563]">—</span>;
  if (Array.isArray(value)) return <ItemsCell items={value} />;
  if (typeof value === 'object') return <span className="font-mono text-xs">{JSON.stringify(value)}</span>;
  return String(value);
}

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
  // Messreihen trennen: nur Werte derselben Suche gehören in eine Kurve.
  const [showOlder, setShowOlder] = useState(false);
  const series = splitSeries(results);
  const shown = showOlder ? results : series.current;
  const latest = series.current[0];
  const olderDiff = diffToOlder(series.current[0], series.older[0]);
  // Ergebnisse von vor der Messreihen-Trennung haben keine gespeicherten
  // Parameter. Dann jede Abweichung als „Änderung" aufzuzählen wäre falsch —
  // wir wissen schlicht nicht, womit sie gemessen wurden.
  const olderUnknown = !series.older[0]?.search_params;

  // Alle vorkommenden Felder (stabile Reihenfolge)
  const fields = Array.from(new Set((shown ?? []).flatMap(r => Object.keys(r.data || {})))).filter(f => !f.startsWith('_'));

  // Chartbare Felder: mind. ein Wert numerisch parsebar
  const numericFields = fields.filter(f => (shown ?? []).some(r => toNumber(r.data?.[f]) !== null));
  const activeChart = chartField || resolved.chartField || numericFields.find(f => /price|preis|amount|value|betrag/i.test(f)) || numericFields[0] || '';
  // Ein Chart mit nur einem Punkt sieht wie ein leerer Platzhalter aus statt
  // wie eine echte Visualisierung — dann lieber gar nicht erst zeigen.
  const chartPointCount = (shown ?? []).filter(r => toNumber(r.data?.[activeChart]) != null).length;

  // Zeitreihe [ms, Wert] chronologisch für den ECharts-Zeitachsen-Chart.
  const chartOption = useMemo<EChartsOption>(() => {
    const data = (shown ?? []).slice().reverse()
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
  }, [shown, activeChart, resolved]);

  const download = (kind: 'csv' | 'json') => {
    if (!results || results.length === 0) return;
    let blob: Blob;
    if (kind === 'json') {
      blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    } else {
      const csvValue = (v: any): string => {
        if (v == null) return '';
        if (Array.isArray(v)) return v.map(it => it && typeof it === 'object'
          ? `${it.title ?? ''}${typeof it.rating === 'number' ? ` [${it.rating.toFixed(1)}★]` : ''}${Array.isArray(it.genres) && it.genres.length ? ` [${it.genres.join(', ')}]` : ''}${it.library?.status === 'present' && !it.library.missing_count ? ' [Bibliothek: da]' : it.library?.missing_count ? ` [Bibliothek: +${it.library.missing_count} fehlen]` : it.library?.status === 'series_missing' ? ' [Bibliothek: fehlt]' : ''} (${it.url ?? ''})`
          : String(it)).join(' | ');
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      };
      const rows = [['Datum', 'Geändert', ...fields].join(',')];
      results.forEach(r => rows.push([
        format(new Date(r.created_at), 'yyyy-MM-dd HH:mm:ss'),
        r.changed ? 'ja' : 'nein',
        ...fields.map(f => `"${csvValue(r.data?.[f]).replace(/"/g, '""')}"`),
      ].join(',')));
      blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `results_${agent?.name || agentId}.${kind}`;
    a.click();
  };

  if (isLoading) return <div className="p-8 text-center text-[#6b7280]">Lade Ergebnisse…</div>;

  // Live-Link des letzten Laufs: Buchungslink der API-Quelle, sonst die Seite,
  // auf der die Werte tatsächlich standen.
  const liveUrl: string | undefined = (latest?.data as any)?.booking_url || (latest?.data as any)?._url;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0a0a0b] text-[#d1d5db] overflow-auto">
      <header className="h-16 border-b border-[#1f2937] flex items-center justify-between px-8 shrink-0">
        <div>
          <div className="text-sm text-white font-medium">Ergebnisse — {agent?.name}</div>
          <div className="text-xs text-[#6b7280] font-mono">{agent?.site}</div>
        </div>
        <div className="flex gap-2">
          {liveUrl && (
            <a href={liveUrl} target="_blank" rel="noopener noreferrer"
              title="Diese Suche im Browser öffnen — fertig ausgefüllt"
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600/15 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded text-xs font-bold">
              Zum Angebot <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={() => download('csv')} className="flex items-center gap-2 px-3 py-1.5 bg-[#1f2937] hover:bg-[#374151] rounded text-xs font-medium"><Download className="w-3.5 h-3.5" /> CSV</button>
          <button onClick={() => download('json')} className="flex items-center gap-2 px-3 py-1.5 bg-[#1f2937] hover:bg-[#374151] rounded text-xs font-medium"><Download className="w-3.5 h-3.5" /> JSON</button>
        </div>
      </header>

      <div className="p-8 space-y-6">
        {series.older.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start justify-between gap-4">
            <div className="text-xs text-amber-200/90 leading-relaxed">
              <span className="font-bold">Die Suche wurde geändert.</span>{' '}
              {series.older.length} ältere {series.older.length === 1 ? 'Messwert gehört' : 'Messwerte gehören'} zu einer
              anderen Suche und {series.older.length === 1 ? 'ist' : 'sind'} nicht vergleichbar
              {olderUnknown
                ? <> — sie stammen aus der Zeit vor der Messreihen-Trennung, mit welchen Parametern sie entstanden, ist nicht festgehalten</>
                : olderDiff.length > 0 && <> — <span className="font-mono text-amber-300">{olderDiff.slice(0, 3).join(', ')}</span></>}.
            </div>
            <button onClick={() => setShowOlder(v => !v)}
              className="shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/30">
              {showOlder ? 'Nur aktuelle Reihe' : 'Alte Werte einblenden'}
            </button>
          </div>
        )}
        {latest && resolved.headlineField && latest.data?.[resolved.headlineField] != null && (
          <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-5">
            <div className="text-xs uppercase tracking-wider text-[#6b7280] mb-1">Aktuell</div>
            <ResultView results={series.current} resolved={resolved} size="lg" />
            <div className="text-[11px] text-[#6b7280] mt-1">Stand {format(new Date(latest.created_at), 'dd.MM.yy HH:mm')} Uhr</div>
          </div>
        )}

        {results && results.length === 0 && (
          <div className="border border-dashed border-[#374151] rounded-xl p-10 text-center text-[#6b7280]">
            Noch keine Ergebnisse. Läufe erzeugen hier Einträge — über „Jetzt ausführen" oder den Zeitplan.
          </div>
        )}

        {latest && Array.isArray((latest.data as any)?.items) && (
          <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-5">
            <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
              <h2 className="font-semibold text-white">Einträge im letzten Lauf ({(latest.data as any).items.length})</h2>
              <div className="flex items-center gap-3">
                {(latest.data as any).library_error
                  ? <span className="text-[11px] text-amber-300" title={String((latest.data as any).library_error)}>⚠ Bibliotheks-Abgleich fehlgeschlagen — {String((latest.data as any).library_error)}</span>
                  : typeof (latest.data as any).library_missing_total === 'number' && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#9ca3af]" title="Abgleich mit deiner Medienbibliothek (Einstellungen → Medienbibliothek)">
                      <Library className="w-3 h-3" />
                      {(latest.data as any).library_missing_total === 0 ? 'Bibliothek vollständig' : `${(latest.data as any).library_missing_total} fehlen in der Bibliothek`}
                    </span>
                  )}
                <span className="text-[11px] text-[#6b7280]">Stand {format(new Date(latest.created_at), 'dd.MM.yy HH:mm')} Uhr</span>
              </div>
            </div>
            <div className="max-h-[32rem] overflow-y-auto -mx-2">
              <ItemsPreview items={(latest.data as any).items} />
            </div>
          </div>
        )}

        {numericFields.length > 0 && chartPointCount >= 2 && (
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
                  {(shown ?? []).map(r => (
                    <tr key={r.id} className="border-b border-[#1f2937]/60 hover:bg-[#0f151f]">
                      <td className="p-3 text-[#9ca3af] whitespace-nowrap font-mono text-xs">{format(new Date(r.created_at), 'dd.MM.yy HH:mm')}</td>
                      <td className="p-3">
                        {r.changed
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300">geändert</span>
                          : <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#1f2937] text-[#9ca3af]">gleich</span>}
                      </td>
                      {fields.map(f => (
                        <td key={f} className={`p-3 text-white ${Array.isArray(r.data?.[f]) ? 'align-top' : 'whitespace-nowrap'}`}>{renderCell(r.data?.[f])}</td>
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
