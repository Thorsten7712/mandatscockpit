import { supabase } from './supabaseClient'
import type { DokumentRow } from './types'

// Spaltenlisten für dokumente statt select('*'): seit 0058 trägt die Tabelle
// die generierte Spalte suchtext - eine zweite Kopie des ganzen Textes, die
// nur der Datenbank zum Suchen dient. Mit '*' käme sie bei jeder Abfrage mit.

/** Alles, was die Oberfläche braucht, einschließlich des vollen Textes. */
export const DOKUMENT_SPALTEN =
  'id, user_id, parent_id, titel, sichtbarkeit, ebene, gliederung, tags, inhalt, datei_url, archiviert_am, erstellt_am, vorschau'

/** Für Listen: ohne den vollen Text, mit der Vorschau. */
export const DOKUMENT_LISTEN_SPALTEN =
  'id, user_id, parent_id, titel, sichtbarkeit, ebene, gliederung, tags, datei_url, archiviert_am, erstellt_am, vorschau'

/** Lädt ein Dokument vollständig, z. B. bevor eine Liste es im Detail öffnet. */
export async function ladeDokument(id: string): Promise<DokumentRow | null> {
  const { data } = await supabase.from('dokumente').select(DOKUMENT_SPALTEN).eq('id', id).maybeSingle()
  return (data as DokumentRow | null) ?? null
}

/**
 * Ids der Dokumente, deren Titel, Tags oder Text den Suchbegriff enthalten -
 * in der Datenbank (Trigramm-Index auf suchtext, 0058) statt im Browser.
 * Gleiche Teilwort-Semantik wie vorher: Kleinschreibung, Weißraum-Folgen als
 * ein Leerzeichen. % und _ werden maskiert, sonst wären sie Platzhalter.
 */
export async function sucheDokumente(begriff: string): Promise<{ ids: Set<string>; fehler: string | null }> {
  const normal = begriff.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normal) return { ids: new Set(), fehler: null }
  const maskiert = normal.replace(/[\\%_]/g, (z) => `\\${z}`)
  const ids = new Set<string>()
  // Seitenweise wie alleZeilen(): ein häufiges Wort trifft leicht mehr als
  // 1.000 Dokumente.
  for (let von = 0; ; von += 1000) {
    const { data, error } = await supabase
      .from('dokumente')
      .select('id')
      .is('parent_id', null)
      .ilike('suchtext', `%${maskiert}%`)
      .order('id')
      .range(von, von + 999)
    if (error) return { ids, fehler: error.message }
    for (const z of data ?? []) ids.add(z.id as string)
    if (!data || data.length < 1000) return { ids, fehler: null }
  }
}
