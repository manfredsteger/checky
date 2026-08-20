import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useState } from 'react';
import { Download } from 'lucide-react';

export default function AgentResults() {
  const { agentId } = useParams<{ agentId: string }>();
  const [chartField, setChartField] = useState<string>('');

  const { data: agent } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => api.getAgent(agentId!),
    enabled: !!agentId
  });

  const { data: results, isLoading } = useQuery({
    queryKey: ['agent-results', agentId],
    queryFn: () => api.getAgentResults(agentId!),
    enabled: !!agentId,
    refetchInterval: 10000,
  });

  // Extract possible numeric fields for charting
  const numericFields = new Set<string>();
  results?.forEach(r => {
    Object.entries(r.data || {}).forEach(([k, v]) => {
      // Very basic heuristic for numeric values (can be string formatted as number, or actual number)
      if (typeof v === 'number' || (typeof v === 'string' && !isNaN(parseFloat(v.replace(/[^0-9.-]+/g,""))))) {
        numericFields.add(k);
      }
    });
  });

  // Auto-select first numeric field if none selected
  if (!chartField && numericFields.size > 0) {
    setChartField(Array.from(numericFields)[0]);
  }

  // Prepare chart data (reverse to show chronological order)
  const chartData = results?.slice().reverse().map(r => {
    let val = r.data?.[chartField];
    if (typeof val === 'string') val = parseFloat(val.replace(/[^0-9.-]+/g,""));
    return {
      date: format(new Date(r.created_at), 'MMM d, HH:mm'),
      [chartField]: val,
      changed: r.changed
    };
  });

  const downloadCsv = () => {
    if (!results || results.length === 0) return;
    const fields = Array.from(new Set(results.flatMap(r => Object.keys(r.data || {}))));
    const csvRows = [];
    csvRows.push(['Date', 'Changed', ...fields].join(','));
    
    results.forEach(r => {
      const row = [
        format(new Date(r.created_at), 'yyyy-MM-dd HH:mm:ss'),
        r.changed ? 'yes' : 'no',
        ...fields.map(f => {
          const val = r.data?.[f] || '';
          return `"${String(val).replace(/"/g, '""')}"`;
        })
      ];
      csvRows.push(row.join(','));
    });
    
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `results_${agent?.name || agentId}.csv`;
    a.click();
  };

  const downloadJson = () => {
    if (!results) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `results_${agent?.name || agentId}.json`;
    a.click();
  };

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500">Loading results...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Results: {agent?.name}</h1>
          <p className="text-slate-500 mt-1">Extracted data over time</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={downloadCsv}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button 
            onClick={downloadJson}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-4 h-4" /> JSON
          </button>
        </div>
      </div>

      {results?.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-500">
          No results found for this agent yet.
        </div>
      ) : (
        <>
          {numericFields.size > 0 && (
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-medium text-slate-800">Trend Chart</h2>
                <select 
                  className="border-slate-300 rounded-lg text-sm"
                  value={chartField} 
                  onChange={e => setChartField(e.target.value)}
                >
                  {Array.from(numericFields).map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickMargin={10}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickMargin={10}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey={chartField} 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={{ r: 4, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-500">
                  <th className="p-4 w-48">Date</th>
                  <th className="p-4 w-24">Changed</th>
                  <th className="p-4">Extracted Data</th>
                </tr>
              </thead>
              <tbody>
                {results?.map(result => (
                  <tr key={result.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-slate-600 whitespace-nowrap">
                      {format(new Date(result.created_at), 'MMM d, yyyy HH:mm:ss')}
                    </td>
                    <td className="p-4">
                      {result.changed ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Changed
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                          Same
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <pre className="text-xs font-mono text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200 overflow-x-auto">
                        {JSON.stringify(result.data, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
