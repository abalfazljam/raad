<div align="center">

[![فارسی](https://img.shields.io/badge/%D9%81%D8%A7%D8%B1%D8%B3%DB%8C-%E2%86%92-374151?style=for-the-badge)](README.md)
[![English](https://img.shields.io/badge/English-%E2%97%8F-6366f1?style=for-the-badge)](README.en.md)

</div>

<div dir="ltr">

# ⚡ Raad — Modern Download Manager (IDM Alternative)

[![Release](https://img.shields.io/badge/download-latest-6366f1)](../../releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](../../releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Raad** (pronounced *ra'ad*, Persian for **Thunder**) is a modern, open-source (MIT), fully **portable** download manager built with **Electron** — designed as a real IDM replacement: a multi-segment download engine, pause/resume, scheduling, clipboard batch import, Chrome/Firefox extensions with an IDM-style floating download window, and genuine IDM history migration.

> **Portable, no installer.** Grab `RaadDM-Portable-x.x.x.exe` from [Releases](../../releases/latest), double-click, done. All data lives in a `Raad-Data` folder next to the exe.

| Downloads list | Animated theme (Aurora) |
|---|---|
| ![downloads](screenshots/view-downloads-populated.png) | ![aurora](screenshots/theme-aurora.png) |

| Appearance settings | Floating download window (IDM-style) |
|---|---|
| ![settings](screenshots/view-settings-appearance.png) | ![dialog](screenshots/dialog.png) |

---

## ✨ Features

- 🚀 **Multi-segment download engine** — up to 32 parallel connections per file, just like IDM
- ⏸ **Pause / Stop / Resume** — even after closing the app (a state file is kept next to unfinished files)
- 📥 **Download queue** — adjustable number of concurrent downloads + “Start all / Pause all”
- 🗂 **Automatic categorization** — Video / Music / Archive / Program / Document / Image in separate subfolders
- 🐢 **Global speed limit** — without dropping the active downloads
- ⏰ **Scheduler** — daily/weekly time windows + optional auto shutdown after the queue drains
- 📋 **Clipboard monitor** — automatic detection of one or many copied links + batch add with checkboxes
- 🌐 **Chrome & Firefox extensions** — clicking a download link opens Raad's floating window (the IDM experience); toggle interception with one click (OFF badge on the icon)
- 🔄 **IDM migration** — history from IDM's own `UrlHistory.txt` file + settings from the registry
- 🎨 **Fully customizable appearance** — dark/light/system × 3 styles (glass, flat, soft) × 6 preset accents + **custom accent color** + **5 animated background themes** (Aurora, Starfall, Waves, Particles, Color Mesh) + corner radius + text size + glow intensity + compact mode
- 🌍 **Bilingual** — Persian/English with automatic RTL/LTR; Vazirmatn font bundled

## 🖼 Animated themes

| Aurora | Starfall | Color Mesh |
|---|---|---|
| ![aurora](screenshots/theme-aurora.png) | ![stars](screenshots/theme-stars.png) | ![mesh](screenshots/theme-mesh.png) |

| Particles | Waves | Light mode |
|---|---|---|
| ![particles](screenshots/theme-particles.png) | ![waves](screenshots/theme-waves.png) | ![light](screenshots/view-downloads-light.png) |

Text is always displayed on clear, solid panels — the animated themes only bring the background to life, so readability is preserved.

## 📥 Install (no installer, no commands)

1. Download **`RaadDM-Portable-x.x.x.exe`** from the [Releases](../../releases/latest) page.
2. Double-click it. The first launch takes a few extra seconds (the app unpacks itself into a Windows temp folder — that's normal).
3. If SmartScreen warns you: `More info → Run anyway` (the file is not digitally signed).
4. Full uninstall = delete the exe and the `Raad-Data` folder next to it. Nothing is written to the registry.

## 🌐 Browser extension setup

| Chrome / Edge / Brave | Firefox |
|---|---|
| `chrome://extensions` → Developer mode → **Load unpacked** → the `extension/chrome` folder | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → the `extension/firefox/manifest.json` file |

Then in Raad: **Settings ← Browser extension ← Copy JSON**, and Paste + Save it in the extension popup.

- Click the **big ON/OFF button** at the top of the extension popup = enable/disable download interception
- Right-click on any page ← “Disable/Enable Raad interception”
- From then on: clicking any download link in the browser opens Raad's floating window and the download continues with Raad

## 🔄 Transfer history & settings from IDM

IDM does not keep download history in the registry — the `UrlHistory.txt` file is made for that (per IDM's official documentation). Raad's transfer options:

| Method | Description |
|---|---|
| **Automatic** (same Windows PC) | In Raad: “IDM migration ← Automatic transfer” — reads `%APPDATA%\IDM\UrlHistory.txt` + settings from the registry. IDM must be closed. |
| **History file** | From the old PC: open `%APPDATA%\IDM` ← copy `UrlHistory.txt` ← in Raad: “History file / IDM export” |
| **Link list** | In IDM itself: `Tasks → Export` menu (text output), or any text file containing links |
| **IDM settings** | In `regedit`: `HKEY_CURRENT_USER\Software\DownloadManager` → Export → give the `.reg` file to Raad |

## 🛠 Build from source

```bash
git clone https://github.com/abalfazljam/raad.git
cd raad
npm install
npm start            # run directly from source
npm run dist:win     # build the portable RaadDM-Portable.exe (Windows)
```

Prerequisite: Node.js 18+. The Windows build also works on Linux (native makensis, no Wine).

## 🧱 Project structure

```
main/       → download engine (multi-segment + queue + speed limit), scheduler, extension HTTP bridge, IDM parser
preload/    → secure bridge (contextIsolation) exposed as window.raad
renderer/   → UI (vanilla JS + CSS, no framework) + floating download window
extension/  → Chrome (MV3) and Firefox (MV2) extensions + guide
native/     → (optional) Native Messaging host
scripts/    → icon generation, IDM parser tests, packaging
```

- **Zero runtime dependencies** — Electron only; the download engine runs on `electron.net`
- Atomic JSON storage (no SQLite, no native modules)
- Extension bridge: local HTTP on `127.0.0.1` with a recoverable security token

## 📄 License

MIT — free for personal and commercial use. Built with ⚡ for Persian speakers and everyone around the world.

</div>
