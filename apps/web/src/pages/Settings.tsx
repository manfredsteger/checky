import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { LIBRARY_KINDS, type MediaLibraryConfigInput, type ConnectionTest } from '@checky/shared';

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  const [retention, setRetention] = useState(30);
  const [webhook, setWebhook] = useState('');
  const [mxHome, setMxHome] = useState('');
  const [mxToken, setMxToken] = useState('');
  const [mxRoom, setMxRoom] = useState('');
  const [ltCookie, setLtCookie] = useState('');
  const [ltUa, setLtUa] = useState('');
  const [lib, setLib] = useState<MediaLibraryConfigInput>({ kind: 'jellyfin', url: '', api_key: '', public_url: '', user: '' });
  const [libTest, setLibTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const s = settings.data;
    if (s) {
      setRetention(s.retention_days ?? 30);
      setWebhook(s.notify?.webhook_url ?? '');
      setMxHome(s.notify?.matrix_homeserver ?? '');
      setMxToken(s.notify?.matrix_token ?? '');
      setMxRoom(s.notify?.matrix_room ?? '');
      setLtCookie(s.sources?.lovetorrent_cookie ?? '');
      setLtUa(s.sources?.lovetorrent_user_agent ?? '');
      const ml = s.sources?.media_library;
      if (ml) setLib({ kind: ml.kind || 'jellyfin', url: ml.url || '', api_key: ml.api_key || '', public_url: ml.public_url || '', user: ml.user || '' });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const cleanup = useMutation({ mutationFn: api.runCleanup });
  const testLib = useMutation({
    mutationFn: (cfg: MediaLibraryConfigInput) => api.testMediaLibrary(cfg),
    onSuccess: (r: ConnectionTest) => setLibTest({ ok: true, text: `Verbunden mit „${r.name}" (${r.version}): ${r.series} Serien (${r.series_with_tmdb} mit TMDB-ID), ${r.movies} Filme (${r.movies_with_tmdb} mit TMDB-ID).` }),
    onError: (e) => setLibTest({ ok: false, text: (e as Error).message }),
  });
  // Quellen-Zugänge werden als EIN Objekt gespeichert — beim Speichern eines
  // Abschnitts die anderen Schlüssel mitnehmen, sonst löscht z.B. der
  // LoveTorrent-Knopf die Bibliotheks-Einstellungen.
  const saveSources = (patch: Record<string, any>) =>
    save.mutate({ sources: { ...(settings.data?.sources || {}), ...patch } });
  const libClean = (): MediaLibraryConfigInput => ({
    kind: lib.kind, url: lib.url.trim(), api_key: lib.api_key.trim(),
    public_url: lib.public_url?.trim() || undefined, user: lib.user?.trim() || undefined,
  });

  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const importBundle = useMutation({
    mutationFn: (bundle: any) => api.importBundle(bundle),
    onSuccess: (r) => {
      const n = (r.imported.manifests?.length || 0) + (r.imported.blueprints?.length || 0);
      setImportMsg({ ok: true, text: `${n} Baustein(e) importiert (${[...r.imported.manifests, ...r.imported.blueprints].join(', ')}).` });
      qc.invalidateQueries({ queryKey: ['manifests'] });
      qc.invalidateQueries({ queryKey: ['blueprints'] });
    },
    onError: (e) => setImportMsg({ ok: false, text: (e as Error).message }),
  });

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      importBundle.mutate(bundle);
    } catch {
      setImportMsg({ ok: false, text: 'Datei ist kein gültiges JSON.' });
    }
  };

  const paused = settings.data?.paused ?? false;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0a0a0b] text-white overflow-auto">
      <header className="h-16 border-b border-[#1f2937] flex items-center px-8 shrink-0">
        <h1 className="text-lg font-bold">Einstellungen</h1>
      </header>

      <div className="p-8 max-w-3xl space-y-6">
        {/* Kill-Switch */}
        <section className={`rounded-xl p-5 border ${paused ? 'border-red-500/50 bg-red-500/10' : 'border-[#1f2937] bg-[#111827]'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Kill-Switch (globale Pause)</h2>
              <p className="text-sm text-[#9ca3af] mt-1">
                {paused ? 'Alle Ausführungen sind pausiert. „Jetzt ausführen" wird abgelehnt.' : 'Betrieb aktiv. Läufe werden normal ausgeführt.'}
              </p>
            </div>
            <button
              onClick={() => save.mutate({ paused: !paused })}
              disabled={save.isPending}
              className={`px-5 py-2 rounded font-semibold disabled:opacity-50 ${paused ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
            >
              {paused ? 'Fortsetzen' : 'Alles pausieren'}
            </button>
          </div>
        </section>

        {/* Notify */}
        <section className="rounded-xl p-5 border border-[#1f2937] bg-[#111827] space-y-3">
          <h2 className="font-semibold">Benachrichtigungen</h2>
          <p className="text-sm text-[#9ca3af]">Ziele werden bei Änderungen und Fehlläufen benachrichtigt.</p>
          <label className="block text-sm">Webhook-URL
            <input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="https://webhook.site/…"
              className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm" />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block text-sm">Matrix Homeserver
              <input value={mxHome} onChange={e => setMxHome(e.target.value)} placeholder="https://matrix.org"
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">Matrix Access-Token
              <input value={mxToken} onChange={e => setMxToken(e.target.value)} type="password"
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">Matrix Raum-ID
              <input value={mxRoom} onChange={e => setMxRoom(e.target.value)} placeholder="!raum:server"
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm" />
            </label>
          </div>
          <button
            onClick={() => save.mutate({ notify: { webhook_url: webhook, matrix_homeserver: mxHome, matrix_token: mxToken, matrix_room: mxRoom } })}
            disabled={save.isPending}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2 rounded font-semibold text-sm">
            Ziele speichern
          </button>
        </section>

        {/* Quellen-Zugänge */}
        <section className="rounded-xl p-5 border border-[#1f2937] bg-[#111827] space-y-3">
          <h2 className="font-semibold">Quellen-Zugänge</h2>
          <p className="text-sm text-[#9ca3af]">
            Manche Quellen liegen hinter einer Hürde, die nur ein Mensch im Browser nimmt. Einmal selbst lösen,
            den entstandenen Cookie hier eintragen — der Worker nutzt ihn bei jedem Lauf, ohne Neustart.
          </p>
          <label className="block text-sm">LoveTorrent Antibot-Cookie
            <input value={ltCookie} onChange={e => setLtCookie(e.target.value)} type="password" autoComplete="off"
              placeholder="<30-stelliger Name>=<Wert> (aus den Browser-Cookies von lovetorrent.net)"
              className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm font-mono" />
          </label>
          <label className="block text-sm">User-Agent des Browsers, in dem das Rätsel gelöst wurde
            <input value={ltUa} onChange={e => setLtUa(e.target.value)} autoComplete="off"
              placeholder="Mozilla/5.0 (Macintosh; …) Chrome/154.0.0.0 Safari/537.36"
              className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm font-mono" />
          </label>
          <p className="text-xs text-[#6b7280]">
            So kommst du dran: lovetorrent.net im Browser öffnen, das Bild-Rätsel lösen, dann in den Entwicklertools
            unter Anwendung → Cookies den Eintrag mit dem 30-stelligen Namen als <span className="font-mono">Name=Wert</span> kopieren
            (der kleine Begleit-Cookie „veAnuQ" wird automatisch ergänzt). Der Cookie gilt nur zusammen mit dem User-Agent
            dieses Browsers — in der Adresszeile <span className="font-mono">chrome://version</span> öffnen und die Zeile „User-Agent" kopieren.
            Läuft nach ca. 7 Tagen ab — der Agent meldet dann „Antibot-Cookie fehlt oder abgelaufen".
          </p>
          <button
            onClick={() => saveSources({ lovetorrent_cookie: ltCookie.trim(), lovetorrent_user_agent: ltUa.trim() })}
            disabled={save.isPending}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2 rounded font-semibold text-sm">
            Zugänge speichern
          </button>
        </section>

        {/* Medienbibliothek */}
        <section className="rounded-xl p-5 border border-[#1f2937] bg-[#111827] space-y-3">
          <h2 className="font-semibold">Medienbibliothek (Jellyfin · Emby · Plex)</h2>
          <p className="text-sm text-[#9ca3af]">
            Neuigkeiten-Agenten (neue Episoden, neue Filme) gleichen jeden Treffer mit deiner eigenen Sammlung ab:
            „✓ schon da" oder „+3" = so viele Folgen der Staffel fehlen noch. Zuordnung läuft über die TMDB-ID,
            die Jellyfin/Emby aus Ordnernamen wie <span className="font-mono">Serie (2024) [tmdbid-12345]</span> liest,
            als Fallback über den Titel.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block text-sm">System
              <select value={lib.kind} onChange={e => setLib({ ...lib, kind: e.target.value as MediaLibraryConfigInput['kind'] })}
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm">
                {LIBRARY_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}{k.experimental ? ' (experimentell)' : ''}</option>)}
              </select>
            </label>
            <label className="block text-sm md:col-span-2">Adresse (aus Sicht des Servers, meist die LAN-IP)
              <input value={lib.url} onChange={e => setLib({ ...lib, url: e.target.value })} autoComplete="off"
                placeholder={lib.kind === 'plex' ? 'http://192.168.0.10:32400' : 'http://192.168.0.10:8096'}
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm font-mono" />
            </label>
            <label className="block text-sm md:col-span-2">{lib.kind === 'plex' ? 'X-Plex-Token' : 'API-Schlüssel'}
              <input value={lib.api_key} onChange={e => setLib({ ...lib, api_key: e.target.value })} type="password" autoComplete="off"
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm font-mono" />
            </label>
            <label className="block text-sm">Benutzer (optional)
              <input value={lib.user || ''} onChange={e => setLib({ ...lib, user: e.target.value })} autoComplete="off"
                placeholder={lib.kind === 'plex' ? '— bei Plex nicht nötig' : 'nur dessen Bibliotheken zählen'}
                disabled={lib.kind === 'plex'}
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm disabled:opacity-40" />
            </label>
            <label className="block text-sm md:col-span-3">Adresse für Links im Browser (optional)
              <input value={lib.public_url || ''} onChange={e => setLib({ ...lib, public_url: e.target.value })} autoComplete="off"
                placeholder="https://jellyfin.example — falls du die Bibliothek über einen anderen Namen öffnest als der Server sie erreicht"
                className="mt-1 w-full bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm font-mono" />
            </label>
          </div>
          <p className="text-xs text-[#6b7280]">
            {lib.kind === 'plex'
              ? <>Token: in der Plex-Weboberfläche bei einem Medium „…" → „Info anzeigen" → „XML anzeigen", in der Adresse steht <span className="font-mono">X-Plex-Token=…</span>. Der Plex-Abgleich ist nach der Plex-API geschrieben, aber noch nicht gegen einen echten Server verifiziert.</>
              : <>Schlüssel anlegen: {lib.kind === 'emby' ? 'Emby' : 'Jellyfin'}-Dashboard → Erweitert → API-Schlüssel → „+", Name z.&nbsp;B. „Checky". Ohne Benutzer gilt die Admin-Sicht auf alle Bibliotheken. Ein selbstsigniertes HTTPS-Zertifikat kennt der Server nicht — dann hier die http-Adresse mit IP eintragen und den HTTPS-Namen nur unter „Links im Browser".</>}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => { setLibTest(null); testLib.mutate(libClean()); }}
              disabled={testLib.isPending || !lib.url.trim() || !lib.api_key.trim()}
              className="bg-[#1f2937] hover:bg-[#374151] disabled:opacity-50 px-5 py-2 rounded font-semibold text-sm">
              {testLib.isPending ? 'Prüfe…' : 'Verbindung testen'}
            </button>
            <button
              onClick={() => saveSources({ media_library: libClean() })}
              disabled={save.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2 rounded font-semibold text-sm">
              Bibliothek speichern
            </button>
            {lib.url && (
              <button
                onClick={() => { setLib({ kind: lib.kind, url: '', api_key: '', public_url: '', user: '' }); saveSources({ media_library: { kind: lib.kind, url: '', api_key: '' } }); }}
                disabled={save.isPending}
                className="text-xs text-[#6b7280] hover:text-red-400">
                Abgleich ausschalten
              </button>
            )}
          </div>
          {libTest && <p className={`text-xs ${libTest.ok ? 'text-emerald-400' : 'text-red-400'}`}>{libTest.text}</p>}
        </section>

        {/* Retention */}
        <section className="rounded-xl p-5 border border-[#1f2937] bg-[#111827] space-y-3">
          <h2 className="font-semibold">Aufbewahrung (Retention)</h2>
          <div className="flex items-end gap-3">
            <label className="block text-sm">Screenshots/Läufe älter als (Tage)
              <input type="number" min={0} value={retention} onChange={e => setRetention(parseInt(e.target.value || '0', 10))}
                className="mt-1 w-32 bg-[#0a0a0b] border border-[#374151] rounded px-3 py-2 text-sm" />
            </label>
            <button onClick={() => save.mutate({ retention_days: retention })} disabled={save.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded text-sm font-semibold">Speichern</button>
            <button onClick={() => cleanup.mutate()} disabled={cleanup.isPending}
              className="bg-[#1f2937] hover:bg-[#374151] px-4 py-2 rounded text-sm">
              {cleanup.isPending ? 'Räume auf…' : 'Jetzt aufräumen'}
            </button>
          </div>
          <p className="text-xs text-[#6b7280]">Der jeweils letzte Lauf pro Agent bleibt immer erhalten.</p>
          {cleanup.isSuccess && <p className="text-xs text-emerald-400">Aufräum-Job angestoßen.</p>}
        </section>

        {/* Bausteinbibliothek */}
        <section className="rounded-xl p-5 border border-[#1f2937] bg-[#111827] space-y-3">
          <h2 className="font-semibold">Bausteinbibliothek</h2>
          <p className="text-sm text-[#9ca3af]">Manifeste (Tracking-Typen) und Blueprints (Quellen) als Bundle sichern oder aus einer Datei einspielen — z.&nbsp;B. aus einem Community-Bundle.</p>
          <div className="flex flex-wrap items-center gap-3">
            <a href="/api/library/export" download
              className="bg-[#1f2937] hover:bg-[#374151] px-4 py-2 rounded text-sm font-semibold inline-flex items-center gap-2">
              ⬇ Bundle exportieren
            </a>
            <label className="bg-[#1f2937] hover:bg-[#374151] px-4 py-2 rounded text-sm font-semibold cursor-pointer inline-flex items-center gap-2">
              ⬆ Bundle importieren
              <input type="file" accept="application/json,.json" className="hidden"
                onChange={e => { onImportFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </label>
            {importBundle.isPending && <span className="text-xs text-[#6b7280]">Importiere…</span>}
          </div>
          {importMsg && <p className={`text-xs ${importMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{importMsg.text}</p>}
        </section>

        {(save.isError) && <p className="text-red-400 text-sm">{(save.error as Error).message}</p>}
      </div>
    </div>
  );
}
