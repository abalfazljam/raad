<div align="center">

[![فارسی](assets/btn-fa-inactive.svg)](README.md)&nbsp;[![English](assets/btn-en-active.svg)](README.en.md)

<img src="screenshots/view-downloads-populated.png" alt="Raad — Downloads list" width="880">

# ⚡ Raad — Modern Download Manager (IDM Alternative)

[![Release](https://img.shields.io/badge/download-latest-6366f1)](../../releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows-blue)](../../releases)
[![Electron](https://img.shields.io/badge/Electron-33-47848F)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

<div dir="ltr">

**Raad** (pronounced *ra'ad*, Persian for **Thunder**) is a modern, open-source (MIT) download manager built with **Electron** — designed as a real IDM replacement: a multi-segment download engine, pause/resume, scheduling, clipboard batch import, Chrome/Firefox extensions and genuine, complete IDM history migration.

> **New in v1.7:** the full IDM experience — browser downloads start instantly in Raad, a floating progress window pops up, and a completion card offers open-file / open-folder / copy-file / drag-&-drop. Launch-on-startup (hidden next to the clock), Persian-first extension UI, and the fix for downloads lost during interception. Details in [v1.7 changes](#v17-changes).

> **Two ways to install: installer or portable.** Want the classic setup with desktop shortcut and an uninstaller? Grab `Raad-Setup-x.x.x.exe` from [Releases](../../releases/latest). Prefer zero-install and fully portable? Grab `RaadDM-Portable-x.x.x.exe` — double-click, done. Data lives in a `Raad-Data` folder next to the exe.

## 📖 Table of contents

- [Why Raad?](#why-raad)
- [Features](#features)
- [UI gallery](#ui-gallery)
- [Install](#install)
- [Quick start](#quick-start)
- [Transfer history & settings from IDM](#transfer-history--settings-from-idm)
- [Browser extension (Chrome & Firefox)](#browser-extension-chrome--firefox)
- [Known limitations](#known-limitations)
- [v1.7 changes](#v17-changes)
- [v1.6 changes](#v16-changes)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [Build from source](#build-from-source)
- [Project structure & architecture](#project-structure--architecture)
- [Contributing](#contributing)
- [License](#license)

## Why Raad?

IDM has been the gold standard of download managers for years — but it is paid, closed-source, and for Persian speakers it has always been an awkward translation. Raad is built from scratch with Persian as a first-class citizen, and what exists today in v1.5 is field-tested: a multi-segment engine verified with MD5 comparison to deliver byte-perfect files, and a migration that moves "the entire list you see inside IDM" with full dates and status.

| | Raad | IDM |
|---|---|---|
| **License** | Free, open-source (MIT) | Commercial — 30-day trial, then paid |
| **Install** | Classic installer or fully portable exe — your choice | Installer + browser integration |
| **Persian UI / RTL** | Native, first-class (Vazirmatn bundled) | Partial translation |
| **Multi-segment downloads** | Up to 32 parallel connections | Up to 32 parallel connections |
| **Pause / Resume** | ✅ even after closing the app | ✅ |
| **IDM history migration** | ✅ Full, from the registry, with dates & "Completed" status | — |
| **Open source & auditable** | ✅ | ❌ |

## ✨ Features

### 🚀 Download engine
- **Multi-segment downloads** — up to 32 parallel connections per file, just like IDM; CDN redirects and servers without Range support are handled
- **Pause / Stop / Resume** — even after closing the app (a state file is kept next to unfinished files)
- **Download queue** — adjustable number of concurrent downloads; bulk start/pause lives only in the Scheduler section, so a stray click can never flood your connection
- **Global speed limit** — without dropping or hurting the active downloads
- Output integrity verified by MD5 comparison against the source file

### 🗂 Organization & management
- **IDM-style categories** — Video / Audio / Image / Archive / Program / Document, each with a **dedicated save folder** (Categories view) or automatic subfolders
- **Sorting** (newest / oldest / name) and a **date filter** (today / last 7 / last 30 days)
- **Windowed list rendering** — only visible rows exist in the DOM; the UI stays smooth with thousands of items and rows physically cannot overlap
- Double-click a row to open the file; action buttons on every row

### ⏰ Automation
- **Scheduler** — daily/weekly time windows + optional auto shutdown after the queue drains
- **Clipboard monitor** — automatic detection of one or many copied links + batch add with checkboxes

### 🔄 Compatibility & migration
- **Complete IDM migration** — the whole list from the Windows registry and `UrlHistory*` files (details in [IDM migration](#transfer-history--settings-from-idm))
- **Chrome & Firefox extensions** — IDM-style floating download window; see [Browser extension](#browser-extension-chrome--firefox)

### 🎨 Appearance & customization
- **Dark/light × 3 styles** (glass, flat, soft) × 6 preset accents + **custom accent color** + corner radius + text size + static background glow + compact mode
- **Bilingual** — Persian/English with automatic RTL/LTR; Vazirmatn font bundled
- **Light & stable** — no GPU process (hardware acceleration off); the executable carries the Raad icon and "Raad Download Manager" metadata in Task Manager

## 🖼 UI gallery

| Downloads list | Light mode |
|---|---|
| ![downloads](screenshots/view-downloads-populated.png) | ![light](screenshots/view-downloads-light.png) |

| 1,000+ items (windowed rendering) | Categories (a folder per file type) |
|---|---|
| ![downloads-1000](screenshots/view-downloads-1000-rows.png) | ![cats](screenshots/view-cats.png) |

| Scheduler | IDM migration |
|---|---|
| ![scheduler](screenshots/view-scheduler.png) | ![idm](screenshots/view-idm.png) |

| Clipboard batch import | Appearance settings |
|---|---|
| ![clipboard](screenshots/modal-clipboard.png) | ![settings](screenshots/view-settings-appearance.png) |

| Floating download window (IDM-style) | Compact mode |
|---|---|
| ![dialog](screenshots/dialog.png) | ![compact](screenshots/view-downloads-scrolled-mid.png) |

## 📥 Install

Two files are available on the [Releases](../../releases/latest) page — pick whichever you prefer:

**Option 1 — Installer (recommended):**

1. Download **`Raad-Setup-1.7.0.exe`** and run it.
2. Choose the installation folder (default: `%LOCALAPPDATA%\Programs\Raad DM`) — the installer creates the desktop shortcut, Start-Menu entry and a proper uninstaller.
3. Full uninstall: via `Control Panel → Programs` or the Uninstall file in the install folder.

**Option 2 — Portable:**

1. Download **`RaadDM-Portable-1.7.0.exe`**.
2. Double-click it. The first launch takes a few extra seconds (the app unpacks itself into a Windows temp folder — that's normal).
3. Full uninstall = delete the exe and the `Raad-Data` folder next to it.

**In both cases:** if SmartScreen warns you, choose `More info → Run anyway` (the file is not digitally signed; see the [FAQ](#faq)). To capture links from your browser, install the Chrome/Firefox extension from the [extension folder](extension/) or the zip files attached to the same release.

Requirement: Windows 10/11 (64-bit).

## 🚀 Quick start

1. **First download:** hit the add button (or `Ctrl+N`) → paste the link → start. Raad detects the file type and places it in the matching category folder.
2. **Clipboard monitor:** copy any link and Raad offers to download it — for multiple links at once, the batch dialog opens with checkboxes.
3. **IDM migration:** run "Automatic transfer" once; the entire history lands as **Completed**, in IDM's own order (nothing downloads automatically).
4. **Categories:** in the Categories view, set the save folder for each file type once — everything stays organized afterwards.
5. **Appearance:** in Settings, pick dark/light, accent color and compact mode to your taste.

## 🔄 Transfer history & settings from IDM

IDM's main list (what you see in its window) lives in the **Windows registry**: every download is a numeric subkey (`HKEY_CURRENT_USER\Software\DownloadManager\<n>`) whose `Url0` value holds the URL — the same source IDM backup/restore tools use, which is why thousands of records survive a Windows reinstall. `UrlHistory.txt` only mirrors recent activity.

Raad's "Automatic transfer" reads **both sources** and merges them — deleted files do not matter, everything comes over (up to 20,000 entries, merged & deduplicated). Items land **Completed**, exactly **in IDM's own list order** (by subkey number, newest first), and **nothing downloads automatically** — re-downloading is an explicit per-row action:

<img src="screenshots/view-idm.png" alt="IDM migration" width="880">

| Method | Description |
|---|---|
| **Automatic** (same Windows PC) | In Raad: "IDM migration ← Automatic transfer" — the whole `HKEY_CURRENT_USER\Software\DownloadManager` tree (all record subkeys with `Url0`) via a Unicode-safe `reg export` + every `UrlHistory*` file in `%APPDATA%\IDM`. IDM must be closed. |
| **History file** | From the old PC: export `HKEY_CURRENT_USER\Software\DownloadManager` in regedit, or copy `%APPDATA%\IDM\UrlHistory.txt` ← in Raad: "History file / IDM export" |
| **Link list** | In IDM itself: `Tasks → Export` menu (text output), or any text file containing links |

## 🌐 Browser extension (Chrome & Firefox)

> ✅ **Status in v1.6: stable.** The bridge was rewritten from scratch, fixing the "extension cannot connect on some systems" issue inherited from v1.5 — no more manual JSON copy/paste: the extension discovers and pairs with the app automatically and stays connected even if the port or token changes.

Manual install (for testing):

| Chrome / Edge / Brave | Firefox |
|---|---|
| `chrome://extensions` → Developer mode → **Load unpacked** → the `extension/chrome` folder | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → the `extension/firefox/manifest.json` file |

That's it — while Raad is running, the connection is **automatic**. The popup should show "Connected to Raad"; if the app is closed, the `↻` button re-establishes it.

- Click the **big ON/OFF button** at the top of the extension popup = enable/disable download interception
- Right-click on any page ← "Disable/Enable Raad interception"
- When connected: clicking a download link **or starting any download in the browser** opens Raad's floating window and the download continues with Raad (real IDM behaviour; if Raad is not running, the browser download proceeds as usual)

**How the coordination works (v1.6):**
1. The extension scans `127.0.0.1:27500…27520` and finds the app via `/ping`.
2. It fetches `{port, token}` automatically from `/pair` (allowed only for browser-extension origins — regular web pages are rejected).
3. On any failed send (app closed, port moved, token regenerated) it re-pairs once by itself.
4. The app also persists the live bridge state to `Raad-Data/bridge.json` for troubleshooting and the Native Messaging host.

## ⚠️ Known limitations

Transparency beats empty promises — here is the honest state of v1.6:

1. **No digital signature**; SmartScreen and some antivirus products may warn you (completely normal — the source is open, build it yourself).
2. **The first launch is a bit slow** because the portable build self-extracts; subsequent launches are fast.
3. **Windows only** for now — Linux/macOS are on the roadmap.
4. On some corporate networks, security software may restrict browser loopback traffic; in that case use the Native Messaging mode (the `native/` folder).

## 🚀 v1.7 changes

Focus of 1.7: **IDM-like UX + download reliability.**

| Change | Details |
|---|---|
| 🛡 Fixed “connected but no download” | v1.6 cancelled the browser download BEFORE handing it to Raad — a failed handoff destroyed the file. Now **send first, cancel after**: if Raad refuses, the ordinary browser download continues. Already-finished browser downloads are never hijacked (no duplicates) |
| 🍪 Browser cookies ON by default | Like IDM, the login session travels with every download — auth-required links just work |
| ⚡ Auto-start extension downloads | Click download in the browser = instant start in Raad + progress window (toggle in Settings) |
| 📊 Floating progress window | Live bar, speed, ETA, pause/resume/cancel — bottom-right, closes itself when idle |
| 🏁 “Download complete” card | Open file, show in folder, copy file (Ctrl+V in Explorer) and **drag & drop** the file anywhere |
| 🖥 Launch on Windows startup | ON by default; the app lives next to the clock (tray) and silently catches browser downloads |
| 🇮🇷 Persian-first extension | Popup & context menus default to Persian; the EN button switches language |
| 🖼 Real icon everywhere | Setup/portable/app show the Raad icon in taskbar & Task Manager — not the Electron one |

## 🚀 v1.6 changes

The main v1.5 problem: **"the browser extensions never coordinated with the app."** Root causes and fixes:

| Root cause in 1.5 | Fix in 1.6 |
|---|---|
| If port 27500 was busy the app silently sat on the next port, but the extension only knew the single hand-copied port → dead link | Auto-discovery: the extension scans `27500…27520` and finds the app; the app remembers its last-good port |
| The token had to be copy/pasted by hand; skipping that meant 401 on every send | Automatic pairing via `/pair` (extension origins only; web pages are rejected) |
| `/ping` returned OK without a token, so the popup said "connected" while sends failed with 401 | `/ping` now reports the real auth state; the badge and popup tell the truth (green ✓ / warning mark) |
| Changing the port leaked the old server, and if all ports were busy the bridge stayed dead until restart | Clean stop-first restart + automatic 5-second retry; live bridge status is visible in Settings |
| On Firefox `AbortSignal.timeout` did not exist and `sendMessage().catch()` threw → requests hung forever | All timeouts via `AbortController`; unified `browser/chrome` promise wrapper |
| Only link clicks with known extensions were intercepted | Real interception of every browser download via `downloads.onCreated`: the browser download is cancelled and routed to Raad; if Raad is down, the browser continues normally |

Other improvements: proper cookies from `chrome.cookies` (instead of `document.cookie`), a bilingual (FA/EN) popup with a reconnect button, a `bridge.json` diagnostics file, and 26 automated bridge tests (`node scripts/test-bridge.js`).

## 🗺 Roadmap

- ✅ Multi-segment engine + pause/resume + speed limiter (verified with MD5)
- ✅ Complete IDM history migration from the registry + UrlHistory
- ✅ Categories, scheduler, clipboard monitor
- ✅ Dark/light × 3 styles × custom accent, bilingual RTL/LTR
- ✅ **v1.6:** stable extension bridge (auto discovery/pairing + full download interception)
- ✅ **v1.7:** full IDM flow (auto-start + progress window + completion card with drag), tray-on-boot, Persian-first extension
- 🔜 Next: publishing the extension to Chrome Web Store & addons.mozilla.org, code signing, lower resource usage, Linux build

## ❓ FAQ

**Antivirus or SmartScreen warns about the portable exe — is it dangerous?**
No. The file is not digitally signed, and self-extracting portable apps sometimes trigger warnings. The entire source is open (MIT) — you can run `npm run dist:win` yourself and get the same binary from source.

**Where is my data stored? How do I uninstall?**
Everything lives in the `Raad-Data` folder next to the exe. Nothing is written to the registry or AppData; full uninstall = delete the exe and that folder.

**Does IDM need to be installed for the migration?**
No. If IDM is installed on the same PC, "Automatic transfer" reads the registry directly; otherwise take the registry export or `UrlHistory.txt` from the old PC and use "History file".

**Do items imported from IDM download automatically?**
Never. All of them land as "Completed", and re-downloading only starts on your explicit click.

**Which languages are supported?**
Persian and English; the UI direction (RTL/LTR) switches automatically and the Vazirmatn font is bundled.

## 🛠 Build from source

```bash
git clone https://github.com/abalfazljam/raad.git
cd raad
npm install
npm start            # run directly from source
npm run dist:win     # build Raad-Setup.exe + RaadDM-Portable.exe (Windows)
node scripts/test-bridge.js   # test the extension bridge (no GUI needed)
```

Prerequisite: Node.js 18+. The Windows build also works on Linux (native makensis, no Wine).

## 🧱 Project structure & architecture

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
- Extension bridge: local HTTP on `127.0.0.1` with automatic extension-origin pairing + optional token

## 🤝 Contributing

Contributions are welcome! For bugs, please open an [Issue](../../issues/new) with exact details (Windows version, reproduction steps and, if possible, logs from `Raad-Data`). For code changes: fork, create a branch (`feature/my-feature`), push clean commits and open a Pull Request. If you want to work on the extension bridge or the download engine, please coordinate in an Issue first.

## 📄 License

MIT — free for personal and commercial use. The [Vazirmatn](https://github.com/rastikerdar/vazirmatn) font is bundled under the SIL OFL license. Built with ⚡ for Persian speakers and everyone around the world.

</div>
