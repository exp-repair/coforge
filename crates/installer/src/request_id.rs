//! Request ids for the installs and upgrades a person starts from the command line.
//!
//! An `install` has no id from the caller, so the installer makes one: an RFC 9562 version-4 UUID
//! in the form [`crate::contract::is_request_id`] accepts. Uniqueness is what it needs, not
//! secrecy: a request id names a receipt file, and a clash would replay another run's receipt. It
//! is never a credential.

use std::collections::hash_map::RandomState;
use std::hash::BuildHasher;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// A new request id: 122 bits from hashed randomness, time, process, and a counter, with the
/// version and variant bits of RFC 9562 set, lowercase and hyphenated.
pub fn new_request_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    let seed = (
        nanos,
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed),
    );
    // Each `RandomState` draws fresh keys from the OS, so the two halves do not share a source.
    let high = RandomState::new().hash_one(seed);
    let low = RandomState::new().hash_one((high, seed));
    let mut bytes = ((u128::from(high) << 64) | u128::from(low)).to_be_bytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests;
