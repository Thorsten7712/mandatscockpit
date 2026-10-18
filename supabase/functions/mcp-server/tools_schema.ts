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
            'Board-Spalte: eine der festen Spalten "Neu", "Geplant", "Ergebnis erstellt", "Fertig".',
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
      'Listet Sitzungstermine (importiert aus den Kalenderquellen oder manuell nachgetragen) auf - wahlweise zukünftige, vergangene oder alle. Für Rückblicke ("worüber wurde im letzten Verkehrsausschuss gesprochen") zeitraum="vergangenheit" verwenden. Liefert je Sitzung auch die id, z. B. für list_notes, link_document_session oder set_session_agenda. Je Sitzung werden id, Gremium, Datum mit Uhrzeit und - falls vorhanden - quelle_url ausgegeben. Hinweis: bei ALLRIS-Feeds ist quelle_url meist nur die Tagesansicht und damit für mehrere Sitzungen desselben Tages identisch; eindeutig ist erst Gremium + Datum samt Uhrzeit.',
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
      'Listet die eigenen Termine des angemeldeten Nutzers (persönlicher Kalender, keine Gremiensitzungen) auf - wahlweise zukünftige, vergangene oder alle. Liefert je Termin auch die id, z. B. für list_notes.',
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
            'Filtert auf eine Board-Spalte des Nutzers: "Neu", "Geplant", "Ergebnis erstellt" oder "Fertig" (optional, Teilstring-Vergleich ohne Groß-/Kleinschreibung).',
        },
        session_id: {
          type: 'string',
          description: 'Filtert auf ToDos, die mit dieser Sitzung verknüpft sind (optional).',
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
      'Liest die Notizen an ToDo-Karten (eigene und geteilte) wieder aus - das Gegenstück zu create_todo_note. Notizen gibt es nur an ToDo-Karten und an Dokumenten im Hub; Sitzungen und Termine haben keine eigenen. Mit session_id bzw. event_id kommen die Notizen der mit dieser Sitzung/diesem Termin verknüpften Karten, mit todo_id die einer Karte, ohne Filter die zuletzt geschriebenen. Notizen an Hub-Dokumenten liefert get_document. Für Fragen wie "was habe ich zur letzten Ratssitzung notiert".',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Nur Notizen der mit dieser Sitzung verknüpften Karten (optional).' },
        event_id: { type: 'string', description: 'Nur Notizen der mit diesem eigenen Termin verknüpften Karten (optional).' },
        todo_id: { type: 'string', description: 'Nur Notizen zu dieser ToDo-Karte (optional).' },
        limit: {
          type: 'number',
          description: 'Maximale Anzahl Notizen (Standard 20, Maximum 100).',
        },
      },
    },
  },
  {
    name: 'create_todo_note',
    description:
      'Speichert eine Text-Notiz an einer ToDo-Karte (erscheint im Karten-Detail unter "Notizen" und in der Sitzungsansicht, wenn die Karte mit einer Sitzung verknüpft ist). Für Karten, die dem Nutzer gehören oder mit ihm geteilt sind; Kolleg*innen, auf deren Board die Karte liegt, sehen die Notiz ebenfalls. Notizen sind reiner Text (Markdown möglich), Dateien lassen sich nicht anhängen. Sitzungen und Termine haben keine eigenen Notizen: eine Sitzungsvorbereitung gehört an die passende Karte oder als persönliches Dokument (create_document, sichtbarkeit="persoenlich") per link_document_session an die Sitzung.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'UUID der ToDo-Karte, zu der die Notiz gehört.',
        },
        inhalt: {
          type: 'string',
          description: 'Text der Notiz.',
        },
      },
      required: ['todo_id', 'inhalt'],
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
      'Ändert Titel, Beschreibung, Fälligkeitsdatum, Zuständigkeit, Sitzungs-Verknüpfung und/oder Board-Spalte einer ToDo-Karte. Für Karten, die dem Nutzer gehören oder mit ihm geteilt sind - "spalte" verschiebt dabei nur die eigene Platzierung des Nutzers (jede Person hat ein eigenes Board), nicht die der anderen. Nur angegebene Felder werden geändert.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'UUID der ToDo-Karte.' },
        titel: { type: 'string', description: 'Neuer Titel (optional).' },
        beschreibung: { type: 'string', description: 'Neue Beschreibung (optional).' },
        faellig_am: { type: 'string', description: 'Neues Fälligkeitsdatum im Format YYYY-MM-DD (optional).' },
        zustaendig: {
          type: 'string',
          description:
            'Wer zuständig ist: Name (oder Teil davon) einer Person, die die Karte schon hat (Ersteller*in oder jemand, mit dem sie geteilt ist), "ich" für den Nutzer selbst, leerer String für niemand. Die Person sieht die Karte auf ihrem Board und kann sie bearbeiten. Mit neuen Kolleg*innen muss die Karte zuerst in der Web-Oberfläche geteilt werden (optional).',
        },
        session_id: {
          type: 'string',
          description: 'UUID einer Sitzung, mit der die Karte nachträglich verknüpft werden soll (optional, leerer String entfernt eine bestehende Verknüpfung).',
        },
        spalte: {
          type: 'string',
          description:
            'Board-Spalte, in die die Karte (auf dem eigenen Board des Nutzers) verschoben werden soll: "Neu", "Geplant", "Ergebnis erstellt" oder "Fertig" (optional).',
        },
      },
      required: ['todo_id'],
    },
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
      'Nur für das technische Konto (ALLRIS-Import) - andere Konten können keine Dateien hochladen und legen Notizen als Text an (create_todo_note, create_document). Startet einen mehrteiligen Upload für eine größere Datei (z. B. PDF), die nicht in einem einzigen dateiname+datei_base64-Aufruf übertragen werden kann - Base64-Tool-Argumente über ca. 18.000 Zeichen (= ca. 13 KB Originaldatei) werden vom aufrufenden Client selbst abgeschnitten, nicht vom Server abgelehnt. Liefert eine upload_id, mit der anschließend append_file_chunk (mehrfach, mit dem Base64-Inhalt in Häppchen von je höchstens ca. 8000 Zeichen) und danach genau einmal finish_file_upload aufgerufen wird. Der finish_file_upload-Aufruf liefert einen datei_pfad, der bei create_document statt dateiname+datei_base64 angegeben wird.',
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
      'Schließt einen per start_file_upload begonnenen, mehrteiligen Upload ab: setzt alle per append_file_chunk übertragenen Häppchen lückenlos zusammen, dekodiert das Ergebnis und legt die Datei im Storage ab. Liefert einen datei_pfad, der anschließend bei create_document statt dateiname+datei_base64 angegeben wird.',
    inputSchema: {
      type: 'object',
      properties: {
        upload_id: { type: 'string', description: 'upload_id aus start_file_upload.' },
        ziel: {
          type: 'string',
          enum: ['dokument'],
          description: 'Nur noch "dokument" (Standard, für create_document im Dokumenten-Hub) - Notizen sind reiner Text.',
        },
      },
      required: ['upload_id'],
    },
  },
  {
    name: 'create_document',
    description:
      'Legt ein Dokument im Dokumenten-Hub an (neuer Reiter "Dokumente", neben dem Archiv) - entweder als eigenständiges Top-Level-Dokument oder, mit parent_id, als Notiz/Analyse-Anhang an ein bestehendes Dokument (z. B. eine Einschätzung zu einer hochgeladenen Sitzungsvorlage). Drei Sichtbarkeits-Kategorien: sichtbarkeit="geteilt" (sichtbar für alle Mitglieder der eigenen Partei auf der Ebene/Gliederung - bei einem Top-Level-Dokument über den Parameter ebene gewählt, bei einem Anhang automatisch vom übergeordneten Dokument übernommen), sichtbarkeit="persoenlich" (nur für den Nutzer selbst sichtbar) oder sichtbarkeit="einzelpersonen" (nur für die in teilen_mit_namen genannten Personen zusätzlich sichtbar). Unterstützt Freitext, einen kleinen Datei-Anhang (dateiname+datei_base64, nur bis ca. 13 KB) oder einen bereits per finish_file_upload(ziel="dokument") hochgeladenen datei_pfad - mindestens eins von inhalt/Datei ist erforderlich. Übliche Tags für geteilte Top-Level-Dokumente: Antrag, Fact Sheet, Argumentationshilfe. Übliche Tags für persönliche Anhänge: Einschätzung, Analyse, Redebeitrag - tags sind aber frei wählbar, keine feste Liste.',
    inputSchema: {
      type: 'object',
      properties: {
        titel: { type: 'string', description: 'Titel des Dokuments.' },
        sichtbarkeit: {
          type: 'string',
          enum: ['persoenlich', 'geteilt', 'einzelpersonen'],
          description: '"persoenlich" = nur für den Nutzer selbst, "geteilt" = für alle Mitglieder der eigenen Partei auf der Ebene sichtbar, "einzelpersonen" = nur für die in teilen_mit_namen genannten Personen zusätzlich sichtbar.',
        },
        parent_id: {
          type: 'string',
          description: 'UUID eines bestehenden Dokuments (z. B. aus list_documents), an das dieses hier als Notiz/Analyse angehängt werden soll (optional). Ohne parent_id entsteht ein eigenständiges Top-Level-Dokument.',
        },
        session_id: {
          type: 'string',
          description: 'UUID einer Sitzung (z. B. aus list_sessions), mit der das Dokument verknüpft werden soll (optional).',
        },
        ebene: {
          type: 'string',
          enum: ['kommune', 'kreis', 'land', 'bund'],
          description: 'Nur bei sichtbarkeit="geteilt" OHNE parent_id relevant (Pflicht in diesem Fall) - muss eine Ebene sein, auf der der Nutzer laut seinem Profil selbst ein Mandat hat. Mit parent_id wird die Ebene automatisch vom übergeordneten Dokument übernommen, hier NICHT angeben.',
        },
        teilen_mit_namen: {
          type: 'array',
          items: { type: 'string' },
          description: 'Namen der Partei-/Ebenen-Kolleg*innen, mit denen geteilt werden soll (Pflicht bei sichtbarkeit="einzelpersonen", sonst ignoriert). Teilstring-Suche gegen sichtbare Profile, Namen ohne eindeutigen Treffer werden in der Antwort genannt statt den Aufruf abzubrechen.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Freie Tags, z. B. ["Antrag", "Fact Sheet"] bei geteilten oder ["Einschätzung"] bei persönlichen Dokumenten (optional).',
        },
        inhalt: { type: 'string', description: 'Freitext-Inhalt, z. B. eine im Chat erstellte Analyse (optional).' },
        dateiname: {
          type: 'string',
          description: 'Nur für das technische Konto (ALLRIS-Import), andere Konten legen Notizen als Text an. Dateiname inkl. Endung für einen kleinen Datei-Anhang (optional, nur zusammen mit datei_base64, nur bis ca. 13 KB - siehe datei_pfad für größere Dateien).',
        },
        datei_base64: {
          type: 'string',
          description: 'Nur für das technische Konto (ALLRIS-Import), andere Konten legen Notizen als Text an. Base64-kodierter Inhalt der anzuhängenden Datei (optional, nur zusammen mit dateiname, nur bis ca. 13 KB).',
        },
        datei_pfad: {
          type: 'string',
          description: 'Nur für das technische Konto (ALLRIS-Import), andere Konten legen Notizen als Text an. Storage-Pfad einer bereits per finish_file_upload(ziel="dokument") hochgeladenen (größeren) Datei (optional, alternativ zu dateiname+datei_base64, nicht zusammen mit diesen angeben).',
        },
      },
      required: ['titel', 'sichtbarkeit'],
    },
  },
  {
    name: 'list_documents',
    description:
      'Listet Dokumente aus dem Dokumenten-Hub auf - eigene (persönlich, geteilt und einzelpersonen) sowie die geteilten bzw. mit dem Nutzer individuell geteilten Dokumente anderer Mitglieder. Ohne parent_id nur Top-Level-Dokumente (z. B. hochgeladene Sitzungsvorlagen); mit parent_id gezielt die an ein bestimmtes Dokument angehängten Notizen/Analysen. Liefert je Dokument auch die id (für parent_id bei create_document oder spätere Verwaltung) und ggf. den Ersteller-Namen bei fremden Dokumenten. Archivierte Dokumente sind standardmäßig ausgeblendet (siehe Parameter archiv) und in der Ausgabe mit ARCHIV markiert. Mit titel lässt sich gezielt nach einer Drucksache suchen - der Filter greift in der Datenbank, also auch für Dokumente, die nicht unter den neuesten Treffern liegen.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_id: {
          type: 'string',
          description: 'UUID eines Top-Level-Dokuments - listet dann nur die daran angehängten Notizen/Analysen statt der Top-Level-Dokumente (optional).',
        },
        sichtbarkeit: {
          type: 'string',
          enum: ['alle', 'persoenlich', 'geteilt', 'einzelpersonen'],
          description: 'Filtert nach Kategorie (Standard "alle").',
        },
        ebene: {
          type: 'string',
          enum: ['kommune', 'kreis', 'land', 'bund'],
          description: 'Filtert geteilte Dokumente nach Ebene (optional).',
        },
        tag: { type: 'string', description: 'Filtert per Teilstring-Suche nach Tag, Groß-/Kleinschreibung egal (optional).' },
        titel: {
          type: 'string',
          description:
            'Filtert per Teilstring-Suche nach Titel, Groß-/Kleinschreibung egal (optional), z. B. eine DS-Nummer wie "DS11/0941". Wird vor dem Limit angewendet, findet also auch ältere Dokumente.',
        },
        session_id: {
          type: 'string',
          description: 'Filtert auf Dokumente, die mit dieser Sitzung verknüpft sind (optional). Ein Dokument kann an mehreren Sitzungen hängen und wird dann über jede davon gefunden.',
        },
        archiv: {
          type: 'string',
          enum: ['ohne', 'alle', 'nur'],
          description:
            'Umgang mit archivierten Dokumenten (Standard "ohne", wie in der Web-UI). Ein Dokument gilt als archiviert, wenn seine verknüpfte Sitzung vorbei ist ODER es per update_document_archiv von Hand archiviert wurde. "alle" listet zusätzlich das Archiv, "nur" ausschließlich das Archiv.',
        },
        seit: {
          type: 'string',
          description:
            'Nur Dokumente, die ab diesem Zeitpunkt in den Hub hochgeladen wurden (optional) - für einen täglichen Scan nach neuen Drucksachen. Ein Datum wie "2026-10-17" gilt ab Mitternacht deutscher Zeit, ein Zeitstempel wie "2026-10-17T06:00:00+02:00" exakt. Greift in der Datenbank, also vor dem Limit. Für einen Scan archiv="alle" setzen: eine neue Drucksache zu einer schon vergangenen Sitzung gilt sonst als archiviert und fehlt.',
        },
        limit: {
          type: 'number',
          description:
            'Maximale Anzahl Dokumente (Standard 20, Maximum 100). Greift erst nach dem Archiv-Filter. Gibt es mehr Treffer, nennt die letzte Zeile der Antwort die Gesamtzahl.',
        },
      },
    },
  },
  {
    name: 'get_document',
    description:
      'Liefert ein einzelnes Dokument aus dem Dokumenten-Hub mit seinem gespeicherten Text (Markdown) - bei Drucksachen die vollständige Vorlage. list_documents zeigt nur Titel, Tags und Sitzungen, den Text gibt es nur hier. Dazu Kopfdaten: Sichtbarkeit, Ersteller*in, Tags, verknüpfte Sitzungen mit TOP-Nummer, Archivstatus, Dateiname und die Zahl der für den Nutzer sichtbaren Notizen. Funktioniert auch für Notizen (parent_id gesetzt). Lange Texte kommen in Abschnitten von höchstens 20.000 Zeichen; die Antwort nennt dann den Wert für ab_zeichen, mit dem es weitergeht.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des Dokuments (z. B. aus list_documents).' },
        ab_zeichen: {
          type: 'number',
          description: 'Ab welchem Zeichen der Text geliefert wird (optional, Standard 0) - für die Fortsetzung langer Texte, den Wert nennt die vorige Antwort.',
        },
        max_zeichen: {
          type: 'number',
          description: 'Höchstens so viele Zeichen Text (optional, Standard und Maximum 20.000).',
        },
      },
      required: ['dokument_id'],
    },
  },
  {
    name: 'update_document_archiv',
    description:
      'Legt ein eigenes Dokument im Dokumenten-Hub von Hand ins Archiv oder holt es zurück - nur der/die Ersteller*in darf das. Betrifft ausschließlich die manuelle Archivierung: ein Dokument, dessen verknüpfte Sitzung vorbei ist, gilt weiterhin als archiviert und lässt sich nur durch Lösen der Sitzungs-Verknüpfung (unlink_document_session) zurückholen.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments/der eigenen Notiz (z. B. aus list_documents).' },
        archivieren: {
          type: 'boolean',
          description: 'true = ins Archiv legen, false = manuelle Archivierung wieder aufheben.',
        },
      },
      required: ['dokument_id', 'archivieren'],
    },
  },
  {
    name: 'delete_document',
    description:
      'Löscht ein eigenes Dokument oder eine eigene Notiz im Dokumenten-Hub endgültig, samt der zugehörigen Dateien im Speicher. Nur der/die Ersteller*in darf das - Admins zusätzlich die Dokumente der Automatik-Konten (der ALLRIS-Import gehört dem technischen Konto, sonst käme niemand mehr an den Bestand heran). Am Dokument hängende Notizen werden mitgelöscht - sind Notizen anderer Personen dabei, bricht der Aufruf ab und muss mit auch_fremde_notizen=true wiederholt werden.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments bzw. der eigenen Notiz (z. B. aus list_documents).' },
        auch_fremde_notizen: {
          type: 'boolean',
          description:
            'Bestätigt ausdrücklich, dass auch Notizen anderer Personen mitgelöscht werden dürfen (Standard false). Ohne das bricht der Aufruf ab, sobald fremde Notizen am Dokument hängen.',
        },
      },
      required: ['dokument_id'],
    },
  },
  {
    name: 'update_document_inhalt',
    description:
      'Setzt den Text-/Markdown-Inhalt eines eigenen Dokuments im Dokumenten-Hub nachträglich - gedacht, um bereits hochgeladene Vorlagen später mit ihrer Markdown-Fassung zu versorgen. Nur der/die Ersteller*in darf das. Lange Inhalte in Stücken übertragen: einmal mit modus="ersetzen" beginnen, danach beliebig oft modus="anhaengen" - ein einzelner MCP-Aufruf wird ab etwa 13 KB Nutzlast unzuverlässig.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments (z. B. aus list_documents).' },
        inhalt: {
          type: 'string',
          description: 'Der Text bzw. das Markdown. Bei modus="ersetzen" leert ein leerer String den Inhalt.',
        },
        modus: {
          type: 'string',
          enum: ['ersetzen', 'anhaengen'],
          description: 'Standard "ersetzen". "anhaengen" hängt an den bestehenden Inhalt an, für stückweise Übertragung langer Vorlagen.',
        },
      },
      required: ['dokument_id', 'inhalt'],
    },
  },
  {
    name: 'link_document_session',
    description:
      'Verknüpft ein eigenes Dokument im Dokumenten-Hub zusätzlich mit einer Sitzung. Ein Dokument kann an mehreren Sitzungen hängen - eine Vorlage durchläuft typischerweise erst den Fachausschuss und danach den Rat. Idempotent: ist die Verknüpfung schon vorhanden, ist das kein Fehler - übergebene Tagesordnungs-Angaben werden dann aufgefrischt, weil sich eine Tagesordnung bis zur Sitzung ändern kann. Nur der/die Ersteller*in darf das.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments (z. B. aus list_documents).' },
        session_id: { type: 'string', description: 'UUID der Sitzung (z. B. aus list_sessions).' },
        top_nummer: {
          type: 'string',
          description: 'Nummer des Tagesordnungspunkts, z. B. "3.1" oder "N 4.2" (optional). Text, weil Tagesordnungen mehrstufig nummerieren und nicht-öffentliche Punkte Präfixe tragen.',
        },
        top_titel: {
          type: 'string',
          description: 'Wortlaut des Tagesordnungspunkts, falls er vom Dokumenttitel abweicht (optional).',
        },
        reihenfolge: {
          type: 'number',
          description: 'Position auf der Tagesordnung (optional). Nötig zum Sortieren, weil top_nummer als Text falsch ordnet ("3.10" vor "3.2").',
        },
        ergebnis: {
          type: 'string',
          description: 'Beratungsergebnis dieses Tagesordnungspunkts, z. B. "ungeändert beschlossen" (optional). Für ganze Tagesordnungen besser set_session_agenda nutzen.',
        },
      },
      required: ['dokument_id', 'session_id'],
    },
  },
  {
    name: 'set_session_agenda',
    description:
      'Schreibt die Tagesordnung einer Sitzung als Ganzes: alle Punkte in ihrer Reihenfolge, mit Verknüpfung auf die Drucksachen im Dokumenten-Hub und mit dem Beratungsergebnis. Punkte ohne Drucksache ("Eröffnung der Sitzung", "Einwohnerfragestunde") gehören dazu - sie strukturieren den Ablauf und machen rund ein Viertel einer Ratstagesordnung aus. Die Drucksachen werden über ihre Nummer aufgelöst (das Tool sucht das Dokument, dessen Titel mit der Nummer beginnt); welche Nummern im Hub fehlen, steht in der Antwort - die herunterladen, mit create_document hochladen und erneut aufrufen. Schlüssel jedes Punkts ist seine TOP-Nummer, ein erneuter Aufruf aktualisiert dieselbe Tagesordnung also statt sie zu verdoppeln. Von Hand im Cockpit gesetzte Sitzungs-Verknüpfungen (ohne TOP-Nummer) bleiben unberührt.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'UUID der Sitzung (aus list_sessions). Alternativ ics_uid angeben.' },
        ics_uid: {
          type: 'string',
          description:
            'Statt session_id: die ALLRIS-Kennung der Sitzung, "ALLRIS-Sitzung-2001745" oder nur "2001745". Das ist dieselbe SILFDNR, die im Kopf der Tagesordnung steht (to010?SILFDNR=...), und damit der zuverlässigste Weg, eine Tagesordnung ihrer Sitzung zuzuordnen.',
        },
        gremium: {
          type: 'string',
          description:
            'Dritter Weg, zusammen mit datum: der Gremienname, genau wie in list_sessions. Nötig für von Hand nachgetragene Sitzungen, die keine ics_uid haben (der ALLRIS-Feed reicht nicht in die Vergangenheit). Wird zusätzlich ics_uid übergeben, trägt der Server sie an der gefundenen Sitzung nach.',
        },
        datum: {
          type: 'string',
          description: 'Zusammen mit gremium: der Sitzungstag als ISO-Datum, z. B. "2025-12-04". Verglichen wird auf den Tag, nicht auf die Minute.',
        },
        punkte: {
          type: 'array',
          description:
            'Die Tagesordnungspunkte in ihrer Reihenfolge. Ohne reihenfolge-Angabe gilt die Position in dieser Liste.',
          items: {
            type: 'object',
            properties: {
              top_nummer: {
                type: 'string',
                description: 'Nummer des Punkts, z. B. "Ö 3.1" oder "N 4.2" (erforderlich, innerhalb der Sitzung eindeutig).',
              },
              top_titel: { type: 'string', description: 'Wortlaut des Punkts (Betreff aus der Tagesordnung).' },
              drucksache: {
                type: 'string',
                description: 'Drucksachennummer der Vorlage, z. B. "DS11/0108" (optional). Wird zum Dokument im Hub aufgelöst.',
              },
              dokument_id: {
                type: 'string',
                description: 'UUID des Dokuments, falls bereits bekannt (optional, Alternative zu drucksache).',
              },
              ergebnis: {
                type: 'string',
                description: 'Beratungsergebnis aus der Spalte "Zuständigkeit", z. B. "ungeändert beschlossen" oder "abgelehnt" (optional, bei vergangenen Sitzungen nachtragen).',
              },
              reihenfolge: { type: 'number', description: 'Position auf der Tagesordnung (optional, Standard: Listenposition).' },
            },
            required: ['top_nummer'],
          },
        },
        modus: {
          type: 'string',
          enum: ['ersetzen', 'anhaengen'],
          description:
            'Standard "ersetzen": die bisherige importierte Tagesordnung dieser Sitzung wird durch die übergebene Liste ersetzt, entfallene Punkte verschwinden. "anhaengen" rührt nur die übergebenen Punkte an - für lange Tagesordnungen, die in Teilstücken kommen (ein einzelner MCP-Aufruf wird ab ca. 13 KB unzuverlässig).',
        },
      },
      required: ['punkte'],
    },
  },
  {
    name: 'list_session_agenda',
    description:
      'Listet die hinterlegte Tagesordnung einer Sitzung: TOP-Nummer, Wortlaut, verknüpftes Dokument und Beratungsergebnis, in der Reihenfolge der Tagesordnung. Zum Prüfen nach einem Import und für Rückblicke ("was wurde in TOP 3.1 beschlossen").',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'UUID der Sitzung (aus list_sessions). Alternativ ics_uid oder gremium+datum angeben.' },
        ics_uid: {
          type: 'string',
          description: 'Statt session_id: die ALLRIS-Kennung, "ALLRIS-Sitzung-2001745" oder nur "2001745".',
        },
        gremium: { type: 'string', description: 'Zusammen mit datum als dritter Weg, die Sitzung zu benennen.' },
        datum: { type: 'string', description: 'Sitzungstag als ISO-Datum, z. B. "2025-12-04".' },
      },
    },
  },
  {
    name: 'unlink_document_session',
    description:
      'Löst die Verknüpfung zwischen einem eigenen Dokument und einer Sitzung. Andere Sitzungs-Verknüpfungen desselben Dokuments bleiben bestehen. Nur der/die Ersteller*in darf das.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments (z. B. aus list_documents).' },
        session_id: { type: 'string', description: 'UUID der Sitzung, deren Verknüpfung gelöst werden soll.' },
      },
      required: ['dokument_id', 'session_id'],
    },
  },
  {
    name: 'link_todo_document',
    description:
      'Verknüpft eine ToDo-Karte mit einem Dokument aus dem Dokumenten-Hub (n:m - eine Karte kann mehrere Dokumente haben, ein Dokument mehrere Karten). Voraussetzung: die Karte gehört dem Nutzer oder ist mit ihm geteilt, ODER das Dokument gehört ihm. Erneutes Verknüpfen einer bereits bestehenden Verbindung ist unschädlich (kein Duplikat/Fehler).',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'UUID der ToDo-Karte (z. B. aus list_todos).' },
        dokument_id: { type: 'string', description: 'UUID des Dokuments (z. B. aus list_documents).' },
      },
      required: ['todo_id', 'dokument_id'],
    },
  },
  {
    name: 'unlink_todo_document',
    description: 'Entfernt eine bestehende Verknüpfung zwischen einer ToDo-Karte und einem Dokument (siehe link_todo_document).',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: { type: 'string', description: 'UUID der ToDo-Karte.' },
        dokument_id: { type: 'string', description: 'UUID des Dokuments.' },
      },
      required: ['todo_id', 'dokument_id'],
    },
  },
  {
    name: 'update_document_titel',
    description:
      'Ändert den Titel eines eigenen Dokuments/einer eigenen Notiz im Dokumenten-Hub (Top-Level-Dokument oder per parent_id angehängte Notiz/Analyse) - nur der/die Ersteller*in darf das. Ändert nur den angezeigten Titel, nicht den Dateinamen eines eventuell angehängten Datei-Uploads.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments/der eigenen Notiz (z. B. aus list_documents).' },
        titel: { type: 'string', description: 'Neuer Titel.' },
      },
      required: ['dokument_id', 'titel'],
    },
  },
  {
    name: 'update_document_tags',
    description:
      'Ersetzt die Tags eines eigenen Dokuments/einer eigenen Notiz im Dokumenten-Hub (Top-Level-Dokument oder per parent_id angehängte Notiz/Analyse) durch die angegebene Liste - nur der/die Ersteller*in darf das. Ein leeres Array entfernt alle Tags.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments/der eigenen Notiz (z. B. aus list_documents).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Vollständige neue Tag-Liste (ersetzt die bisherige komplett, leeres Array = alle Tags entfernen).' },
      },
      required: ['dokument_id', 'tags'],
    },
  },
  {
    name: 'update_document_sharing',
    description:
      'Ändert nachträglich die Sichtbarkeit/Freigabe eines eigenen Dokuments/einer eigenen Notiz im Dokumenten-Hub - nur der/die Ersteller*in darf das. Ersetzt bestehende Freigaben komplett (kein Hinzufügen einzelner Personen). Bei sichtbarkeit="geteilt" für eine per parent_id angehängte Notiz wird die Ebene/Gliederung automatisch vom übergeordneten Dokument übernommen (das übergeordnete Dokument muss dafür selbst Ebene-weit geteilt sein); für ein Top-Level-Dokument bleibt die bisherige Ebene/Gliederung erhalten.',
    inputSchema: {
      type: 'object',
      properties: {
        dokument_id: { type: 'string', description: 'UUID des eigenen Dokuments/der eigenen Notiz (z. B. aus list_documents).' },
        sichtbarkeit: {
          type: 'string',
          enum: ['persoenlich', 'geteilt', 'einzelpersonen'],
          description: '"persoenlich" = nur für den Nutzer selbst, "geteilt" = für alle Mitglieder der eigenen Partei auf der Ebene sichtbar, "einzelpersonen" = nur für die in teilen_mit_namen genannten Personen zusätzlich sichtbar.',
        },
        teilen_mit_namen: {
          type: 'array',
          items: { type: 'string' },
          description: 'Namen der Partei-/Ebenen-Kolleg*innen, mit denen geteilt werden soll (Pflicht bei sichtbarkeit="einzelpersonen", sonst ignoriert). Ersetzt die bisherige Freigabe-Liste komplett. Teilstring-Suche gegen sichtbare Profile, Namen ohne eindeutigen Treffer werden in der Antwort genannt statt den Aufruf abzubrechen.',
        },
      },
      required: ['dokument_id', 'sichtbarkeit'],
    },
  },
  {
    name: 'list_fakten',
    description:
      'Listet Einträge aus "Zahlen & Fakten": Argumentationshilfen, Sprachregelungen und belegte Kennzahlen - eigene und die von Partei-Kolleg*innen derselben Ebene und Gliederung. Je Eintrag Wert (bei Zahlen), Text, Beleg (Quelle und Stand), Ebene, Tags, Ersteller*in und id (für update_fakt). Für Debatten: Fakten ohne Quelle oder Stand sind so gekennzeichnet und nicht zitierfähig.',
    inputSchema: {
      type: 'object',
      properties: {
        kategorie: {
          type: 'string',
          enum: ['argumentationshilfe', 'sprachregelung', 'zahl'],
          description: 'Nur diese Kategorie (optional).',
        },
        ebene: { type: 'string', enum: ['kommune', 'kreis', 'land', 'bund'], description: 'Nur diese Ebene (optional).' },
        tag: { type: 'string', description: 'Nur Einträge mit genau diesem Tag (optional).' },
        suche: {
          type: 'string',
          description: 'Freitext über Titel, Text, Wert, Einheit, Quelle und Tags, Groß-/Kleinschreibung egal (optional).',
        },
        limit: { type: 'number', description: 'Maximale Anzahl (Standard 20, Maximum 100).' },
      },
    },
  },
  {
    name: 'create_fakt',
    description:
      'Legt einen Eintrag in "Zahlen & Fakten" an. Er ist immer für alle Partei-Kolleg*innen der gewählten Ebene sichtbar - private Fakten gibt es nicht (dafür den Dokumenten-Hub nutzen). Bei kategorie="zahl" ist kennzahl Pflicht, sonst inhalt. Quelle und Stand angeben, wann immer möglich: ohne sie gilt der Fakt als unbelegt.',
    inputSchema: {
      type: 'object',
      properties: {
        kategorie: {
          type: 'string',
          enum: ['argumentationshilfe', 'sprachregelung', 'zahl'],
          description: 'argumentationshilfe = Argument samt Erwiderung, sprachregelung = wie wir worüber sprechen, zahl = belegte Kennzahl.',
        },
        titel: { type: 'string', description: 'Kurzer Titel, z. B. "Sanierungsstau Schulgebäude".' },
        inhalt: { type: 'string', description: 'Text: das Argument, die Sprachregelung bzw. die Einordnung der Zahl.' },
        kennzahl: {
          type: 'string',
          description: 'Nur bei kategorie="zahl": der Wert als Text, wie veröffentlicht ("rund 1.200", "8-12", "12,5").',
        },
        einheit: { type: 'string', description: 'Nur bei kategorie="zahl": Einheit, z. B. "%", "Mio. €", "Wohnungen".' },
        quelle: { type: 'string', description: 'Beleg: Behörde, Studie, Drucksache oder URL.' },
        stand: { type: 'string', description: 'Datum, auf das sich die Angabe bezieht (YYYY-MM-DD).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Freie Tags (optional).' },
        ebene: {
          type: 'string',
          enum: ['kommune', 'kreis', 'land', 'bund'],
          description: 'Für welche der eigenen Ebenen der Fakt gilt. Die Gliederung kommt automatisch aus dem Profil.',
        },
      },
      required: ['kategorie', 'titel', 'ebene'],
    },
  },
  {
    name: 'update_fakt',
    description:
      'Ändert einen eigenen Eintrag in "Zahlen & Fakten" (fakt_id aus list_fakten). Nur angegebene Felder ändern sich; ein leerer String leert ein Feld, tags ersetzt die ganze Liste. Fremde Fakten lassen sich nicht ändern, die Ebene nur in der Web-Oberfläche. Löschen geht nur dort.',
    inputSchema: {
      type: 'object',
      properties: {
        fakt_id: { type: 'string', description: 'UUID des Fakts.' },
        kategorie: { type: 'string', enum: ['argumentationshilfe', 'sprachregelung', 'zahl'] },
        titel: { type: 'string' },
        inhalt: { type: 'string' },
        kennzahl: { type: 'string' },
        einheit: { type: 'string' },
        quelle: { type: 'string' },
        stand: { type: 'string', description: 'YYYY-MM-DD' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['fakt_id'],
    },
  },
  {
    name: 'search',
    description:
      'Durchsucht Titel/Inhalte von ToDo-Karten und Notizen (Freitext-Suche, Groß-/Kleinschreibung egal) - berücksichtigt dabei nur für den Nutzer sichtbare Einträge (eigene und geteilte). Für Fragen wie "wo ging es um XY".',
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
