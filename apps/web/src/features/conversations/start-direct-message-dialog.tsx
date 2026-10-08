import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loading02, SearchLg } from "@untitledui/icons";

import { Dialog, Modal, ModalOverlay } from "#src/components/application/modals/modal";
import { DialogHeader } from "#src/components/application/modals/dialog-header";
import { Avatar } from "#src/components/base/avatar/avatar";
import { Button } from "#src/components/base/buttons/button";
import { Input } from "#src/components/base/input/input";
import { useCurrentWorkspaceId } from "#src/features/agents/workspace-agents-realtime";
import { loadWorkspaceDirectory } from "#src/features/workspaces/workspaces.functions";
import { avatarInitial, avatarToneClassName } from "#src/lib/avatar-tone";
import { m } from "#src/paraglide/messages";
import { useOpenDirectConversation } from "./open-direct-conversation";
import { useCloseConversationList } from "./conversation-navigation";

/** Choose an Agent or Human without leaving Chat; the existing DM seam owns opening it. */
export function StartDirectMessageDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const workspaceId = useCurrentWorkspaceId();
  const load = useServerFn(loadWorkspaceDirectory);
  const directory = useQuery({
    queryKey: ["direct-message-directory", workspaceId],
    queryFn: () => load(),
    enabled: !!workspaceId,
  });
  const [error, setError] = useState("");
  const openDirect = useOpenDirectConversation(() => setError(m.conversation_open_error()));
  const closeList = useCloseConversationList();
  const [search, setSearch] = useState("");
  const [opening, setOpening] = useState(false);
  const busy = useRef(false);
  const query = search.trim().toLowerCase();
  const matches = (...names: (string | null)[]) =>
    names.some((name) => name?.toLowerCase().includes(query));
  const groups = [
    {
      label: m.member_agent(),
      members: (directory.data?.agents ?? [])
        .filter((agent) => agent.ownedByCurrentUser && matches(agent.name, agent.handle))
        .map((agent) => ({ ...agent, peer: { agentId: agent.id } })),
    },
    {
      label: m.member_person(),
      members: (directory.data?.people ?? [])
        .filter((person) => matches(person.name, person.fullName))
        .map((person) => ({
          ...person,
          name:
            person.id === directory.data?.viewerId
              ? m.conversation_dm_self_name({ name: person.name })
              : person.name,
          peer: { userId: person.id },
        })),
    },
  ];

  async function select(peer: { agentId: string } | { userId: string }) {
    if (busy.current) return;
    busy.current = true;
    setOpening(true);
    setError("");
    try {
      if (await openDirect(peer)) {
        closeList();
        onOpenChange(false);
      }
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }

  return (
    <ModalOverlay isOpen onOpenChange={onOpenChange}>
      <Modal className="w-[calc(100vw-2rem)] max-w-md">
        <Dialog>
          <DialogHeader title={m.conversation_start_direct()} onClose={() => onOpenChange(false)} />
          <div className="flex flex-col gap-4 px-6 py-6">
            <Input
              aria-label={m.channel_members_search_placeholder()}
              placeholder={m.channel_members_search_placeholder()}
              icon={SearchLg}
              value={search}
              onChange={setSearch}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-sm text-error-primary">
                {error}
              </p>
            )}
            {opening && (
              <p role="status" className="flex items-center gap-2 text-sm text-tertiary">
                <Loading02 aria-hidden="true" className="size-4 animate-spin" />
                {m.conversation_opening_direct()}
              </p>
            )}
            <div className="max-h-[60vh] overflow-y-auto" aria-busy={opening}>
              {directory.isPending && (
                <p className="text-sm text-tertiary">{m.channel_members_loading()}</p>
              )}
              {directory.isError && (
                <div className="flex flex-col gap-3">
                  <p role="alert" className="text-sm text-error-primary">
                    {m.channel_members_load_error()}
                  </p>
                  <Button color="secondary" size="sm" onPress={() => void directory.refetch()}>
                    {m.controls_retry()}
                  </Button>
                </div>
              )}
              {directory.isSuccess && (
                <div className="flex flex-col gap-4">
                  {groups.map((group) => (
                    <section key={group.label}>
                      <h2 className="mb-2 text-sm font-semibold text-primary">{group.label}</h2>
                      {group.members.length === 0 ? (
                        <p className="text-sm text-tertiary">{m.channel_members_none()}</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {group.members.map((member) => (
                            <li key={member.id}>
                              <Button
                                color="tertiary"
                                size="sm"
                                className="w-full min-w-0 justify-start [&>[data-text]]:min-w-0"
                                isDisabled={opening}
                                onPress={() => void select(member.peer)}
                                iconLeading={
                                  <Avatar
                                    size="xs"
                                    alt={member.name}
                                    src={member.avatarUrl ?? undefined}
                                    initials={avatarInitial(member.name)}
                                    contentClassName={avatarToneClassName(member.name)}
                                  />
                                }
                              >
                                <span className="block truncate">{member.name}</span>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
