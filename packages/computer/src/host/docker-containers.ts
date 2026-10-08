export const COMPUTER_ID_LABEL = "coforge.computer_id";

export function dockerFindArgs(computerId: string): string[] {
  return ["ps", "-aq", "--filter", `label=${COMPUTER_ID_LABEL}=${computerId}`];
}

export function dockerRunArgs(input: {
  computerId: string;
  image: string;
  env: Record<string, string>;
}): string[] {
  const args = [
    "run",
    "-d",
    "--name",
    `coforge-${input.computerId}`,
    "--restart",
    "unless-stopped",
    "--label",
    `${COMPUTER_ID_LABEL}=${input.computerId}`,
  ];
  for (const [key, value] of Object.entries(input.env)) {
    args.push("--env", `${key}=${value}`);
  }
  args.push(input.image);
  return args;
}

export interface ContainerRuntime {
  findByComputerId(computerId: string): Promise<string | undefined>;
  run(input: { computerId: string; image: string; env: Record<string, string> }): Promise<string>;
}

type DockerSpawn = (
  args: string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export function createDockerContainers(spawn: DockerSpawn = spawnDocker): ContainerRuntime {
  return {
    async findByComputerId(computerId) {
      const result = await spawn(dockerFindArgs(computerId));
      if (result.exitCode !== 0) throw new Error(result.stderr || "docker ps failed");
      const id = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);
      return id;
    },
    async run(input) {
      const result = await spawn(dockerRunArgs(input));
      if (result.exitCode !== 0) throw new Error(result.stderr || "docker run failed");
      const id = result.stdout.trim();
      if (!id) throw new Error("docker run returned an empty container id");
      return id;
    },
  };
}

async function spawnDocker(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
