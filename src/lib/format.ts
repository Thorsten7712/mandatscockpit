// Datums-/Zeitformatierung: bewusst ohne Sekunden ("18.07.2026, 12:30" statt
// "18.7.2026, 12:30:00" wie bei toLocaleString-Default) - Sekunden sind bei
// Sitzungs-/Terminzeiten reines Rauschen.

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

/** Für Datums-Chips in Listen: Tag ("10") und Kurzmonat ("Sep."). */
export function formatDayMonth(iso: string): { day: string; month: string } {
  const d = new Date(iso)
  return {
    day: d.toLocaleDateString('de-DE', { day: '2-digit' }),
    month: d.toLocaleDateString('de-DE', { month: 'short' }),
  }
}
