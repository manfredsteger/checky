import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import React, { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';

export default function RunsList() {
  const [projectId, setProjectId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [status, setStatus] = useState('');

  const { data: runs, isLoading } = useQuery({
    queryKey: ['runs', { projectId, agentId, status }],
    queryFn: () => api.getRuns({ project_id: projectId || undefined, agent_id: agentId || undefined, status: status || undefined }),
    refetchInterval: 5000,
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects
  });

  const { data: agents } = useQuery({
    queryKey: ['agents-all'],
    queryFn: async () => {
      // Just fetch all agents across all projects for the filter dropdown
      // In a real app we'd have a /agents route that lists all, but we only have /projects/:id/agents
      // So let's fetch all projects first, then all agents.
      const projs = await api.getProjects();
      const allAgents = await Promise.all(projs.map(p => api.getProjectAgents(p.id)));
      return allAgents.flat();
    }
  });

  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const toggleRow = (id: string) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'succeeded': return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case 'failed': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running': return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'queued': return <Clock className="w-5 h-5 text-gray-400" />;
      default: return <AlertCircle className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold text-slate-800">All Runs</h1>
      </div>

      <div className="flex gap-4 mb-6 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <select 
          className="border-slate-300 rounded-lg text-sm"
          value={projectId} 
          onChange={e => setProjectId(e.target.value)}
        >
          <option value="">All Projects</option>
          {projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select 
          className="border-slate-300 rounded-lg text-sm"
          value={agentId} 
          onChange={e => setAgentId(e.target.value)}
        >
          <option value="">All Agents</option>
          {agents?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select 
          className="border-slate-300 rounded-lg text-sm"
          value={status} 
          onChange={e => setStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading runs...</div>
        ) : runs?.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No runs found.</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-sm font-medium text-slate-500">
                <th className="p-4 w-10"></th>
                <th className="p-4">Status</th>
                <th className="p-4">Agent</th>
                <th className="p-4">Started At</th>
                <th className="p-4">Duration</th>
                <th className="p-4">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {runs?.map(run => (
                <React.Fragment key={run.id}>
                  <tr 
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => toggleRow(run.id)}
                  >
                    <td className="p-4 text-slate-400">
                      {expandedRows[run.id] ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        <span className="capitalize font-medium text-slate-700">{run.status}</span>
                      </div>
                    </td>
                    <td className="p-4 text-slate-700">{run.agent_name || run.agent_id}</td>
                    <td className="p-4 text-slate-600">
                      {run.started_at ? format(new Date(run.started_at), 'MMM d, HH:mm:ss') : '-'}
                    </td>
                    <td className="p-4 text-slate-600">
                      {run.started_at && run.finished_at ? 
                        `${((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000).toFixed(1)}s` 
                        : '-'}
                    </td>
                    <td className="p-4 text-slate-600 font-mono text-sm">{run.ai_tokens}</td>
                  </tr>
                  
                  {expandedRows[run.id] && (
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={6} className="p-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          
                          {/* Screenshots */}
                          <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Screenshots</h3>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Before</p>
                                {run.screenshot_before ? (
                                  <img 
                                    src={`/api/screenshots/${run.screenshot_before.split('/').pop()}`} 
                                    alt="Before" 
                                    className="w-full rounded-lg border border-slate-200 shadow-sm"
                                  />
                                ) : (
                                  <div className="w-full aspect-video bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 text-sm">No screenshot</div>
                                )}
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">After</p>
                                {run.screenshot_after ? (
                                  <img 
                                    src={`/api/screenshots/${run.screenshot_after.split('/').pop()}`} 
                                    alt="After" 
                                    className="w-full rounded-lg border border-slate-200 shadow-sm"
                                  />
                                ) : (
                                  <div className="w-full aspect-video bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center text-slate-400 text-sm">No screenshot</div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Logs and Error */}
                          <div className="space-y-4">
                            {run.error && (
                              <div>
                                <h3 className="text-sm font-semibold text-red-700 uppercase tracking-wider mb-2">Error</h3>
                                <div className="bg-red-50 text-red-700 p-3 rounded-lg border border-red-100 font-mono text-xs overflow-auto">
                                  {run.error}
                                </div>
                              </div>
                            )}

                            <div>
                              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-2">Step Timeline</h3>
                              {run.steps_log && run.steps_log.length > 0 ? (
                                <div className="space-y-2">
                                  {run.steps_log.map((step: any, i: number) => (
                                    <div key={i} className="flex gap-3 text-sm">
                                      <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs shrink-0">
                                        {i + 1}
                                      </div>
                                      <div className="flex-1 bg-white p-2 rounded border border-slate-200">
                                        <div className="font-medium text-slate-700">{step.action}</div>
                                        <div className="text-xs text-slate-500 font-mono mt-1">
                                          {JSON.stringify(step.details || step)}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-slate-500 italic">No steps logged.</p>
                              )}
                            </div>
                          </div>

                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
