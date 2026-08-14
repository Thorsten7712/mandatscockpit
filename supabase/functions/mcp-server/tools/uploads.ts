import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { toolTextResult, uploadBase64File } from '../shared.ts'

/** "notiz" (Standard) = Anhang an Sitzung/Termin/ToDo/Antrag (Bucket
 *  "zusammenfassungen"), "dokument" = Eintrag im Dokumenten-Hub (Bucket
 *  "dokumente", siehe tools/dokumente.ts). Ein Parameter statt einer zweiten,
 *  fast identischen Upload-Tool-Trias. */
const BUCKET_BY_ZIEL: Record<string, string> = {
  notiz: 'zusammenfassungen',
  dokument: 'dokumente',
}

// Größere Dateien (z. B. PDFs) lassen sich nicht in einem einzigen
// create_*_note-Aufruf übertragen, weil der Base64-Tool-Aufruf-Text beim
// aufrufenden MCP-Client irgendwo zwischen ca. 18.000 und 20.000 Zeichen
// abgeschnitten wird (Nutzer-Feedback, siehe docs/CHANGELOG.md) - eine
// Grenze der Tool-Aufruf-Generierung selbst, nicht dieses Servers. Diese drei
// Tools übertragen eine Datei stattdessen in mehreren kleinen Häppchen über
// mehrere Aufrufe, serverseitig zwischengespeichert in mcp_uploads/
// mcp_upload_chunks, und liefern am Ende einen datei_pfad, der bei den
// create_*_note-Tools als Alternative zu dateiname+datei_base64 übergeben
// werden kann (siehe createNote() in notes.ts).

const STALE_UPLOAD_MS = 60 * 60 * 1000

export async function startFileUpload(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const dateiname = typeof args.dateiname === 'string' ? args.dateiname.trim() : ''
  if (!dateiname) return toolTextResult('Fehler: dateiname ist erforderlich.', true)

  // Alte, nie abgeschlossene Uploads dieses Nutzers aufräumen (z. B. nach
  // einem abgebrochenen Übertragungsversuch) - sonst würden liegen
  // gelassene Häppchen unbegrenzt anwachsen, da es keinen separaten
  // Cleanup-Job dafür gibt.
  const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString()
  await supabase.from('mcp_uploads').delete().eq('user_id', userId).lt('erstellt_am', cutoff)

  const { data, error } = await supabase
    .from('mcp_uploads')
    .insert({ user_id: userId, dateiname })
    .select('id')
    .single()
  if (error || !data) return toolTextResult(`Fehler beim Starten des Uploads: ${error?.message}`, true)

  return toolTextResult(
    `Upload gestartet (upload_id: ${data.id}). Jetzt den Base64-Inhalt der Datei "${dateiname}" in Teilstücken von jeweils höchstens ca. 8000 Zeichen per append_file_chunk übertragen (chunk_index lückenlos ab 0 aufsteigend), danach finish_file_upload mit derselben upload_id aufrufen.`,
  )
}

export async function appendFileChunk(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const uploadId = typeof args.upload_id === 'string' ? args.upload_id.trim() : ''
  const chunkIndex = typeof args.chunk_index === 'number' ? args.chunk_index : NaN
  const chunkBase64 = typeof args.chunk_base64 === 'string' ? args.chunk_base64 : ''

  if (!uploadId) return toolTextResult('Fehler: upload_id ist erforderlich.', true)
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return toolTextResult('Fehler: chunk_index muss eine nicht-negative Ganzzahl sein.', true)
  }
  if (!chunkBase64) return toolTextResult('Fehler: chunk_base64 ist erforderlich.', true)

  const { data: upload } = await supabase
    .from('mcp_uploads')
    .select('id')
    .eq('id', uploadId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!upload) {
    return toolTextResult(
      `Upload ${uploadId} wurde nicht gefunden (falsche upload_id, oder der Upload ist älter als 1 Stunde und wurde automatisch aufgeräumt - mit start_file_upload neu beginnen).`,
      true,
    )
  }

  const { error } = await supabase
    .from('mcp_upload_chunks')
    .upsert({ upload_id: uploadId, chunk_index: chunkIndex, chunk_base64: chunkBase64 })
  if (error) return toolTextResult(`Fehler beim Speichern des Teilstücks: ${error.message}`, true)

  return toolTextResult(`Teilstück ${chunkIndex} gespeichert (${chunkBase64.length} Zeichen).`)
}

export async function finishFileUpload(supabase: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const uploadId = typeof args.upload_id === 'string' ? args.upload_id.trim() : ''
  if (!uploadId) return toolTextResult('Fehler: upload_id ist erforderlich.', true)

  const ziel = typeof args.ziel === 'string' && args.ziel.trim() ? args.ziel.trim() : 'notiz'
  const bucket = BUCKET_BY_ZIEL[ziel]
  if (!bucket) return toolTextResult(`Fehler: ziel muss "notiz" oder "dokument" sein (war "${ziel}").`, true)

  const { data: upload } = await supabase
    .from('mcp_uploads')
    .select('id, dateiname')
    .eq('id', uploadId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!upload) return toolTextResult(`Upload ${uploadId} wurde nicht gefunden.`, true)

  const { data: chunks, error: chunksError } = await supabase
    .from('mcp_upload_chunks')
    .select('chunk_index, chunk_base64')
    .eq('upload_id', uploadId)
    .order('chunk_index')
  if (chunksError) return toolTextResult(`Fehler beim Laden der Teilstücke: ${chunksError.message}`, true)
  if (!chunks || chunks.length === 0) {
    return toolTextResult('Fehler: keine Teilstücke für diesen Upload gefunden - erst append_file_chunk aufrufen.', true)
  }

  // Lückenlose Nummerierung 0..n-1 erzwingen - ein fehlendes Teilstück würde
  // sonst eine unbemerkt kaputte Datei zusammensetzen.
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].chunk_index !== i) {
      return toolTextResult(
        `Fehler: Teilstück ${i} fehlt (${chunks.length} vorhanden, aber nicht lückenlos ab 0 nummeriert).`,
        true,
      )
    }
  }

  const fullBase64 = chunks.map((c) => c.chunk_base64 as string).join('')
  const uploaded = await uploadBase64File(supabase, bucket, userId, upload.dateiname, fullBase64)
  if (uploaded.error) return toolTextResult(uploaded.error, true)

  // Löscht per on-delete-cascade auch die zugehörigen mcp_upload_chunks-Zeilen.
  await supabase.from('mcp_uploads').delete().eq('id', uploadId)

  const naechsterSchritt =
    ziel === 'dokument'
      ? 'create_document'
      : 'create_session_note/create_event_note/create_todo_note/create_antrag_note'
  return toolTextResult(
    `Datei "${upload.dateiname}" wurde vollständig hochgeladen. Jetzt datei_pfad="${uploaded.path}" bei ${naechsterSchritt} angeben.`,
  )
}
