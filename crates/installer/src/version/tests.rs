use std::fs;
use std::path::PathBuf;

use super::*;
use crate::contract::ReleaseVersions;

#[test]
fn agrees_with_the_computer_on_every_contract_case() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("contract/release-versions.json");
    let versions: ReleaseVersions =
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    for case in versions.cases {
        assert_eq!(
            is_valid_release_version(&case.value),
            case.valid,
            "{:?}",
            case.value
        );
    }
}

#[test]
fn orders_release_versions_by_semver_precedence() {
    use std::cmp::Ordering::{Equal, Greater, Less};

    assert_eq!(precedence("0.1.0-e2e.2", "0.1.0-e2e.10"), Some(Less));
    assert_eq!(precedence("0.1.0-e2e.10", "0.1.0"), Some(Less));
    assert_eq!(precedence("0.1.0", "0.1.0-e2e.10"), Some(Greater));
    assert_eq!(precedence("0.1.0", "0.2.0"), Some(Less));
    assert_eq!(precedence("0.2.0", "0.2.0"), Some(Equal));
}

#[test]
fn a_version_that_is_not_semver_has_no_precedence() {
    assert_eq!(precedence("1.0", "0.1.0"), None);
    assert_eq!(precedence("0.1.0", "v0.2"), None);
}
