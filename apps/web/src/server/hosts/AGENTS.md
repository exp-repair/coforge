# Host nodes

These rules apply to `src/server/hosts/`.

- A host node is the server process that creates containers. It is not a Computer and not a Workspace Daemon.
- `HostDirectory` owns enrollment, registration, heartbeat, and the online list. The list is every host seen inside `HOST_ONLINE_WINDOW_MS`. It takes no user or workspace filter.
- The enrollment token is shown once and stored only as a hash. The registrar user id stays on the row and is not an authorization filter.
- Register and heartbeat authenticate with that token. Issuing a token and listing online hosts authenticate a signed-in user. A host token is not a user session, and a user session is not a host token.
- `HostJobs` creates a cloud Computer for a workspace member on an online host and stores one open job. The daemon key is returned only when that host claims the job, and it is cleared when the host reports a container id. A repeated idempotency key returns the same job.
- `host-production.server.ts` and `host-job-production.server.ts` only wire the database and the browser session. Routes stay thin adapters over them.
