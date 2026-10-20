use sha2::{Digest, Sha256};
use std::io::{self, Read};

/// Stream a reader through SHA-256; returns lowercase hex.
pub fn sha256_hex<R: Read>(mut r: R) -> io::Result<String> {
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Constant-time-ish compare isn't needed (hashes aren't secrets); normalize case only.
pub fn hashes_match(expected: &str, actual: &str) -> bool {
    expected.eq_ignore_ascii_case(actual)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vector() {
        assert_eq!(
            sha256_hex(&b"abc"[..]).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(hashes_match("ABCDEF", "abcdef"));
    }
}
