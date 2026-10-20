//! catalog.json model and validation. Mirrors `src/lib/catalog.ts` (zod) on the UI side.
//! The backend never trusts the UI's validation — this is the authoritative check.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema_version: u32,
    #[serde(default = "default_catalog_name")]
    pub name: String,
    pub packages: Vec<Package>,
}

fn default_catalog_name() -> String {
    "LaunchCore Catalog".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub installer: Installer,
    pub detection: Detection,
}

fn default_category() -> String {
    "General".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Installer {
    Msi(LocalInstaller),
    Exe(LocalInstaller),
    Winget(WingetInstaller),
}

impl Installer {
    pub fn success_codes(&self) -> &[i64] {
        match self {
            Installer::Msi(l) | Installer::Exe(l) => &l.success_codes,
            Installer::Winget(w) => &w.success_codes,
        }
    }
    pub fn reboot_codes(&self) -> &[i64] {
        match self {
            Installer::Msi(l) | Installer::Exe(l) => &l.reboot_codes,
            Installer::Winget(w) => &w.reboot_codes,
        }
    }
    pub fn timeout_minutes(&self) -> u32 {
        match self {
            Installer::Msi(l) | Installer::Exe(l) => l.timeout_minutes,
            Installer::Winget(w) => w.timeout_minutes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalInstaller {
    pub path: String,
    pub sha256: String,
    #[serde(default)]
    pub args: String,
    #[serde(default = "default_local_success")]
    pub success_codes: Vec<i64>,
    #[serde(default = "default_local_reboot")]
    pub reboot_codes: Vec<i64>,
    #[serde(default = "default_timeout")]
    pub timeout_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetInstaller {
    pub package_id: String,
    #[serde(default = "default_true")]
    pub pin_version: bool,
    #[serde(default)]
    pub scope: WingetScope,
    #[serde(default = "default_winget_success")]
    pub success_codes: Vec<i64>,
    #[serde(default)]
    pub reboot_codes: Vec<i64>,
    #[serde(default = "default_timeout")]
    pub timeout_minutes: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WingetScope {
    #[default]
    Machine,
    User,
}

fn default_local_success() -> Vec<i64> {
    vec![0, 3010]
}
fn default_local_reboot() -> Vec<i64> {
    vec![3010]
}
fn default_winget_success() -> Vec<i64> {
    vec![0]
}
fn default_timeout() -> u32 {
    30
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Detection {
    #[serde(rename_all = "camelCase")]
    MsiProductCode { product_code: String },
    #[serde(rename_all = "camelCase")]
    Registry { key: String, value_name: String },
    #[serde(rename_all = "camelCase")]
    File { path: String },
}

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("catalog is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("catalog failed validation")]
    Invalid(Vec<String>),
}

impl CatalogError {
    /// Flatten into human-readable lines for the UI.
    pub fn messages(&self) -> Vec<String> {
        match self {
            CatalogError::Json(e) => vec![format!("(root): {e}")],
            CatalogError::Invalid(v) => v.clone(),
        }
    }
}

/// Parse and fully validate catalog bytes. Signature checking happens before this, on the raw bytes.
pub fn parse_catalog(bytes: &[u8]) -> Result<Catalog, CatalogError> {
    let catalog: Catalog = serde_json::from_slice(bytes)?;
    let errors = validate(&catalog);
    if errors.is_empty() {
        Ok(catalog)
    } else {
        Err(CatalogError::Invalid(errors))
    }
}

pub fn validate(c: &Catalog) -> Vec<String> {
    let mut e = Vec::new();
    if c.schema_version != 1 {
        e.push(format!("schemaVersion: unsupported version {}", c.schema_version));
    }
    if c.name.chars().count() > 80 {
        e.push("name: at most 80 characters".into());
    }
    let mut seen = HashSet::new();
    for (i, p) in c.packages.iter().enumerate() {
        let at = |field: &str| format!("packages.{i}.{field}");
        if !is_package_id(&p.id) {
            e.push(format!("{}: lowercase letters, digits and dashes (2-64 chars)", at("id")));
        }
        if !seen.insert(p.id.as_str()) {
            e.push(format!("{}: duplicate id '{}'", at("id"), p.id));
        }
        if p.name.is_empty() || p.name.chars().count() > 100 {
            e.push(format!("{}: 1-100 characters", at("name")));
        }
        if p.version.is_empty() || p.version.chars().count() > 40 {
            e.push(format!("{}: 1-40 characters", at("version")));
        }
        if let Some(color) = &p.color {
            if !(color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|ch| ch.is_ascii_hexdigit())) {
                e.push(format!("{}: must be a #RRGGBB hex color", at("color")));
            }
        }
        match &p.installer {
            Installer::Msi(l) | Installer::Exe(l) => {
                if let Err(msg) = check_relative_path(&l.path) {
                    e.push(format!("{}: {msg}", at("installer.path")));
                }
                if !(l.sha256.len() == 64 && l.sha256.chars().all(|ch| ch.is_ascii_hexdigit())) {
                    e.push(format!("{}: must be a 64-character hex SHA-256 hash", at("installer.sha256")));
                }
                if !is_safe_args(&l.args) {
                    e.push(format!("{}: must not contain \" & | < > ^ ` or newlines", at("installer.args")));
                }
                if l.success_codes.is_empty() {
                    e.push(format!("{}: at least one code", at("installer.successCodes")));
                }
            }
            Installer::Winget(w) => {
                if !is_winget_id(&w.package_id) {
                    e.push(format!("{}: must be a winget package id like Vendor.App", at("installer.packageId")));
                }
                if w.pin_version && !is_winget_version(&p.version) {
                    e.push(format!(
                        "{}: pinned winget versions may only use letters, digits and . _ + -",
                        at("version")
                    ));
                }
                if w.success_codes.is_empty() {
                    e.push(format!("{}: at least one code", at("installer.successCodes")));
                }
            }
        }
        let t = p.installer.timeout_minutes();
        if t == 0 || t > 240 {
            e.push(format!("{}: 1-240", at("installer.timeoutMinutes")));
        }
        match &p.detection {
            Detection::MsiProductCode { product_code } => {
                if !is_guid(product_code) {
                    e.push(format!("{}: must be a {{GUID}}", at("detection.productCode")));
                }
            }
            Detection::Registry { key, value_name } => {
                if !key.to_ascii_uppercase().starts_with("HKLM\\") || key.len() <= 5 {
                    e.push(format!("{}: registry detection must use an HKLM\\ key", at("detection.key")));
                }
                if value_name.is_empty() {
                    e.push(format!("{}: required", at("detection.valueName")));
                }
            }
            Detection::File { path } => {
                if path.is_empty() {
                    e.push(format!("{}: required", at("detection.path")));
                }
            }
        }
    }
    e
}

fn is_package_id(s: &str) -> bool {
    let b = s.as_bytes();
    (2..=64).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

pub fn is_winget_id(s: &str) -> bool {
    let b = s.as_bytes();
    (2..=100).contains(&b.len())
        && b[0].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'+' | b'_' | b'-'))
}

pub fn is_winget_version(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'+' | b'_' | b'-'))
}

fn is_safe_args(s: &str) -> bool {
    s.len() <= 1000 && !s.chars().any(|c| matches!(c, '"' | '&' | '|' | '<' | '>' | '^' | '`' | '\r' | '\n'))
}

fn is_guid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 38 || b[0] != b'{' || b[37] != b'}' {
        return false;
    }
    b[1..37].iter().enumerate().all(|(i, c)| match i {
        8 | 13 | 18 | 23 => *c == b'-',
        _ => c.is_ascii_hexdigit(),
    })
}

/// Installer paths must stay inside the kit: relative, no drive/UNC roots, no `..`, no quotes.
pub fn check_relative_path(p: &str) -> Result<(), &'static str> {
    if p.is_empty() {
        return Err("required");
    }
    let b = p.as_bytes();
    if p.starts_with('/') || p.starts_with('\\') || (b.len() >= 2 && b[1] == b':') {
        return Err("must be relative to the LaunchCore folder (no drive letters or UNC roots)");
    }
    if p.split(['/', '\\']).any(|seg| seg == "..") {
        return Err("must not contain '..' segments");
    }
    if p.contains('"') || p.contains(':') {
        return Err("must not contain quotes or colons");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r##"{
      "schemaVersion": 1,
      "name": "Test",
      "packages": [
        { "id": "7zip", "name": "7-Zip", "version": "24.09", "color": "#A2845E",
          "installer": { "type": "msi", "path": "packages/7zip/7z.msi",
            "sha256": "0000000000000000000000000000000000000000000000000000000000000001", "args": "/qn" },
          "detection": { "type": "msiProductCode", "productCode": "{00000000-0000-0000-0000-000000000001}" } },
        { "id": "powertoys", "name": "PowerToys", "version": "0.85.1",
          "installer": { "type": "winget", "packageId": "Microsoft.PowerToys" },
          "detection": { "type": "registry", "key": "HKLM\\SOFTWARE\\X", "valueName": "DisplayVersion" } }
      ]
    }"##;

    #[test]
    fn parses_valid_catalog_with_defaults() {
        let c = parse_catalog(GOOD.as_bytes()).expect("valid");
        assert_eq!(c.packages.len(), 2);
        match &c.packages[0].installer {
            Installer::Msi(l) => assert_eq!(l.success_codes, vec![0, 3010]),
            _ => panic!("expected msi"),
        }
        match &c.packages[1].installer {
            Installer::Winget(w) => {
                assert!(w.pin_version);
                assert_eq!(w.scope, WingetScope::Machine);
            }
            _ => panic!("expected winget"),
        }
        assert_eq!(c.packages[1].category, "General");
    }

    #[test]
    fn rejects_path_escape_and_absolute_paths() {
        assert!(check_relative_path("packages/a.msi").is_ok());
        assert!(check_relative_path("..\\evil.msi").is_err());
        assert!(check_relative_path("packages/../../evil.msi").is_err());
        assert!(check_relative_path("C:\\Windows\\evil.exe").is_err());
        assert!(check_relative_path("\\\\server\\share\\evil.exe").is_err());
        assert!(check_relative_path("a\"b.msi").is_err());
    }

    #[test]
    fn rejects_injection_in_args_and_winget_ids() {
        let bad = GOOD.replace("\"/qn\"", "\"/qn & calc.exe\"");
        let err = parse_catalog(bad.as_bytes()).unwrap_err().messages();
        assert!(err.iter().any(|m| m.contains("installer.args")), "{err:?}");

        assert!(is_winget_id("Microsoft.PowerToys"));
        assert!(!is_winget_id("Git.Git & del C:\\"));
        assert!(!is_winget_id("x"));
    }

    #[test]
    fn rejects_duplicates_bad_guid_and_non_hklm() {
        let bad = GOOD
            .replace("\"powertoys\"", "\"7zip\"")
            .replace("{00000000-0000-0000-0000-000000000001}", "not-a-guid")
            .replace("HKLM\\\\SOFTWARE", "HKCU\\\\SOFTWARE");
        let err = parse_catalog(bad.as_bytes()).unwrap_err().messages();
        assert!(err.iter().any(|m| m.contains("duplicate id")), "{err:?}");
        assert!(err.iter().any(|m| m.contains("productCode")), "{err:?}");
        assert!(err.iter().any(|m| m.contains("HKLM")), "{err:?}");
    }

    #[test]
    fn guid_check() {
        assert!(is_guid("{23170F69-40C1-2702-2409-000001000000}"));
        assert!(!is_guid("23170F69-40C1-2702-2409-000001000000"));
        assert!(!is_guid("{23170F69_40C1-2702-2409-000001000000}"));
    }
}
