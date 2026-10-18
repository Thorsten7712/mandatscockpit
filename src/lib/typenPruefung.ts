// Prüft beim Build, dass die handgeschriebenen Zeilentypen in types.ts zur
// Datenbank passen (database.types.ts, erzeugt). Die Oberfläche braucht
// engere Typen als die Datenbank liefert ('kommune' | 'kreis' ... statt
// string) - deshalb werden die Typen nicht ersetzt, sondern verglichen:
//
//   - dieselben Spalten: keine fehlt, keine ist erfunden,
//   - kann die Datenbank null liefern, muss der Typ null erlauben,
//   - der Typ ist nicht weiter als die Spalte (string statt number o. Ä.).
//
// Schlägt etwas fehl, nennt der Fehler die Spalte. Nach einer Migration also
// erst database.types.ts neu erzeugen, dann meldet tsc, was in types.ts
// nachzuziehen ist. Diese Datei erzeugt keinen Code.

import type { Tables } from './database.types'
import type * as T from './types'

type Fehlend<Hand, Db> = Exclude<keyof Db, keyof Hand>
type Erfunden<Hand, Db> = Exclude<keyof Hand, keyof Db>
type NullFehlt<Hand, Db> = {
  [K in keyof Db & keyof Hand]: null extends Db[K] ? (null extends Hand[K] ? never : K) : never
}[keyof Db & keyof Hand]
type ZuWeit<Hand, Db> = {
  [K in keyof Db & keyof Hand]: NonNullable<Hand[K]> extends NonNullable<Db[K]> ? never : K
}[keyof Db & keyof Hand]

type Passt<Hand, Db> = [Fehlend<Hand, Db>, Erfunden<Hand, Db>, NullFehlt<Hand, Db>, ZuWeit<Hand, Db>] extends [
  never,
  never,
  never,
  never,
]
  ? true
  : {
      fehlt_in_types_ts: Fehlend<Hand, Db>
      gibt_es_in_der_datenbank_nicht: Erfunden<Hand, Db>
      muss_null_erlauben: NullFehlt<Hand, Db>
      typ_passt_nicht: ZuWeit<Hand, Db>
    }

// Passt ein Typ nicht, ist das Ergebnis kein `true`, und tsc meldet an der
// Stelle, welche Spalten abweichen.
type Pruefe<Ergebnis extends true> = Ergebnis

export type Pruefungen = [
  Pruefe<Passt<T.Profile, Tables<'profiles'>>>,
  Pruefe<Passt<T.PresseschauRow, Tables<'presseschauen'>>>,
  // suchtext ist eine reine Suchspalte der Datenbank (0058), die Oberfläche liest sie nie.
  Pruefe<Passt<T.DokumentRow, Omit<Tables<'dokumente'>, 'suchtext'>>>,
  Pruefe<Passt<T.DokumentGelesen, Tables<'dokument_gelesen'>>>,
  Pruefe<Passt<T.DokumentShareRow, Tables<'dokument_shares'>>>,
  Pruefe<Passt<T.FaktRow, Tables<'fakten'>>>,
  Pruefe<Passt<T.SitzungDokument, Tables<'sitzung_dokumente'>>>,
  Pruefe<Passt<T.CalendarSource, Tables<'calendar_sources'>>>,
  Pruefe<Passt<T.UserSourceSubscription, Tables<'user_source_subscriptions'>>>,
  Pruefe<Passt<T.UserGremium, Tables<'user_gremien'>>>,
  Pruefe<Passt<T.SessionRow, Tables<'sessions'>>>,
  Pruefe<Passt<T.SummaryRow, Tables<'summaries'>>>,
  Pruefe<Passt<T.EventRow, Tables<'events'>>>,
  Pruefe<Passt<T.TodoColumn, Tables<'todo_columns'>>>,
  Pruefe<Passt<T.TodoBoardSettings, Tables<'todo_board_settings'>>>,
  Pruefe<Passt<T.TodoRow, Tables<'todos'>>>,
  Pruefe<Passt<T.TodoPlacement, Tables<'todo_placements'>>>,
  Pruefe<Passt<T.TodoDokument, Tables<'todo_dokumente'>>>,
  Pruefe<Passt<T.McpToken, Tables<'mcp_tokens'>>>,
  Pruefe<Passt<T.KontaktAnfrage, Tables<'kontakt_anfragen'>>>,
]
