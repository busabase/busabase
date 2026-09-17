"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  FormFieldBindingVO,
  FormSubmitResultVO,
  FormVO,
  NodeVO,
} from "busabase-contract/types";
import { Button } from "kui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { CheckCircle2, Code2, Eye, FileInput, Globe, Info, Lock } from "lucide-react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import { useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { NodeSettingsDialog } from "../../dashboard/components/node-settings-dialog";
import {
  FullscreenPreviewSurface,
  PREVIEW_DETAIL_TAB_LIST_CLASS,
  PREVIEW_DETAIL_TAB_TRIGGER_CLASS,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
} from "../../dashboard/components/preview-fullscreen";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { isFormNotConfiguredError } from "../utils/not-configured-error";
import { FormSandboxFrame } from "./form-sandbox-frame";
import { FormSetupDialog } from "./form-setup-dialog";
import { GeneratedFormField } from "./generated-form-field";

interface SubmitMutation {
  data?: FormSubmitResultVO;
  error: unknown;
  isError: boolean;
  isPending: boolean;
  isSuccess: boolean;
  mutate: (input: { nodeId: string; values: Record<string, unknown> }) => void;
}

function SubmittedPanel({ submit }: { submit: SubmitMutation }) {
  const messages = useCoreI18n();
  return (
    <div className="px-6 py-16 text-center">
      <CheckCircle2 className="mx-auto text-merged" size={40} />
      <div className="mt-3 font-semibold text-base">{messages.form.submitted}</div>
      <p className="mt-2 text-muted-foreground text-sm">
        {submit.data?.status === "merged"
          ? messages.form.submissionMerged
          : messages.form.pendingReview}
      </p>
      <p className="mt-1 font-mono text-muted-foreground/70 text-xs">
        {submit.data?.changeRequestId}
      </p>
    </div>
  );
}

function FormPreviewSurface({
  form,
  fullscreenState,
  onSubmit,
  setValues,
  showToolbar = false,
  submit,
  values,
}: {
  form: FormVO;
  fullscreenState: PreviewFullscreenState;
  onSubmit: (values: Record<string, unknown>) => void;
  setValues: Dispatch<SetStateAction<Record<string, unknown>>>;
  showToolbar?: boolean;
  submit: SubmitMutation;
  values: Record<string, unknown>;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const resolveIString = useIString();
  const hasCustomPage = Boolean(form.page.code);
  const targetFieldsBySlug = new Map(form.boundFields.map((field) => [field.slug, field]));

  return (
    <FullscreenPreviewSurface
      aria-label={`${form.name} ${messages.form.tabForm}`}
      bodyClassName={
        hasCustomPage && fullscreenState.fullscreen
          ? "bg-background p-0"
          : "overflow-auto bg-muted/35"
      }
      data-form-fullscreen={fullscreenState.fullscreen ? "true" : "false"}
      data-form-preview=""
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={fullscreenState}
      toolbar={
        showToolbar ? (
          <div className="flex min-h-11 items-center justify-between gap-2 border-border/60 border-b px-4 py-2">
            <span className="font-medium text-muted-foreground text-xs uppercase">
              {messages.form.tabForm}
            </span>
            <PreviewFullscreenButton
              fullscreenState={fullscreenState}
              label={messages.airapp.enterFullscreen}
            />
          </div>
        ) : null
      }
    >
      {submit.isSuccess ? (
        <SubmittedPanel submit={submit} />
      ) : hasCustomPage ? (
        <div
          className={
            fullscreenState.fullscreen
              ? "h-full min-h-0"
              : "mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8"
          }
        >
          <FormSandboxFrame
            fill={fullscreenState.fullscreen}
            onSubmit={onSubmit}
            page={form.page}
          />
          {!fullscreenState.fullscreen ? (
            <p className="mt-2 text-muted-foreground text-xs">{messages.form.sandboxHint}</p>
          ) : null}
          {submit.isError ? (
            <div className="mt-3 rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
              {presentCoreError(messages, locale, submit.error, messages.form.submitFailed)}
            </div>
          ) : null}
        </div>
      ) : (
        <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:py-10">
          <section className="overflow-hidden rounded-md border border-border/70 bg-card">
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
                  {presentCoreError(messages, locale, submit.error, messages.form.submitFailed)}
                </div>
              ) : null}

              <div className="mt-4 flex justify-end border-border/50 border-t pt-3">
                <button
                  className="inline-flex h-9 min-w-28 items-center justify-center rounded-md bg-foreground px-4 font-medium text-background text-sm transition-colors hover:bg-foreground/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:opacity-60"
                  disabled={submit.isPending}
                  onClick={() => onSubmit(values)}
                  type="button"
                >
                  {submit.isPending ? messages.common.submitting : messages.common.submit}
                </button>
              </div>
            </div>
          </section>
        </main>
      )}
    </FullscreenPreviewSurface>
  );
}

interface FormDetailViewProps {
  fullscreenState: PreviewFullscreenState;
  node?: NodeVO;
  orpc: BusabaseQueryUtils;
  previewOnly?: boolean;
  slug: string | null;
}

/** Form detail editor, or a preview-only instance when hosted in the Side Panel. */
export function FormDetailView({
  fullscreenState,
  node,
  orpc,
  previewOnly = false,
  slug,
}: FormDetailViewProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const formQuery = useQuery({
    ...orpc.forms.getByNode.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
    retry: false,
  });
  const form = formQuery.isError ? null : (formQuery.data ?? null);
  const isNotConfigured = isFormNotConfiguredError(formQuery.error);
  const submit = useMutation(orpc.forms.submit.mutationOptions());
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [tab, setTab] = useState<"form" | "code">("form");
  const [infoOpen, setInfoOpen] = useState(false);
  const [isSetUpOpen, setIsSetUpOpen] = useState(false);

  useEffect(() => {
    if (fullscreenState.fullscreen) setTab("form");
  }, [fullscreenState.fullscreen]);

  const isAnonymous = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const canSetUp = !isAnonymous && hasApiKeyLevel(permissionLevel, "manage");
  const nodeQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "form" } }),
    enabled: Boolean(slug) && canSetUp && !formQuery.isPending && !form,
    retry: false,
  });
  const setUpNodeName =
    (nodeQuery.data && "node" in nodeQuery.data ? nodeQuery.data.node.name : null) ?? slug ?? "";

  const doSubmit = useCallback(
    (payload: Record<string, unknown>) => {
      if (slug) submit.mutate({ nodeId: slug, values: payload });
    },
    [slug, submit],
  );

  if (formQuery.isPending) return <NodeDetailSkeleton variant="doc" />;

  if (formQuery.isError && !isNotConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="font-semibold text-base">{messages.inbox.loadFailedTitle}</div>
        <p className="mt-2 text-muted-foreground text-sm">
          {presentCoreError(messages, locale, formQuery.error, messages.inbox.loadFailedBody)}
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
        {canSetUp && !previewOnly ? (
          <>
            <Button className="mt-4" onClick={() => setIsSetUpOpen(true)} type="button">
              {messages.form.setUpCta}
            </Button>
            <FormSetupDialog
              nodeId={slug ?? ""}
              nodeName={setUpNodeName}
              onCreated={() => void formQuery.refetch()}
              onOpenChange={setIsSetUpOpen}
              open={isSetUpOpen}
              orpc={orpc}
            />
          </>
        ) : isAnonymous || previewOnly ? null : (
          <p className="mt-3 text-muted-foreground text-xs">{messages.form.setUpNeedsManage}</p>
        )}
      </div>
    );
  }

  const preview = (
    <FormPreviewSurface
      form={form}
      fullscreenState={fullscreenState}
      onSubmit={doSubmit}
      setValues={setValues}
      showToolbar={previewOnly}
      submit={submit}
      values={values}
    />
  );

  if (previewOnly) return preview;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={(value) => setTab(value as "form" | "code")}
        value={fullscreenState.fullscreen ? "form" : tab}
      >
        <header className="shrink-0 border-border/60 border-b px-4 pt-5 pb-2 md:px-6">
          <div className="flex min-w-0 items-start gap-2">
            <FileInput className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="truncate font-semibold text-foreground text-xl leading-7">
                  {form.name}
                </h1>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-muted-foreground text-xs">
                  {form.share.isPublic ? <Globe size={11} /> : <Lock size={11} />}
                  {form.share.isPublic
                    ? form.share.anonymousSubmit
                      ? messages.form.publicAnonymous
                      : messages.form.publicLogin
                    : messages.form.private}
                </span>
              </div>
              {form.description ? (
                <p
                  className="mt-1 line-clamp-2 text-muted-foreground text-sm leading-5 md:line-clamp-1"
                  title={form.description}
                >
                  {form.description}
                </p>
              ) : null}
            </div>
            {node ? (
              <>
                <Button
                  aria-label={messages.nodeDetail.details}
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setInfoOpen(true)}
                  size="icon-sm"
                  title={messages.nodeDetail.details}
                  type="button"
                  variant="ghost"
                >
                  <Info className="size-3.5" />
                </Button>
                {infoOpen ? (
                  <NodeSettingsDialog
                    initialTab="info"
                    nodeId={node.id}
                    nodeName={node.name}
                    nodeSlug={node.slug}
                    nodeType="form"
                    onOpenChange={setInfoOpen}
                    open
                    orpc={orpc}
                  />
                ) : null}
              </>
            ) : null}
          </div>
          <TabsList className={PREVIEW_DETAIL_TAB_LIST_CLASS}>
            <TabsTrigger className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS} value="form">
              <Eye className="size-3.5" />
              {messages.form.tabForm}
            </TabsTrigger>
            <TabsTrigger className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS} value="code">
              <Code2 className="size-3.5" />
              {messages.form.tabCode}
            </TabsTrigger>
          </TabsList>
        </header>
        <TabsContent
          className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden"
          forceMount
          value="form"
        >
          {preview}
        </TabsContent>
        <TabsContent className="m-0 min-h-0 flex-1 overflow-auto p-4 md:p-6" value="code">
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">{messages.form.codeReviewHint}</p>
            {form.page.code ? (
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
