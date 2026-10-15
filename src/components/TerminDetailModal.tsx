import { TerminDetailPanel } from './TerminDetailPanel'

/**
 * Einstiegspunkt für die Detailansicht eines Termins oder einer Sitzung als
 * Modal. Das Chrome (Overlay, Kopfzeile, Schließen) liegt in
 * TerminDetailPanel selbst, weil nur die Komponente weiß, ob sie überhaupt
 * eines braucht: Eine Sitzung mit Tagesordnung geht direkt im Leser auf, der
 * sein eigenes Overlay mitbringt - ein zweites darunter wäre genau die alte
 * Listenansicht, die dort nicht mehr auftauchen soll.
 */
export function TerminDetailModal({
  kind,
  id,
  onClose,
  onDeleted,
}: {
  kind: 'event' | 'session'
  id: string
  onClose: () => void
  onDeleted?: () => void
}) {
  return (
    <TerminDetailPanel
      kind={kind}
      id={id}
      layout="modal"
      onCloseAll={onClose}
      onDeleted={() => {
        onDeleted?.()
        onClose()
      }}
    />
  )
}
