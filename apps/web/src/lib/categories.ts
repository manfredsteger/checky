// Agent-Klassifizierung: was für eine Art Check ist das? Rein UI-seitig über
// params._category (kein DB-Feld nötig, wie _priority). Dient Badge + Filter/
// Gruppierung auf der Projektseite.
export interface Category { key: string; label: string; badge: string; }

export const CATEGORIES: Category[] = [
  { key: 'price',        label: 'Preis',         badge: 'bg-emerald-500/15 text-emerald-300' },
  { key: 'availability', label: 'Verfügbarkeit', badge: 'bg-sky-500/15 text-sky-300' },
  { key: 'status',       label: 'Status',        badge: 'bg-violet-500/15 text-violet-300' },
  { key: 'stock',        label: 'Bestand',       badge: 'bg-amber-500/15 text-amber-300' },
  { key: 'other',        label: 'Sonstiges',     badge: 'bg-[#374151] text-[#9ca3af]' },
];

export const categoryOf = (key: unknown): Category | undefined =>
  CATEGORIES.find(c => c.key === key);
