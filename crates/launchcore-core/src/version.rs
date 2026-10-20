//! Version comparison matching `compareVersions` in src/lib/catalog.ts.
//! "24.9" == "24.09"; missing segments count as 0, so "24.004" == "24.4.0.0".

use std::cmp::Ordering;

pub fn compare(a: &str, b: &str) -> Ordering {
    let split = |s: &str| s.split(['.', '-', '+']).map(str::to_owned).collect::<Vec<_>>();
    let (pa, pb) = (split(a), split(b));
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).map(String::as_str).unwrap_or("0");
        let y = pb.get(i).map(String::as_str).unwrap_or("0");
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(nx), Ok(ny)) => nx.cmp(&ny),
            _ => x.cmp(y),
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_numerically() {
        assert_eq!(compare("24.9", "24.09"), Ordering::Equal);
        assert_eq!(compare("24.004", "24.4.20272.0"), Ordering::Less);
        assert_eq!(compare("8.5.8", "8.7.1"), Ordering::Less);
        assert_eq!(compare("130.0.6723.70", "130.0.6723.70"), Ordering::Equal);
        assert_eq!(compare("10.0", "9.9"), Ordering::Greater);
    }
}
