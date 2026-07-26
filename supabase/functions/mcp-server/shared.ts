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
