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

  useEffect(() => {
    const s = settings.data;
    if (s) {
      setRetention(s.retention_days ?? 30);
      setWebhook(s.notify?.webhook_url ?? '');
      setMxHome(s.notify?.matrix_homeserver ?? '');
      setMxToken(s.notify?.matrix_token ?? '');
      setMxRoom(s.notify?.matrix_room ?? '');
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  const cleanup = useMutation({ mutationFn: api.runCleanup });

  const paused = settings.data?.paused ?? false;

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0b] text-white overflow-auto">
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

        {(save.isError) && <p className="text-red-400 text-sm">{(save.error as Error).message}</p>}
      </div>
    </div>
  );
}
