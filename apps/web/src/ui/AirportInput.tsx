import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Plane, Building2 } from 'lucide-react';

/**
 * Ortsauswahl mit echter Liste statt Raten.
 *
 * Der Anlass: „Osaka" heißt als Stadt OSA (alle Flughäfen), der große Flughafen
 * ist KIX, daneben gibt es ITM. Tippt man den Klartext in ein Code-Feld, landet
 * er unverändert in den Such-URLs und die Quellen finden nichts oder etwas
 * Falsches. Hier wird deshalb der offizielle Code übernommen — und danebensteht,
 * welcher Ort das ist.
 */
export function AirportInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Was steckt hinter dem aktuell gesetzten Code? Nur zur Anzeige.
  const known = useQuery({
    queryKey: ['places', value],
    queryFn: () => api.searchPlaces(value),
    enabled: /^[A-Za-z]{3}$/.test(value || ''),
    staleTime: 60 * 60 * 1000,
  });
  const resolved = known.data?.find(p => p.code === (value || '').toUpperCase());

  const suggest = useQuery({
    queryKey: ['places', term],
    queryFn: () => api.searchPlaces(term),
    enabled: open && term.trim().length >= 2,
    staleTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const pick = (code: string) => { onChange(code); setTerm(''); setOpen(false); };

  return (
    <div className="relative" ref={box}>
      <input
        value={open ? term : (value || '')}
        onChange={e => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => { setTerm(''); setOpen(true); }}
        placeholder={placeholder || 'Ort oder Code, z.B. Osaka'}
        className="w-full bg-[#1f2937] border border-[#374151] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
      />
      {!open && resolved && (
        <div className="text-[11px] text-[#6b7280] mt-1 truncate">{resolved.label}</div>
      )}
      {!open && !resolved && value && !/^[A-Za-z]{3}$/.test(value) && (
        <div className="text-[11px] text-amber-400/90 mt-1">
          „{value}" ist kein Flughafen-Code — bitte aus der Liste wählen, sonst suchen die Quellen ins Leere.
        </div>
      )}
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-[#0f151f] border border-[#374151] rounded-lg shadow-2xl max-h-72 overflow-auto">
          {term.trim().length < 2 && <div className="px-3 py-2 text-xs text-[#6b7280]">Mindestens zwei Zeichen eingeben…</div>}
          {term.trim().length >= 2 && suggest.isFetching && <div className="px-3 py-2 text-xs text-[#6b7280]">Suche…</div>}
          {term.trim().length >= 2 && !suggest.isFetching && (suggest.data?.length ?? 0) === 0 && (
            <div className="px-3 py-2 text-xs text-[#6b7280]">Nichts gefunden.</div>
          )}
          {suggest.data?.map(p => (
            <button key={p.kind + p.code} type="button" onClick={() => pick(p.code)}
              className="w-full text-left px-3 py-2 hover:bg-[#1f2937] flex items-center gap-2">
              {p.kind === 'city'
                ? <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                : <Plane className="w-3.5 h-3.5 text-[#6b7280] shrink-0" />}
              <span className="text-sm text-white truncate">{p.label}</span>
              <span className="ml-auto text-[10px] font-mono text-[#6b7280] shrink-0">{p.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
