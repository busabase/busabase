import { useMutation, useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FormFieldBindingVO } from "busabase-contract/types";
import { CheckCircle2, Code2, Eye, Globe, Lock } from "lucide-react";
import { useCallback, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { FormSandboxFrame } from "./form-sandbox-frame";

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
  const formQuery = useQuery({
    ...orpc.forms.getByNode.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
    retry: false,
  });
  const submit = useMutation(orpc.forms.submit.mutationOptions());
  const [values, setValues] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"form" | "code">("form");

  const form = formQuery.data ?? null;

  const doSubmit = useCallback(
    (payload: Record<string, unknown>) => {
      if (!slug) {
        return;
      }
      submit.mutate({ nodeId: slug, values: payload });
    },
    [slug, submit],
  );

  if (!form) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="font-semibold text-base">{messages.form.notConfigured}</div>
        <p className="mt-2 text-muted-foreground text-sm">{messages.form.notConfiguredBody}</p>
      </div>
    );
  }

  const { theme } = form.page;
  const hasCustomPage = Boolean(form.page.code);

  const submittedPanel = (
    <div className="px-6 py-16 text-center">
      <CheckCircle2 className="mx-auto text-emerald-600" size={40} />
      <div className="mt-3 font-semibold text-base">{messages.form.submitted}</div>
      <p className="mt-2 text-muted-foreground text-sm">{messages.form.pendingReview}</p>
      <p className="mt-1 font-mono text-muted-foreground/70 text-xs">
        {submit.data?.changeRequestId}
      </p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* Header: name + visibility + tabs */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate font-semibold text-lg">{form.name}</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-muted-foreground text-xs">
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
                ? "bg-background text-foreground shadow-sm"
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
                ? "bg-background text-foreground shadow-sm"
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
              <div className="mb-1 font-mono text-muted-foreground text-xs uppercase">page</div>
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
            <div className="mb-1 font-mono text-muted-foreground text-xs uppercase">bindings</div>
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
            <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 text-sm">
              {submit.error instanceof Error ? submit.error.message : messages.form.submitFailed}
            </div>
          ) : null}
        </div>
      ) : (
        <div>
          {theme?.coverUrl ? (
            <img alt="" className="mb-4 h-40 w-full rounded-lg object-cover" src={theme.coverUrl} />
          ) : null}
          {theme?.logoUrl ? (
            <img alt="" className="mb-3 h-10 w-10 rounded object-contain" src={theme.logoUrl} />
          ) : null}
          {form.description ? (
            <p className="mb-5 text-muted-foreground text-sm">{form.description}</p>
          ) : null}
          <div className="space-y-4">
            {form.bindings.map((binding: FormFieldBindingVO) => (
              <label className="block" key={binding.inputName}>
                <span className="font-medium text-foreground text-sm">
                  {binding.label ?? binding.fieldSlug}
                  {binding.required ? <span className="ml-0.5 text-rose-600">*</span> : null}
                </span>
                {binding.help ? (
                  <span className="mt-0.5 block text-muted-foreground text-xs">{binding.help}</span>
                ) : null}
                <input
                  className="mt-1.5 h-9 w-full rounded-md border border-border/70 bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
                  data-input-name={binding.inputName}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [binding.inputName]: event.target.value,
                    }))
                  }
                  value={values[binding.inputName] ?? ""}
                />
              </label>
            ))}
          </div>
          {submit.isError ? (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 text-sm">
              {submit.error instanceof Error ? submit.error.message : messages.form.submitFailed}
            </div>
          ) : null}
          <button
            className="mt-6 inline-flex h-9 items-center rounded-md bg-foreground px-4 font-medium text-background text-sm transition-colors hover:bg-foreground/85 disabled:opacity-60"
            disabled={submit.isPending}
            onClick={() => doSubmit(values)}
            type="button"
          >
            {submit.isPending ? messages.common.submitting : messages.common.submit}
          </button>
        </div>
      )}
    </div>
  );
}
