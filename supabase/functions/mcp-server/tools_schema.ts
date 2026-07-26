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
      'Speichert eine Notiz zu einer bestimmten Sitzung im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort in der Termindetailsicht der Sitzung, wie eine manuell eingetragene Notiz/ein manuell hochgeladenes Dokument). Unterstützt Freitext (z. B. eine im Chat erstellte Analyse/Zusammenfassung eines eingefügten Sammeldokuments), einen Datei-Anhang (Base64-kodiert, z. B. das Sammeldokument selbst) oder beides zusammen. Mindestens eins von beidem ist erforderlich. Für den Datei-Anhang gilt ein praktisches Limit von einigen MB (Base64 vergrößert die Originaldatei um ca. 33%, das Edge-Function-Request-Limit greift zuerst).',
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
          description: 'Dateiname inkl. Endung für einen Datei-Anhang, z. B. "sammeldokument.pdf" (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
        },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'create_event_note',
    description:
      'Speichert eine Notiz zu einem bestimmten eigenen Termin (nicht Sitzung) im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort in der Termindetailsicht, wie eine manuell eingetragene Notiz/ein manuell hochgeladenes Dokument). Nur für Termine, die dem angemeldeten Nutzer gehören. Unterstützt Freitext, einen Datei-Anhang (Base64-kodiert) oder beides zusammen. Mindestens eins von beidem ist erforderlich.',
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
          description: 'Dateiname inkl. Endung für einen Datei-Anhang (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
        },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'create_todo_note',
    description:
      'Speichert eine Notiz zu einer bestimmten ToDo-Karte im MandatsCockpit-Account des angemeldeten Nutzers (erscheint dort im Karten-Detail-Modal, wie ein manuell hochgeladenes Dokument - reiner Freitext ohne Datei landet ebenfalls dort, auch wenn die Web-UI für Karten primär Datei-Uploads zeigt). Nur für ToDo-Karten, die dem Nutzer gehören oder mit ihm geteilt sind. Unterstützt Freitext, einen Datei-Anhang (Base64-kodiert) oder beides zusammen. Mindestens eins von beidem ist erforderlich.',
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
          description: 'Dateiname inkl. Endung für einen Datei-Anhang (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
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
      'Speichert eine Notiz zu einem bestimmten Antrag (Freitext, ein Datei-Anhang als Base64, oder beides). Für Anträge, die dem Nutzer gehören oder mit ihm geteilt sind. Mindestens eins von Text oder Datei ist erforderlich.',
    inputSchema: {
      type: 'object',
      properties: {
        antrag_id: { type: 'string', description: 'UUID des Antrags, zu dem die Notiz gehört.' },
        inhalt: { type: 'string', description: 'Freitext-Notiz (optional).' },
        dateiname: {
          type: 'string',
          description: 'Dateiname inkl. Endung für einen Datei-Anhang (optional, nur zusammen mit datei_base64).',
        },
        datei_base64: {
          type: 'string',
          description: 'Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname).',
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
