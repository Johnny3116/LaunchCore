//! Append-only local log. Lives on the target machine, never on the kit (which may be read-only).

use crate::types::LogLevel;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Logger {
    dir: PathBuf,
    file: Mutex<Option<(String, File)>>,
}

impl Logger {
    pub fn new() -> Self {
        Self { dir: log_dir(), file: Mutex::new(None) }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Today's log file path (UTC date).
    pub fn current_path(&self) -> PathBuf {
        self.dir.join(format!("launchcore-{}.log", utc_now().0))
    }

    pub fn log(&self, level: LogLevel, pkg: Option<&str>, msg: &str) {
        let (date, ts) = utc_now();
        let lvl = match level {
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        };
        let user = std::env::var("USERNAME").unwrap_or_default();
        let line = match pkg {
            Some(p) => format!("{ts} [{lvl}] user={user} pkg={p} {msg}\r\n"),
            None => format!("{ts} [{lvl}] user={user} {msg}\r\n"),
        };
        let Ok(mut guard) = self.file.lock() else { return };
        if guard.as_ref().map(|(d, _)| d != &date).unwrap_or(true) {
            let _ = fs::create_dir_all(&self.dir);
            *guard = OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.dir.join(format!("launchcore-{date}.log")))
                .ok()
                .map(|f| (date.clone(), f));
        }
        if let Some((_, f)) = guard.as_mut() {
            // Logging must never break an install; ignore write errors.
            let _ = f.write_all(line.as_bytes());
        }
    }
}

fn log_dir() -> PathBuf {
    for var in ["ProgramData", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            let dir = PathBuf::from(base).join("LaunchCore").join("logs");
            if fs::create_dir_all(&dir).is_ok() {
                return dir;
            }
        }
    }
    std::env::temp_dir().join("LaunchCore").join("logs")
}

/// ("YYYY-MM-DD", "YYYY-MM-DDTHH:MM:SSZ") in UTC without pulling in a date crate.
pub fn utc_now() -> (String, String) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = ((secs / 86_400) as i64, secs % 86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    let date = format!("{y:04}-{m:02}-{d:02}");
    let ts = format!("{date}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60);
    (date, ts)
}
