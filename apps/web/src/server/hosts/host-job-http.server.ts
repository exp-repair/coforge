import { HostJobError, HostJobs } from "./host-jobs.server";

type UserAuthenticator = (request: Request) => Promise<{ userId: string } | null>;

export function createHostJobHttpHandler(dependencies: {
  jobs: HostJobs;
  authenticateUser: UserAuthenticator;
  now: () => Date;
}) {
  return {
    create: (request: Request, hostId: string) => createJob(request, hostId, dependencies),
    claim: (request: Request) => claimJob(request, dependencies),
    report: (request: Request, jobId: string) => reportJob(request, jobId, dependencies),
  };
}

async function createJob(
  request: Request,
  hostId: string,
  dependencies: {
    jobs: HostJobs;
    authenticateUser: UserAuthenticator;
    now: () => Date;
  },
): Promise<Response> {
  const user = await dependencies.authenticateUser(request);
  if (!user) return error(401, "authentication required");
  const body = await readJson(request);
  if (!body) return error(400, "invalid request");
  try {
    const job = await dependencies.jobs.create({
      userId: user.userId,
      workspaceSlug: typeof body.workspaceSlug === "string" ? body.workspaceSlug : "",
      hostId,
      name: typeof body.name === "string" ? body.name : "",
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      now: dependencies.now(),
    });
    return Response.json(job);
  } catch (cause) {
    return jobError(cause);
  }
}

async function claimJob(
  request: Request,
  dependencies: { jobs: HostJobs; now: () => Date },
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return error(401, "invalid host token");
  try {
    const job = await dependencies.jobs.claim({ token, now: dependencies.now() });
    return Response.json({ job: job ?? null });
  } catch (cause) {
    return jobError(cause);
  }
}

async function reportJob(
  request: Request,
  jobId: string,
  dependencies: { jobs: HostJobs; now: () => Date },
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return error(401, "invalid host token");
  const body = await readJson(request);
  if (!body) return error(400, "invalid request");
  try {
    const job = await dependencies.jobs.report({
      token,
      jobId,
      containerId: typeof body.containerId === "string" ? body.containerId : "",
      now: dependencies.now(),
    });
    return Response.json(job);
  } catch (cause) {
    return jobError(cause);
  }
}

function bearerToken(request: Request): string | undefined {
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1];
}

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
    return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function error(status: number, message: string): Response {
  return Response.json({ error: { code: status, message } }, { status });
}

function jobError(cause: unknown): Response {
  if (cause instanceof HostJobError) return error(cause.status, cause.message);
  throw cause;
}
