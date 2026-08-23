import { useState } from 'react';
import { useOverlayDismiss } from './useOverlayDismiss';
import { AirportInput } from './AirportInput';
import { useToast } from './toast';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project, ManifestParam } from '@checky/shared';
import { Plus, X, Trash2 } from 'lucide-react';

export function ProjectParamsEditor({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const manifestsQ = useQuery({ queryKey: ['manifests'], queryFn: api.getManifests });
  const [manifestId, setManifestId] = useState<string>(project.manifest_id || '');
  const [values, setValues] = useState<Record<string, any>>({ ...(project.params || {}) });
  const [newKey, setNewKey] = useState('');
  const toast = useToast();

  const manifest = manifestsQ.data?.find(m => m.id === manifestId);
  const set = (k: string, v: any) => setValues(s => ({ ...s, [k]: v }));
  const manifestKeys = new Set((manifest?.params || []).map(p => p.key));
  const customEntries = Object.entries(values).filter(([k]) => !manifestKeys.has(k) && !k.startsWith('_'));

  const save = useMutation({
    mutationFn: () => api.updateProject(project.id, { manifest_id: manifestId || null, params: values }),
    onSuccess: (updated: any) => {
      qc.invalidateQueries({ queryKey: ['projects', project.id] });
      qc.invalidateQueries({ queryKey: ['agents', project.id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
      // Die API meldet zurück, ob sich die SUCHE geändert hat (und nicht bloß
      // eine Anzeige-Schwelle) und wie viele Läufe deshalb gestartet wurden.
      const rq = updated?.requeue;
      if (rq?.searchChanged) {
        const was = rq.diff?.length ? ` (${rq.diff.slice(0, 2).join(', ')})` : '';
        toast('success', rq.requeued > 0
          ? `Suche geändert${was} — ${rq.requeued} ${rq.requeued === 1 ? 'Lauf' : 'Läufe'} neu gestartet. Ältere Werte gehören zur vorherigen Messreihe.`
          : `Suche geändert${was}. Kein aktiver Agent zum Neumessen.`);
      } else {
        toast('success', 'Einstellungen gespeichert.');
      }
      onClose();
    },
    onError: (e) => toast('error', (e as Error).message),
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
    if (p.type === 'airport') return <AirportInput value={v || ''} onChange={code => set(p.key, code)} placeholder={p.placeholder} />;
    if (p.type === 'select') return <select value={v} onChange={e => set(p.key, e.target.value)} className={input}>{(p.options || []).map(o => <option key={o} value={o}>{o}</option>)}</select>;
    if (p.type === 'number') return <input type="number" value={v === null ? '' : v} min={p.min} max={p.max} step={p.step} onChange={e => set(p.key, e.target.value === '' ? null : Number(e.target.value))} placeholder={p.placeholder} className={input} />;
    if (p.type === 'date') return <input type="date" value={v || ''} onChange={e => set(p.key, e.target.value)} className={input} />;
    return <input type="text" value={v ?? ''} onChange={e => set(p.key, e.target.value)} placeholder={p.placeholder} className={input} />;
  };

  const overlay = useOverlayDismiss(onClose);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" {...overlay}>
      <div className="bg-[#111827] border border-[#1f2937] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-auto p-6 animate-[fadeIn_0.15s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Projekt-Einstellungen</h2>
            <p className="text-xs text-[#6b7280]">Gilt für alle Agenten in „{project.name}". Als {'{{'}Platzhalter{'}}'} im Recipe nutzbar.</p>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Typ */}
        <label className="block mb-5">
          <span className="text-xs font-semibold text-[#9ca3af]">Was möchtest du tracken? (Vorlage)</span>
          <select value={manifestId} onChange={e => setManifestId(e.target.value)} className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded-lg px-3 py-2 text-sm text-white">
            <option value="">— frei / kein Typ —</option>
            {(manifestsQ.data || []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {manifest?.description && <span className="text-xs text-[#6b7280] mt-1 block">{manifest.description}</span>}
        </label>

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
            {customEntries.length === 0 && <p className="text-xs text-[#6b7280]">Noch keine eigenen Parameter.</p>}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <input value={newKey} onChange={e => setNewKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCustom(); }} placeholder="neuer Parametername, z.B. hotel_max" className="flex-1 bg-[#0a0a0b] border border-[#374151] rounded-lg px-3 py-1.5 text-sm text-white" />
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
