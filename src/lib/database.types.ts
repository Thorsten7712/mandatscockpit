// Aus der Datenbank erzeugt (Supabase, `supabase gen types typescript` bzw.
// generate_typescript_types über den Connector) - nicht von Hand bearbeiten,
// sondern nach einer Migration neu erzeugen. Stand: 0059.
//
// Gekürzt auf die Zeilen- und Schreibtypen der Tabellen; die Hilfstypen
// (Tables<>, TablesInsert<> ...) der Vorlage stehen unten in vereinfachter
// Form. src/lib/types.ts leitet die Zeilentypen der Oberfläche hiervon ab.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      antraege: {
        Row: {
          ausschuss: string | null
          created_at: string
          ebene: string | null
          eingereicht_am: string | null
          ergebnis: string | null
          id: string
          inhalt: string | null
          session_id: string | null
          status: string
          titel: string
          user_id: string
        }
      }
      antrag_deadline_settings: {
        Row: { ebene: string; tage_vor_sitzung: number; user_id: string }
      }
      antrag_shares: {
        Row: { antrag_id: string; id: string; user_id: string }
      }
      calendar_sources: {
        Row: {
          art: string
          created_at: string
          ebene: string
          farbe: string | null
          ics_url: string
          id: string
          name: string
          verwaltet_von: string | null
        }
      }
      documents: {
        Row: {
          ausschuss: string | null
          created_at: string
          id: string
          quelle_url: string | null
          session_id: string | null
          tags: string[] | null
          titel: string
        }
      }
      dokument_gelesen: {
        Row: { dokument_id: string; gelesen_am: string; user_id: string }
      }
      dokument_shares: {
        Row: { dokument_id: string; id: string; user_id: string }
      }
      dokumente: {
        Row: {
          archiviert_am: string | null
          datei_url: string | null
          ebene: string | null
          erstellt_am: string
          gliederung: string | null
          id: string
          inhalt: string | null
          parent_id: string | null
          sichtbarkeit: string
          suchtext: string | null
          tags: string[]
          titel: string
          user_id: string
          vorschau: string | null
        }
      }
      events: {
        Row: {
          created_at: string
          ende: string | null
          erstellt_von: string
          herkunft: string
          id: string
          ort: string | null
          start: string
          status: string
          titel: string
          user_id: string
        }
      }
      fakten: {
        Row: {
          ebene: string
          einheit: string | null
          erstellt_am: string
          geaendert_am: string
          gliederung: string | null
          id: string
          inhalt: string | null
          kategorie: string
          kennzahl: string | null
          quelle: string | null
          sichtbarkeit: string
          stand: string | null
          tags: string[]
          titel: string
          user_id: string
        }
      }
      kontakt_anfragen: {
        Row: { email: string; erstellt_am: string; gelesen: boolean; id: string; nachricht: string; name: string }
      }
      mcp_tokens: {
        Row: { created_at: string; token_hash: string; user_id: string }
      }
      mcp_upload_chunks: {
        Row: { chunk_base64: string; chunk_index: number; upload_id: string }
      }
      mcp_uploads: {
        Row: { dateiname: string; erstellt_am: string; id: string; user_id: string }
      }
      neuigkeiten_stand: {
        Row: { gesehen_am: string; user_id: string }
      }
      presseschauen: {
        Row: {
          datum: string
          erstellt_am: string
          id: string
          inhalt: string
          quelle: string | null
          titel: string | null
          user_id: string
        }
      }
      profiles: {
        Row: {
          created_at: string
          ebenen: string[]
          foto_url: string | null
          fraktion: string | null
          gliederung_kommune: string | null
          gliederung_kreis: string | null
          gliederung_land: string | null
          id: string
          muss_passwort_aendern: boolean
          name: string
          partei: string | null
          presseschau_aktiv: boolean
          rolle: string
          technisch: boolean
        }
      }
      sessions: {
        Row: {
          datum: string
          ebene: string | null
          erstellt_von: string | null
          gremium: string | null
          ics_uid: string | null
          id: string
          ort: string | null
          quelle_url: string | null
          source_id: string | null
          status: string
          titel: string
        }
      }
      sitzung_dokumente: {
        Row: {
          dokument_id: string | null
          ergebnis: string | null
          erstellt_am: string
          id: string
          reihenfolge: number | null
          session_id: string
          top_nummer: string | null
          top_titel: string | null
        }
      }
      summaries: {
        Row: {
          antrag_id: string | null
          datei_url: string | null
          document_id: string | null
          erstellt_am: string
          event_id: string | null
          id: string
          inhalt: string | null
          session_id: string | null
          sichtbarkeit: string
          todo_id: string | null
          user_id: string
        }
      }
      todo_board_settings: {
        Row: { user_id: string; zeige_termin: boolean; zeige_zustaendig: boolean }
      }
      todo_columns: {
        Row: { id: string; reihenfolge: number; titel: string; user_id: string }
      }
      todo_dokumente: {
        Row: { dokument_id: string; erstellt_am: string; id: string; todo_id: string }
      }
      todo_placements: {
        Row: { column_id: string; erstellt_am: string; id: string; position: number; todo_id: string; user_id: string }
      }
      todos: {
        Row: {
          beschreibung: string | null
          created_at: string
          dokument_id: string | null
          ebene: string | null
          erledigt: boolean
          erledigt_am: string | null
          event_id: string | null
          faellig_am: string | null
          id: string
          session_id: string | null
          titel: string
          user_id: string
          zustaendig: string | null
          zustaendig_seit: string | null
          zustaendig_user_id: string | null
        }
      }
      user_gremien: {
        Row: { gremium: string; user_id: string }
      }
      user_source_subscriptions: {
        Row: { gremium_filter: string | null; source_id: string; user_id: string }
      }
    }
    Functions: {
      speicherbelegung: { Args: never; Returns: Json }
    }
  }
}

/** Zeilentyp einer Tabelle, so wie die Datenbank ihn liefert. */
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
