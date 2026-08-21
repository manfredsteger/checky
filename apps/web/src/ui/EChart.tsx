import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

// Schlanker React-19-Wrapper um Apache ECharts. Bewusst OHNE echarts-for-react
// (dessen React-19-Peer-Support ist wackelig) — init/setOption/resize/dispose
// selbst verwaltet. Dies ist die EINZIGE Chart-Primitive der App; alle Diagramme
// bauen darauf auf, damit Look & Verhalten überall gleich sind.
export function EChart({
  option,
  height = 320,
  className,
  onEvents,
}: {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  onEvents?: Record<string, (params: any) => void>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // Chart einmal initialisieren + auf Container-Resize reagieren.
  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Option bei jeder Änderung neu setzen (notMerge, da wir die Option komplett bauen).
  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  // Event-Handler (z.B. Klick auf einen Datenpunkt) an-/abmelden.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    const entries = Object.entries(onEvents);
    for (const [ev, handler] of entries) chart.on(ev, handler as any);
    return () => {
      for (const [ev, handler] of entries) chart.off(ev, handler as any);
    };
  }, [onEvents]);

  const h = typeof height === 'number' ? `${height}px` : height;
  return <div ref={elRef} className={className} style={{ width: '100%', height: h }} />;
}
