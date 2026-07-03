import type { Metadata } from "next";
import { getBusabaseServerLL } from "~/lib/i18n-server";

export const metadata: Metadata = {
  title: "About BusaBase",
  description:
    "BusaBase is an approval-first database for AI agents. Every AI-generated record must pass human review before it becomes canonical.",
};

export default async function AboutPage() {
  const LL = await getBusabaseServerLL();
  const pillars = [
    {
      title: LL.marketing.pillarApprovalTitle(),
      body: LL.marketing.pillarApprovalBody(),
    },
    {
      title: LL.marketing.pillarPrivacyTitle(),
      body: LL.marketing.pillarPrivacyBody(),
    },
    {
      title: LL.marketing.pillarAgentTitle(),
      body: LL.marketing.pillarAgentBody(),
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto max-w-3xl px-4 py-20">
        {/* Header */}
        <div className="mb-16 text-center">
          <span className="mb-4 inline-block rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
            {LL.marketing.aboutEyebrow()}
          </span>
          <h1 className="mb-6 text-4xl font-bold tracking-tight">{LL.marketing.aboutHeadline()}</h1>
          <p className="text-xl text-muted-foreground">
            {LL.marketing.aboutSubhead()}
            <br />
            {LL.marketing.aboutCategory()}{" "}
            <span className="font-medium text-foreground">{LL.marketing.aboutCategoryValue()}</span>
          </p>
        </div>

        {/* Mission */}
        <section className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">{LL.marketing.convictionTitle()}</h2>
          <div className="space-y-5 text-muted-foreground leading-relaxed">
            <p>{LL.marketing.convictionP1()}</p>
            <p>{LL.marketing.convictionP2()}</p>
            <p>{LL.marketing.convictionP3()}</p>
          </div>
        </section>

        {/* Three pillars */}
        <section className="mb-16">
          <h2 className="mb-8 text-2xl font-bold">{LL.marketing.whatIsTitle()}</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {pillars.map((item) => (
              <div key={item.title} className="rounded-lg border bg-card p-5">
                <h3 className="mb-2 font-semibold">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Open core */}
        <section className="mb-16">
          <h2 className="mb-6 text-2xl font-bold">{LL.marketing.openCoreTitle()}</h2>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>{LL.marketing.openCoreP1()}</p>
            <p>{LL.marketing.openCoreP2()}</p>
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-xl border bg-muted/30 p-8 text-center">
          <h2 className="mb-3 text-xl font-bold">{LL.marketing.aboutCtaTitle()}</h2>
          <p className="mb-6 text-muted-foreground">{LL.marketing.aboutCtaBody()}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="/dashboard"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {LL.marketing.openDashboard()}
            </a>
            <a
              href="https://github.com/vikadata/kapps/tree/develop/apps/busabase"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              {LL.marketing.viewOnGithub()}
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
