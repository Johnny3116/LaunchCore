# LaunchCore

Portable software installer for Windows. LaunchCore runs from a flash drive or a network share and installs software from a vetted catalog onto **the machine it's running on**. It is not a network push tool.

## Status

**Phase 1: front end on mock data.** The UI is complete and simulates every outcome. Nothing touches the machine yet.
**Phase 2 (next):** Rust backend commands for environment, catalog loading, detection, and install.

## Kit layout

```
LaunchCore\
  LaunchCore.exe      portable binary, no installer
  catalog.json        what can be installed (see schema below)
  packages\           MSI/EXE installers, referenced by relative path
```

All paths in `catalog.json` are relative to the LaunchCore folder, so the same kit works from `E:\` or `\\server\share\LaunchCore\`. Logs go to the local machine because the kit may be read-only.

## Safety model

- **Hash-pinned installers.** Every package declares a SHA-256 hash, and an installer that doesn't match is never executed.
- **Per-install elevation.** The UI runs un-elevated, and UAC is requested only when an installer runs.
- **Confirm before running.** The confirm dialog names the target hostname.
- **One installer at a time.** A running install is never killed. Skipping the queue only drops items that haven't started.
- **No generic shell, fs, or http plugins.** Privileged work goes only through LaunchCore's own Rust commands.

## catalog.json

The schema lives in `src/lib/catalog.ts` and is validated with zod. A malformed catalog blocks all installs and lists every problem it found.

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
      "installer": {
        "type": "msi",                    // "msi" | "exe"
        "path": "packages/7zip/7z-x64.msi",
        "sha256": "<64 hex chars>",
        "args": "/qn /norestart",         // MSI: LaunchCore adds /i <path> and a verbose log
        "successCodes": [0, 3010],        // default
        "rebootCodes": [3010],            // default
        "timeoutMinutes": 30              // default
      },
      "detection": { "type": "msiProductCode", "productCode": "{GUID}" }
      // or { "type": "registry", "key": "HKLM\\...\\Uninstall\\X", "valueName": "DisplayVersion" }
      // or { "type": "file", "path": "%ProgramFiles%\\X\\x.exe" }
    }
  ]
}
```

To get an installer's hash, run `Get-FileHash .\packages\7zip\7z-x64.msi -Algorithm SHA256`.

## Development

Requires [Bun](https://bun.sh), Rust, and the WebView2 runtime. WebView2 ships with Windows 11.

```powershell
bun install
bun run dev          # UI only, in a browser, on mock data
bun run tauri dev    # desktop window
bun run tauri build  # release exe at src-tauri\target\release\launchcore.exe
```

Before the first `tauri build`, generate icons from a square PNG of 1024 px or larger:

```powershell
bun run tauri icon .\app-icon.png
```

## Stack

These versions are pinned.

- Tauri 2.12.4 / tauri-build 2.7.3
- React 19.3.1
- Vite 8.3.4
- TypeScript 6.0.3
- Tailwind 4.3.3
- zod 4.6.7
- lucide-react 1.60.0
