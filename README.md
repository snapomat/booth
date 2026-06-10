# Photobooth

Eigene Photobooth-Software für eine Canon EOS (hier: **EOS 2000D**) mit Live-Vorschau,
Countdown und **Sofortdruck**. Electron + React + TypeScript, Kamera über `gphoto2`,
Druck über CUPS.

## Stack

- **Electron** (electron-vite, CJS) – ein gebündeltes Artefakt, echtes Kiosk-Fenster.
- **React + Tailwind v4** – das Touch-UI.
- **gphoto2-CLI** – Liveview (`--capture-movie --stdout`) & Auslösen (`--capture-image-and-download`).
- **sharp** – Compositing (Template/Rahmen, druckfertig 6×4″ @ 300 dpi).
- **CUPS** (`lp`) – Druck.

## Entwicklung

```bash
pnpm install
pnpm dev
```

Auf dem Mac ohne Canon läuft automatisch eine **Mock-Quelle** (generierte Bilder),
sodass sich die Oberfläche ohne Hardware entwickeln lässt.

Nützliche Skripte: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm dist:linux`.

## Kamera-Quellen

Einstellbar im Admin-Bereich (`cameraSource`):

| Quelle | Verhalten |
|---|---|
| `auto` | gphoto2/Canon falls erkannt, sonst `mock` |
| `gphoto2` | erzwingt die angeschlossene Canon |
| `webcam` | macOS-Kamera / **iPhone Continuity Camera** (Live & Aufnahme via `getUserMedia`) |
| `mock` | generierte Testbilder |

`webcam` ist ideal für die Entwicklung am Mac: echtes Live-Preview und Auslösen ohne DSLR.

## Linux / gphoto2 (Zielgerät)

```bash
sudo apt install gphoto2 libgphoto2-dev cups
```

Wichtig: Der GNOME-Automounter greift sich die Kamera und blockiert gphoto2. Falls die
Kamera nicht erkannt wird:

```bash
# laufende Monitore beenden …
pkill -f gvfs-gphoto2-volume-monitor
# … oder dauerhaft entfernen:
sudo apt remove gvfs-backends
```

Test: `gphoto2 --auto-detect` muss die EOS 2000D listen.

## Drucker (Canon SELPHY CP1500 via WLAN)

Die SELPHY CP1500 spricht IPP/AirPrint. In CUPS (`http://localhost:631`) als Netzwerk-
drucker hinzufügen, dann im Admin-Bereich auswählen. Druckformat ist Postkarte (6×4″),
passend zum Compositing.

## Bedienung / Kiosk

- **Start-Screen** antippen → Countdown → Aufnahme → Vorschau → *Drucken* / *Nochmal*.
- **Admin** über das Zahnrad oben rechts. Standard-Passwort beim Erststart: **`admin`**
  – bitte sofort ändern. Einstellungen liegen unter dem Electron-`userData`-Verzeichnis.
- **Kiosk verlassen:** `Strg/Cmd + Shift + Q`.

Im Produktiv-Build (`pnpm dist:linux` → AppImage/.deb) startet die App automatisch im
Vollbild-Kiosk; in der Entwicklung als normales Fenster mit DevTools.
