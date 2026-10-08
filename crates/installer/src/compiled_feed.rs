//! The release feed this installer build reads, compiled in and never changed at run time.
//!
//! `COFORGE_RELEASE_FEED_URL` is read at build time only, so an installer cannot be pointed at an
//! unofficial feed by its environment. The default is the production feed, the one
//! `packages/computer/src/release-channel.ts` defaults to. A local end-to-end build may name a
//! loopback `http://` feed; any other plain-HTTP URL is refused at startup.

use crate::fetch::Transport;

/// The production feed, without a trailing slash (the feed client trims one anyway).
pub const DEFAULT_FEED: &str = "https://releases.coforge.cn";

/// Where the feed is and how its transfers are made.
#[derive(Debug, PartialEq, Eq)]
pub struct FeedEndpoint {
    pub base_url: String,
    pub transport: Transport,
}

/// The endpoint this build was compiled with.
pub fn compiled() -> Result<FeedEndpoint, String> {
    endpoint_for(option_env!("COFORGE_RELEASE_FEED_URL"))
}

/// The endpoint for a compiled `COFORGE_RELEASE_FEED_URL` value (`None` or empty: the default).
pub fn endpoint_for(compiled: Option<&str>) -> Result<FeedEndpoint, String> {
    let raw = compiled
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_FEED);
    let base_url = raw.trim_end_matches('/').to_owned();
    if base_url.starts_with("https://") {
        return Ok(FeedEndpoint {
            base_url,
            transport: Transport::Https,
        });
    }
    if base_url.starts_with("http://127.0.0.1:") || base_url.starts_with("http://localhost:") {
        return Ok(FeedEndpoint {
            base_url,
            transport: Transport::LoopbackHttp,
        });
    }
    Err(format!(
        "the compiled release feed {raw} must be an https:// URL; only a local end-to-end build \
         may use http://127.0.0.1 or http://localhost"
    ))
}

#[cfg(test)]
mod tests;
