use super::{hklm_string, winget_path};
use super::startup::webview2_version;
use crate::types::Environment;
use std::path::Path;

pub fn environment(kit: &Path, log_path: &Path) -> Environment {
    let var = |k: &str| std::env::var(k).unwrap_or_default();
    let username = match (var("USERDOMAIN"), var("USERNAME")) {
        (d, u) if d.is_empty() => u,
        (d, u) => format!("{d}\\{u}"),
    };
    Environment {
        hostname: var("COMPUTERNAME"),
        username,
        os_version: os_version(),
        app_dir: kit.display().to_string(),
        log_path: log_path.display().to_string(),
        webview2_version: webview2_version(),
        winget_available: winget_path().is_some(),
    }
}

fn os_version() -> String {
    const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let get = |v: &str| hklm_string(KEY, v).ok().flatten().unwrap_or_default();
    let mut product = get("ProductName");
    let build = get("CurrentBuildNumber");
    // ProductName still says "Windows 10" on Windows 11; build 22000+ is Windows 11.
    if build.parse::<u32>().map(|b| b >= 22000).unwrap_or(false) {
        product = product.replacen("Windows 10", "Windows 11", 1);
    }
    let display = get("DisplayVersion");
    [product, display, if build.is_empty() { String::new() } else { format!("(build {build})") }]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
