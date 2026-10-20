use std::path::Path;

fn main() {
    // The trusted catalog public key(s) are compiled into the exe. Fail the build loudly
    // with instructions rather than shipping a binary that trusts nothing (or anything).
    let keys = Path::new("keys/catalog.pub");
    println!("cargo:rerun-if-changed=keys/catalog.pub");
    let usable = std::fs::read_to_string(keys)
        .map(|t| t.lines().any(|l| !l.trim().is_empty() && !l.trim().starts_with('#')))
        .unwrap_or(false);
    if !usable {
        panic!(
            "\n\nsrc-tauri/keys/catalog.pub is missing or has no keys.\n\
             Generate your catalog signing key once:\n\
             \n    bun scripts/catalog-sign.ts keygen --private <path OUTSIDE the repo>\n\n\
             then rebuild. See README > Catalog signing.\n\n"
        );
    }
    tauri_build::build()
}
