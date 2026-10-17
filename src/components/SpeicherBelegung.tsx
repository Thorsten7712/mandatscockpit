import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

// Admin-Bereich in Settings.tsx: Belegung je Bucket und Person gegen die
// Grenzen des Free-Tiers. Ersetzt eine Quota pro Nutzer (Entscheidung
// 17.10.2026, docs/ARCHITEKTUR-PLAN.md) - seit 0052 laden nur noch das
// technische Konto und Profilbilder Dateien hoch. Die Zahlen kommen über die
// admin-users Edge Function aus public.speicherbelegung() (0054).

const GRENZE_DATEIEN = 1024 ** 3
const GRENZE_DATENBANK = 500 * 1024 ** 2

const BUCKET_LABEL: Record<string, string> = {
  dokumente: 'Dokumente (Drucksachen)',
  profilbilder: 'Profilbilder',
  zusammenfassungen: 'Notiz-Dateien (Altbestand)',
  presseschauen: 'Presseschauen',
}

interface Zeile {
  bucket: string
  konto: string | null
  name: string
  anzahl: number
  bytes: number
}

interface Belegung {
  datenbank_bytes: number
  dateien: Zeile[]
}

function groesse(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} kB`
  return `${(bytes / 1024 ** 2).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
}

function Balken({ titel, bytes, grenze }: { titel: string; bytes: number; grenze: number }) {
  const anteil = Math.min(1, bytes / grenze)
  const farbe = anteil > 0.8 ? 'bg-red-500' : anteil > 0.6 ? 'bg-amber-500' : 'bg-primary'
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-slate-900">{titel}</span>
        <span className="text-slate-500">
          {groesse(bytes)} von {groesse(grenze)} ({(anteil * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${farbe}`} style={{ width: `${Math.max(anteil * 100, 0.5)}%` }} />
      </div>
    </div>
  )
}

export function SpeicherBelegung() {
  const [belegung, setBelegung] = useState<Belegung | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laedt, setLaedt] = useState(false)

  async function load() {
    setLaedt(true)
    setFehler(null)
    const { data, error } = await supabase.functions.invoke<Belegung>('admin-users', { body: { action: 'speicher' } })
    setLaedt(false)
    if (error || !data) {
      setFehler(error?.message ?? 'Keine Daten erhalten.')
      return
    }
    setBelegung(data)
  }

  useEffect(() => {
    load()
  }, [])

  const dateienGesamt = belegung?.dateien.reduce((s, z) => s + z.bytes, 0) ?? 0
  const buckets = [...new Set(belegung?.dateien.map((z) => z.bucket) ?? [])]

  return (
    <div className="max-w-2xl">
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900">
        Speicher
        <button
          type="button"
          onClick={load}
          disabled={laedt}
          className="rounded-sm p-1 text-slate-400 hover:text-slate-700 disabled:opacity-50"
          title="Neu laden"
        >
          <RefreshCw className={`h-4 w-4 ${laedt ? 'animate-spin' : ''}`} />
        </button>
      </h2>
      <p className="mb-3 text-sm text-slate-500">
        Belegung gegen die Grenzen des kostenlosen Supabase-Tarifs. Mitglieder laden keine Dateien mehr hoch –
        Platz brauchen nur noch die Drucksachen des ALLRIS-Imports und Profilbilder.
      </p>
      {fehler && <p className="mb-3 text-sm text-red-600">Konnte die Belegung nicht laden: {fehler}</p>}
      {belegung && (
        <div className="space-y-3">
          <Balken titel="Dateien" bytes={dateienGesamt} grenze={GRENZE_DATEIEN} />
          <Balken titel="Datenbank" bytes={belegung.datenbank_bytes} grenze={GRENZE_DATENBANK} />
          {buckets.map((bucket) => {
            const zeilen = belegung.dateien.filter((z) => z.bucket === bucket)
            return (
              <div key={bucket} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                <p className="mb-1 text-sm font-medium text-slate-900">{BUCKET_LABEL[bucket] ?? bucket}</p>
                <table className="w-full text-sm">
                  <tbody>
                    {zeilen.map((z) => (
                      <tr key={`${z.bucket}-${z.konto ?? z.name}`} className="border-t border-slate-100 first:border-0">
                        <td className="py-1 text-slate-700">{z.name}</td>
                        <td className="py-1 text-right text-slate-500">
                          {z.anzahl.toLocaleString('de-DE')} {z.anzahl === 1 ? 'Datei' : 'Dateien'}
                        </td>
                        <td className="w-24 py-1 text-right text-slate-700">{groesse(z.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
