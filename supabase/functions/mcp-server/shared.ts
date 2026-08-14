// Gemeinsame Helper für alle Tool-Module: JSON-RPC-Hilfsfunktionen, Auth
// (Token-Hash-Lookup), sowie Format-/Pagination-Helfer, die von mehr als
// einem Tool gebraucht werden. Reine Umstrukturierung (Aufteilung von
// index.ts in Module, siehe docs/CHANGELOG.md) - keine Verhaltensänderung.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
}

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

export function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

export function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function toolTextResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

// Gleicher Algorithmus wie client-seitig in Settings.tsx (sha256Hex) - muss
// identisch bleiben, sonst schlägt der Token-Lookup fehl.
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface ResolvedUser {
  id: string
  name: string | null
}

export async function resolveUser(supabase: SupabaseClient, bearerToken: string): Promise<ResolvedUser | null> {
  const tokenHash = await sha256Hex(bearerToken)
  const { data: tokenRow } = await supabase
    .from('mcp_tokens')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!tokenRow) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', tokenRow.user_id)
    .maybeSingle()
  return { id: tokenRow.user_id as string, name: profile?.name ?? null }
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `faellig_am`/`eingereicht_am` sind reine Datumsfelder (date, kein timestamptz) - hier
 *  ohne Uhrzeit und ohne Zeitzonen-Umrechnung formatieren, sonst kippt das Datum je nach
 *  Zeitzone. */
export function formatDate(isoDate: string): string {
  const [jahr, monat, tag] = isoDate.split('-')
  return tag && monat && jahr ? `${tag}.${monat}.${jahr}` : isoDate
}

/** Storage-Pfade sind `<user_id>/<timestamp>-<dateiname>` - für die Anzeige nur den Dateinamen. */
export function fileNameFromPath(path: string): string {
  return path.split('/').pop() ?? path
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  txt: 'text/plain;charset=UTF-8',
  md: 'text/markdown;charset=UTF-8',
  csv: 'text/csv;charset=UTF-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
}

/** Bugfix (siehe docs/CHANGELOG.md): `supabase.storage.upload()` ohne
 *  explizite `contentType`-Option speichert Base64-dekodierte Bytes
 *  (Uint8Array statt eines echten Browser-File-Objekts mit eigenem `.type`)
 *  standardmäßig als `text/plain;charset=UTF-8` ab - der Browser rendert
 *  PDFs mit diesem Content-Type nicht im `<iframe>`-Vorschau-Modal
 *  (DocumentPreviewModal.tsx), sondern bietet nur einen Download an. Beide
 *  MCP-Upload-Pfade (createNote() in notes.ts, finishFileUpload() in
 *  uploads.ts) müssen deshalb den Content-Type explizit anhand der
 *  Dateiendung setzen, wie es ein echtes File-Objekt aus der Web-UI
 *  automatisch tut. */
export function guessContentType(dateiname: string): string {
  const ext = dateiname.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

export interface Base64UploadResult {
  path?: string
  error?: string
}

/** Dekodiert einen Base64-String und lädt ihn unter `<userId>/<Date.now()>-<dateiname>`
 *  in den angegebenen Bucket hoch, mit korrektem Content-Type (siehe guessContentType()).
 *  Gemeinsam genutzt von createNote() (notes.ts, Bucket "zusammenfassungen") und
 *  createDocument() (tools/dokumente.ts, Bucket "dokumente") - vorher war diese Logik
 *  nur in createNote() inline vorhanden. */
export async function uploadBase64File(
  supabase: SupabaseClient,
  bucket: string,
  userId: string,
  dateiname: string,
  base64: string,
): Promise<Base64UploadResult> {
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  } catch {
    return { error: 'datei_base64 ist kein gültiges Base64.' }
  }
  const path = `${userId}/${Date.now()}-${dateiname}`
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: guessContentType(dateiname) })
  if (error) return { error: `Fehler beim Hochladen der Datei: ${error.message}` }
  return { path }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [gekürzt, ${text.length} Zeichen gesamt]`
}

export function parseLimit(value: unknown): number {
  const n = typeof value === 'number' ? Math.floor(value) : 20
  return Math.min(Math.max(Number.isFinite(n) ? n : 20, 1), 100)
}

export type Zeitraum = 'zukunft' | 'vergangenheit' | 'alle'

export function parseZeitraum(value: unknown): Zeitraum {
  return value === 'vergangenheit' || value === 'alle' ? value : 'zukunft'
}

/** Nur "zukunft" sortiert aufsteigend (nächster Termin zuerst); Vergangenheit und
 *  "alle" absteigend, damit das Limit die jüngsten Einträge behält statt der ältesten. */
export function sortAscending(zeitraum: Zeitraum): boolean {
  return zeitraum === 'zukunft'
}

export function zeitraumLabel(zeitraum: Zeitraum): string {
  if (zeitraum === 'vergangenheit') return 'vergangene'
  if (zeitraum === 'alle') return ''
  return 'zukünftige'
}
