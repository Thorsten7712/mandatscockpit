import { useEffect } from 'react'

// Pflichtschritte nach dem Login (Passwortwechsel, Nutzungserklärung) blenden
// den Hinweis aus, solange sie offen sind - sonst läge er über deren Knöpfen.
let unterdrueckt = 0
const zuhoerer = new Set<() => void>()
function melden() {
  zuhoerer.forEach((f) => f())
}
export function speicherHinweisAbonnieren(f: () => void) {
  zuhoerer.add(f)
  return () => zuhoerer.delete(f)
}

/** Solange die aufrufende Komponente angezeigt wird, bleibt der Hinweis verborgen. */
export function useSpeicherHinweisAusblenden() {
  useEffect(() => {
    unterdrueckt += 1
    melden()
    return () => {
      unterdrueckt -= 1
      melden()
    }
  }, [])
}

export function speicherHinweisUnterdrueckt() {
  return unterdrueckt > 0
}
