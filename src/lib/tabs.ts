import type { KeyboardEvent } from 'react'

/**
 * Pfeiltasten für eine Reiterleiste (role="tablist"): links/rechts, Pos1 und
 * Ende wechseln den Reiter und nehmen den Fokus mit – so erwartet es, wer mit
 * Tastatur oder Screenreader unterwegs ist. Dazu gehört am Reiter selbst
 * `tabIndex={gewählt ? 0 : -1}`, damit Tab die Leiste als Ganzes überspringt.
 */
export function tabTasten(e: KeyboardEvent<HTMLElement>) {
  const tasten = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!tasten.includes(e.key)) return
  const reiter = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')]
  if (reiter.length === 0) return
  const jetzt = reiter.findIndex((r) => r === document.activeElement)
  let ziel = jetzt
  if (e.key === 'ArrowRight') ziel = (jetzt + 1) % reiter.length
  if (e.key === 'ArrowLeft') ziel = (jetzt - 1 + reiter.length) % reiter.length
  if (e.key === 'Home') ziel = 0
  if (e.key === 'End') ziel = reiter.length - 1
  e.preventDefault()
  reiter[ziel].focus()
  reiter[ziel].click()
}
