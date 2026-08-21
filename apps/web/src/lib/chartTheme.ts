import type { EChartsOption, LineSeriesOption } from 'echarts';
import type { Resolved } from './resultDisplay';

// Zentrales Chart-Design für die gesamte App. Alle Diagramme (Agenten-Verlauf,
// Projekt-Übersicht, …) beziehen Farben, Achsen, Tooltip und Schwellenlinien aus
// diesem Modul, damit sie wie EIN System aussehen. Die App läuft ausschließlich
// im Dark-Mode; die Werte sind die dunkle, farbfehlsicht-geprüfte Palette aus
// dem dataviz-Design-System, gegen die App-Oberfläche (#111827) validiert.

// Kategoriale Serienfarben (feste Reihenfolge, NIE zyklisch neu verteilt).
// Reihenfolge = CVD-Sicherheit; validiert für den Dark-Surface der App.
export const SERIES_COLORS = [
  '#3987e5', // blau
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // gelb
  '#d55181', // magenta
  '#008300', // grün
  '#9085e9', // violett
  '#e66767', // rot
];

// Status-Farben (reserviert — nie als Serienfarbe). Wunsch-/Schmerzgrenze.
export const STATUS = {
  good: '#10b981', // Wunschpreis / Ziel (emerald, App-Akzent)
  bad: '#ef4444',  // Schmerzgrenze / Grenze
};

// Chart-Chrome & Tinten (Dark).
export const INK = {
  primary: '#d1d5db',
  secondary: '#9ca3af',
  muted: '#6b7280',
  grid: '#1f2937',
  axis: '#374151',
  surface: '#111827',
};

export const AXIS_FONT = 11;

// Serienfarbe für Slot i (faltet ab Slot 8 in „grau" statt neue Hues zu erzeugen).
export function seriesColor(i: number): string {
  return SERIES_COLORS[i] ?? INK.muted;
}

// Dark-Tooltip-Style (für trigger:'axis' und 'item' gleich).
export function tooltipStyle(): NonNullable<EChartsOption['tooltip']> {
  return {
    backgroundColor: INK.surface,
    borderColor: INK.axis,
    borderWidth: 1,
    textStyle: { color: '#fff', fontSize: 12 },
    padding: [8, 10],
    extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);',
  };
}

// Zeit-X-Achse (type:'time') im App-Stil.
export function timeAxis(): NonNullable<EChartsOption['xAxis']> {
  return {
    type: 'time',
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: INK.muted, fontSize: AXIS_FONT, hideOverlap: true },
    splitLine: { show: false },
  };
}

// Wert-Y-Achse im App-Stil (unit optional als Achsenname).
export function valueAxis(unit?: string): NonNullable<EChartsOption['yAxis']> {
  return {
    type: 'value',
    scale: true,
    name: unit,
    nameTextStyle: { color: INK.muted, fontSize: 10, align: 'left' },
    nameGap: 12,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: INK.muted, fontSize: AXIS_FONT },
    splitLine: { show: true, lineStyle: { color: INK.grid, type: 'dashed' } },
  };
}

export function baseGrid(): NonNullable<EChartsOption['grid']> {
  return { top: 24, right: 20, bottom: 8, left: 8, containLabel: true };
}

// Schwellenlinien (Ziel grün / Grenze rot) als markLine, an eine Serie gehängt.
// Gestrichelt + beschriftet → klar von den Datenserien unterscheidbar (die
// Status-Farben „impersonieren" so keine Serie).
export function thresholdMarkLine(resolved: Pick<Resolved, 'target' | 'max' | 'unit'>): LineSeriesOption['markLine'] | undefined {
  const u = resolved.unit ? ` ${resolved.unit}` : '';
  const data: any[] = [];
  if (resolved.target != null)
    data.push({
      yAxis: resolved.target,
      lineStyle: { color: STATUS.good, type: 'dashed', width: 1.5 },
      label: { formatter: `Ziel ${resolved.target}${u}`, color: STATUS.good, fontSize: 10, position: 'insideEndTop' },
    });
  if (resolved.max != null)
    data.push({
      yAxis: resolved.max,
      lineStyle: { color: STATUS.bad, type: 'dashed', width: 1.5 },
      label: { formatter: `Grenze ${resolved.max}${u}`, color: STATUS.bad, fontSize: 10, position: 'insideEndBottom' },
    });
  if (!data.length) return undefined;
  return { silent: true, symbol: 'none', data };
}

// Zahl hübsch (max. 2 Nachkommastellen, deutsches Format).
export function fmtNum(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
