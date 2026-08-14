// JSON-Schema-Definitionen für tools/list. Reine Deklarationen, keine Logik -
// die Implementierungen liegen in tools/*.ts.

export const TOOLS = [
  {
    name: 'create_todo',
    description: 'Legt eine neue ToDo-Karte im MandatsCockpit-Board des angemeldeten Nutzers an.',
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel der Aufgabe' },
        spalte: {
          type: 'string',
          description:
            "Name der Board-Spalte (z. B. 'Neu', 'Geplant', 'Wartet', 'Fertig'). Wird angelegt, falls sie beim Nutzer noch nicht existiert.",
        },
        faellig_am: {
          type: 'string',
          description: 'Fälligkeitsdatum im Format YYYY-MM-DD (optional).',
        },
        session_id: {
          type: 'string',
          description:
            'UUID einer Sitzung (z. B. aus list_next_sessions), an die die Aufgabe geknüpft werden soll (optional).',
        },
      },
      required: ['titel', 'spalte'],
    },
  },
  {
    name: 'create_event',
    description: "Legt einen neuen eigenen Termin (herkunft='privat') im persönlichen Kalender des angemeldeten Nutzers an.",
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel des Termins' },
        start: {
          type: 'string',
          description: 'Start als ISO-8601-Zeitstempel, z. B. 2026-08-12T18:00:00+02:00',
        },
        ende: { type: 'string', description: 'Ende als ISO-8601-Zeitstempel (optional).' },
      },
      required: ['titel', 'start'],
    },
  },
  {
    name: 'list_sessions',
    description:
      'Listet Sitzungstermine (importiert aus den Kalenderquellen oder manuell nachgetragen) auf - wahlweise zukünftige, vergangene oder alle. Für Rückblicke ("worüber wurde im letzten Verkehrsausschuss gesprochen") zeitraum="vergangenheit" verwenden. Liefert je Sitzung auch die id, die für create_session_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        zeitraum: {
          type: 'string',
          enum: ['zukunft', 'vergangenheit', 'alle'],
          description:
            'Welche Sitzungen: "zukunft" (Standard, nächste zuerst), "vergangenheit" (jüngste zuerst) oder "alle" (neueste zuerst).',
        },
        gremium: {
          type: 'string',
          description: "Filtert per Teilstring-Suche nach Gremium/Ausschuss, z. B. 'Verkehrsausschuss' (optional).",
        },
        nur_meine_gremien: {
          type: 'boolean',
          description:
            'true = nur Sitzungen der Gremien, in denen der Nutzer ein Mandat hat (plus reine Terminkalender-Quellen) - entspricht der Filterung im Dashboard/Archiv der Web-App. Standard false (alle sichtbaren Sitzungen). Bei Formulierungen wie "meine Sitzungen" true setzen.',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Sitzungen (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'list_events',
    description:
      'Listet die eigenen Termine des angemeldeten Nutzers (persönlicher Kalender, keine Gremiensitzungen) auf - wahlweise zukünftige, vergangene oder alle. Liefert je Termin auch die id, die für create_event_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        zeitraum: {
          type: 'string',
          enum: ['zukunft', 'vergangenheit', 'alle'],
          description:
            'Welche Termine: "zukunft" (Standard, nächste zuerst), "vergangenheit" (jüngste zuerst) oder "alle" (neueste zuerst).',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Termine (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'list_todos',
    description:
      'Listet die ToDo-Karten des angemeldeten Nutzers auf (eigene und mit ihm geteilte), sortiert nach Fälligkeitsdatum. Für Fragen wie "was steht noch offen" oder "was ist diese Woche fällig". Liefert je Karte auch die id, die für create_todo_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['offen', 'erledigt', 'alle'],
          description: 'Welche Karten: "offen" (Standard), "erledigt" oder "alle".',
        },
        spalte: {
          type: 'string',
          description:
            'Filtert auf eine Board-Spalte des Nutzers, z. B. "Wartet" (optional, Teilstring-Vergleich ohne Groß-/Kleinschreibung).',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Karten (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'list_notes',
    description:
      'Liest gespeicherte Notizen und hochgeladene Dokumente wieder aus (das Gegenstück zu create_session_note/create_event_note/create_todo_note). Ohne Filter kommen die zuletzt gespeicherten Einträge über alle Sitzungen/Termine/ToDos hinweg; mit genau einem der *_id-Filter alle Einträge zu diesem einen Objekt. Für Fragen wie "was habe ich zur letzten Ratssitzung notiert". Bei Datei-Anhängen wird nur der Dateiname genannt - der Dateiinhalt selbst kann über MCP nicht heruntergeladen werden.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Nur Notizen zu dieser Sitzung (optional).' },
        event_id: { type: 'string', description: 'Nur Notizen zu diesem eigenen Termin (optional).' },
        todo_id: { type: 'string', description: 'Nur Notizen zu dieser ToDo-Karte (optional).' },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Notizen (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'create_session_note',
    description:
      'Speichert eine Notiz zu einer bestimmten Sitzung im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort in der Termindetailsicht der Sitzung, wie eine manuell eingetragene Notiz/ein manuell hochgeladenes Dokument). Unterstützt Freitext (z. B. eine im Chat erstellte Analyse/Zusammenfassung eines eingefügten Sammeldokuments), einen Datei-Anhang (Base64-kodiert, z. B. das Sammeldokument selbst) oder beides zusammen. Mindestens eins von beidem ist erforderlich. Datei-Anhänge über ca. 13 KB (= ca. 18.000 Base64-Zeichen) NICHT über dateiname+datei_base64 versuchen - das scheitert an einer Zeichenlimit-Grenze des eigenen Tool-Aufrufs, nicht am Server. Für größere Dateien stattdessen start_file_upload/append_file_chunk/finish_file_upload verwenden und den daraus resultierenden datei_pfad hier statt dateiname+datei_base64 angeben.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'UUID der Sitzung (z. B. aus list_next_sessions), zu der die Notiz gehört.',
        },
        inhalt: {
          type: 'string',
          description: 'Freitext-Notiz, z. B. eine im Chat erstellte Analyse/Zusammenfassung (optional).',
        },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen kleinen Datei-Anhang, z. B. "sammeldokument.pdf" (optional, nur zusammen mit datei_base64, nur für Dateien bis ca. 13 KB - siehe datei_pfad für größere Dateien).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname, nur für Dateien bis ca. 13 KB).',
        },
        datei_pfad: {
          type: 'string',
          description: 'Storage-Pfad einer bereits per finish_file_upload hochgeladenen (größeren) Datei (optional, alternativ zu dateiname+datei_base64, nicht zusammen mit diesen angeben).',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'create_event_note',
    description:
      'Speichert eine Notiz zu einem bestimmten eigenen Termin (nicht Sitzung) im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort in der Termindetailsicht, wie eine manuell eingetragene Notiz/ein manuell hochgeladenes Dokument). Nur für Termine, die dem angemeldeten Nutzer gehören. Unterstützt Freitext, einen Datei-Anhang (Base64-kodiert) oder beides zusammen. Mindestens eins von beidem ist erforderlich. Datei-Anhänge über ca. 13 KB NICHT über dateiname+datei_base64 versuchen (Zeichenlimit des eigenen Tool-Aufrufs) - stattdessen start_file_upload/append_file_chunk/finish_file_upload verwenden und datei_pfad angeben.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: {
          type: 'string',
          description: 'UUID des eigenen Termins, zu dem die Notiz gehört.',
        },
        inhalt: {
          type: 'string',
          description: 'Freitext-Notiz (optional).',
        },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen kleinen Datei-Anhang (optional, nur zusammen mit datei_base64, nur bis ca. 13 KB - siehe datei_pfad für größere Dateien).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname, nur bis ca. 13 KB).',
        },
        datei_pfad: {
          type: 'string',
          description: 'Storage-Pfad einer bereits per finish_file_upload hochgeladenen (größeren) Datei (optional, alternativ zu dateiname+datei_base64, nicht zusammen mit diesen angeben).',
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'create_todo_note',
    description:
      'Speichert eine Notiz zu einer bestimmten ToDo-Karte im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort im Karten-Detail-Modal, wie ein manuell hochgeladenes Dokument - reiner Freitext ohne Datei landet ebenfalls dort, auch wenn die Web-UI für Karten primär Datei-Uploads zeigt). Nur für ToDo-Karten, die dem Nutzer gehören oder mit ihm geteilt sind. Unterstützt Freitext, einen Datei-Anhang (Base64-kodiert) oder beides zusammen. Mindestens eins von beidem ist erforderlich. Datei-Anhänge über ca. 13 KB NICHT über dateiname+datei_base64 versuchen (Zeichenlimit des eigenen Tool-Aufrufs) - stattdessen start_file_upload/append_file_chunk/finish_file_upload verwenden und datei_pfad angeben.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'UUID der ToDo-Karte, zu der die Notiz gehört.',
        },
        inhalt: {
          type: 'string',
          description: 'Freitext-Notiz (optional).',
        },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen kleinen Datei-Anhang (optional, nur zusammen mit datei_base64, nur bis ca. 13 KB - siehe datei_pfad für größere Dateien).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname, nur bis ca. 13 KB).',
        },
        datei_pfad: {
          type: 'string',
          description: 'Storage-Pfad einer bereits per finish_file_upload hochgeladenen (größeren) Datei (optional, alternativ zu dateiname+datei_base64, nicht zusammen mit diesen angeben).',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'complete_todo',
    description:
      'Hakt eine ToDo-Karte ab oder macht das rückgängig. Für Karten, die dem Nutzer gehören oder mit ihm geteilt sind.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'UUID der ToDo-Karte.' },
        erledigt: {
          type: 'boolean',
          description: 'true = abhaken (Standard), false = wieder auf offen setzen.',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'update_todo',
    description:
      'Ändert Titel, Beschreibung, Fälligkeitsdatum, Zuständigkeit und/oder Board-Spalte einer ToDo-Karte. Für Karten, die dem Nutzer gehören oder mit ihm geteilt sind - "spalte" verschiebt dabei nur die eigene Platzierung des Nutzers (jede Person hat ein eigenes Board), nicht die der anderen. Nur angegebene Felder werden geändert.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'UUID der ToDo-Karte.' },
        titel: { type: 'string', description: 'Neuer Titel (optional).' },
        beschreibung: { type: 'string', description: 'Neue Beschreibung (optional).' },
        faellig_am: { type: 'string', description: 'Neues Fälligkeitsdatum im Format YYYY-MM-DD (optional).' },
        zustaendig: { type: 'string', description: 'Neue Zuständigkeit als Freitext (optional).' },
        spalte: {
          type: 'string',
          description:
            'Board-Spalte, in die die Karte (auf dem eigenen Board des Nutzers) verschoben werden soll - wird angelegt, falls sie noch nicht existiert (optional).',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'create_antrag',
    description:
      'Legt einen neuen eigenen Antrag an (Status startet immer bei "entwurf"). Wird eine session_id angegeben, werden ausschuss und ebene automatisch aus deren Gremium/Ebene übernommen, sofern nicht explizit gesetzt (wie im "+ Antrag"-Formular der Web-App).',
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel des Antrags' },
        inhalt: { type: 'string', description: 'Antragstext (optional).' },
        ausschuss: { type: 'string', description: 'Vorgesehener Ausschuss (optional, sonst aus session_id übernommen).' },
        ebene: {
          type: 'string',
          enum: ['kommune', 'kreis', 'land', 'bund'],
          description: 'Ebene, für Fristen-Nachschlag und Teilen-Filter (optional, sonst aus session_id übernommen).',
        },
        session_id: {
          type: 'string',
          description: 'UUID der vorgesehenen Sitzung, an die der Antrag geknüpft werden soll (optional).',
        },
      },
      required: ['titel'],
    },
  },
  {
    name: 'list_antraege',
    description:
      'Listet Anträge auf - eigene und mit dem Nutzer geteilte. Liefert je Antrag auch die id, die für update_antrag_status und create_antrag_note gebraucht wird.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['aktiv', 'entwurf', 'gestellt', 'in_beratung', 'vertagt', 'abgestimmt', 'zurueckgezogen', 'alle'],
          description:
            '"aktiv" (Standard) = entwurf/gestellt/in_beratung/vertagt (noch nicht final entschieden), ein einzelner Status, oder "alle".',
        },
        ausschuss: {
          type: 'string',
          description: 'Filtert per Teilstring-Suche nach Ausschuss (optional).',
        },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Anträge (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'update_antrag_status',
    description:
      'Ändert den Status eines Antrags (z. B. von "entwurf" auf "gestellt", oder auf "abgestimmt" mit Ergebnis). Für Anträge, die dem Nutzer gehören oder mit ihm geteilt sind. Beim Übergang auf "gestellt" wird eingereicht_am automatisch auf heute gesetzt, falls nicht bereits vorhanden oder explizit angegeben.',
    inputSchema: {
      type: 'object',
      properties: {
        antrag_id: { type: 'string', description: 'UUID des Antrags.' },
        status: {
          type: 'string',
          enum: ['entwurf', 'gestellt', 'in_beratung', 'vertagt', 'abgestimmt', 'zurueckgezogen'],
          description: 'Neuer Status.',
        },
        ergebnis: {
          type: 'string',
          enum: ['positiv', 'negativ'],
          description: 'Erforderlich, wenn status="abgestimmt" gesetzt wird.',
        },
        eingereicht_am: {
          type: 'string',
          description: 'Einreichungsdatum im Format YYYY-MM-DD, überschreibt die Automatik (optional).',
        },
      },
      required: ['antrag_id', 'status'],
    },
  },
  {
    name: 'create_antrag_note',
    description:
      'Speichert eine Notiz zu einem bestimmten Antrag (Freitext, ein Datei-Anhang als Base64, oder beides). Für Anträge, die dem Nutzer gehören oder mit ihm geteilt sind. Mindestens eins von Text oder Datei ist erforderlich. Datei-Anhänge über ca. 13 KB NICHT über dateiname+datei_base64 versuchen (Zeichenlimit des eigenen Tool-Aufrufs) - stattdessen start_file_upload/append_file_chunk/finish_file_upload verwenden und datei_pfad angeben.',
    inputSchema: {
      type: 'object',
      properties: {
        antrag_id: { type: 'string', description: 'UUID des Antrags, zu dem die Notiz gehört.' },
        inhalt: { type: 'string', description: 'Freitext-Notiz (optional).' },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen kleinen Datei-Anhang (optional, nur zusammen mit datei_base64, nur bis ca. 13 KB - siehe datei_pfad für größere Dateien).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname, nur bis ca. 13 KB).',
        },
        datei_pfad: {
          type: 'string',
          description: 'Storage-Pfad einer bereits per finish_file_upload hochgeladenen (größeren) Datei (optional, alternativ zu dateiname+datei_base64, nicht zusammen mit diesen angeben).',
        },
      },
      required: ['antrag_id'],
    },
  },
  {
    name: 'list_antrag_fristen',
    description:
      'Berechnet die Einreichungsfristen (Sitzungsdatum minus die für die Ebene konfigurierte Vorlaufzeit aus Einstellungen -> Antrags-Fristen) für die eigenen aktiven Anträge mit verknüpfter Sitzung, sortiert nach Frist. Nur berechenbar, wenn Antrag, verknüpfte Sitzung UND eine Fristen-Einstellung für die jeweilige Ebene vorhanden sind.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'upload_presseschau',
    description:
      'Speichert eine tägliche Presseschau (Markdown-Text, z. B. eine extern erstellte Übersicht relevanter Presseartikel) im MandatsCockpit-Account des angemeldeten Nutzers. Erscheint dort im Presseschau-Abschnitt des Dashboards, sofern der Nutzer diesen in seinen eigenen Einstellungen aktiviert hat - der Upload funktioniert unabhängig davon immer. Pro Kalendertag (datum) ist genau ein Eintrag möglich; ein erneuter Upload für dasselbe datum ERSETZT den bisherigen Inhalt (Korrektur statt Duplikat) - für unterschiedliche Presseschauen deshalb immer das tatsächliche Datum der jeweiligen Ausgabe angeben, niemals das aktuelle Tagesdatum raten oder weglassen, sonst überschreiben sich mehrere Ausgaben gegenseitig.',
    inputSchema: {
      type: 'object',
      properties: {
        inhalt: { type: 'string', description: 'Vollständiger Presseschau-Text als Markdown.' },
        datum: {
          type: 'string',
          description:
            'Datum der Presseschau-Ausgabe im Format YYYY-MM-DD (Pflicht). Muss das tatsächliche Datum der Ausgabe sein (z. B. aus dem Dateinamen/der Überschrift der Vorlage, etwa "2026-07-28_Presseschau_IKZ.md" → 2026-07-28), nicht automatisch das heutige Datum - sonst überschreibt ein späterer Upload für einen anderen Tag versehentlich den falschen Eintrag.',
        },
        titel: { type: 'string', description: 'Überschrift, z. B. "Presseschau IKZ – 28.07.2026" (optional).' },
        quelle: { type: 'string', description: 'Quellenangabe, z. B. "Iserlohner Kreisanzeiger und Zeitung" (optional).' },
      },
      required: ['inhalt', 'datum'],
    },
  },
  {
    name: 'start_file_upload',
    description:
      'Startet einen mehrteiligen Upload für eine größere Datei (z. B. PDF), die nicht in einem einzigen dateiname+datei_base64-Aufruf übertragen werden kann - Base64-Tool-Argumente über ca. 18.000 Zeichen (= ca. 13 KB Originaldatei) werden vom aufrufenden Client selbst abgeschnitten, nicht vom Server abgelehnt. Liefert eine upload_id, mit der anschließend append_file_chunk (mehrfach, mit dem Base64-Inhalt in Häppchen von je höchstens ca. 8000 Zeichen) und danach genau einmal finish_file_upload aufgerufen wird. Der finish_file_upload-Aufruf liefert einen datei_pfad, der bei create_session_note/create_event_note/create_todo_note/create_antrag_note statt dateiname+datei_base64 angegeben wird.',
    inputSchema: {
      type: 'object',
      properties: {
        dateiname: { type: 'string', description: 'Dateiname inkl. Endung, z. B. "sammeldokument.pdf".' },
      },
      required: ['dateiname'],
    },
  },
  {
    name: 'append_file_chunk',
    description:
      'Überträgt ein Teilstück (Häppchen) des Base64-Inhalts einer per start_file_upload begonnenen Datei. chunk_index muss lückenlos bei 0 beginnend aufsteigend vergeben werden (0, 1, 2, ...) - jedes Häppchen sollte höchstens ca. 8000 Zeichen Base64-Text enthalten. Ein erneuter Aufruf mit derselben chunk_index überschreibt das vorherige Häppchen (z. B. nach einem Wiederholungsversuch), erzeugt also kein Duplikat.',
    inputSchema: {
      type: 'object',
      properties: {
        upload_id: { type: 'string', description: 'upload_id aus start_file_upload.' },
        chunk_index: { type: 'number', description: 'Fortlaufende Nummer dieses Häppchens, beginnend bei 0.' },
        chunk_base64: { type: 'string', description: 'Base64-Teilstück (höchstens ca. 8000 Zeichen empfohlen).' },
      },
      required: ['upload_id', 'chunk_index', 'chunk_base64'],
    },
  },
  {
    name: 'finish_file_upload',
    description:
      'Schließt einen per start_file_upload begonnenen, mehrteiligen Upload ab: setzt alle per append_file_chunk übertragenen Häppchen lückenlos zusammen, dekodiert das Ergebnis und legt die Datei im Storage ab. Liefert einen datei_pfad, der anschließend bei create_session_note/create_event_note/create_todo_note/create_antrag_note bzw. create_document statt dateiname+datei_base64 angegeben wird.',
    inputSchema: {
      type: 'object',
      properties: {
        upload_id: { type: 'string', description: 'upload_id aus start_file_upload.' },
        ziel: {
          type: 'string',
          enum: ['notiz', 'dokument'],
          description:
            'Wofür die Datei bestimmt ist: "notiz" (Standard, für create_session_note/create_event_note/create_todo_note/create_antrag_note) oder "dokument" (für create_document im Dokumenten-Hub) - bestimmt den Ziel-Speicherort.',
        },
      },
      required: ['upload_id'],
    },
  },
  {
    name: 'create_document',
    description:
      'Legt ein Dokument im Dokumenten-Hub an (neuer Reiter "Dokumente", neben dem Archiv). Zwei Kategorien: sichtbarkeit="geteilt" (sichtbar für alle Mitglieder der eigenen Partei auf der angegebenen Ebene/Gliederung, z. B. "Kommune Iserlohn" - die Gliederung wird automatisch aus dem eigenen Profil übernommen, NICHT als Parameter angegeben) oder sichtbarkeit="persoenlich" (nur für den Nutzer selbst sichtbar). Unterstützt Freitext, einen kleinen Datei-Anhang (dateiname+datei_base64, nur bis ca. 13 KB) oder einen bereits per finish_file_upload(ziel="dokument") hochgeladenen datei_pfad - mindestens eins von inhalt/Datei ist erforderlich. Übliche Tags für geteilte Dokumente: Antrag, Fact Sheet, Argumentationshilfe. Übliche Tags für persönliche Dokumente: Einschätzung, Analyse, Redebeitrag - tags sind aber frei wählbar, keine feste Liste.',
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel des Dokuments.' },
        sichtbarkeit: {
          type: 'string',
          enum: ['persoenlich', 'geteilt'],
          description: '"persoenlich" = nur für den Nutzer selbst, "geteilt" = für alle Mitglieder der eigenen Partei auf der angegebenen ebene sichtbar.',
        },
        ebene: {
          type: 'string',
          enum: ['kommune', 'kreis', 'land', 'bund'],
          description: 'Pflicht bei sichtbarkeit="geteilt". Muss eine Ebene sein, auf der der Nutzer laut seinem Profil selbst ein Mandat hat (Einstellungen -> Meine Gremien).',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Freie Tags, z. B. ["Antrag", "Fact Sheet"] bei geteilten oder ["Einschätzung"] bei persönlichen Dokumenten (optional).',
        },
        inhalt: { type: 'string', description: 'Freitext-Inhalt, z. B. eine im Chat erstellte Analyse (optional).' },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen kleinen Datei-Anhang (optional, nur zusammen mit datei_base64, nur bis ca. 13 KB - siehe datei_pfad für größere Dateien).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname, nur bis ca. 13 KB).',
        },
        datei_pfad: {
          type: 'string',
          description: 'Storage-Pfad einer bereits per finish_file_upload(ziel="dokument") hochgeladenen (größeren) Datei (optional, alternativ zu dateiname+datei_base64, nicht zusammen mit diesen angeben).',
        },
      },
      required: ['titel', 'sichtbarkeit'],
    },
  },
  {
    name: 'list_documents',
    description:
      'Listet Dokumente aus dem Dokumenten-Hub auf - eigene (persönlich und geteilt) sowie die geteilten Dokumente anderer Mitglieder der eigenen Partei auf gemeinsamen Ebenen/Gliederungen. Liefert je Dokument auch die id (für spätere Verwaltung) und ggf. den Ersteller-Namen bei fremden geteilten Dokumenten.',
    inputSchema: {
      type: 'object',
      properties: {
        sichtbarkeit: {
          type: 'string',
          enum: ['alle', 'persoenlich', 'geteilt'],
          description: 'Filtert nach Kategorie (Standard "alle").',
        },
        ebene: {
          type: 'string',
          enum: ['kommune', 'kreis', 'land', 'bund'],
          description: 'Filtert geteilte Dokumente nach Ebene (optional).',
        },
        tag: { type: 'string', description: 'Filtert per Teilstring-Suche nach Tag, Groß-/Kleinschreibung egal (optional).' },
        limit: { type: 'number', description: 'Maximale Anzahl Dokumente (Standard 20, Maximum 100).' },
      },
    },
  },
  {
    name: 'search',
    description:
      'Durchsucht Titel/Inhalte von ToDo-Karten, Anträgen und Notizen (Freitext-Suche, Groß-/Kleinschreibung egal) - berücksichtigt dabei nur für den Nutzer sichtbare Einträge (eigene und geteilte). Für Fragen wie "wo ging es um XY".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Suchbegriff.' },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Treffer je Kategorie (Standard 10, Maximum 50).',
        },
      },
      required: ['query'],
    },
  },
] as const
