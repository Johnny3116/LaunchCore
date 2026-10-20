//! Platform-independent LaunchCore logic. Everything here is pure and unit-tested on any OS.
//! Windows-specific work (detection, elevation, process launch) lives in the Tauri app.

pub mod catalog;
pub mod hash;
pub mod paths;
pub mod signature;
pub mod version;
