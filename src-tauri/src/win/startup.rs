//! Pre-flight checks that must run before Tauri starts. Release builds have no console,
//! so any failure here is shown in a message box instead of disappearing silently.

use super::{pcwstr, wide};
use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};

/// Installed WebView2 runtime version (Evergreen, machine or per-user), if any.
/// Same API wry uses internally, so "found" here means Tauri can start.
pub fn webview2_version() -> Option<String> {
    let mut info = PWSTR::null();
    // SAFETY: null folder = look for the installed runtime; on success `info` is a CoTaskMem string.
    unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut info) }.ok()?;
    if info.is_null() {
        return None;
    }
    let v = webview2_com::take_pwstr(info);
    (!v.is_empty()).then_some(v)
}

pub fn require_webview2() -> Result<(), String> {
    match webview2_version() {
        Some(_) => Ok(()),
        None => Err(
            "LaunchCore needs the Microsoft Edge WebView2 Runtime, which isn't installed on this computer.\n\n\
             Install the Evergreen WebView2 Runtime (it ships with Windows 11 and most updated Windows 10 \
             machines), then run LaunchCore again."
                .into(),
        ),
    }
}

pub fn error_box(title: &str, message: &str) {
    let (t, m) = (wide(title), wide(message));
    // SAFETY: valid null-terminated strings; no owner window.
    unsafe {
        MessageBoxW(None, pcwstr(&m), pcwstr(&t), MB_OK | MB_ICONERROR);
    }
}
