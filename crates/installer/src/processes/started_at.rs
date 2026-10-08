//! The start time of a stopped process as an upgrade receipt records it
//! (`DeadProcessIdentitySchema` in packages/coforge-sdk/src/internal/upgrade-receipt.ts): each
//! platform's own value, written without conversion, compared only for equality on the machine
//! that wrote it. Pure text, compiled on every platform under test.

/// macOS: `<seconds>.<microseconds>`, the microseconds six digits. `started_at` is what the
/// libproc adapter reads, `pbi_start_tvsec * 1_000_000 + pbi_start_tvusec`.
#[cfg(any(target_os = "macos", test))]
pub(super) fn macos(started_at: u64) -> String {
    format!("{}.{:06}", started_at / 1_000_000, started_at % 1_000_000)
}

/// Linux: `<boot id>:<start ticks>`. The ticks count from boot, so the boot id
/// (`/proc/sys/kernel/random/boot_id`, as read) keeps a pid recycled after a reboot apart. `None`
/// when `boot_id` is not a UUID.
#[cfg(any(target_os = "linux", test))]
pub(super) fn linux(boot_id: &str, start_ticks: u64) -> Option<String> {
    let boot_id = boot_id.trim().to_ascii_lowercase();
    let groups: Vec<&str> = boot_id.split('-').collect();
    let uuid = groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, length)| {
            group.len() == length && group.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
    uuid.then(|| format!("{boot_id}:{start_ticks}"))
}

/// Windows: the creation time from `GetProcessTimes`, in decimal `FILETIME` ticks.
#[cfg(any(windows, test))]
pub(super) fn windows(creation_time: u64) -> String {
    creation_time.to_string()
}

#[cfg(test)]
mod tests;
