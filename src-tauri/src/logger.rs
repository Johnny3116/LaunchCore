//! Append-only local log. Lives on the target machine, never on the kit (which may be read-only).
//!
//! One file per user per day: under default ProgramData ACLs, a file created by one user can't be
//! appended to by another, so a shared file would silently drop the second user's lines.
//! If ProgramData isn't writable at all, fall back to the user's LOCALAPPDATA.

use crate::types::LogLevel;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

struct Open {
    date: String,
    path: PathBuf,
    file: File,
}

pub struct Logger {
    candidates: Vec<PathBuf>,
    user: String,
    open: Mutex<Option<Open>>,
}

impl Logger {
    pub fn new() -> Self {
        let mut candidates = Vec::new();
        for var in ["ProgramData", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var) {
                candidates.push(PathBuf::from(base).join("LaunchCore").join("logs"));
            }
        }
        candidates.push(std::env::temp_dir().join("LaunchCore").join("logs"));
        Self { candidates, user: safe_user(), open: Mutex::new(None) }
    }

    /// Folder of the log currently in use (MSI verbose logs go next to it).
    pub fn dir(&self) -> PathBuf {
        self.current_path().parent().map(Path::to_path_buf).unwrap_or_else(std::env::temp_dir)
    }

    /// The log file actually being written, or where today's would go.
    pub fn current_path(&self) -> PathBuf {
        if let Ok(g) = self.open.lock() {
            if let Some(o) = g.as_ref() {
                return o.path.clone();
            }
        }
        self.candidates[0].join(self.file_name(&utc_now().0))
    }

    fn file_name(&self, date: &str) -> String {
        format!("launchcore-{date}-{}.log", self.user)
    }

    pub fn log(&self, level: LogLevel, pkg: Option<&str>, msg: &str) {
        let (date, ts) = utc_now();
        let lvl = match level {
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
        };
        let line = match pkg {
            Some(p) => format!("{ts} [{lvl}] pkg={p} {msg}\r\n"),
            None => format!("{ts} [{lvl}] {msg}\r\n"),
        };
        let Ok(mut guard) = self.open.lock() else { return };
        if guard.as_ref().map(|o| o.date != date).unwrap_or(true) {
            *guard = self.open_first_writable(&date);
        }
        if let Some(o) = guard.as_mut() {
            // Logging must never break an install; ignore write errors.
            let _ = o.file.write_all(line.as_bytes());
        }
    }

    fn open_first_writable(&self, date: &str) -> Option<Open> {
        let name = self.file_name(date);
        self.candidates.iter().find_map(|dir| {
            fs::create_dir_all(dir).ok()?;
            let path = dir.join(&name);
            let file = OpenOptions::new().create(true).append(true).open(&path).ok()?;
            Some(Open { date: date.to_string(), path, file })
        })
    }
}

/// Username safe for a file name.
fn safe_user() -> String {
    let raw = std::env::var("USERNAME").unwrap_or_else(|_| "unknown".into());
    let s: String = raw.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' }).collect();
    if s.is_empty() { "unknown".into() } else { s }
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
