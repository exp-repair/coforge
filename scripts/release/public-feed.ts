/**
 * Anonymous reads of a public release feed through its CDN: what the production candidate check
 * and staging's numbering read without a credential. A feed's object keys are publish.ts's
 * (`LATEST_OBJECT_KEY`, `manifestObjectKey`) and installer-feed.ts's.
 */

/** The fetch a feed read uses; tests inject one that answers from fixtures. */
export type FeedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The text of one feed object. Anything but a 200 throws, naming the URL and status; a read that
 * stalls gives up after 30 seconds. */
export async function readFeedObject(
  feedUrl: string,
  key: string,
  fetch: FeedFetch,
): Promise<string> {
  const url = `${feedUrl.replace(/\/+$/, "")}/${key}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}
