import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy01 as Copy } from "@untitledui/icons";

import { Button } from "#src/components/base/buttons/button";
import { ButtonUtility } from "#src/components/base/buttons/button-utility";
import { StatusDot } from "#src/components/ui/status-dot";
import { useSubmitGuard } from "#src/hooks/use-submit-guard";
import { isAppErrorCode } from "#src/lib/app-error";
import { formatDateForDisplay } from "#src/lib/dates";
import type { TimeFormat } from "#src/lib/time-format";
import { m } from "#src/paraglide/messages";
import {
  loadServerConnection,
  submitServerConnection,
} from "#src/features/settings/server-connection.functions";

type Connection = Awaited<ReturnType<typeof loadServerConnection>>;

export function ServerConnectionSettings({
  connection: initial,
  timeZone,
  timeFormat,
}: {
  connection: Connection;
  timeZone: string | null;
  timeFormat: TimeFormat | null;
}) {
  const [connection, setConnection] = useState(initial);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<"conflict" | "failed" | null>(null);
  const [pending, guard] = useSubmitGuard();
  const load = useServerFn(loadServerConnection);
  const submit = useServerFn(submitServerConnection);

  useEffect(() => {
    setConnection(initial);
  }, [initial]);

  useEffect(() => {
    if (!connection.configured) return;
    const refresh = () => {
      void load()
        .then((next) => setConnection(next))
        .catch(() => {});
    };
    const interval = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(interval);
  }, [connection.configured, load]);

  function save() {
    setError(null);
    void guard(async () => {
      try {
        setConnection(await submit());
      } catch (cause) {
        setError(isAppErrorCode(cause, "CONFLICT") ? "conflict" : "failed");
      }
    });
  }

  return (
    <div className="space-y-6 px-4 py-6 text-sm sm:px-8">
      <p className="max-w-2xl text-tertiary">{m.settings_server_connection_description()}</p>
      {connection.configured ? (
        <dl className="max-w-2xl space-y-4">
          <div>
            <dt className="text-secondary">{m.settings_server_connection_status()}</dt>
            <dd className="mt-1 flex items-center gap-2 font-medium text-primary">
              <StatusDot tone={connection.connected ? "online" : "offline"} className="size-2" />
              {connection.connected
                ? m.settings_server_connection_online()
                : m.settings_server_connection_offline()}
            </dd>
          </div>
          <div>
            <dt className="text-secondary">{m.settings_server_connection_origin()}</dt>
            <dd className="mt-1 break-all text-primary">{connection.installOrigin}</dd>
          </div>
          <div>
            <dt className="text-secondary">{m.settings_server_connection_submitted_by()}</dt>
            <dd className="mt-1 text-primary">{connection.submittedByName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{m.settings_server_connection_submitted_at()}</dt>
            <dd className="mt-1 text-primary">
              {formatDateForDisplay(connection.submittedAt, timeZone, undefined, timeFormat)}
            </dd>
          </div>
        </dl>
      ) : (
        <Button type="button" isDisabled={pending} onPress={save}>
          {pending ? m.settings_server_connection_saving() : m.settings_server_connection_save()}
        </Button>
      )}
      {connection.configured ? (
        <div className="max-w-2xl space-y-2">
          <p className="font-medium text-primary">{m.settings_server_connection_command()}</p>
          <div className="flex items-start gap-3 rounded-lg bg-terminal p-4 text-terminal-fg">
            <code className="min-w-0 flex-1 break-all">{connection.command}</code>
            <ButtonUtility
              icon={copied ? Check : Copy}
              size="sm"
              color="secondary"
              aria-label={m.settings_server_connection_copy()}
              onClick={async () => {
                await navigator.clipboard.writeText(connection.command);
                setCopied(true);
              }}
            />
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-error-primary">
          {error === "conflict"
            ? m.settings_server_connection_conflict()
            : m.settings_server_connection_error()}
        </p>
      ) : null}
    </div>
  );
}
