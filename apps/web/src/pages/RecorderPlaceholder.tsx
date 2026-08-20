import { useParams, Link } from 'react-router-dom';

export default function RecorderPlaceholder() {
  const { projectId, agentId } = useParams();

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0b] items-center justify-center p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Checky Recorder</h1>
      <p className="text-[#9ca3af] mb-6">Diese Funktion kommt in M4.</p>
      <Link to={`/projects/${projectId}`} className="bg-[#1f2937] hover:bg-[#374151] text-white px-6 py-2 rounded transition-colors">
        Zurück zum Projekt
      </Link>
    </div>
  );
}
