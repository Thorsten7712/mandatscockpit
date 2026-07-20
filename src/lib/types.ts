// Typen spiegeln 1:1 das Datenmodell aus docs/KONZEPT.md (Abschnitt 7) und
// die Tabellen aus supabase/migrations/0001_init.sql.

export type Rolle = 'mitglied' | 'fraktionsbuero' | 'admin'
export type Ebene = 'kommune' | 'kreis' | 'land' | 'bund'
export type EventHerkunft = 'privat' | 'uebernommene_sitzung' | 'fraktionsbuero'
export type SessionStatus = 'geplant' | 'aktiv' | 'abgeschlossen' | 'abgesagt'
export type EventStatus = 'geplant' | 'abgesagt'
export type Sichtbarkeit = 'privat' | 'geteilt'
export type AntragStatus = 'entwurf' | 'gestellt' | 'in_beratung' | 'vertagt' | 'abgestimmt' | 'zurueckgezogen'
export type AntragErgebnis = 'positiv' | 'negativ'

export interface Profile {
  id: string
  name: string
  rolle: Rolle
  fraktion: string | null
  foto_url: string | null
  /** Theme-Id aus src/lib/themes.ts (cdu/spd/fdp/...), null = neutral */
  partei: string | null
  /** Eigene Mandate/Ebenen, selbst gepflegt in Settings (mehrere gleichzeitig möglich) */
  ebenen: Ebene[]
}

export interface CalendarSource {
  id: string
  name: string
  ebene: Ebene
  ics_url: string
  verwaltet_von: string | null
  /** Token-Id aus src/lib/sourceColors.ts, null = Theme-Primärfarbe */
  farbe: string | null
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
  event_id: string | null
  todo_id: string | null
  antrag_id: string | null
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
  status: EventStatus
  herkunft: EventHerkunft
  erstellt_von: string
}

export interface TodoColumn {
  id: string
  user_id: string
  titel: string
  reihenfolge: number
}

export interface TodoBoardSettings {
  user_id: string
  zeige_termin: boolean
  zeige_zustaendig: boolean
}

export interface TodoRow {
  id: string
  user_id: string
  titel: string
  beschreibung: string | null
  zustaendig: string | null
  faellig_am: string | null
  dokument_id: string | null
  session_id: string | null
  event_id: string | null
  erledigt: boolean
  erledigt_am: string | null
  /** Ebene, für die diese Karte ggf. geteilt wurde (vom Ersteller gewählt) */
  ebene: Ebene | null
  created_at: string
}

/** Board-Platzierung einer Karte für eine bestimmte Person - je Karte+Nutzer
 * eine Zeile, damit geteilte Karten auf mehreren Boards unterschiedlich
 * einsortiert sein können. */
export interface TodoPlacement {
  id: string
  todo_id: string
  user_id: string
  column_id: string
  position: number
}

export interface TodoComment {
  id: string
  todo_id: string
  user_id: string
  inhalt: string
  erstellt_am: string
}

export interface McpToken {
  user_id: string
  token_hash: string
  created_at: string
}

export interface AntragRow {
  id: string
  user_id: string
  titel: string
  inhalt: string | null
  status: AntragStatus
  ergebnis: AntragErgebnis | null
  ausschuss: string | null
  /** Dient dem Fristen-Nachschlag UND dem Teilen-Kandidatenfilter (analog todos.ebene) */
  ebene: Ebene | null
  session_id: string | null
  eingereicht_am: string | null
  created_at: string
}

export interface AntragComment {
  id: string
  antrag_id: string
  user_id: string
  inhalt: string
  erstellt_am: string
}

/** Teilen-Freigabe eines Antrags mit einer Kollegin/einem Kollegen (analog TodoPlacement, ohne Board-Position) */
export interface AntragShare {
  id: string
  antrag_id: string
  user_id: string
}

export interface AntragDeadlineSetting {
  user_id: string
  ebene: Ebene
  tage_vor_sitzung: number
}
