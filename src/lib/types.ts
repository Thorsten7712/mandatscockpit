// Typen spiegeln 1:1 das Datenmodell aus docs/KONZEPT.md (Abschnitt 7) und
// die Tabellen aus supabase/migrations/0001_init.sql.

export type Rolle = 'mitglied' | 'fraktionsbuero' | 'admin'
export type Ebene = 'kommune' | 'kreis' | 'land' | 'bund'
export type EventHerkunft = 'privat' | 'uebernommene_sitzung' | 'fraktionsbuero'
export type SessionStatus = 'geplant' | 'aktiv' | 'abgeschlossen'
export type Sichtbarkeit = 'privat' | 'geteilt'

export interface Profile {
  id: string
  name: string
  rolle: Rolle
  fraktion: string | null
}

export interface CalendarSource {
  id: string
  name: string
  ebene: Ebene
  ics_url: string
  verwaltet_von: string | null
}

export interface UserSourceSubscription {
  user_id: string
  source_id: string
  gremium_filter: string | null
}

export interface UserGremium {
  user_id: string
  gremium: string
}

export interface SessionRow {
  id: string
  source_id: string | null
  titel: string
  gremium: string | null
  ebene: Ebene | null
  datum: string
  ort: string | null
  quelle_url: string | null
  status: SessionStatus
}

export interface DocumentRow {
  id: string
  titel: string
  quelle_url: string | null
  ausschuss: string | null
  session_id: string | null
  tags: string[] | null
}

export interface SummaryRow {
  id: string
  user_id: string
  document_id: string | null
  session_id: string | null
  inhalt: string | null
  datei_url: string | null
  sichtbarkeit: Sichtbarkeit
  erstellt_am: string
}

export interface EventRow {
  id: string
  user_id: string
  titel: string
  start: string
  ende: string | null
  ort: string | null
  herkunft: EventHerkunft
  erstellt_von: string
}

export interface TodoColumn {
  id: string
  user_id: string
  titel: string
  reihenfolge: number
}

export interface TodoRow {
  id: string
  user_id: string
  column_id: string
  position: number
  titel: string
  faellig_am: string | null
  dokument_id: string | null
  session_id: string | null
}
