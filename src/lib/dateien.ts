// Helfer rund um Storage-Pfade hochgeladener Dateien. Eigene Datei statt in
// DocumentPreviewModal.tsx, weil React Fast Refresh nur Dateien hot-reloaden
// kann, die ausschließlich Komponenten exportieren.

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

export function fileExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

/** Dateiname aus dem Storage-Pfad ("<user_id>/<dateiname>") extrahieren.
 * Uploads werden als "<Date.now()>-<originalname>" gespeichert, um
 * Namenskollisionen im Bucket zu vermeiden (siehe z. B. handleUploadDocument
 * in TodoDetailModal.tsx/AntragDetailModal.tsx) - dieser Zeitstempel-Präfix
 * ist für Anzeigezwecke reines Rauschen und wird hier ausgeblendet, ohne den
 * tatsächlichen Storage-Pfad (und damit bestehende datei_url-Referenzen) zu
 * verändern. */
export function fileNameFromPath(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/^\d+-/, '')
}
