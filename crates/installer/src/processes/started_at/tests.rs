use super::*;

#[test]
fn macos_reads_as_seconds_and_six_digit_microseconds() {
    assert_eq!(macos(1_700_000_000_000_042), "1700000000.000042");
    assert_eq!(macos(5_000_000), "5.000000");
    assert_eq!(macos(999_999), "0.999999");
}

#[test]
fn linux_is_the_lowercase_boot_id_and_the_start_ticks() {
    assert_eq!(
        linux("0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0\n", 12345).unwrap(),
        "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0:12345"
    );
}

#[test]
fn a_linux_boot_id_that_is_not_one_is_refused() {
    assert!(linux("", 1).is_none());
    assert!(linux("not a boot id\n", 1).is_none());
    assert!(linux("0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0:7\n", 1).is_none());
}

#[test]
fn windows_is_the_decimal_filetime() {
    assert_eq!(windows(133_000_000_000_000_000), "133000000000000000");
}
