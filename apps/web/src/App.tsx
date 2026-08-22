import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './layout/Layout';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import CreateAgent from './pages/CreateAgent';
import Recorder from './pages/Recorder';
import RunsList from './pages/RunsList';
import AgentResults from './pages/AgentResults';
import Settings from './pages/Settings';
import { ToastProvider } from './ui/toast';
import { ActivityProvider } from './lib/activity';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
      <ActivityProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<ProjectList />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route path="projects/:projectId/agents/:agentId/recorder" element={<Recorder />} />
            <Route path="projects/:projectId/agents/new" element={<CreateAgent />} />
            <Route path="runs" element={<RunsList />} />
            <Route path="settings" element={<Settings />} />
            <Route path="agents/:agentId/results" element={<AgentResults />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </ActivityProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
