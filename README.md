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
- **Umsatz-Kennzeichnung** inkl. „davon kein Umsatz“ (z. B. Wechselgeld).
- **Chronologisch**: alle Buchungen nach Datum mit laufendem Kassenstand und
  Abschlussblock (Abschlusssaldo Vorjahr → Gesamtsaldo → Abschlusssaldo).
- **Veranstaltungen**: Buchungen je Veranstaltung gruppiert mit Zwischensummen.
- **Übersicht**: Kassenstand, Einnahmen, Ausgaben, Umsatz sowie Monats- und
  Kategorien-Auswertung.
- **Kontoauszug-Import**: CSV-Exporte aus dem Online-Banking (Sparkasse,
  Volksbank, ING, DKB u. a.) einlesen. Datum, Verwendungszweck und Betrag
  werden automatisch erkannt, Duplikate markiert; je Umsatz wird die Kategorie
  zugeordnet.
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
npm run typecheck    # TypeScript
npm run preview:web  # Nur die Oberfläche im Browser (ohne Electron)
```

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
