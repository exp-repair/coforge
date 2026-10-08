//! Which release version strings are acceptable. A version is both a URL segment on the release
//! feed and a directory name under `versions/`, so the rule (the Computer's
//! `isValidReleaseVersion`; crates/installer/contract/release-versions.json) keeps it to one
//! safe path segment: 1 to 100 of `A-Z a-z 0-9 . + -`, not `.` alone, no `..` anywhere (no
//! traversal), and no leading `-` (never mistaken for a flag).

use std::cmp::Ordering;

use semver::Version;

/// How `target` orders against `installed` by SemVer precedence (a pre-release is below its
/// release, and numeric pre-release identifiers compare as numbers). `None` when either is not a
/// SemVer version, so the order is unknown.
pub fn precedence(target: &str, installed: &str) -> Option<Ordering> {
    let target = Version::parse(target).ok()?;
    let installed = Version::parse(installed).ok()?;
    Some(target.cmp_precedence(&installed))
}

pub fn is_valid_release_version(value: &str) -> bool {
    (1..=100).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
        && value != "."
        && !value.contains("..")
        && !value.starts_with('-')
}

#[cfg(test)]
mod tests;
