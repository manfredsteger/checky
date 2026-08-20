import { Link, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Box, PlaySquare, Plus } from 'lucide-react';

export default function Layout() {
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.getProjects });
  const { projectId } = useParams();

  return (
    <div className='h-screen w-full flex bg-[#0a0a0b] text-[#d1d5db] font-sans overflow-hidden'>
      <aside className='w-64 border-r border-[#1f2937] flex flex-col shrink-0'>
        <Link to="/" className='p-6 flex items-center gap-3 border-b border-[#1f2937] hover:bg-[#111827] transition-colors'>
          <div className='w-8 h-8 bg-emerald-500 rounded flex items-center justify-center text-black font-black italic'>C</div>
          <h1 className='text-xl font-bold tracking-tight text-white'>Checky</h1>
        </Link>
        <nav className='flex-1 py-4 overflow-y-auto'>
          <div className='px-6 mb-4 mt-8 flex items-center justify-between'>
            <span className='text-[10px] uppercase tracking-widest text-[#6b7280] font-semibold'>Projekte</span>
          </div>
          <div className='space-y-1'>
            {projects?.map(p => (
              <Link 
                key={p.id} 
                to={`/projects/${p.id}`}
                className={`px-6 py-3 flex items-center justify-between cursor-pointer transition-colors ${projectId === p.id ? 'bg-[#1f2937] border-l-4 border-emerald-500' : 'hover:bg-[#111827] border-l-4 border-transparent'}`}
              >
                <span className={`text-sm font-medium ${projectId === p.id ? 'text-white' : ''}`}>{p.name}</span>
              </Link>
            ))}
            {projects?.length === 0 && (
              <div className="px-6 text-xs text-[#6b7280]">Keine Projekte</div>
            )}
          </div>
          <div className='px-6 mb-4 mt-8 flex items-center justify-between'>
            <span className='text-[10px] uppercase tracking-widest text-[#6b7280] font-semibold'>Global</span>
          </div>
          <div className='space-y-1'>
             <Link 
                to="/runs"
                className={`px-6 py-3 flex items-center gap-2 cursor-pointer transition-colors hover:bg-[#111827] border-l-4 border-transparent`}
              >
                <PlaySquare className="w-4 h-4 text-slate-400" />
                <span className={`text-sm font-medium`}>All Runs</span>
              </Link>
          </div>
        </nav>
      </aside>
      <main className='flex-1 flex flex-col min-w-0'>
        <Outlet />
      </main>
    </div>
  );
}
