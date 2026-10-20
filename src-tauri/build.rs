use std::path::Path;

fn main() {
    // The trusted catalog public key(s) are compiled into the exe. Fail the build loudly
    // with instructions rather than shipping a binary that trusts nothing (or anything).
    let keys = Path::new("keys/catalog.pub");
    println!("cargo:rerun-if-changed=keys/catalog.pub");
    // Declaring any rerun-if-changed narrows Cargo's watch list, so name the icon explicitly too.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    let usable = std::fs::read_to_string(keys)
        .map(|t| t.lines().any(|l| !l.trim().is_empty() && !l.trim().starts_with('#')))
        .unwrap_or(false);
    if !usable {
        panic!(
            "\n\nsrc-tauri/keys/catalog.pub is missing or has no keys.\n\
             Run first-time setup (creates your signing key, never overwrites one):\n\
             \n    bun run setup\n\n\
             then rebuild. See README > Quick start.\n\n"
        );
    }
    tauri_build::build()
}
