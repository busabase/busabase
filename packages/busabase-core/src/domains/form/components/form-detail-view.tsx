import { useMutation, useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FormFieldBindingVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { CheckCircle2, Code2, Eye, Globe, Lock } from "lucide-react";
import { useCallback, useState } from "react";
import { useCoreI18n, useIString } from "../../../i18n";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { FormSandboxFrame } from "./form-sandbox-frame";
import { GeneratedFormField } from "./generated-form-field";

/**
 * Form node detail view.
 *
 * "Form" tab renders the fillable page: if the agent authored a custom page
 * (`page.html`) it runs inside a STRICT sandbox iframe (see FormSandboxFrame)
 * and submits through the `busa.submit` bridge; otherwise the view falls back to
 * inputs generated from the binding contract. "Code" tab reviews the
 * agent-written source — the review surface for agent-authored pages.
 */
export function FormDetailView({ orpc, slug }: { orpc: BusabaseQueryUtils; slug: string | null }) {
  const messages = useCoreI18n();
  const resolveIString = useIString();
  const formQuery = useQuery({
    ...orpc.forms.getByNode.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
    retry: false,
  });
  const form = formQuery.isError ? null : (formQuery.data ?? null);
  const submit = useMutation(orpc.forms.submit.mutationOptions());
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [tab, setTab] = useState<"form" | "code">("form");

  const doSubmit = useCallback(
    (payload: Record<string, unknown>) => {
      if (!slug) {
        return;
      }
      submit.mutate({ nodeId: slug, values: payload });
    },
    [slug, submit],
  );

  if (formQuery.isPending) {
    return <NodeDetailSkeleton variant="doc" />;
  }

  if (formQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="font-semibold text-base">{messages.inbox.loadFailedTitle}</div>
        <p className="mt-2 text-muted-foreground text-sm">
          {formQuery.error instanceof Error
            ? formQuery.error.message
            : messages.inbox.loadFailedBody}
        </p>
        <Button
          className="mt-4"
          onClick={() => void formQuery.refetch()}
          type="button"
          variant="outline"
        >
          {messages.inbox.retry}
        </Button>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="font-semibold text-base">{messages.form.notConfigured}</div>
        <p className="mt-2 text-muted-foreground text-sm">{messages.form.notConfiguredBody}</p>
      </div>
    );
  }

  const hasCustomPage = Boolean(form.page.code);
  const targetFieldsBySlug = new Map(form.boundFields.map((field) => [field.slug, field]));

  const submittedPanel = (
    <div className="px-6 py-16 text-center">
      <CheckCircle2 className="mx-auto text-merged" size={40} />
      <div className="mt-3 font-semibold text-base">{messages.form.submitted}</div>
      <p className="mt-2 text-muted-foreground text-sm">{messages.form.pendingReview}</p>
      <p className="mt-1 font-mono text-muted-foreground/70 text-xs">
        {submit.data?.changeRequestId}
      </p>
    </div>
  );

  if (!hasCustomPage) {
    return (
      <div
        className="h-full min-h-0 w-full overflow-auto bg-muted/35"
        data-dashboard-scroll="generated-form"
      >
        <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
          <section className="overflow-hidden rounded-md border border-border/70 bg-card">
            <header className="border-border/60 border-b px-5 py-5 sm:px-7">
              <h1 className="font-semibold text-2xl text-foreground leading-tight">{form.name}</h1>
              {form.description ? (
                <p className="mt-1.5 max-w-2xl text-muted-foreground text-sm leading-5">
                  {form.description}
                </p>
              ) : null}
            </header>

            {submit.isSuccess ? (
              submittedPanel
            ) : (
              <div className="px-5 py-5 sm:px-7">
                <div className="space-y-3">
                  {form.bindings.map((binding: FormFieldBindingVO) => {
                    const field = targetFieldsBySlug.get(binding.fieldSlug);
                    const label =
                      binding.label ?? (field ? resolveIString(field.name) : binding.fieldSlug);
                    return (
                      <GeneratedFormField
                        binding={binding}
                        field={field}
                        key={binding.inputName}
                        label={label}
                        onChange={(value) =>
                          setValues((current) => ({ ...current, [binding.inputName]: value }))
                        }
                        value={values[binding.inputName]}
                      />
                    );
                  })}
                </div>

                {submit.isError ? (
                  <div className="mt-4 rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
                    {submit.error instanceof Error
                      ? submit.error.message
                      : messages.form.submitFailed}
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end border-border/50 border-t pt-3">
                  <button
                    className="inline-flex h-9 min-w-28 items-center justify-center rounded-md bg-foreground px-4 font-medium text-background text-sm transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:opacity-60"
                    disabled={submit.isPending}
                    onClick={() => doSubmit(values)}
                    type="button"
                  >
                    {submit.isPending ? messages.common.submitting : messages.common.submit}
                  </button>
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* Header: name + visibility + tabs */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate font-semibold text-lg">{form.name}</h1>
          <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-muted-foreground text-xs">
            {form.share.isPublic ? <Globe size={11} /> : <Lock size={11} />}
            {form.share.isPublic
              ? form.share.anonymousSubmit
                ? messages.form.publicAnonymous
                : messages.form.publicLogin
              : messages.form.private}
          </span>
        </div>
        <div className="flex rounded-md bg-muted/60 p-0.5 text-xs">
          <button
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors ${
              tab === "form"
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("form")}
            type="button"
          >
            <Eye size={12} />
            {messages.form.tabForm}
          </button>
          <button
            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium transition-colors ${
              tab === "code"
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab("code")}
            type="button"
          >
            <Code2 size={12} />
            {messages.form.tabCode}
          </button>
        </div>
      </div>

      {tab === "code" ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">{messages.form.codeReviewHint}</p>
          {hasCustomPage ? (
            <div>
              <div className="mb-1 font-mono text-muted-foreground text-xs uppercase">
                {messages.form.pageSource}
              </div>
              <pre className="max-h-[32rem] overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                <code>{form.page.code}</code>
              </pre>
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/20 p-4 text-muted-foreground text-sm">
              {messages.form.noCustomPage}
            </div>
          )}
          <div>
            <div className="mb-1 font-mono text-muted-foreground text-xs uppercase">
              {messages.form.fieldBindings}
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
              <code>{JSON.stringify(form.bindings, null, 2)}</code>
            </pre>
          </div>
        </div>
      ) : submit.isSuccess ? (
        submittedPanel
      ) : hasCustomPage ? (
        <div>
          <FormSandboxFrame onSubmit={doSubmit} page={form.page} />
          <p className="mt-2 text-muted-foreground text-xs">{messages.form.sandboxHint}</p>
          {submit.isError ? (
            <div className="mt-3 rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
              {submit.error instanceof Error ? submit.error.message : messages.form.submitFailed}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
