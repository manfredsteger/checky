import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

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
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const cleanup = useMutation({ mutationFn: api.runCleanup });

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
            onClick={() => save.mutate({ sources: { lovetorrent_cookie: ltCookie.trim(), lovetorrent_user_agent: ltUa.trim() } })}
            disabled={save.isPending}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2 rounded font-semibold text-sm">
            Zugänge speichern
          </button>
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
