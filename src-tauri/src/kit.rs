//! The kit folder (where LaunchCore.exe lives) and loading its signed catalog.

use launchcore_core::{catalog, signature};
use std::path::{Path, PathBuf};

/// Trusted catalog signing keys, compiled in at build time. build.rs refuses to build without them.
const TRUSTED_KEYS: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/keys/catalog.pub"));

pub const CATALOG_FILE: &str = "catalog.json";

/// Folder containing LaunchCore.exe. Debug builds may override with LAUNCHCORE_KIT_DIR for
/// development; release builds ignore it so the kit is always "where the exe is".
pub fn kit_dir() -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("LAUNCHCORE_KIT_DIR") {
        return PathBuf::from(dir);
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Read, verify (signature first, on raw bytes) and validate the catalog.
pub fn load_catalog(kit: &Path) -> Result<catalog::Catalog, Vec<String>> {
    let path = kit.join(CATALOG_FILE);
    let sig_path = kit.join(format!("{CATALOG_FILE}.sig"));

    let bytes = std::fs::read(&path).map_err(|e| vec![format!("cannot read {}: {e}", path.display())])?;
    let sig = std::fs::read_to_string(&sig_path).map_err(|e| {
        vec![format!(
            "cannot read {} ({e}). Unsigned catalogs are refused — sign it with scripts/catalog-sign.ts",
            sig_path.display()
        )]
    })?;
    let keys = signature::parse_trusted_keys(TRUSTED_KEYS).map_err(|e| vec![e.to_string()])?;
    signature::verify_catalog(&bytes, &sig, &keys).map_err(|e| vec![e.to_string()])?;
    catalog::parse_catalog(&bytes).map_err(|e| e.messages())
}
