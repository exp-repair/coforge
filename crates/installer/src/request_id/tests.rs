use std::collections::HashSet;

use super::*;
use crate::contract::is_request_id;

#[test]
fn a_generated_id_is_a_request_id_in_version_4_form() {
    let id = new_request_id();

    assert!(is_request_id(&id), "{id}");
    assert_eq!(id.len(), 36);
    assert_eq!(&id[14..15], "4");
    assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"), "{id}");
}

#[test]
fn generated_ids_differ() {
    let ids: HashSet<String> = (0..200).map(|_| new_request_id()).collect();

    assert_eq!(ids.len(), 200);
}
