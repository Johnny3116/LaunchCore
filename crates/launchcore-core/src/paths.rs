//! Resolve catalog-relative installer paths and prove they stay inside the kit folder.

use crate::catalog::check_relative_path;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum PathError {
    #[error("invalid installer path: {0}")]
    Invalid(&'static str),
    #[error("installer not found: {0}")]
    NotFound(String),
    #[error("installer path escapes the LaunchCore folder")]
    Escapes,
    #[error("cannot resolve path: {0}")]
    Io(#[from] io::Error),
}

/// Join `rel` onto the kit root and canonicalize. Catches symlink/junction escapes that
/// string checks can't. Both sides are canonicalized so UNC (`\\?\UNC\...`) prefixes agree.
pub fn resolve_in_kit(kit_root: &Path, rel: &str) -> Result<PathBuf, PathError> {
    check_relative_path(rel).map_err(PathError::Invalid)?;
    let joined: PathBuf = rel.split(['/', '\\']).filter(|s| !s.is_empty()).fold(kit_root.to_path_buf(), |p, s| p.join(s));
    if joined.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(PathError::Escapes);
    }
    let root = kit_root.canonicalize()?;
    let full = joined.canonicalize().map_err(|e| match e.kind() {
        io::ErrorKind::NotFound => PathError::NotFound(rel.to_string()),
        _ => PathError::Io(e),
    })?;
    if !full.starts_with(&root) {
        return Err(PathError::Escapes);
    }
    if !full.is_file() {
        return Err(PathError::NotFound(rel.to_string()));
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("launchcore-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn resolves_inside_and_rejects_missing() {
        let kit = tmpdir("paths");
        fs::create_dir_all(kit.join("packages/a")).unwrap();
        fs::write(kit.join("packages/a/x.msi"), b"x").unwrap();
        assert!(resolve_in_kit(&kit, "packages/a/x.msi").is_ok());
        assert!(resolve_in_kit(&kit, "packages\\a\\x.msi").is_ok());
        assert!(matches!(resolve_in_kit(&kit, "packages/a/missing.msi"), Err(PathError::NotFound(_))));
        assert!(matches!(resolve_in_kit(&kit, "../x.msi"), Err(PathError::Invalid(_))));
        let _ = fs::remove_dir_all(&kit);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let kit = tmpdir("symlink");
        let outside = tmpdir("outside");
        fs::write(outside.join("evil.msi"), b"x").unwrap();
        std::os::unix::fs::symlink(&outside, kit.join("packages")).unwrap();
        assert!(matches!(resolve_in_kit(&kit, "packages/evil.msi"), Err(PathError::Escapes)));
        let _ = fs::remove_dir_all(&kit);
        let _ = fs::remove_dir_all(&outside);
    }
}
