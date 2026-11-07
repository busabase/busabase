"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { parseWorkflowApprovers } from "busabase-contract/domains/workflow/run";
import { useCoreI18n } from "../../../i18n";

interface Props {
  orpc: BusabaseQueryUtils;
  /** The approval step's `approver` text: member emails separated by commas. */
  value: string;
  onChange: (approver: string) => void;
}

/**
 * Adds a space member's email to an approval step, so nobody has to type it.
 * Members already named are left out of the list.
 */
export function WorkflowApproverPicker({ orpc, value, onChange }: Props) {
  const messages = useCoreI18n();
  const membersQuery = useQuery(orpc.spaces.members.queryOptions());
  const named = new Set(parseWorkflowApprovers(value).map((email) => email.toLowerCase()));
  const members = (membersQuery.data ?? []).filter(
    (member): member is typeof member & { email: string } =>
      Boolean(member.email) && !named.has(member.email?.toLowerCase() ?? ""),
  );
  if (members.length === 0) return null;
  return (
    <select
      aria-label={messages.richNodes.addApprover}
      // A long "Name <email>" option must not widen the settings panel.
      className="h-9 w-full min-w-0 max-w-full border border-input bg-card px-3 text-foreground text-sm"
      data-workflow-approver-picker=""
      onChange={(event) => {
        const email = event.target.value;
        if (!email) return;
        const current = value.trim();
        onChange(current ? `${current.replace(/[\s,;]+$/, "")}, ${email}` : email);
      }}
      value=""
    >
      <option value="">{messages.richNodes.addApprover}</option>
      {members.map((member) => (
        <option key={member.id} value={member.email}>
          {member.name ? `${member.name} <${member.email}>` : member.email}
        </option>
      ))}
    </select>
  );
}
