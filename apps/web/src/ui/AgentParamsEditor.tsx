import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Agent, Manifest, ManifestParam } from '@checky/shared';
import { Plus, X, Trash2 } from 'lucide-react';
import { CATEGORIES } from '../lib/categories';

// Bearbeitet EINEN Agenten: Name, Kategorie und Parameter. Die hier gesetzten
// Werte gelten nur für diesen Agenten und überschreiben die Projekt-Einstellungen
// (der Worker merged Projekt- und Agent-Params, Agent gewinnt).
export function AgentParamsEditor({ agent, manifest, projectParams, onClose }: {
  agent: Agent;
  manifest: Manifest | undefined;
  projectParams: Record<string, any> | null | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(agent.name);
  // Effektive Werte (Projekt + Agent) vorbefüllen, damit man sieht, was gilt.
  const [values, setValues] = useState<Record<string, any>>({ ...(projectParams || {}), ...((agent.params as any) || {}) });
  const [newKey, setNewKey] = useState('');

  const set = (k: string, v: any) => setValues(s => ({ ...s, [k]: v }));
  const manifestKeys = new Set((manifest?.params || []).map(p => p.key));
  const customEntries = Object.entries(values).filter(([k]) => !manifestKeys.has(k) && !k.startsWith('_'));
  const category = (values._category as string) || '';

  const save = useMutation({
    mutationFn: () => api.updateAgent(agent.id, { name, params: values }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents', agent.project_id] });
      qc.invalidateQueries({ queryKey: ['agent', agent.id] });
      qc.invalidateQueries({ queryKey: ['agent-last', agent.id] });
      onClose();
    },
  });

  const addCustom = () => {
    const k = newKey.trim().replace(/\s+/g, '_');
    if (!k || k in values) return;
    set(k, '');
    setNewKey('');
  };
  const removeCustom = (k: string) => setValues(s => { const c = { ...s }; delete c[k]; return c; });

  const input = 'w-full bg-[#0a0a0b] border border-[#374151] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500';

  const renderField = (p: ManifestParam) => {
    const v = values[p.key] ?? p.default ?? '';
    if (p.type === 'select') return <select value={v} onChange={e => set(p.key, e.target.value)} className={input}>{(p.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>;
    if (p.type === 'number') return <input type="number" value={v === null ? '' : v} min={p.min} max={p.max} step={p.step} onChange={e => set(p.key, e.target.value === '' ? null : Number(e.target.value))} placeholder={p.placeholder} className={input} />;
    if (p.type === 'date') return <input type="date" value={v || ''} onChange={e => set(p.key, e.target.value)} className={input} />;
    return <input type="text" value={v ?? ''} onChange={e => set(p.key, e.target.value)} placeholder={p.placeholder} className={input} />;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#111827] border border-[#1f2937] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-auto p-6 animate-[fadeIn_0.15s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Agent bearbeiten</h2>
            <p className="text-xs text-[#6b7280]">Gilt nur für diesen Agenten — überschreibt die Projekt-Einstellungen.</p>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Name */}
        <label className="block mb-4">
          <span className="text-xs font-semibold text-[#9ca3af]">Name</span>
          <input value={name} onChange={e => setName(e.target.value)} className={input + ' mt-1'} />
        </label>

        {/* Kategorie */}
        <div className="mb-5">
          <span className="text-xs font-semibold text-[#9ca3af]">Kategorie</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {CATEGORIES.map(c => (
              <button key={c.key} type="button" onClick={() => set('_category', c.key)}
                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${category === c.key ? c.badge + ' border-transparent' : 'bg-transparent border-[#1f2937] text-[#9ca3af] hover:text-white'}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Manifest-Felder */}
        {manifest && manifest.params.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {manifest.params.map(p => (
              <label key={p.key} className="block">
                <span className="text-xs font-semibold text-[#9ca3af]">{p.label}</span>
                <div className="mt-1">{renderField(p)}</div>
                {p.help && <span className="text-[11px] text-[#6b7280] mt-0.5 block">{p.help}</span>}
              </label>
            ))}
          </div>
        )}

        {/* Eigene Parameter */}
        <div className="border-t border-[#1f2937] pt-4">
          <h3 className="text-xs font-semibold text-[#9ca3af] mb-2">Eigene Parameter</h3>
          <div className="space-y-2">
            {customEntries.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xs text-sky-300 font-mono w-40 truncate" title={k}>{k}</span>
                <input value={v ?? ''} onChange={e => set(k, e.target.value)} className="flex-1 bg-[#0a0a0b] border border-[#374151] rounded-lg px-3 py-1.5 text-sm text-white" />
                <button onClick={() => removeCustom(k)} className="text-[#6b7280] hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            {customEntries.length === 0 && <p className="text-xs text-[#6b7280]">Keine eigenen Parameter.</p>}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <input value={newKey} onChange={e => setNewKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCustom(); }} placeholder="neuer Parametername" className="flex-1 bg-[#0a0a0b] border border-[#374151] rounded-lg px-3 py-1.5 text-sm text-white" />
            <button onClick={addCustom} className="flex items-center gap-1 bg-[#1f2937] hover:bg-[#374151] text-white text-sm px-3 py-1.5 rounded-lg"><Plus className="w-4 h-4" /> hinzufügen</button>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-[#1f2937] hover:bg-[#374151] text-white">Abbrechen</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
            {save.isPending ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
