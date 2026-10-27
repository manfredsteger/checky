import { describe, it, expect } from 'vitest';
import { pickExactHit } from './providers/tmdb.js';

// Echte TMDB-Antwort (gekürzt) für „That Time I Got Reincarnated as a Slime",
// language=de-DE: das Spin-off steht VOR der Hauptserie.
const DE = [
  { id: 118541, name: 'Die Schleim-Tagebücher', original_name: '転生したらスライムだった件 転スラ日記' },
  { id: 82684, name: 'Meine Wiedergeburt als Schleim in einer anderen Welt', original_name: '転生したらスライムだった件' },
];
const EN = [
  { id: 118541, name: 'The Slime Diaries: That Time I Got Reincarnated as a Slime', original_name: '転生したらスライムだった件 転スラ日記' },
  { id: 82684, name: 'That Time I Got Reincarnated as a Slime', original_name: '転生したらスライムだった件' },
];

describe('pickExactHit', () => {
  it('nimmt nur einen Treffer mit exakt passendem Namen, nicht die Popularitäts-Nr. 1', () => {
    expect(pickExactHit(DE, 'That Time I Got Reincarnated as a Slime')).toBeUndefined();
    expect(pickExactHit(EN, 'That Time I Got Reincarnated as a Slime')?.id).toBe(82684);
    expect(pickExactHit(DE, 'Meine Wiedergeburt als Schleim in einer anderen Welt')?.id).toBe(82684);
  });
  it('vergleicht nach Normalform (Groß/Klein, Satzzeichen, Jahr) und auch den Originaltitel', () => {
    expect(pickExactHit(EN, 'that time i got reincarnated as a slime (2018)')?.id).toBe(82684);
    expect(pickExactHit(DE, '転生したらスライムだった件')?.id).toBe(82684);
    expect(pickExactHit([{ id: 1, title: 'Deadpool & Wolverine', original_title: 'Deadpool & Wolverine' }], 'Deadpool and Wolverine')).toBeUndefined();
  });
  it('liefert undefined bei leerem Suchbegriff oder leerer Liste', () => {
    expect(pickExactHit(EN, '')).toBeUndefined();
    expect(pickExactHit([], 'x')).toBeUndefined();
  });
});
