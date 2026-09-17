"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FormVO } from "busabase-contract/types";
import { Globe, Lock } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useMemo } from "react";
import { useSearch } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { mergeSearchIntoHref } from "../../dashboard/helpers/link-search";

const FORMS_PAGE_SIZE = 20;

interface FormsForBasePanelProps {
  orpc: BusabaseQueryUtils;
  /** The Base these forms WRITE INTO — `forms.list` is scoped to it, never space-wide. */
  baseId: string;
  /**
   * The Base's own node id. Accepted so a caller that already has it does not
   * have to look it up; unused by the read itself (`forms.list` takes the base
   * id), but it keeps this panel's contract stable if the query ever moves to
   * the node.
   */
  baseNodeId?: string;
}

/**
 * "Forms writing into this Base" — provenance and safety on the object people
 * actually care about.
 *
 * A public Form with anonymous submit turns a Base into an inbox strangers can
 * queue rows into, and until this panel the only place that fact was visible was
 * the form's own page — so you could only audit it if you already knew the form
 * existed, and forms live anywhere in the node tree. Inheriting a Base meant
 * inheriting inbound surfaces you had no screen to find.
 *
 * Self-contained on purpose: it owns its own loading / empty / error states so a
 * host only has to drop it into a column.
 */
export function FormsForBasePanel({ orpc, baseId }: FormsForBasePanelProps) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();

  const listOptions = useMemo(
    () =>
      orpc.forms.list.infiniteOptions({
        input: (pageParam: string | undefined) => ({
          targetBaseId: baseId,
          limit: FORMS_PAGE_SIZE,
          cursor: pageParam,
        }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }),
    [baseId, orpc],
  );
  const formsQuery = useInfiniteQuery(listOptions);
  const forms = formsQuery.data?.pages.flatMap((page) => page.forms) ?? [];

  if (formsQuery.isPending) {
    return (
      <section>
        <SectionHeader />
        <p className="text-muted-foreground text-sm">{messages.common.loading}</p>
      </section>
    );
  }

  if (formsQuery.isError) {
    return (
      <section>
        <SectionHeader />
        {/* Never the raw English ORPCError: an unreadable, id-bearing server
            string on a safety panel reads as "this is broken", not "this
            failed to load". */}
        <div className="rounded-md border border-rejected/35 bg-rejected/17 px-3 py-2 text-rejected-strong text-sm">
          {messages.form.forBaseFailed}
        </div>
      </section>
    );
  }

  if (forms.length === 0) {
    return (
      <section>
        <SectionHeader />
        <p className="text-muted-foreground text-sm">{messages.form.forBaseEmpty}</p>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader count={forms.length} />
      <div className="overflow-hidden rounded-md border border-border/60">
        {forms.map((form) => (
          <FormRow currentSearch={currentSearch} form={form} key={form.id} />
        ))}
      </div>
      {formsQuery.hasNextPage ? (
        <button
          className="mt-2 inline-flex h-8 items-center rounded-md border border-border/70 bg-card px-2.5 font-medium text-xs transition-colors hover:bg-accent disabled:opacity-60"
          disabled={formsQuery.isFetchingNextPage}
          onClick={() => void formsQuery.fetchNextPage()}
          type="button"
        >
          {formsQuery.isFetchingNextPage ? messages.common.loading : messages.form.forBaseLoadMore}
        </button>
      ) : null}
    </section>
  );
}

function SectionHeader({ count }: { count?: number }) {
  const messages = useCoreI18n();
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
      <div className="font-semibold text-sm">{messages.form.forBaseTitle}</div>
      {count === undefined ? null : (
        <span className="rounded-md bg-muted/55 px-2.5 py-1 text-muted-foreground text-xs">
          {fmt(messages.form.forBaseCount, { count, plural: count === 1 ? "" : "s" })}
        </span>
      )}
    </div>
  );
}

function FormRow({ currentSearch, form }: { currentSearch: string; form: FormVO }) {
  const messages = useCoreI18n();
  // `forms.getByNode` resolves a node id or a slug, so the registry's
  // `/form/:slug` detail route opens this form from its node id directly.
  const href = mergeSearchIntoHref(`/form/${form.nodeId}`, currentSearch);
  const isOpenToAnyone = form.share.isPublic && form.share.anonymousSubmit;

  return (
    <div className="border-border/40 border-b last:border-b-0">
      <Link
        className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2 text-sm transition-colors hover:bg-muted/35"
        href={href}
      >
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{form.name}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-muted-foreground text-xs">
          {form.share.isPublic ? <Globe size={11} /> : <Lock size={11} />}
          {form.share.isPublic
            ? form.share.anonymousSubmit
              ? messages.form.publicAnonymous
              : messages.form.publicLogin
            : messages.form.private}
        </span>
        <span className="shrink-0 text-muted-foreground text-xs">
          {fmt(messages.form.forBaseSubmissions, {
            count: form.submissionCount,
            plural: form.submissionCount === 1 ? "" : "s",
          })}
        </span>
        <span className="shrink-0 text-muted-foreground text-xs">
          {fmt(messages.form.forBaseBoundFields, {
            count: form.bindings.length,
            plural: form.bindings.length === 1 ? "" : "s",
          })}
        </span>
      </Link>
      {isOpenToAnyone ? (
        <div className="mx-2.5 mb-2 rounded-md border border-rejected/35 bg-rejected/17 px-2.5 py-1.5 text-rejected-strong text-xs">
          {messages.form.forBasePublicWarning}
        </div>
      ) : null}
    </div>
  );
}
