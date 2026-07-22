import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { KontaktAnfrage } from '../lib/types'
import { formatDateTime } from '../lib/format'

/**
 * Admin-Bereich in Settings.tsx für eingehende Nachrichten über das
 * öffentliche Kontaktformular (src/components/KontaktFormular.tsx auf der
 * Impressum-Seite). RLS (kontakt_anfragen_select_admin) beschränkt das
 * Lesen bereits auf Nutzer*innen mit rolle='admin'.
 */
export function KontaktAnfragenListe() {
  const [anfragen, setAnfragen] = useState<KontaktAnfrage[]>([])

  async function load() {
    const { data } = await supabase.from('kontakt_anfragen').select('*').order('erstellt_am', { ascending: false })
    setAnfragen(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleGelesen(a: KontaktAnfrage) {
    await supabase.from('kontakt_anfragen').update({ gelesen: !a.gelesen }).eq('id', a.id)
    await load()
  }

  async function handleDelete(id: string) {
    await supabase.from('kontakt_anfragen').delete().eq('id', id)
    await load()
  }

  const ungelesen = anfragen.filter((a) => !a.gelesen).length

  return (
    <div>
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900">
        Kontaktanfragen
        {ungelesen > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {ungelesen} neu
          </span>
        )}
      </h2>
      <p className="mb-3 max-w-md text-sm text-slate-500">
        Nachrichten über das Kontaktformular auf der öffentlichen Impressum-Seite.
      </p>
      <ul className="max-w-2xl space-y-2">
        {anfragen.map((a) => (
          <li
            key={a.id}
            className={`rounded-xl border p-3 shadow-sm ${a.gelesen ? 'border-slate-200 bg-white' : 'border-primary/30 bg-primary/5'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {a.name} ·{' '}
                  <a href={`mailto:${a.email}`} className="text-primary underline">
                    {a.email}
                  </a>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{a.nachricht}</p>
                <p className="mt-1 text-xs text-slate-400">{formatDateTime(a.erstellt_am)}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleGelesen(a)}
                  className="mc-btn-ghost !px-2 !py-1 !text-xs"
                >
                  {a.gelesen ? 'Ungelesen' : 'Gelesen'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  className="mc-btn-danger !px-2 !py-1 !text-xs"
                >
                  Löschen
                </button>
              </div>
            </div>
          </li>
        ))}
        {anfragen.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            Noch keine Kontaktanfragen.
          </li>
        )}
      </ul>
    </div>
  )
}
