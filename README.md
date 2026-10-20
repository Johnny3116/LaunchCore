# LaunchCore

Portable software installer for Windows. LaunchCore runs from a flash drive or a network share and installs software from a **signed, vetted catalog** onto **the machine it's running on**. It is not a network push tool.

## Status

- **Front end:** done. In a plain browser it runs on mock data, labeled "mock mode".
- **Backend:** catalog signing, detection, install, and logging are implemented. It compile-checks for Windows; next step is real-machine testing.

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

## Catalog signing

One-time setup. The private key must live **outside** the repo; the tool refuses otherwise.

```powershell
bun scripts/catalog-sign.ts keygen --private $env:USERPROFILE\.launchcore\catalog-signing.key
```

This writes the public key to `src-tauri/keys/catalog.pub`. Commit that file and rebuild. Keep the private key offline and backed up. Anyone holding it can authorize installs.

Every time the catalog changes:

```powershell
bun scripts/catalog-sign.ts sign \\server\share\LaunchCore\catalog.json --private $env:USERPROFILE\.launchcore\catalog-signing.key
bun scripts/catalog-sign.ts verify \\server\share\LaunchCore\catalog.json
```

`sign` validates the catalog first and refuses to sign a broken one. To check a kit exactly as the exe will:

```powershell
cargo run -p launchcore-core --example verify -- path\to\catalog.json src-tauri\keys\catalog.pub
```

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

The session log is written to `%ProgramData%\LaunchCore\logs\launchcore-YYYY-MM-DD.log` on the target machine, falling back to `%LOCALAPPDATA%`. Each MSI also writes a verbose log next to it (`msi-<id>-<time>.log`). Nothing is written to the kit.

## Development

Requires [Bun](https://bun.sh), Rust (MSVC toolchain), and the WebView2 runtime. WebView2 ships with Windows 11.

```powershell
bun install
bun run dev                                   # UI only, in a browser, mock data

# Real backend against the test kit (debug builds only honor LAUNCHCORE_KIT_DIR):
bun scripts/catalog-sign.ts sign examples\test-kit\catalog.json --private $env:USERPROFILE\.launchcore\catalog-signing.key
$env:LAUNCHCORE_KIT_DIR = "$PWD\examples\test-kit"
bun run tauri dev

cargo test -p launchcore-core                 # core logic tests (any OS)
bun run tauri build                           # release exe: target\release\launchcore.exe
```

To deploy a kit, copy `launchcore.exe`, `catalog.json`, `catalog.json.sig` and `packages\` into one folder. Release builds always read the catalog from the exe's own folder.

Icons were generated from `app-icon.png` with `bun run tauri icon app-icon.png`.

## Layout

```
src/                       React UI (Deploy design)
  lib/tauriService.ts      real backend adapter (ids only cross the bridge)
  mock/                    browser-only mock
src-tauri/                 Tauri app: commands, Win32 detection/install, logging
  keys/catalog.pub         trusted public keys (compiled in)
crates/launchcore-core/    pure logic: schema, signatures, hashing, paths, versions (+ tests)
scripts/catalog-sign.ts    keygen / sign / verify
examples/test-kit/         one winget package for end-to-end testing
```

## Stack

These versions are pinned.

- **App:** Tauri 2.12.4 / tauri-build 2.7.3, windows 0.62.2
- **Rust crates:** ed25519-dalek 3.0.0, sha2 0.11.1
- **UI:** React 19.3.1, Vite 8.3.4, TypeScript 6.0.3, Tailwind 4.3.3, zod 4.6.7, lucide-react 1.60.0
- **Fonts (self-hosted):** @fontsource IBM Plex Sans / Space Grotesk / JetBrains Mono 5.3.0
