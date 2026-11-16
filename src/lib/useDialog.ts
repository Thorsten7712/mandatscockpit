import { useEffect, useRef } from 'react'

const FOKUSSIERBAR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Offene Fenster in Reihenfolge: nur das oberste reagiert auf Escape und hält
// den Fokus (Löschdialog über einem Detail-Fenster).
const stapel: symbol[] = []

/**
 * Tastatur-Verhalten für ein Fenster über der Seite: Escape schließt, Tab
 * bleibt im Fenster, beim Öffnen wandert der Fokus hinein und beim Schließen
 * zurück dorthin, wo er vorher stand. Das zurückgegebene ref gehört an das
 * Fenster selbst (nicht ans Overlay), zusammen mit role="dialog",
 * aria-modal="true" und tabIndex={-1}.
 *
 * `aktiv = false` schaltet alles ab - für Komponenten, die wahlweise als
 * Fenster oder eingebettet in eine Seite erscheinen.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(onClose: () => void, aktiv = true) {
  const ref = useRef<T>(null)
  const schliessen = useRef(onClose)
  useEffect(() => {
    schliessen.current = onClose
  })

  useEffect(() => {
    if (!aktiv) return
    const id = Symbol('dialog')
    stapel.push(id)
    const vorher = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fenster = ref.current
    // Nur hineinspringen, wenn der Fokus nicht schon drin steht (autoFocus).
    if (fenster && !fenster.contains(document.activeElement)) fenster.focus({ preventScroll: true })

    function beiTaste(e: KeyboardEvent) {
      if (stapel[stapel.length - 1] !== id) return
      const el = ref.current
      if (!el) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        schliessen.current()
        return
      }
      if (e.key !== 'Tab') return
      const ziele = [...el.querySelectorAll<HTMLElement>(FOKUSSIERBAR)].filter((z) => z.offsetParent !== null)
      if (ziele.length === 0) {
        e.preventDefault()
        el.focus()
        return
      }
      const erstes = ziele[0]
      const letztes = ziele[ziele.length - 1]
      const jetzt = document.activeElement
      if (!el.contains(jetzt)) {
        e.preventDefault()
        erstes.focus()
      } else if (e.shiftKey && (jetzt === erstes || jetzt === el)) {
        e.preventDefault()
        letztes.focus()
      } else if (!e.shiftKey && jetzt === letztes) {
        e.preventDefault()
        erstes.focus()
      }
    }
    document.addEventListener('keydown', beiTaste)
    return () => {
      document.removeEventListener('keydown', beiTaste)
      const i = stapel.indexOf(id)
      if (i >= 0) stapel.splice(i, 1)
      if (vorher && document.contains(vorher)) vorher.focus({ preventScroll: true })
    }
  }, [aktiv])

  return ref
}
