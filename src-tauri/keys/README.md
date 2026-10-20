# Trusted catalog keys

`catalog.pub` holds the Ed25519 **public** keys LaunchCore trusts, one per line (base64). They are compiled into the exe; the build fails if the file is missing or empty.

Create yours once with `bun run setup`. Setup runs `keygen` for you and uses `%USERPROFILE%\.launchcore\catalog-signing.key`. On a new clone where you already have the key, setup re-trusts it. You can also run that step yourself with `bun run catalog trust --private <key>`.

Commit `catalog.pub`. **Never** commit or copy the private key to the share. Store a backup somewhere offline.

To rotate a key, run `bun run catalog keygen --private <new path>`. It appends a new line, so both keys are trusted. Re-sign the catalog with the new key, rebuild, then delete the old line and rebuild again.
