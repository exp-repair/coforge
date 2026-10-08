import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "#src/components/base/buttons/button";
import { Input } from "#src/components/base/input/input";
import { m } from "#src/paraglide/messages";

type OnlineHost = { id: string; name: string };

export function CloudComputerStep({
  workspaceSlug,
  onCreated,
  onBack,
}: {
  workspaceSlug: string | null;
  onCreated: (computerId: string) => Promise<void>;
  onBack: () => void;
}) {
  const [hosts, setHosts] = useState<OnlineHost[] | undefined>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [hostId, setHostId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const attempt = useRef<{ hostId: string; name: string; key: string } | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setHosts(undefined);
    setLoadFailed(false);
    void loadOnlineHosts(controller.signal)
      .then((online) => {
        if (controller.signal.aborted) return;
        setHosts(online);
        setHostId(online.length === 1 ? online[0]!.id : "");
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted ||
          (cause instanceof DOMException && cause.name === "AbortError")
        )
          return;
        setLoadFailed(true);
        setHosts([]);
      });
    return () => controller.abort();
  }, [reload]);

  const trimmedName = name.trim();
  const canCreate = Boolean(workspaceSlug && hostId && trimmedName && !saving);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canCreate || busy.current || !workspaceSlug) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      const computerId = await createCloudComputer({
        hostId,
        workspaceSlug,
        name: trimmedName,
        idempotencyKey: idempotencyKey(attempt, hostId, trimmedName),
      });
      await onCreated(computerId);
    } catch (cause) {
      setError(createErrorMessage(cause));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <form id="cloud-computer-form" onSubmit={(event) => void submit(event)}>
      <div className="flex flex-col gap-4 px-6 py-6 sm:px-8">
        {hosts === undefined ? (
          <p className="text-sm text-tertiary">{m.computer_cloud_hosts_loading()}</p>
        ) : loadFailed ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-error-primary">
              {m.computer_cloud_hosts_error()}
            </p>
            <Button color="secondary" type="button" onPress={() => setReload((value) => value + 1)}>
              {m.computer_cloud_hosts_retry()}
            </Button>
          </div>
        ) : hosts.length === 0 ? (
          <p className="text-sm text-tertiary">{m.computer_cloud_hosts_empty()}</p>
        ) : (
          <div
            role="radiogroup"
            aria-label={m.computer_cloud_host_label()}
            className="flex max-h-48 flex-col gap-2 overflow-y-auto"
          >
            {hosts.map((host) => {
              const selected = host.id === hostId;
              return (
                <Button
                  key={host.id}
                  type="button"
                  color="secondary"
                  role="radio"
                  aria-checked={selected}
                  className={`h-auto justify-start whitespace-normal rounded-xl px-4 py-3 text-left ${selected ? "border-brand ring-1 ring-brand" : ""}`}
                  onPress={() => setHostId(host.id)}
                >
                  {host.name}
                </Button>
              );
            })}
          </div>
        )}
        <Input
          label={m.computer_cloud_name_label()}
          value={name}
          onChange={setName}
          isRequired
          maxLength={200}
          isDisabled={hosts === undefined || hosts.length === 0}
        />
        {error && (
          <p role="alert" className="text-sm text-error-primary">
            {error}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-secondary px-6 py-4 sm:px-8">
        <Button color="secondary" type="button" onPress={onBack} isDisabled={saving}>
          {m.controls_back()}
        </Button>
        <Button type="submit" isDisabled={!canCreate} isLoading={saving} showTextWhileLoading>
          {saving ? m.computer_cloud_creating() : m.computer_cloud_create()}
        </Button>
      </div>
    </form>
  );
}

async function loadOnlineHosts(signal: AbortSignal): Promise<OnlineHost[]> {
  const response = await fetch("/api/hosts/", { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error("hosts unavailable");
  return onlineHosts(await response.json());
}

function onlineHosts(value: unknown): OnlineHost[] {
  if (!value || typeof value !== "object" || !("hosts" in value) || !Array.isArray(value.hosts))
    return [];
  const hosts: OnlineHost[] = [];
  for (const host of value.hosts) {
    if (!host || typeof host !== "object") continue;
    const id = "id" in host && typeof host.id === "string" ? host.id : "";
    const name = "name" in host && typeof host.name === "string" ? host.name : "";
    if (id && name) hosts.push({ id, name });
  }
  return hosts;
}

async function createCloudComputer(input: {
  hostId: string;
  workspaceSlug: string;
  name: string;
  idempotencyKey: string;
}): Promise<string> {
  const response = await fetch(`/api/hosts/${encodeURIComponent(input.hostId)}/jobs`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceSlug: input.workspaceSlug,
      name: input.name,
      idempotencyKey: input.idempotencyKey,
    }),
  });
  const body: unknown = await response.json().catch(() => undefined);
  const computerId =
    body && typeof body === "object" && "computerId" in body && typeof body.computerId === "string"
      ? body.computerId
      : "";
  if (!response.ok || !computerId) throw new CloudComputerCreateError(response.status);
  return computerId;
}

class CloudComputerCreateError extends Error {
  constructor(readonly status: number) {
    super("cloud computer create failed");
    this.name = "CloudComputerCreateError";
  }
}

function createErrorMessage(cause: unknown): string {
  if (!(cause instanceof CloudComputerCreateError)) return m.computer_cloud_create_error();
  if (cause.status === 409) return m.computer_cloud_host_offline();
  if (cause.status === 404) return m.computer_cloud_host_missing();
  if (cause.status === 403) return m.computer_cloud_access_denied();
  return m.computer_cloud_create_error();
}

function idempotencyKey(
  attempt: { current: { hostId: string; name: string; key: string } | undefined },
  hostId: string,
  name: string,
): string {
  const current = attempt.current;
  if (current && current.hostId === hostId && current.name === name) return current.key;
  const key = crypto.randomUUID();
  attempt.current = { hostId, name, key };
  return key;
}
