use std::fs;

use super::*;
use crate::lock::MachineMutationLock;
use crate::test_support::Scratch;

const ID: &str = "0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0";

fn entry() -> Transaction {
    Transaction {
        request_id: ID.to_owned(),
        from: Some("1.2.3".to_owned()),
        from_previous: Some("1.2.2".to_owned()),
        to: "1.2.4".to_owned(),
        supervisor_running: true,
    }
}

#[test]
fn a_recorded_transaction_is_read_back_until_it_is_cleared() {
    let root = Scratch::new("journal-roundtrip");
    let lock = MachineMutationLock::acquire(root.path()).unwrap();
    let journal = Journal::new(root.path());
    assert_eq!(journal.read().unwrap(), None);
    journal.record(&lock, &entry()).unwrap();
    assert_eq!(journal.read().unwrap(), Some(entry()));
    journal.clear(&lock).unwrap();
    assert_eq!(journal.read().unwrap(), None);
    journal.clear(&lock).unwrap();
}

#[test]
fn the_file_is_the_documented_json() {
    let root = Scratch::new("journal-json");
    let lock = MachineMutationLock::acquire(root.path()).unwrap();
    Journal::new(root.path()).record(&lock, &entry()).unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(root.path().join("installer-transaction.json")).unwrap())
            .unwrap();
    assert_eq!(
        value,
        serde_json::json!({
            "schema_version": 1,
            "request_id": ID,
            "from": "1.2.3",
            "from_previous": "1.2.2",
            "to": "1.2.4",
            "supervisor_running": true,
        })
    );
}

#[test]
fn a_journal_that_cannot_be_read_is_an_error_not_an_absence() {
    let root = Scratch::new("journal-garbage");
    fs::write(root.path().join("installer-transaction.json"), "{").unwrap();
    assert!(Journal::new(root.path()).read().is_err());
}

#[test]
fn a_lock_on_another_root_is_refused() {
    let root = Scratch::new("journal-root");
    let other = Scratch::new("journal-other");
    let lock = MachineMutationLock::acquire(other.path()).unwrap();
    assert!(Journal::new(root.path()).record(&lock, &entry()).is_err());
    assert_eq!(Journal::new(root.path()).read().unwrap(), None);
}

#[cfg(unix)]
#[test]
fn the_journal_is_private_to_the_user() {
    use std::os::unix::fs::PermissionsExt;
    let root = Scratch::new("journal-mode");
    let lock = MachineMutationLock::acquire(root.path()).unwrap();
    Journal::new(root.path()).record(&lock, &entry()).unwrap();
    let mode = fs::metadata(root.path().join("installer-transaction.json"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}
