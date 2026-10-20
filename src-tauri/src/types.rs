//! Wire types shared with the UI. Field names and tags must match src/lib/service.ts.

use launchcore_core::catalog::Catalog;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub hostname: String,
    pub username: String,
    pub os_version: String,
    pub app_dir: String,
    pub log_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webview2_version: Option<String>,
    pub winget_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogLoad {
    pub ok: bool,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog: Option<Catalog>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DetectionStatus {
    Installed,
    Outdated,
    NotInstalled,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
    pub status: DetectionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl DetectionResult {
    pub fn unknown(detail: impl Into<String>) -> Self {
        Self { status: DetectionStatus::Unknown, installed_version: None, detail: Some(detail.into()) }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallPhase {
    Verifying,
    WaitingElevation,
    Installing,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InstallEvent {
    Phase { phase: InstallPhase },
    Log { level: LogLevel, message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InstallOutcome {
    #[serde(rename_all = "camelCase")]
    Success { exit_code: i64, reboot_required: bool, duration_ms: u64 },
    #[serde(rename_all = "camelCase")]
    Failed {
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i64>,
        reason: String,
        duration_ms: u64,
    },
    HashMismatch { expected: String, actual: String },
}
