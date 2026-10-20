# Trusted catalog keys

`catalog.pub` holds the Ed25519 **public** keys LaunchCore trusts, one per line (base64). They are compiled into the exe; the build fails if the file is missing or empty.

Create yours once:

```powershell
bun scripts/catalog-sign.ts keygen --private $env:USERPROFILE\.launchcore\catalog-signing.key
```

Commit `catalog.pub`. **Never** commit or copy the private key to the share. Store a backup somewhere offline.

To rotate a key, run `keygen` again. It appends a new line, so both keys are trusted. Re-sign the catalog with the new key, rebuild, then delete the old line and rebuild again.
