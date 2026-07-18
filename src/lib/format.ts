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
