import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About BusaBase",
  description:
    "BusaBase is an approval-first database for AI agents. Every AI-generated record must pass human review before it becomes canonical.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-3xl px-4 py-20">
        {/* Header */}
        <div className="mb-16 text-center">
          <span className="mb-4 inline-block rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
            Why we built BusaBase
          </span>
          <h1 className="mb-6 text-4xl font-bold tracking-tight">
            AI agents shouldn&apos;t exist to produce garbage at infinite speed
          </h1>
          <p className="text-xl text-muted-foreground">
            An approval-first database for AI agents.
            <br />
            Category:{" "}
            <span className="font-medium text-foreground">
              (Approval | Privacy)-first (Database | Knowledgebase) for AI Agents
            </span>
          </p>
        </div>

        {/* Mission */}
        <section className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">Our conviction</h2>
          <div className="space-y-5 text-muted-foreground leading-relaxed">
            <p>
              The speed at which AI agents can generate content has outpaced the human capacity to
              evaluate it. The result: databases filled with unreviewed output, knowledge bases that
              nobody trusts, and teams drowning in AI-generated noise they can&apos;t act on.
            </p>
            <p>
              We built BusaBase because we believe AI agents should serve human interests — not
              optimize for throughput. Every piece of AI-generated content should earn its place in
              a knowledge base by passing human judgment first.
            </p>
            <p>
              That means: a change request comes in, a human reviews it, requests changes if needed,
              then approves. Only then does it become a canonical record. The audit trail stays
              forever. The team stays in control.
            </p>
          </div>
        </section>

        {/* Three pillars */}
        <section className="mb-16">
          <h2 className="mb-8 text-2xl font-bold">What BusaBase is</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Approval-first",
                body: "No AI output becomes a canonical record without human approval. Change Request → Review → Merge. Always.",
              },
              {
                title: "Privacy-first",
                body: "Open-source local engine. Your data never leaves your machine unless you choose to. No SaaS required.",
              },
              {
                title: "Agent-native",
                body: "REST API and structured schema designed from the ground up for AI agent workflows, not retrofitted.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border bg-card p-5">
                <h3 className="mb-2 font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Open core */}
        <section className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">Open core</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              BusaBase OSS (this app) is the open-source local engine — no login, one local
              workspace, PGLite persistence, REST APIs. It&apos;s the foundation: free forever,
              self-hostable, auditable.
            </p>
            <p>
              BusaBase Cloud wraps the same core with multi-user workspaces, team roles, billing,
              and enterprise audit logs. It&apos;s the hosted layer for teams who want the approval
              workflow without running infrastructure.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-xl border bg-muted/30 p-8 text-center">
          <h2 className="mb-3 text-xl font-bold">Start reviewing AI output today</h2>
          <p className="mb-6 text-muted-foreground">
            Run the local engine, point your AI agent at the API, and let humans decide what becomes
            canonical.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="/dashboard"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open Dashboard
            </a>
            <a
              href="https://github.com/vikadata/kapps/tree/develop/apps/busabase"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              View on GitHub
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
