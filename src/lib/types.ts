// Typen spiegeln 1:1 das Datenmodell aus docs/KONZEPT.md (Abschnitt 7) und
// die Tabellen aus supabase/migrations/0001_init.sql.

export type Rolle = 'mitglied' | 'fraktionsbuero' | 'admin'
export type Ebene = 'kommune' | 'kreis' | 'land' | 'bund'
export type EventHerkunft = 'privat' | 'uebernommene_sitzung' | 'fraktionsbuero'
export type SessionStatus = 'geplant' | 'aktiv' | 'abgeschlossen' | 'abgesagt'
export type EventStatus = 'geplant' | 'abgesagt'
export type Sichtbarkeit = 'privat' | 'geteilt'
/** 'sitzung' = Sitzungs-/Gremienkalender (gremienweise Auswahl via user_gremien), 'termin' = reiner Terminkalender (alle Einträge werden ungefiltert übernommen) */
export type CalendarSourceArt = 'sitzung' | 'termin'

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
  /** Welche Kommune/welcher Kreis/welches Land konkret (Bund braucht keine Angabe) - siehe src/lib/gliederung.ts */
  gliederung_kommune: string | null
  gliederung_kreis: string | null
  gliederung_land: string | null
  /** true = admin-vergebenes Passwort noch nicht selbst geändert (siehe ForcedPasswordChange.tsx) */
  muss_passwort_aendern: boolean
  /** Presseschau-Abschnitt auf dem Dashboard ein-/ausgeblendet (siehe PresseschauSection.tsx) */
  presseschau_aktiv: boolean
  /** Kein Mensch, sondern ein Automatik-Konto (z. B. der ALLRIS-Import von
   * dailyallris). Wird aus den Teilen-Kandidatenlisten ausgeblendet, behält
   * sonst aber alle Rechte eines Mitglieds - siehe 0041_profiles_technisch.sql. */
  technisch: boolean
  created_at: string
}

export interface PresseschauRow {
  id: string
  user_id: string
  datum: string
  titel: string | null
  quelle: string | null
  inhalt: string
  erstellt_am: string
}

export type DokumentSichtbarkeit = 'persoenlich' | 'geteilt' | 'einzelpersonen'

export interface DokumentRow {
  id: string
  user_id: string
  /** null = Top-Level-Dokument (z. B. Sitzungsvorlage), gesetzt = angehängte Notiz/Analyse (siehe DokumentDetailModal.tsx) */
  parent_id: string | null
  titel: string
  sichtbarkeit: DokumentSichtbarkeit
  /** nur bei sichtbarkeit='geteilt' gesetzt (bei Kindern vom Elternteil übernommen) */
  ebene: Ebene | null
  /** nur bei sichtbarkeit='geteilt' und ebene != 'bund' gesetzt, server-seitig/vom Elternteil übernommen */
  gliederung: string | null
  tags: string[]
  inhalt: string | null
  datei_url: string | null
  /** Manuell ins Archiv gelegt (0038_dokumente_archiv.sql). Die automatische
   * Archivierung über eine vergangene verknüpfte Sitzung steht NICHT hier
   * drin, sondern wird beim Anzeigen abgeleitet - siehe src/lib/dokumenteArchiv.ts. */
  archiviert_am: string | null
  erstellt_am: string
  /** Zwei Zeilen reiner Text für Listen, beim Schreiben berechnet (0058). */
  vorschau: string | null
}

/** Ein Dokument, wie es Listen laden: ohne den vollen Text (rund 5 KB je
 *  Drucksache). Zum Öffnen erst ladeDokument() aus src/lib/dokumentSpalten.ts. */
export type DokumentListenZeile = Omit<DokumentRow, 'inhalt'>

/** Individuelle Gelesen-Markierung pro Nutzer, immer auf ein Top-Level-Dokument
 * bezogen (siehe src/lib/dokumenteGelesen.ts für die Ungelesen-Berechnung). */
export interface DokumentGelesen {
  dokument_id: string
  user_id: string
  gelesen_am: string
}

/** sichtbarkeit='einzelpersonen': mit wem ein Dokument/eine Notiz konkret geteilt wurde. */
export interface DokumentShareRow {
  id: string
  dokument_id: string
  user_id: string
}

/** Kategorien der "Zahlen und Fakten"-Seite (0039_fakten.sql). 'zahl' ist die
 * einzige Kategorie, die kennzahl/einheit nutzt - die beiden anderen sind
 * reine Textbausteine. */
export type FaktKategorie = 'argumentationshilfe' | 'sprachregelung' | 'zahl'

export interface FaktRow {
  id: string
  user_id: string
  kategorie: FaktKategorie
  titel: string
  inhalt: string | null
  /** Nur bei kategorie='zahl': herausgestellter Wert ("12,5", "rund 1.200") - bewusst
   * Text, weil Kennzahlen aus Veröffentlichungen Näherungen und Spannen enthalten. */
  kennzahl: string | null
  einheit: string | null
  /** Belegangaben - entscheiden darüber, ob der Fakt zitierfähig ist. */
  quelle: string | null
  stand: string | null
  tags: string[]
  /** Immer 'geteilt' (0040_fakten_immer_geteilt.sql): Fakten stehen grundsätzlich
   * allen auf der jeweiligen Ebene zur Verfügung, es gibt keine privaten Fakten.
   * Die Spalte bleibt, weil die RLS-Policy fakten_select_shared sie liest. */
  sichtbarkeit: 'geteilt'
  /** Pflichtfeld - ohne Ebene kann die RLS-Policy nicht entscheiden, für wen der Fakt gilt. */
  ebene: Ebene
  /** null nur bei ebene='bund' (es gibt nur einen Bundestag), sonst aus dem Profil übernommen. */
  gliederung: string | null
  erstellt_am: string
  geaendert_am: string
}

/** n:m-Verknüpfung zwischen Sitzungen und Dokumenten (0042_sitzung_dokumente.sql).
 * Ersetzt die frühere Spalte dokumente.session_id: eine Vorlage durchläuft
 * typischerweise mehrere Gremien (Fachausschuss, dann Rat). */
export interface SitzungDokument {
  id: string
  session_id: string
  /** null = Tagesordnungspunkt ohne Drucksache ("Eröffnung der Sitzung",
   * "Einwohnerfragestunde"). Rund ein Viertel der Punkte einer Ratssitzung
   * hat keine Vorlage (0044_tagesordnungspunkte.sql). */
  dokument_id: string | null
  /** Tagesordnungspunkt, unter dem das Dokument in DIESER Sitzung läuft
   * (0043_sitzung_dokumente_top.sql). Dasselbe Dokument kann in einer anderen
   * Sitzung unter einer anderen Nummer stehen. Text wegen mehrstufiger
   * Nummerierung ("3.1", "N 4.2"). */
  top_nummer: string | null
  /** Wortlaut des TOP, falls er vom Dokumenttitel abweicht. */
  top_titel: string | null
  /** Position auf der Tagesordnung - top_nummer sortiert als Text falsch. */
  reihenfolge: number | null
  /** Beratungsergebnis aus der Spalte "Zuständigkeit" der ALLRIS-Tagesordnung
   * ("ungeändert beschlossen", "abgelehnt", ...). Freitext, die Wertemenge
   * gehört ALLRIS (0044_tagesordnungspunkte.sql). */
  ergebnis: string | null
  erstellt_am: string
}

/** Ein Eintrag der Tagesordnung für die linke Spalte des Lesers. */
export interface TagesordnungsEintrag {
  /** null = Punkt ohne Drucksache; im Leser nicht anklickbar. */
  dokument_id: string | null
  top_nummer: string | null
  top_titel: string | null
  reihenfolge: number | null
  ergebnis: string | null
  /** Titel des verknüpften Dokuments, leer bei Punkten ohne Drucksache. */
  titel: string
}

export interface CalendarSource {
  id: string
  name: string
  ebene: Ebene
  ics_url: string
  verwaltet_von: string | null
  /** Token-Id aus src/lib/sourceColors.ts, null = Theme-Primärfarbe */
  farbe: string | null
  art: CalendarSourceArt
  created_at: string
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
  /** ALLRIS-Sitzungskennung aus dem ICS-Feed ("ALLRIS-Sitzung-<SILFDNR>"), null bei nachgetragenen Sitzungen. */
  ics_uid: string | null
  /** Nur bei manuell nachgetragenen Sitzungen gesetzt (nicht via ICS-Import) - bestimmt Bearbeiten/Löschen-Rechte. */
  erstellt_von: string | null
}

/** Notiz an einer ToDo-Karte - seit 0060 nur noch Text an genau einer Karte. */
export interface SummaryRow {
  id: string
  user_id: string
  todo_id: string
  inhalt: string
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
  created_at: string
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
  /** Zuständige Person (0056) - hat die Karte immer auf ihrem Board oder hat sie angelegt. */
  zustaendig_user_id: string | null
  /** Seit wann die Person zuständig ist (0057, für die Neuigkeiten). */
  zustaendig_seit: string | null
  faellig_am: string | null
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
  /** Seit wann die Karte auf diesem Board liegt (0057). */
  erstellt_am: string
}

/** n:m-Verknüpfung zwischen ToDo-Karten und Dokumenten-Hub-Dokumenten
 * (0037_todo_dokumente.sql) - anders als die 1:n-session_id-Spalten kann
 * eine Karte mehrere Dokumente und ein Dokument mehrere Karten haben. */
export interface TodoDokument {
  id: string
  todo_id: string
  dokument_id: string
  erstellt_am: string
}

export interface McpToken {
  user_id: string
  token_hash: string
  created_at: string
}

/** Eingang über das Kontaktformular auf der öffentlichen Impressum-Seite. */
export interface KontaktAnfrage {
  id: string
  name: string
  email: string
  nachricht: string
  gelesen: boolean
  erstellt_am: string
}
