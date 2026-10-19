#!/usr/bin/env bun
/**
 * Publishes one release version's notes to the release catalog and reads them back
 * (docs/release/release-notes.md): a `PUT` of both languages to
 * `{origin}/api/release-catalog/v1/apps/coforge-computer/releases/{version}`, then a public `GET`
 * of the same path, whose notes must equal what was sent.
 *
 * The notes come from `RELEASE_NOTES_EN` and `RELEASE_NOTES_ZH_CN` and the publish token from
 * `COFORGE_RELEASE_CATALOG_TOKEN` - never from argv. The release workflows receive the notes as
 * caller-controlled `workflow_dispatch` text and pass them on only through env vars, for the same
 * reason they pass the version that way: substituted into a `run:` script, the text would be read
 * as shell syntax before this script could validate it. Output names the app, version, sizes and
 * outcome; it never carries the token or the notes themselves.
 *
 *   --origin <url>     the Web origin, https:// (http:// only for a loopback host)
 *   --version <v>      the published release version
 *   --check            validate the inputs only; no token, no request, and --version is optional
 */
import {
  COMPUTER_RELEASE_APP as APP,
  isValidReleaseVersion,
  RELEASE_NOTES_MAX_LENGTH,
  type ReleaseNotes,
} from "@lrm/coforge-sdk/internal/release-version";

const REQUEST_TIMEOUT_MS = 15_000;
/** Attempts per request; only a network error or a 5xx response is tried again. */
const REQUEST_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

interface PublishRequest {
  origin: string;
  version: string;
  notes: ReleaseNotes;
  token: string;
}

interface PublishDependencies {
  delay: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function releaseUrl({ origin, version }: PublishRequest): string {
  const path = `apps/${APP}/releases/${encodeURIComponent(version)}`;
  return `${origin.replace(/\/+$/, "")}/api/release-catalog/v1/${path}`;
}

/** Sends one request, trying a network error or a 5xx response again up to REQUEST_ATTEMPTS. */
async function send(
  label: string,
  url: string,
  init: RequestInit,
  deps: PublishDependencies,
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      if (attempt >= REQUEST_ATTEMPTS)
        throw new Error(`${label} failed after ${attempt} attempts: ${describe(error)}`);
      deps.log(`${label}: ${describe(error)}; retrying (${attempt}/${REQUEST_ATTEMPTS})`);
      await deps.delay(RETRY_DELAY_MS * attempt);
      continue;
    }
    if (response.status < 500 || attempt >= REQUEST_ATTEMPTS) return response;
    // A catalog without a publish token answers 503 `publishing_disabled` until it is configured;
    // that is a state, not a transient failure, so it is reported at once.
    if (response.status === 503 && (await catalogError(response.clone())) === "publishing_disabled")
      return response;
    await response.body?.cancel();
    deps.log(`${label}: HTTP ${response.status}; retrying (${attempt}/${REQUEST_ATTEMPTS})`);
    await deps.delay(RETRY_DELAY_MS * attempt);
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name === "TimeoutError" ? "timed out" : error.message;
  return String(error);
}

/** The catalog's `error` code, never the rest of a body. */
async function catalogError(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
}

async function failure(label: string, response: Response): Promise<Error> {
  const code = await catalogError(response);
  return new Error(`${label} answered HTTP ${response.status}${code ? ` (${code})` : ""}`);
}

/** PUTs the notes, then GETs them back and requires the stored notes to equal what was sent. */
async function publishReleaseNotes(
  request: PublishRequest,
  deps: PublishDependencies,
): Promise<void> {
  const url = releaseUrl(request);
  const put = await send(
    "publish",
    url,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${request.token}`, "content-type": "application/json" },
      body: JSON.stringify({ notes: request.notes }),
    },
    deps,
  );
  if (!put.ok) throw await failure("publish", put);
  await put.body?.cancel();

  const get = await send("read-back", url, { method: "GET", cache: "no-store" }, deps);
  if (!get.ok) throw await failure("read-back", get);
  const stored = (await get.json()) as {
    app?: unknown;
    version?: unknown;
    notes?: Partial<ReleaseNotes>;
  };
  if (
    stored.app !== APP ||
    stored.version !== request.version ||
    stored.notes?.en !== request.notes.en ||
    stored.notes?.["zh-CN"] !== request.notes["zh-CN"]
  )
    throw new Error("read-back does not match the notes sent");
}

/* -------------------------------------------------------------------------------------------- */
/* CLI                                                                                            */
/* -------------------------------------------------------------------------------------------- */

export interface ReleaseNotesCliDependencies {
  env?: Record<string, string | undefined>;
  delay?: (ms: number) => Promise<void>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface ParsedArgs {
  origin?: string;
  version?: string;
  check: boolean;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgv(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--check":
        result.check = true;
        break;
      case "--origin":
        result.origin = requireValue(argv, (index += 1), flag);
        break;
      case "--version":
        result.version = requireValue(argv, (index += 1), flag);
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }
  return result;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Reads one language from its env var, trimmed, and enforces the catalog's limits. */
function readNotes(env: Record<string, string | undefined>, name: string): string {
  const text = (env[name] ?? "").trim();
  if (text.length === 0) throw new Error(`${name} is required and must not be blank`);
  if (text.length > RELEASE_NOTES_MAX_LENGTH)
    throw new Error(
      `${name} is ${text.length} characters; the limit is ${RELEASE_NOTES_MAX_LENGTH}`,
    );
  return text;
}

function validateOrigin(origin: string | undefined): string {
  if (!origin) throw new Error("--origin is required");
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`--origin must be an https:// URL: ${origin}`);
  }
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopback)
    throw new Error(`--origin must be https:// (http:// only on a loopback host): ${origin}`);
  return url.origin;
}

function validateVersion(version: string | undefined): void {
  if (version !== undefined && !isValidReleaseVersion(version))
    throw new Error(`--version must be a valid version string: ${version}`);
}

export async function runCli(
  argv: string[],
  dependencies: ReleaseNotesCliDependencies = {},
): Promise<number> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? ((line: string) => console.log(line));
  const stderr = dependencies.stderr ?? ((line: string) => console.error(line));
  try {
    const args = parseArgv(argv);
    validateVersion(args.version);
    const notes: ReleaseNotes = {
      en: readNotes(env, "RELEASE_NOTES_EN"),
      "zh-CN": readNotes(env, "RELEASE_NOTES_ZH_CN"),
    };
    const sizes = `en=${notes.en.length} zh-CN=${notes["zh-CN"].length} chars`;
    if (args.check) {
      stdout(`release notes ${APP} ${args.version ?? "(version pending)"}: valid, ${sizes}`);
      return 0;
    }
    const origin = validateOrigin(args.origin);
    if (args.version === undefined) throw new Error("--version is required");
    const version = args.version;
    const token = env.COFORGE_RELEASE_CATALOG_TOKEN ?? "";
    if (token.length === 0) throw new Error("COFORGE_RELEASE_CATALOG_TOKEN is required");
    stdout(`release notes ${APP} ${version}: ${sizes}; publishing to ${origin}`);
    await publishReleaseNotes(
      { origin, version, notes, token },
      { delay: dependencies.delay ?? sleep, log: stdout },
    );
    stdout(`release notes ${APP} ${version}: published and verified`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`release notes failed: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
