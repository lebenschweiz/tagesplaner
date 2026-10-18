# Mein Tagesplaner

Tages- und Wochenplaner nach dem Vorbild eines Papier-Planers – als Web-App fürs Handy und den Computer.

## Was die App kann

**Tag**
- Ich bin dankbar für · Ich freue mich auf · Meine Affirmationen
- Tages-Fokus („Das Kuchenstück“) zum Abhaken, mit Hinweis auf die Wochenziele
- To-do-Liste: Sahnehaube (2), Kirschen obendrauf (4), weitere To-dos (beliebig viele), To-relax-Liste
- Gewohnheiten des Tages direkt abhaken (kommen aus der Wochenplanung)
- Termine & Notizen, Gedanken, Ideen & Erfolge
- **Zeitplan 05:15 – 20:15 im 15-Minuten-Takt: Spalte „Geplant“ und „Gemacht“**
  - ✓ übernimmt den Plan als gemacht; vergangene, nicht eingetragene Blöcke werden markiert
  - aktueller Block hervorgehoben, „Zur aktuellen Zeit“ springt hin
- Tages-Reflexion: Stimmung, Fitness & Gesundheit (Gewicht, Training), Mahlzeiten, Wasser (8 Gläser), Selbsteinschätzung 1–10

**Wie in Excel**
- **Autovervollständigung**: Beim Tippen wird ein früherer Eintrag vorgeschlagen und markiert ergänzt – Enter/Tab übernimmt, weitertippen überschreibt. Auf dem Handy erscheinen die Vorschläge als Liste.
- **Ausfüllkästchen**: Das kleine Quadrat am aktiven Feld nach unten ziehen füllt die Zeilen darunter aus.
- **Mehrere Zeilen markieren**: Auf die Uhrzeit klicken und ziehen (oder Shift-Klick; auf dem Handy zwei Uhrzeiten antippen). Dann: Plan ausfüllen, Plan → Gemacht, Kopieren, Einfügen, Leeren. `Strg+C`, `Strg+D` funktionieren auch.
- **Einfügen aus Excel/Notizen**: Mehrere Zeilen einfügen verteilt sie untereinander (Tab trennt Geplant/Gemacht).
- **Übernehmen**: Zeitplan von gestern, Zeitplan vom letzten gleichen Wochentag, offene To-dos von gestern, gestern Gemachtes als Plan.
- **Vorlagen**: Einen Zeitplan als Vorlage speichern (z. B. „Arbeitstag“) und an anderen Tagen einfügen.
- Jede dieser Aktionen lässt sich mit „Rückgängig“ zurücknehmen.

**Gmail** (nach Google-Anmeldung)
- Mails direkt im Tagesplaner: Ungelesen, Markiert, Heute, Wichtig
- „+ To-do“ übernimmt den Betreff in die To-dos, „+ Zeitplan“ setzt ihn in den nächsten freien Zeitblock (ab jetzt oder ab der markierten Zeile)
- Nur Lesezugriff. Mails werden nicht gespeichert – nur was du selbst übernimmst. Die Verbindung gilt jeweils ca. 1 Stunde, danach „Neu verbinden“.

**Woche**
- Gewohnheits-Tracker (6 Gewohnheiten × 7 Tage), Namen werden in die nächste Woche übernommen
- Wochen-Fokus: Ziel 1 und Ziel 2 mit je 3 Schritten
- Wochenübersicht: Fokus, To-dos, Plan umgesetzt, getrackte Stunden, Gewohnheiten, Stimmung, Selbsteinschätzung, Wasser, Fitness – pro Tag
- Zeitraster der Woche (geplant/gemacht als Mini-Kalender)
- Selbst-Reflexion: Sinn & Motivation (1–10), Erfolge & Fortschritte

**Speichern**
- Mit **Google-Anmeldung**: alles automatisch in der Cloud (Firebase), auf allen Geräten, funktioniert auch offline und synchronisiert später.
- Ohne Konto: nur im Browser dieses Geräts.
- Export/Import aller Daten als JSON (Menü oben rechts).

## Online stellen (GitHub Pages)

1. Repository → **Settings → Pages** → Source: *Deploy from a branch*, Branch `main`, Ordner `/ (root)` → Save.
2. Nach ca. 1 Minute läuft die App unter `https://lebenschweiz.github.io/tagesplaner/`.

## Google-Anmeldung einrichten (einmalig, ca. 10 Minuten, kostenlos)

1. <https://console.firebase.google.com> → **Projekt hinzufügen** (z. B. `mein-tagesplaner`). Google Analytics kannst du ausschalten.
2. **Build → Authentication → Jetzt starten → Anbieter „Google“** aktivieren, Support-E-Mail wählen, speichern.
3. **Authentication → Einstellungen → Autorisierte Domains → Domain hinzufügen:** `lebenschweiz.github.io`
4. **Build → Firestore Database → Datenbank erstellen** → Standort `eur3 (europe-west)` → *Produktionsmodus*.
5. Im Tab **Regeln** den Inhalt von [`firestore.rules`](firestore.rules) einfügen → **Veröffentlichen**. Damit sieht jede Person nur ihre eigenen Daten.
6. **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web-App `</>` hinzufügen** (Hosting nicht nötig). Das angezeigte `firebaseConfig`-Objekt kopieren.
7. In [`js/firebase-config.js`](js/firebase-config.js) `export const firebaseConfig = null;` durch das kopierte Objekt ersetzen und committen.

Die Firebase-Werte sind nicht geheim; geschützt werden die Daten durch die Regeln aus Schritt 5. Der kostenlose Spark-Tarif reicht für den persönlichen Gebrauch bei Weitem.

## Gmail einrichten (einmalig, nach der Google-Anmeldung)

Firebase legt im Hintergrund ein Google-Cloud-Projekt mit demselben Namen an. Dort:

1. <https://console.cloud.google.com/apis/library/gmail.googleapis.com> öffnen, oben dein Firebase-Projekt wählen → **Aktivieren**.
2. **APIs & Dienste → OAuth-Zustimmungsbildschirm** (heißt teils „Google Auth Platform“):
   - Zielgruppe: **Extern**, Status **Test** lassen.
   - **Testnutzer:** deine Gmail-Adresse hinzufügen.
   - **Datenzugriff → Bereiche hinzufügen:** `https://www.googleapis.com/auth/gmail.readonly`.
3. In der App im Gmail-Feld **„Gmail verbinden“** tippen. Google zeigt „Diese App wurde nicht von Google überprüft“ → **Weiter** (es ist deine eigene App) → Lesezugriff erlauben.

Solange die App im Status „Test“ ist, können nur die eingetragenen Testnutzer Gmail verbinden – genau richtig für den persönlichen Gebrauch.

## Lokal ausprobieren

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Für die Google-Anmeldung lokal zusätzlich `localhost` als autorisierte Domain eintragen (ist meist schon vorhanden).

## Aufbau

- `index.html` – Seitenstruktur
- `css/style.css` – Gestaltung (hell/dunkel automatisch)
- `js/app.js` – Tag, Woche, Kopieren/Ausfüllen, Übersicht
- `js/autocomplete.js` – Excel-artige Vorschläge
- `js/gmail.js` – Gmail lesen (Liste, Betreff, Absender)
- `js/store.js` – Speicher (Firestore oder localStorage)
- `js/firebase-config.js` – deine Firebase-Konfiguration
- `firestore.rules` – Zugriffsregeln für die Datenbank
