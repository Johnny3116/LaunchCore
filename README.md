# LaunchCore

Portable software installer for Windows. LaunchCore runs from a flash drive or a network share and installs software from a **signed, vetted catalog** onto **the machine it's running on**. It is not a network push tool.

## Status

- **Front end:** done. In a plain browser it runs on mock data, labeled "mock mode".
- **Backend:** catalog signing, detection, install, and logging are implemented. It compile-checks for Windows; next step is real-machine testing.
- **Tooling:** `bun run setup` handles first-time setup, and `bun run kit` builds a deployable folder.

## Quick start (Windows)

You need [Bun](https://bun.sh), [Rust](https://rustup.rs) with the MSVC toolchain (Visual Studio C++ Build Tools), and the WebView2 runtime, which ships with Windows 11.

```powershell
git clone https://github.com/Johnny3116/LaunchCore.git; cd LaunchCore
bun install
bun run setup                                   # checks tools, creates your signing key, signs the test kit
git add src-tauri/keys/catalog.pub; git commit -m "Add catalog signing key"

$env:LAUNCHCORE_KIT_DIR = "$PWD\examples\test-kit"
bun run tauri dev                               # real app against the test kit (7-Zip via winget)
```

`setup` is safe to re-run. It never overwrites a key. Your private key lives at `%USERPROFILE%\.launchcore\catalog-signing.key`. Back it up, and never commit it or put it on the share.

## Kit layout

```
LaunchCore\
  LaunchCore.exe        portable binary, no installer
  catalog.json          what can be installed
  catalog.json.sig      Ed25519 signature; without it, nothing installs
  packages\             MSI/EXE installers, referenced by relative path
```

All paths in `catalog.json` are relative to the LaunchCore folder, so the same kit works from `E:\` or `\\server\share\LaunchCore\`.

## Safety model

| Threat | Control |
|---|---|
| Someone edits `catalog.json` on the share | The catalog must carry a valid signature from a key compiled into the exe. Any edit invalidates it, and LaunchCore then installs nothing. |
| Someone swaps an installer file | The installer is staged to local disk and locked so it can't be written to, then hashed through that lock. A mismatch means it never runs. |
| Swap between hash check and run | The lock is held for the whole install, so the verified bytes are the bytes that run. |
| Path or argument tricks in the catalog | Paths must be relative and stay inside the kit (checked after symlink resolution). Arguments can't contain `" & \| < > ^ \``. winget IDs and versions are charset-checked. |
| A compromised UI requests something else | The UI sends only a package *id*. Rust looks up the path, arguments, and hash in its own verified catalog. |
| Wrong machine | The confirm dialog names the hostname. |
| Half-installed machine | A running installer is never killed, and a timeout is reported, not enforced. |

Elevation is requested per install through UAC. The app itself runs un-elevated. msiexec is launched by absolute path from System32.

**Still recommended:** make the share read-only for everyone except whoever maintains the kit.

## Making a kit

Keep a **source** folder with your real `catalog.json` and the installers under `packages\`. Then:

```powershell
bun run catalog hash  D:\KitSource\catalog.json --write     # fill in / fix every installer's SHA-256
bun run catalog sign  D:\KitSource\catalog.json --private $env:USERPROFILE\.launchcore\catalog-signing.key
bun run kit --catalog D:\KitSource\catalog.json --out D:\LaunchCoreKit
```

- `sign` validates the catalog and hashes every installer first, and refuses to sign if anything doesn't match. Use `--allow-missing` if the files aren't copied in yet.
- `kit` builds `LaunchCore.exe`, copies **only** the installers the catalog uses, then re-verifies the copied folder exactly as the exe will. It never overwrites an existing folder.
- Copy the `--out` folder to the flash drive or share as-is.

Other catalog commands:

| Command | What it does |
|---|---|
| `bun run catalog verify <catalog.json>` | Checks the signature, schema, and installer hashes, the same way the exe does |
| `bun run catalog trust --private <key>` | Trusts an existing key (e.g. on a new clone) |
| `bun run catalog keygen --private <path>` | Makes an additional key (key rotation). See `src-tauri/keys/README.md` |

Any edit to `catalog.json`, even whitespace, needs a re-sign. A BOM from PowerShell 5 is fine. `.gitattributes` keeps Git from changing line endings on signed files.

## catalog.json

The schema lives in `src/lib/catalog.ts` (zod) and is mirrored in `crates/launchcore-core/src/catalog.rs` (the authoritative check).

```jsonc
{
  "schemaVersion": 1,
  "name": "Standard Software",
  "packages": [
    {
      "id": "7zip",                       // lowercase, digits, dashes; unique
      "name": "7-Zip",
      "version": "24.09",
      "category": "Utilities",
      "color": "#A2845E",                 // optional tile color
      "installer": {
        "type": "msi",                    // "msi" | "exe" | "winget"
        "path": "packages/7zip/7z-x64.msi",
        "sha256": "<64 hex chars>",
        "args": "/qn /norestart",         // MSI: LaunchCore adds /i <staged path> and /l*v <log>
        "successCodes": [0, 3010],        // default
        "rebootCodes": [3010],            // default
        "timeoutMinutes": 30              // default
      },
      "detection": { "type": "msiProductCode", "productCode": "{GUID}" }
      // or { "type": "registry", "key": "HKLM\\...\\Uninstall\\X", "valueName": "DisplayVersion" }
      // or { "type": "file", "path": "%ProgramFiles%\\X\\x.exe" }   (version read from the file)
    }
  ]
}
```

To get an installer's hash, run `Get-FileHash .\packages\7zip\7z-x64.msi -Algorithm SHA256`.

### winget packages

```jsonc
"installer": {
  "type": "winget",
  "packageId": "7zip.7zip",
  "pinVersion": true,        // default: installs exactly "version" from the catalog
  "scope": "machine"         // default; "user" runs un-elevated as the signed-in user
}
```

Caveats:

- **Network:** winget needs internet access on the target machine at install time. Hashes are checked by winget against its manifest, not by LaunchCore.
- **winget is per-user:** LaunchCore finds it in the signed-in user's profile. If you elevate with a **separate admin account** (over-the-shoulder UAC), winget may not be registered for that account and the install will fail. Local MSI/EXE packages don't have this problem.
- **Exit codes:** winget returns HRESULT-style codes, shown in hex in the queue and log. Add codes to `successCodes`/`rebootCodes` only if you've confirmed what they mean.

## Logs

The session log is written to `%ProgramData%\LaunchCore\logs\launchcore-YYYY-MM-DD-<user>.log` (one file per user, so shared PCs work) on the target machine, falling back to `%LOCALAPPDATA%`. Each MSI also writes a verbose log next to it (`msi-<id>-<time>.log`). Nothing is written to the kit.

## Development

```powershell
bun run dev            # UI only, in a browser, on mock data
bun run tauri dev      # desktop app (debug builds honor LAUNCHCORE_KIT_DIR)
bun run typecheck      # UI + scripts
bun run test           # Rust core tests (any OS)
bun run tauri build    # release exe: target\release\LaunchCore.exe
```

If WebView2 is missing, LaunchCore shows a message box rather than silently exiting. Any startup failure is also written to the log.

Icons were generated from `app-icon.png` with `bun run tauri icon app-icon.png`.

## Layout

```
src/                       React UI (Deploy design)
  lib/tauriService.ts      real backend adapter (ids only cross the bridge)
  mock/                    browser-only mock
src-tauri/                 Tauri app: commands, Win32 detection/install, logging
  keys/catalog.pub         trusted public keys (compiled in)
crates/launchcore-core/    pure logic: schema, signatures, hashing, paths, versions (+ tests)
scripts/                   setup, catalog (keygen/trust/hash/sign/verify), kit builder
examples/test-kit/         one winget package for end-to-end testing
```

## Stack

These versions are pinned.

- **App:** Tauri 2.12.4 / tauri-build 2.7.3, windows 0.62.2
- **Rust crates:** ed25519-dalek 3.0.0, sha2 0.11.1
- **UI:** React 19.3.1, Vite 8.3.4, TypeScript 6.0.3, Tailwind 4.3.3, zod 4.6.7, lucide-react 1.60.0
- **Fonts (self-hosted):** @fontsource IBM Plex Sans / Space Grotesk / JetBrains Mono 5.3.0
