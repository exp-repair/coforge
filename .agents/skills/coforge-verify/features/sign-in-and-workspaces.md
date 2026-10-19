# Sign-in and Workspaces

Pages live under a locale prefix, `/en/...` or `/zh-CN/...`
(`apps/web/paraglide.config.ts`); `/api`, `/oauth`, `/auth` handlers and
`/.well-known` are used unprefixed (`apps/web/src/lib/non-localized-path.ts`).
None of these screens has a `data-testid`; use roles, labels and text.

## sign-in

- **Reach**: `/` sends a signed-in user to the page they last had open (within
  24 hours), else `/w/<slug>`, else `/workspaces/new`
  (`apps/web/src/routes/index.tsx`). `/login` without `?error` redirects to
  `/auth/login`. A first-time user lands on `/en/welcome?returnTo=...` after the
  callback; a failed callback lands on `/login?error=login_failed`.
- **Drive**:
  - Staging and production use the hosted Authing login. With `ego-browser`,
    the user's own browser session is already signed in; if it is not, ask the
    user to sign in. Never enter credentials yourself.
  - Locally, `COFORGE_DEV_SKIP_AUTH=1` in `apps/web/.env` makes every request the
    fixed dev user (`dev@coforge.local`, username `dev-user`, "Dev User"); it is
    ignored when `NODE_ENV=production`
    (`apps/web/src/server/auth/dev-skip-auth.server.ts`). Run the HMR server
    with `./scripts/dev-web-hmr.sh` (127.0.0.1:8788) and seed the user first
    ([Web environments](README.md#environments)).
  - Name step `/en/welcome`: "Display name" (`input[name="displayName"]`),
    "Workspace URL" (`name="workspaceSlug"`), button "Continue"
    (`apps/web/src/features/auth/name-step-page.tsx`).
  - Error page: `main [role=alert]` "Sign-in failed. Try again." with
    "Sign in again".
- **Success**: the URL reaches `/w/<slug>` and the sidebar shows `general`.
  Validation errors appear as `main form [role=alert]` ("Enter your display
  name.", "Use 80 characters or fewer.", "You can't use this name.").
- **Traps**:
  - A dev database user without `displayName` cannot finish sign-in: the app
    redirects to `/en/welcome` and every browser e2e times out with no log line.
    Re-run `apps/web/scripts/seed-dev-data.ts`
    ([testing guidance](../../../../docs/agents/testing.md#browser-end-to-end-tests)).
  - Serving a production build with `NODE_ENV=production` leaves the browser on
    the marketing page, unauthenticated; serve with `NODE_ENV=development`.
  - Under skip-auth every request is the dev user, so sign-out cannot be
    verified locally; `/auth/logout` answers 503 without Authing configuration.
  - React controlled inputs may ignore an automation `fill`; the sign-in harness
    uses the native value setter plus an `input` event
    (`apps/web/test/e2e-sign-in-harness.ts`).
- **Covered by**: `apps/web/test/e2e-sign-in-flow.e2e.ts` (fake OIDC server via
  `e2e-sign-in-harness.ts`: invite sign-in, refused sign-in, two tabs),
  `e2e-first-sign-in-name.e2e.ts` (name validation, phone width, Chinese locale,
  `/oauth/verify` not gated by the name step). The harness needs
  `agent-browser`, openssl, local PostgreSQL and Redis.

## workspace-switch

- **Reach**: any `/en/w/<slug>/...` page; the switcher sits in the sidebar
  (`apps/web/src/features/workspaces/workspace-switcher.tsx`).
- **Drive**: the trigger is named "Current workspace" in the expanded sidebar and
  "Current workspace: <name>" on the collapsed rail. Its menu, also named
  "Current workspace", lists each Workspace as a `menuitem` named by the
  Workspace name, and "Create workspace" opens "Create a new workspace" with
  "Workspace name" (`name="name"`), "Workspace URL" (`name="slug"`) and the
  submit "Create workspace" (`create-workspace-form.tsx`).
- **Success**: the URL changes to `/w/<slug>` of the chosen or created
  Workspace and its channels load. A former slug redirects to the current one;
  a Workspace you are not in is a 404 (`apps/web/src/routes/w.$workspaceSlug.tsx`).
- **Traps**:
  - The switcher renders in the mobile drawer, the sidebar and the rail
    (`apps/web/src/components/app-shell.tsx`); scope to the visible one.
  - `/workspaces/new` ("Create your first workspace") is only for a user in no
    Workspace; others are redirected. Create a second one from the switcher.
  - Taken URLs fail with "That workspace URL is already taken. Choose another one."
  - The dev Workspace slug is usually `dev-user` but becomes `dev-user-<8hex>`
    when taken; read it from the URL rather than assuming it.
- **Covered by**: no browser e2e for the switcher.

## workspace-join

- **Reach**: `/join/<token>` from an invite link.
- **Drive**: "Sign in to join", "Join <name>", "Open <name>", "Use another
  account"; "Signed in as <account>".
- **Success**: lands on `/w/<slug>` with `#general`. An invalid link shows
  "This invite link can’t be used".
- **Covered by**: `apps/web/test/e2e-workspace-join-link.e2e.ts` (skip-auth:
  join, lost connection with "Try again", ended session, invalid link) and the
  invite path of `e2e-sign-in-flow.e2e.ts`.

## device-approval

The browser half of Computer login (see [computer-setup](computer.md#computer-setup)).

- **Reach**: the exact verification URL printed by `coforge-computer login` or
  `setup`: `/oauth/verify?user_code=...` (unprefixed).
- **Drive**: "Connect a computer", "Device code", "Continue", then "Approve" or
  "Deny" (`apps/web/src/routes/oauth/verify.tsx`).
- **Success**: "Computer connected" in the browser, and the CLI returns
  `ok: true`.
- **Covered by**: the first run of `scripts/e2e/run-computer-setup.sh` waits for
  this approval by hand.
