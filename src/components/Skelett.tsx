import type { ReactNode } from 'react'

/**
 * Ladeplatzhalter in der Form des späteren Inhalts: beim Laden springt nichts,
 * und man sieht sofort, was gleich dasteht. Bewusst wenige feste Formen statt
 * eines Baukastens – Zeilen, Listenzeilen, Karten, Spalten und ein Dokument.
 * Jede Form sagt einem Screenreader einmal „Lädt …" an (role="status"); die
 * grauen Flächen selbst sind aria-hidden. `mc-skelett` (index.css) pulsiert
 * ruhig und steht bei „weniger Bewegung" still.
 */
const BREITEN = [78, 62, 70, 54, 66]

function Rahmen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">Lädt …</span>
      {children}
    </div>
  )
}

function Zeile({ i }: { i: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="mc-skelett h-4" style={{ width: `${BREITEN[i % BREITEN.length]}%` }} />
      <div className="mc-skelett h-3 w-1/3" />
    </div>
  )
}

/** Schlichte Zeilen ohne Rahmen – für Spalten auf „Heute". */
export function Skelett({ zeilen }: { zeilen: number }) {
  return (
    <Rahmen className="flex flex-col gap-4 py-1">
      {Array.from({ length: zeilen }, (_, i) => (
        <Zeile key={i} i={i} />
      ))}
    </Rahmen>
  )
}

/** Zeilen einer Liste in einer Karte, mit Trennlinien (Hub, Kalender-Liste). */
export function SkelettListe({ zeilen }: { zeilen: number }) {
  return (
    <Rahmen>
      {Array.from({ length: zeilen }, (_, i) => (
        <div key={i} className="border-b border-slate-100 px-5 py-4 last:border-b-0">
          <Zeile i={i} />
        </div>
      ))}
    </Rahmen>
  )
}

/** Einzelne Karten untereinander oder im Raster (Archiv, Zahlen & Fakten). */
export function SkelettKarten({ anzahl, className = 'space-y-2' }: { anzahl: number; className?: string }) {
  return (
    <Rahmen className={className}>
      {Array.from({ length: anzahl }, (_, i) => (
        <div key={i} className="mc-card p-4">
          <Zeile i={i} />
        </div>
      ))}
    </Rahmen>
  )
}

/** Vier Board-Spalten mit je ein, zwei Karten. */
export function SkelettBoard() {
  return (
    <Rahmen className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] items-start gap-3.5">
      {[2, 2, 1, 0].map((karten, i) => (
        <div key={i} aria-hidden="true" className="rounded-xl bg-slate-200/50 p-3">
          <div className="mc-skelett mb-3 h-4 w-1/3" />
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: karten }, (_, k) => (
              <div key={k} className="rounded-lg bg-white p-3">
                <div className="mc-skelett h-4" style={{ width: `${BREITEN[(i + k) % BREITEN.length]}%` }} />
                <div className="mc-skelett mt-2 h-3 w-2/5" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </Rahmen>
  )
}

/** Überschrift und Fließtext – für eine Vorlage oder eine Sitzungskarte. */
export function SkelettDokument({ className = '' }: { className?: string }) {
  return (
    <Rahmen className={className}>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="mc-skelett h-7 w-3/5" />
        <div className="mc-skelett h-3 w-1/3" />
        <div className="mt-4 flex flex-col gap-2.5">
          {[96, 92, 97, 88, 94, 60].map((b, i) => (
            <div key={i} className="mc-skelett h-3.5" style={{ width: `${b}%` }} />
          ))}
        </div>
      </div>
    </Rahmen>
  )
}
