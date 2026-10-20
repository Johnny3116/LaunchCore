//! Verify a signed catalog exactly the way LaunchCore.exe will.
//!   cargo run -p launchcore-core --example verify -- <catalog.json> <catalog.pub>

use launchcore_core::{catalog, signature};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [catalog_path, pub_path] = args.as_slice() else {
        eprintln!("usage: verify <catalog.json> <catalog.pub>");
        return ExitCode::from(2);
    };
    let run = || -> Result<usize, String> {
        let bytes = std::fs::read(catalog_path).map_err(|e| format!("{catalog_path}: {e}"))?;
        let sig = std::fs::read_to_string(format!("{catalog_path}.sig")).map_err(|e| format!("{catalog_path}.sig: {e}"))?;
        let keys_text = std::fs::read_to_string(pub_path).map_err(|e| format!("{pub_path}: {e}"))?;
        let keys = signature::parse_trusted_keys(&keys_text).map_err(|e| e.to_string())?;
        signature::verify_catalog(&bytes, &sig, &keys).map_err(|e| e.to_string())?;
        let c = catalog::parse_catalog(&bytes).map_err(|e| e.messages().join("\n"))?;
        Ok(c.packages.len())
    };
    match run() {
        Ok(n) => {
            println!("OK — signature valid, {n} packages");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("FAIL — {e}");
            ExitCode::FAILURE
        }
    }
}
