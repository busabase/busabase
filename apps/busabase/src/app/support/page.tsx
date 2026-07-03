import {
  ArrowUpRight,
  BookOpen,
  Download,
  LifeBuoy,
  Mail,
  MessageSquare,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";

const SUPPORT_EMAIL = "support@busabase.com";

export const metadata: Metadata = {
  title: "Busabase Support",
  description:
    "Get help with Busabase Desktop, Busabase Mobile, Agent Skill setup, and approval-first database workflows.",
};

const supportOptions = [
  {
    title: "Email support",
    body: "Send your workspace, device, and a short description of what went wrong. Include screenshots or logs when possible.",
    href: `mailto:${SUPPORT_EMAIL}`,
    action: SUPPORT_EMAIL,
    icon: Mail,
  },
  {
    title: "Set up Agent Skill",
    body: "Connect Claude Code, Codex, or another AI agent to Busabase so it can create reviewed change requests.",
    href: "/SETUP_SKILL.md",
    action: "Open setup guide",
    icon: BookOpen,
  },
  {
    title: "Download apps",
    body: "Install the desktop app for the local review engine, or use the mobile app to review changes on the go.",
    href: "/download",
    action: "Open downloads",
    icon: Download,
  },
  {
    title: "Open dashboard",
    body: "Check the local inbox, activity feed, base schema, and pending change requests in your Busabase workspace.",
    href: "/dashboard",
    action: "Open dashboard",
    icon: Wrench,
  },
] as const;

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-5xl flex-col px-5 pt-20 pb-16 sm:px-6 lg:px-8">
        <div className="max-w-3xl space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
            <LifeBuoy className="size-4 text-primary" aria-hidden="true" />
            Support
          </p>
          <div className="space-y-4">
            <h1 className="text-4xl font-medium tracking-normal text-foreground sm:text-5xl">
              Get help with Busabase
            </h1>
            <p className="text-lg leading-8 text-muted-foreground">
              Use these support paths for Busabase Desktop, Busabase Mobile, local review workflows,
              and AI agent setup.
            </p>
          </div>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {supportOptions.map((option) => {
            const Icon = option.icon;
            return (
              <a
                key={option.title}
                href={option.href}
                className="group flex min-h-56 flex-col justify-between rounded-lg border border-border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-accent/60"
              >
                <span className="space-y-4">
                  <span className="flex size-11 items-center justify-center rounded-md bg-muted text-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="block space-y-2">
                    <span className="block text-lg font-medium text-foreground">
                      {option.title}
                    </span>
                    <span className="block text-sm leading-6 text-muted-foreground">
                      {option.body}
                    </span>
                  </span>
                </span>
                <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary">
                  {option.action}
                  <ArrowUpRight
                    className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </a>
            );
          })}
        </div>

        <section className="mt-12 rounded-lg border border-border bg-muted/40 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-background text-foreground">
              <MessageSquare className="size-5" aria-hidden="true" />
            </span>
            <div className="space-y-2">
              <h2 className="text-lg font-medium text-foreground">What to include</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                For faster troubleshooting, include your Busabase version, operating system, whether
                you are using Desktop, Mobile, Cloud, or self-hosted mode, and the exact action that
                failed.
              </p>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
