//! Ed25519 catalog signatures. The signature covers the exact bytes of catalog.json.
//! Trusted public keys are raw 32-byte keys, base64, one per line (comments with `#`).
//! Format matches `scripts/catalog-sign.ts`.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SignatureError {
    #[error("no trusted catalog keys are compiled into this build")]
    NoTrustedKeys,
    #[error("trusted key on line {0} is malformed")]
    BadTrustedKey(usize),
    #[error("signature file is malformed (expected base64 of 64 bytes)")]
    BadSignature,
    #[error("catalog signature does not match any trusted key — the catalog was modified or signed with an untrusted key")]
    Mismatch,
}

/// Parse the trusted-key file. Fails closed on any malformed line.
pub fn parse_trusted_keys(text: &str) -> Result<Vec<VerifyingKey>, SignatureError> {
    let mut keys = Vec::new();
    for (i, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let raw = STANDARD.decode(line).map_err(|_| SignatureError::BadTrustedKey(i + 1))?;
        let arr: [u8; 32] = raw.try_into().map_err(|_| SignatureError::BadTrustedKey(i + 1))?;
        keys.push(VerifyingKey::from_bytes(&arr).map_err(|_| SignatureError::BadTrustedKey(i + 1))?);
    }
    if keys.is_empty() {
        return Err(SignatureError::NoTrustedKeys);
    }
    Ok(keys)
}

/// Verify `catalog` against the `.sig` file contents using any trusted key.
pub fn verify_catalog(catalog: &[u8], sig_file: &str, trusted: &[VerifyingKey]) -> Result<(), SignatureError> {
    if trusted.is_empty() {
        return Err(SignatureError::NoTrustedKeys);
    }
    let raw = STANDARD.decode(sig_file.trim()).map_err(|_| SignatureError::BadSignature)?;
    let arr: [u8; 64] = raw.try_into().map_err(|_| SignatureError::BadSignature)?;
    let sig = Signature::from_bytes(&arr);
    if trusted.iter().any(|k| k.verify_strict(catalog, &sig).is_ok()) {
        Ok(())
    } else {
        Err(SignatureError::Mismatch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn keypair(seed: u8) -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[seed; 32]);
        let pk = STANDARD.encode(sk.verifying_key().to_bytes());
        (sk, pk)
    }

    #[test]
    fn accepts_valid_signature_from_any_trusted_key() {
        let (sk_a, pk_a) = keypair(1);
        let (_, pk_b) = keypair(2);
        let keys = parse_trusted_keys(&format!("# comment\n{pk_b}\n\n{pk_a}\n")).unwrap();
        let msg = br#"{"schemaVersion":1}"#;
        let sig = STANDARD.encode(sk_a.sign(msg).to_bytes());
        assert_eq!(verify_catalog(msg, &format!("{sig}\n"), &keys), Ok(()));
    }

    #[test]
    fn rejects_tampered_catalog_and_untrusted_key() {
        let (sk_a, _) = keypair(1);
        let (_, pk_b) = keypair(2);
        let keys = parse_trusted_keys(&pk_b).unwrap();
        let msg = b"original";
        let sig = STANDARD.encode(sk_a.sign(msg).to_bytes());
        assert_eq!(verify_catalog(msg, &sig, &keys), Err(SignatureError::Mismatch));

        let (sk_b, _) = keypair(2);
        let sig_b = STANDARD.encode(sk_b.sign(msg).to_bytes());
        assert_eq!(verify_catalog(b"original ", &sig_b, &keys), Err(SignatureError::Mismatch));
    }

    #[test]
    fn fails_closed_on_garbage() {
        assert_eq!(parse_trusted_keys("# only comments\n"), Err(SignatureError::NoTrustedKeys));
        assert_eq!(parse_trusted_keys("not base64!!"), Err(SignatureError::BadTrustedKey(1)));
        let (_, pk) = keypair(3);
        let keys = parse_trusted_keys(&pk).unwrap();
        assert_eq!(verify_catalog(b"x", "AAAA", &keys), Err(SignatureError::BadSignature));
    }
}
