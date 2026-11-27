/** Shared introduction and post-connection choices for shell and MCP onboarding. */
export const BUSABASE_ONBOARDING_INTRO =
  "Busabase is an open-source database and workspace for AI agents: turn agent output into data, docs, skills, and apps you can actually use. Like a shared space station: one agent researches, another drafts.";

export interface OnboardingNextStepsContext {
  mode: "cloud" | "local";
  transport: "cli" | "mcp";
  /** Deployment origin, when known, for the Members settings fallback link. */
  origin?: string;
}

/** Render guidance, not automatic actions; every option waits for the user's choice. */
export function renderOnboardingNextSteps({
  mode,
  transport,
  origin,
}: OnboardingNextStepsContext): string {
  const cloud = mode === "cloud";
  const mcp = transport === "mcp";
  const cli = "npx --yes busabase-cli@latest";
  const linkAction = mcp
    ? "call `members_create_invite_link`"
    : `run \`${cli} members create-invite-link\``;
  const emailAction = mcp
    ? "call `members_invite`"
    : `run \`${cli} members invite --email <address>\``;
  const whoami = mcp ? "`auth_verify`" : `\`${cli} whoami --output json\``;
  const membersPage = origin
    ? `${origin.replace(/\/$/, "")}/dashboard?settings=space&tab=people`
    : "Dashboard → Settings → Members";

  return `## What would you like to do next?

After success in a new or existing space, offer these in the user's language. Recommend their goal
or A for personal use. Await a choice; read space instructions and a matching playbook first.${
    cloud ? `\nList C only if ${whoami} shows \`member.role\` owner/admin; else omit it.` : ""
  }

> **A. Try two assistants together** — save research, let another assistant draft.
> **B. Make something** — notes, a to-do list, a collection, or an app. Templates are optional.${
    cloud
      ? `
> **C. Bring a friend** — get a link to invite them into this space.
> **D. Join a space I was invited to** — use an invitation someone sent me.`
      : ""
  }

**A:** Offer research → draft as an example; use real existing content or agree a small goal. ${
    cloud
      ? "Each assistant signs in separately. Use this document's or configured MCP's origin plus /SETUP_SKILL.md?edition=cloud&editionConfirmed=1&space=<verified-id>. If hidden, ask for Dashboard's Connect-agent prompt."
      : "Both assistants must run on this actual computer; give the next one http://localhost:15419/SETUP_SKILL.md."
  } Never share keys, promise automatic spawning/scheduling, or grant membership by syncing.
**B:** Build one small result from the user's idea.${
    cloud
      ? `
**C:** "发我邀请链接" is enough: ${linkAction}; return its exact URL.
By email: confirm each address and role (member unless asked), then ${emailAction} once per address.
403: not owner/admin, or admin needs a manage key — say which, offer member. 404: this server cannot
invite by API — point to ${membersPage}. Inviting people differs from connecting your own assistant.
**D:** Use the exact member invitation or SETUP_SKILL.md?invite=… guide. Preserve tokens;
wait for authorization, never create a replacement space, silently switch or initialize it.`
      : "\nIf asked to share remotely, explain Cloud; do not call member invitation APIs on Desktop."
  }
`;
}
