# Buchführung

Desktop-App für die Vereinskasse – der Nachfolger des Excel-Kassenberichts.
Läuft auf **Windows und macOS**. Vereinsname und Logo sind in den
Einstellungen frei konfigurierbar; das Logo erscheint in der Seitenleiste,
im Prüfbericht und als Dock-Symbol.

> Hinweis: Der interne Paketname bleibt `kassenwart`, damit der
> Datenordner (`…/Application Support/kassenwart`) über Updates hinweg
> stabil bleibt. Sichtbarer App-Name, Icon und Installer heißen „Buchführung“.

## Funktionen

- **Buchungen erfassen** mit Datum, Veranstaltung/Kategorie, Verwendungszweck,
  Einnahme/Ausgabe und Betrag. Beleg-Nummern (z. B. `M1`, `M2`, `B1` …) werden
  automatisch je Kategorie vergeben – genau wie im Excel-Template.
- **Clean Mode** auf der Buchungsseite: aufgeräumte Leseansicht nach Datum mit
  laufendem Kassenstand, einklappbaren Filtern und CSV-Export. Die Ansichtswahl
  wird gespeichert; ein erneuter Klick blendet die Bearbeitung wieder ein.
- **Umsatz-Kennzeichnung** inkl. „davon kein Umsatz“ (z. B. Wechselgeld).
- **Chronologisch**: alle Buchungen nach Datum mit laufendem Kassenstand und
  Abschlussblock (Abschlusssaldo Vorjahr → Gesamtsaldo → Abschlusssaldo).
- **Veranstaltungen**: Buchungen je Veranstaltung gruppiert mit Zwischensummen.
- **Übersicht**: Kassenstand, Einnahmen, Ausgaben, Umsatz sowie Monats- und
  Kategorien-Auswertung. Ein Klick auf Einnahmen, Ausgaben, Umsatz, eine
  Veranstaltung oder einen Monat öffnet die passend vorgefilterten Buchungen.
  Der Kalenderfilter „Von“/„Bis“ umfasst beide Grenztage; Monatsklicks füllen
  den ersten und letzten Kalendertag vor.
- **Umsatz-Import**: CSV-Exporte aus dem Online-Banking (Sparkasse,
  Volksbank, ING, DKB u. a.) einlesen oder Umsätze direkt per FinTS abrufen. Datum, Verwendungszweck und Betrag
  werden automatisch erkannt. Listen und offene Import-Zähler zeigen ausschließlich
  neue Umsätze; bereits erfasste Umsätze werden ausgeblendet. Je Umsatz wird die
  Kategorie zugeordnet. Ein Klick auf die freie Zeilenfläche wählt den Umsatz
  aus oder ab; Eingabefelder und andere Bedienelemente bleiben unabhängig davon.
- **Prüfbericht als PDF**: druckfertiger Kassenbericht mit Abhak-Kästchen je
  Beleg, Prüf-Checkliste und Unterschriftsfeldern für die Kassenprüfer.
- **Jahresabschluss**: legt das Folgejahr an und übernimmt den Abschlusssaldo
  als Anfangssaldo sowie alle Kategorien.

## Datenablage

Die Daten liegen lokal als JSON-Datei pro Kassenjahr im Benutzerdaten-Ordner
der App (über *Einstellungen → Datenordner öffnen* erreichbar). Vor jedem
Speichern wird automatisch ein Backup rotiert (die letzten 20 Stände bleiben
erhalten).

## Entwicklung

```bash
npm install
npm run dev          # Electron mit Hot-Reload
npm test             # Tests der Kernlogik (Vitest)
npm run test:coverage # Kernlogik mit mindestens 80 % Testabdeckung
npm run test:e2e     # Import, Filter und Clean Mode in separater Electron-Test-App
npm run typecheck    # TypeScript
npm run preview:web  # Nur die Oberfläche im Browser (ohne Electron)
```

Die E2E-Tests verwenden eigene temporäre Jahresdateien. Die vorhandenen
Kassenbücher und Bankverbindungen werden dabei nicht geladen.
Alle Testdaten müssen künstlich sein: keine echten Namen, Banktexte,
Kontostände oder Referenzen aus produktiven Kassenbüchern übernehmen.

## Installer bauen

Lokal:

```bash
npm run dist:mac     # .dmg / .zip (macOS)
npm run dist:win     # .exe-Installer (Windows, nur auf Windows)
```

Oder über GitHub Actions: einen Tag `v*` pushen – der Release-Workflow baut
Installer für Windows und macOS und hängt sie an einen Release-Entwurf an.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

> Hinweis: Die Builds sind nicht code-signiert. macOS blockiert den ersten
> Start ggf. – dann Rechtsklick → „Öffnen“ bzw. unter
> *Systemeinstellungen → Datenschutz & Sicherheit* erlauben. Windows
> SmartScreen: „Weitere Informationen“ → „Trotzdem ausführen“.

## Technik

Electron + React + TypeScript (electron-vite). Das App-Icon wird aus
`build/icon.png` für macOS und Windows generiert.
Beträge werden intern in Cent
(ganzzahlig) gerechnet, damit keine Rundungsfehler entstehen. Die Kernlogik
(Beleg-Nummern, Sortierung, Salden, CSV-Parser) ist in `src/shared/` gekapselt
und mit Vitest getestet.
