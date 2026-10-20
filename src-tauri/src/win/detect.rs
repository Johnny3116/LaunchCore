//! "Is it installed, and which version?" for each catalog detection rule.

use super::{expand_env, file_version, hklm_string, pcwstr, wide};
use crate::types::{DetectionResult, DetectionStatus};
use launchcore_core::catalog::{Detection, Package};
use launchcore_core::version;
use std::cmp::Ordering;
use std::path::Path;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::ApplicationInstallationAndServicing::{
    MsiGetProductInfoW, MsiQueryProductStateW, INSTALLPROPERTY_VERSIONSTRING, INSTALLSTATE_DEFAULT,
};

pub fn detect(pkg: &Package) -> DetectionResult {
    let found = match &pkg.detection {
        Detection::MsiProductCode { product_code } => msi(product_code),
        Detection::Registry { key, value_name } => registry(key, value_name),
        Detection::File { path } => file(path),
    };
    match found {
        Err(e) => DetectionResult::unknown(e),
        Ok(None) => DetectionResult { status: DetectionStatus::NotInstalled, installed_version: None, detail: None },
        Ok(Some(installed)) => {
            let status = match installed.as_deref() {
                // Present but no version to compare — treat as installed.
                None | Some("") => DetectionStatus::Installed,
                Some(v) if version::compare(v, &pkg.version) == Ordering::Less => DetectionStatus::Outdated,
                Some(_) => DetectionStatus::Installed,
            };
            DetectionResult { status, installed_version: installed, detail: None }
        }
    }
}

/// Ok(None) = not installed; Ok(Some(version?)) = installed.
type Found = Result<Option<Option<String>>, String>;

fn msi(product_code: &str) -> Found {
    let code = wide(product_code);
    // SAFETY: valid null-terminated GUID string.
    let state = unsafe { MsiQueryProductStateW(pcwstr(&code)) };
    if state != INSTALLSTATE_DEFAULT {
        return Ok(None);
    }
    let mut len: u32 = 64;
    let mut buf = vec![0u16; len as usize];
    // SAFETY: buffer of `len` chars; len updated to chars written (excl. null).
    let rc = unsafe {
        MsiGetProductInfoW(
            pcwstr(&code),
            INSTALLPROPERTY_VERSIONSTRING,
            Some(windows::core::PWSTR(buf.as_mut_ptr())),
            Some(&mut len),
        )
    };
    if rc != ERROR_SUCCESS.0 {
        return Ok(Some(None));
    }
    Ok(Some(Some(String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())]))))
}

fn registry(key: &str, value_name: &str) -> Found {
    // Catalog validation guarantees the "HKLM\" prefix.
    let subkey = key.get(5..).unwrap_or_default();
    Ok(hklm_string(subkey, value_name)?.map(Some))
}

fn file(path: &str) -> Found {
    let expanded = expand_env(path)?;
    let p = Path::new(&expanded);
    if !p.is_file() {
        return Ok(None);
    }
    Ok(Some(file_version(p)?))
}
