import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Vorschau für hochgeladene Dokumente (Bucket "zusammenfassungen", privat -
// daher signierte URL statt öffentlichem Link). Bilder werden inline
// gerendert, PDFs im nativen Browser-PDF-Viewer per iframe; für alle
// anderen Dateitypen (docx, xlsx, ...) gibt es keine Inline-Vorschau im
// Browser, dafür ein "Datei öffnen"-Link. 3600s Gültigkeit statt der
// sonst üblichen 60s bei Downloads, weil das Dokument während des Lesens
// länger geöffnet bleiben kann (gleiche Überlegung wie bei Profilfotos).
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

function fileExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

/** Dateiname aus dem Storage-Pfad ("<user_id>/<dateiname>") extrahieren. */
export function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path
}

export function DocumentPreviewModal({
  path,
  fileName,
  onClose,
}: {
  path: string
  fileName: string
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.storage
      .from('zusammenfassungen')
      .createSignedUrl(path, 3600)
      .then(({ data, error: signError }) => {
        if (signError || !data) {
          setError('Datei konnte nicht geladen werden.')
        } else {
          setUrl(data.signedUrl)
        }
      })
  }, [path])

  const ext = fileExtension(path)
  const isImage = IMAGE_EXTENSIONS.has(ext)
  const isPdf = ext === 'pdf'

  return (
    <div
      className="mc-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="mc-animate-pop flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3">
          <h2 className="truncate text-sm font-medium text-slate-900">{fileName}</h2>
          <div className="flex shrink-0 items-center gap-2">
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="mc-btn-ghost !px-2 !py-1 !text-xs">
                Herunterladen
              </a>
            )}
            <button type="button" onClick={onClose} className="mc-btn-ghost !px-2 !py-1 !text-xs">
              Schließen
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-slate-100">
          {error && <p className="p-6 text-center text-sm text-red-600">{error}</p>}
          {!error && !url && <p className="p-6 text-center text-sm text-slate-400">Lädt...</p>}
          {url && isImage && (
            <div className="flex h-full items-center justify-center p-4">
              <img src={url} alt={fileName} className="max-h-full max-w-full object-contain" />
            </div>
          )}
          {url && isPdf && <iframe src={url} title={fileName} className="h-full w-full border-0" />}
          {url && !isImage && !isPdf && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-slate-500">Für diesen Dateityp gibt es keine Vorschau im Browser.</p>
              <a href={url} target="_blank" rel="noreferrer" className="mc-btn-primary">
                Datei öffnen
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
