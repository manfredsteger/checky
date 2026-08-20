import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './layout/Layout';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import CreateAgent from './pages/CreateAgent';
import RecorderPlaceholder from './pages/RecorderPlaceholder';
import RunsList from './pages/RunsList';
import AgentResults from './pages/AgentResults';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<ProjectList />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="runs" element={<RunsList />} />
            <Route path="agents/:agentId/results" element={<AgentResults />} />
          </Route>
          <Route path="projects/:projectId/agents/new" element={<CreateAgent />} />
          <Route path="projects/:projectId/agents/:agentId/recorder" element={<RecorderPlaceholder />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
