import { HostDirectory, HostDirectoryError } from "./host-directory.server";

type UserAuthenticator = (request: Request) => Promise<{ userId: string } | null>;

export function createHostHttpHandler(dependencies: {
  directory: HostDirectory;
  authenticateUser: UserAuthenticator;
  now: () => Date;
}) {
  return {
    issue: (request: Request) => issueHost(request, dependencies),
    list: (request: Request) => listHosts(request, dependencies),
    register: (request: Request) => registerHost(request, dependencies),
    heartbeat: (request: Request) => heartbeatHost(request, dependencies),
  };
}

async function issueHost(
  request: Request,
  dependencies: {
    directory: HostDirectory;
    authenticateUser: UserAuthenticator;
    now: () => Date;
  },
): Promise<Response> {
  const user = await dependencies.authenticateUser(request);
  if (!user) return unauthorized();
  const body = await readJson(request);
  if (!body) return invalidRequest();
  const name = typeof body.name === "string" ? body.name : "";
  try {
    const issued = await dependencies.directory.issue({
      registrarUserId: user.userId,
      name,
      now: dependencies.now(),
    });
    return Response.json(issued);
  } catch (error) {
    return hostError(error);
  }
}

async function listHosts(
  request: Request,
  dependencies: {
    directory: HostDirectory;
    authenticateUser: UserAuthenticator;
    now: () => Date;
  },
): Promise<Response> {
  const user = await dependencies.authenticateUser(request);
  if (!user) return unauthorized();
  const hosts = await dependencies.directory.listOnline(dependencies.now());
  return Response.json({ hosts });
}

async function registerHost(
  request: Request,
  dependencies: { directory: HostDirectory; now: () => Date },
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return invalidHostToken();
  const body = await readJson(request);
  if (!body) return invalidRequest();
  try {
    const host = await dependencies.directory.register({
      token,
      nodeKey: typeof body.nodeKey === "string" ? body.nodeKey : "",
      name: typeof body.name === "string" ? body.name : "",
      now: dependencies.now(),
    });
    return Response.json(host);
  } catch (error) {
    return hostError(error);
  }
}

async function heartbeatHost(
  request: Request,
  dependencies: { directory: HostDirectory; now: () => Date },
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return invalidHostToken();
  try {
    const host = await dependencies.directory.heartbeat({ token, now: dependencies.now() });
    return Response.json(host);
  } catch (error) {
    return hostError(error);
  }
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
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

function unauthorized(): Response {
  return Response.json(
    { error: { code: 401, message: "authentication required" } },
    { status: 401 },
  );
}

function invalidHostToken(): Response {
  return Response.json({ error: { code: 401, message: "invalid host token" } }, { status: 401 });
}

function invalidRequest(): Response {
  return Response.json({ error: { code: 400, message: "invalid request" } }, { status: 400 });
}

function hostError(error: unknown): Response {
  if (error instanceof HostDirectoryError) {
    return Response.json(
      { error: { code: error.status, message: error.message } },
      { status: error.status },
    );
  }
  throw error;
}
