import { describe, expect, test } from "bun:test";

import { dockerFindArgs, dockerRunArgs } from "#src/host/docker-containers";
import { HttpHostCloud } from "#src/host/host-cloud";
import { acceptClaimedJob, runHost, type ClaimedContainerJob } from "#src/host/run-host";

const job: ClaimedContainerJob = {
  jobId: "job-1",
  hostId: "host-1",
  computerId: "computer-1",
  workspaceId: "workspace-1",
  workspaceSlug: "alpha",
  name: "lab",
  daemonApiKey: `dk_${"b".repeat(43)}`,
};

const config = {
  serverUrl: "https://server.example",
  token: "chn_token",
  nodeKey: "machine-1",
  name: "lab-host",
  image: "coforge-computer:local",
};

describe("host process", () => {
  test("one claim runs one container and reports its id", async () => {
    const runs: string[] = [];
    const reports: string[] = [];
    await acceptClaimedJob(job, config, {
      containers: {
        findByComputerId: async () => undefined,
        run: async (input) => {
          runs.push(input.computerId);
          expect(input.image).toBe("coforge-computer:local");
          expect(input.env).toEqual({
            COFORGE_DAEMON_API_KEY: job.daemonApiKey,
            COFORGE_WORKSPACE_ID: "workspace-1",
            COFORGE_WORKSPACE_SLUG: "alpha",
            COFORGE_COMPUTER_ID: "computer-1",
            COFORGE_COMPUTER_NAME: "lab",
            COFORGE_SERVER_URL: "https://server.example",
          });
          expect(JSON.stringify(input.env)).not.toContain("refresh");
          return "container-1";
        },
      },
      report: async (containerId) => {
        reports.push(containerId);
      },
    });
    expect(runs).toEqual(["computer-1"]);
    expect(reports).toEqual(["container-1"]);
  });

  test("a container already labeled with the computer id is reported without running another", async () => {
    let runs = 0;
    const containerId = await acceptClaimedJob(job, config, {
      containers: {
        findByComputerId: async (computerId) =>
          computerId === "computer-1" ? "container-existing" : undefined,
        run: async () => {
          runs += 1;
          return "container-new";
        },
      },
      report: async (id) => id,
    });
    expect(containerId).toBe("container-existing");
    expect(runs).toBe(0);
  });

  test("a tick registers, heartbeats, claims, and stops when the signal aborts", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    await runHost(
      config,
      {
        cloud: {
          register: async () => {
            calls.push("register");
          },
          heartbeat: async () => {
            calls.push("heartbeat");
          },
          claim: async () => {
            calls.push("claim");
            return null;
          },
          report: async () => {
            calls.push("report");
          },
        },
        containers: {
          findByComputerId: async () => undefined,
          run: async () => "container-1",
        },
        wait: async () => {
          calls.push("wait");
          controller.abort();
        },
      },
      controller.signal,
    );
    expect(calls).toEqual(["register", "heartbeat", "claim", "wait"]);
  });
});

describe("host cloud HTTP", () => {
  test("register, claim, and report use the host token and the host routes", async () => {
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const url = String(input);
      if (url.endsWith("/jobs/claim")) {
        return Response.json({ job });
      }
      return Response.json({ ok: true });
    };
    const cloud = new HttpHostCloud(fetchImpl, "https://server.example/");
    await cloud.register({ token: "chn_token", nodeKey: "machine-1", name: "lab-host" });
    expect(await cloud.claim("chn_token")).toEqual(job);
    await cloud.report("chn_token", "job-1", "container-1");
    expect(requests).toEqual([
      {
        url: "https://server.example/api/hosts/register",
        authorization: "Bearer chn_token",
        body: { nodeKey: "machine-1", name: "lab-host" },
      },
      {
        url: "https://server.example/api/hosts/jobs/claim",
        authorization: "Bearer chn_token",
        body: null,
      },
      {
        url: "https://server.example/api/hosts/jobs/job-1/report",
        authorization: "Bearer chn_token",
        body: { containerId: "container-1" },
      },
    ]);
  });
});

describe("docker container arguments", () => {
  test("find and run address one computer id label", () => {
    expect(dockerFindArgs("computer-1")).toEqual([
      "ps",
      "-aq",
      "--filter",
      "label=coforge.computer_id=computer-1",
    ]);
    expect(
      dockerRunArgs({
        computerId: "computer-1",
        image: "coforge-computer:local",
        env: { COFORGE_SERVER_URL: "https://server.example" },
      }),
    ).toEqual([
      "run",
      "-d",
      "--name",
      "coforge-computer-1",
      "--restart",
      "unless-stopped",
      "--label",
      "coforge.computer_id=computer-1",
      "--env",
      "COFORGE_SERVER_URL=https://server.example",
      "coforge-computer:local",
    ]);
  });
});
