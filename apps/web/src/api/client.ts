import { Project, Agent, Run, Result, CreateProject, UpdateProject, CreateAgent, UpdateAgent } from '@checky/shared';

const baseUrl = '/api';

async function fetcher<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let err = 'An error occurred';
    try {
      const data = await res.json();
      err = data.error || err;
    } catch {}
    throw new Error(err);
  }
  return res.json();
}

export interface RunWithAgent extends Run {
  project_id?: string;
  agent_name?: string;
}

export const api = {
  getProjects: () => fetcher<Project[]>('/projects'),
  getProject: (id: string) => fetcher<Project>(`/projects/${id}`),
  createProject: (data: CreateProject) => fetcher<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id: string, data: UpdateProject) => fetcher<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id: string) => fetcher<Project>(`/projects/${id}`, { method: 'DELETE' }),

  getProjectAgents: (projectId: string) => fetcher<Agent[]>(`/projects/${projectId}/agents`),
  createAgent: (projectId: string, data: CreateAgent) => fetcher<Agent>(`/projects/${projectId}/agents`, { method: 'POST', body: JSON.stringify(data) }),
  
  getAgent: (id: string) => fetcher<Agent>(`/agents/${id}`),
  updateAgent: (id: string, data: UpdateAgent) => fetcher<Agent>(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAgent: (id: string) => fetcher<Agent>(`/agents/${id}`, { method: 'DELETE' }),
  
  getAgentRuns: (id: string) => fetcher<Run[]>(`/agents/${id}/runs`),
  getAgentResults: (id: string) => fetcher<Result[]>(`/agents/${id}/results`),
  triggerAgentRun: (id: string) => fetcher<Run>(`/agents/${id}/trigger`, { method: 'POST' }),
  
  getRuns: (params?: { project_id?: string; agent_id?: string; status?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>);
    return fetcher<RunWithAgent[]>(`/runs?${query.toString()}`);
  }
};
