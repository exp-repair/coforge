use super::*;
use crate::fetch::Transport;

fn https(base_url: &str) -> FeedEndpoint {
    FeedEndpoint {
        base_url: base_url.to_owned(),
        transport: Transport::Https,
    }
}

#[test]
fn an_unset_or_empty_feed_is_the_production_feed() {
    assert_eq!(endpoint_for(None), Ok(https("https://releases.coforge.cn")));
    assert_eq!(
        endpoint_for(Some("")),
        Ok(https("https://releases.coforge.cn"))
    );
}

#[test]
fn an_https_feed_is_used_without_its_trailing_slash() {
    assert_eq!(
        endpoint_for(Some("https://releases-staging.coforge.cn/")),
        Ok(https("https://releases-staging.coforge.cn"))
    );
}

#[test]
fn an_https_feed_uses_the_https_transport() {
    assert_eq!(
        endpoint_for(Some("https://releases.coforge.cn")).map(|endpoint| endpoint.transport),
        Ok(Transport::Https)
    );
}

#[test]
fn a_loopback_feed_is_allowed_for_local_end_to_end_builds_only() {
    assert_eq!(
        endpoint_for(Some("http://127.0.0.1:8443/")),
        Ok(FeedEndpoint {
            base_url: "http://127.0.0.1:8443".to_owned(),
            transport: Transport::LoopbackHttp,
        })
    );
    assert!(
        endpoint_for(Some("http://localhost:9000"))
            .is_ok_and(|endpoint| endpoint.transport == Transport::LoopbackHttp)
    );
}

#[test]
fn any_other_plain_http_feed_is_refused_naming_it() {
    for raw in [
        "http://example.com",
        "http://127.0.0.1.example.com:8443",
        "http://127.0.0.1",
        "ftp://releases.coforge.cn",
    ] {
        let error = endpoint_for(Some(raw)).expect_err(raw);
        assert!(error.contains(raw), "{error}");
    }
}
