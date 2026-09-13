import { describe, it, expect } from 'vitest';
import { parseListPage, normalizeDate, parseAvailableTotal, tagSlug, matchesSearch, normalizeCookie } from './lovetorrent.js';

// Markup nachgebaut aus der echten Startseite (Stand 13.09.2026): ein Eintrag
// ist ein Anker mit Bild-Block (Größe in .info) und Info-Block (.title,
// Kalender-Datum, per Script zufällige Seed-Zahl).
function row(id: string, title: string, size: string, date: string): string {
  return `
<a href="https://lovetorrent.net/${id}-${id}.html" class="item-thumb">
  <div class="img-holder">
    <img class="tooltip lazyimg-video" data-src="https://lovetorrent.net/uploads/x.jpg?v=1" alt="">
    <div class="info">${size}</div>
    <div class="play"><svg class="svg-icon"><use xlink:href="#icon-play"></use></svg></div>
  </div>
  <div class="info-holder">
    <div class="title">${title}</div>
    <div class="details">
      <div class="item"><span class="icon"><svg class="svg-icon"><use xlink:href="#icon-calendar"></use></svg></span><span class="text">${date}</span></div>
      <div class="item"><span class="icon"><svg class="svg-icon icon-eye"><use xlink:href="#icon-eye"></use></svg></span><span class="text"><script>var tmp = Math.round((Math.random() * (199 - 135)));</script><script>document.write(tmp);</script> Seed</span></div>
    </div>
  </div>
</a>`;
}

const NOW = new Date(2026, 8, 13, 9, 0, 0); // 13.09.2026

describe('lovetorrent provider', () => {
  it('parst Titel, Link, Größe und Datum je Eintrag', () => {
    const html = `<div class="thumbs-items">${row('3308557', 'Beispiel part 5  Pack', '191.39 GB', 'Сегодня, 06:48')}${row('3308527', 'Anna Beispiel &amp; Co - Ben&#039;s Tag', '29.9 GB', '6-09-2026, 11:51')}</div>`;
    const rows = parseListPage(html, NOW);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      url: 'https://lovetorrent.net/3308557-3308557.html',
      title: 'Beispiel part 5 Pack',
      size: '191.39 GB',
      date: '13.09.2026 06:48',
    });
    expect(rows[1].title).toBe("Anna Beispiel & Co - Ben's Tag");
    expect(rows[1].date).toBe('06.09.2026 11:51');
  });

  it('normalisiert heute/gestern/absolut', () => {
    expect(normalizeDate('Сегодня, 06:48', NOW)).toBe('13.09.2026 06:48');
    expect(normalizeDate('Вчера, 23:05', NOW)).toBe('12.09.2026 23:05');
    expect(normalizeDate('11-09-2026, 09:07', NOW)).toBe('11.09.2026 09:07');
    expect(normalizeDate('irgendwas', NOW)).toBe('irgendwas');
  });

  it('liest die Gesamtzahl nur dort, wo sie zum Kontext passt', () => {
    const home = `<a class="tag2" href="/tags/1080p/" title="Найдено публикаций: 30054">1080p</a>
      <div class="subheadline">Showing <em>166204</em> submitted torrent.</div>`;
    expect(parseAvailableTotal(home, null)).toBe(166204);
    expect(parseAvailableTotal(home, '1080p')).toBe(30054);
    // Tag-Seite ohne Tag-Leiste: die globale Zahl darf NICHT als Tag-Zahl durchgehen
    const tagPage = `<div class="subheadline">Showing <em>166204</em> submitted torrent.</div>`;
    expect(parseAvailableTotal(tagPage, '4k')).toBeNull();
  });

  it('bildet Tag-Eingaben auf Slugs ab', () => {
    expect(tagSlug('1080p')).toBe('1080p');
    expect(tagSlug('Ultra HD')).toBe('ultra-hd');
    expect(tagSlug('/tags/720p/')).toBe('720p');
    expect(tagSlug('')).toBeNull();
  });

  it('ergänzt den Begleit-Cookie veAnuQ, wenn nur der Token eingetragen wurde', () => {
    const tok = 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCd=0123456789abcdef0123456789abcdef-1700000000-1700000000';
    expect(normalizeCookie(tok)).toBe(`veAnuQ=AbCdEfGhIjKlMnOpQrStUvWxYzAbCd; ${tok}`);
    expect(normalizeCookie(`Cookie: veAnuQ=AbCdEfGhIjKlMnOpQrStUvWxYzAbCd; ${tok};`)).toBe(`veAnuQ=AbCdEfGhIjKlMnOpQrStUvWxYzAbCd; ${tok}`);
    expect(normalizeCookie('')).toBe('');
  });

  it('filtert Titel wortweise, unabhängig von Reihenfolge und Schreibweise', () => {
    expect(matchesSearch('Anna Berg - Schöner Tag', 'berg anna')).toBe(true);
    expect(matchesSearch('Anna Berg - Schöner Tag', 'Anna Rhein')).toBe(false);
    expect(matchesSearch('anything', '')).toBe(true);
  });
});
