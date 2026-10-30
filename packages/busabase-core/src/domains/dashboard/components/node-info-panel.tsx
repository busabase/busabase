"use client";

// Read-only body of the Node Settings "Info" tab. Identity, timestamps, place,
// sharing, and the type-specific facts the open payload (or one cheap follow-up
// read) already has. Nothing here is a setting you edit — General owns that.

import { useQuery } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { UserRefVO } from "busabase-contract/types";
import { Copy } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { formatFullTime } from "../helpers/format";
import { nodeHref } from "../helpers/nav-tree";
import { getNodeInfoSections, type NodePropertyItem } from "../helpers/node-property-items";
import { dashboardNodeShareUrl } from "../utils/share-url";
import { NodeActivitySummary } from "./activity";
import { AssetMetadataBlock } from "./assets";
import { UserRefButton } from "./identity";
import { EmptyState } from "./primitives";
import { ShimmerSkeleton as Skeleton } from "./shimmer-skeleton";

const idle = {
  queryKey: ["node-info", "idle"] as const,
  queryFn: async () => null,
  enabled: false as const,
};

export function NodeInfoPanel({
  detail,
  isLoading,
  nodeId,
  nodeSlug,
  nodeType,
  orpc,
}: {
  detail: NodeDetailVO | undefined;
  isLoading: boolean;
  nodeId: string;
  nodeSlug?: string;
  nodeType: string;
  orpc: BusabaseQueryUtils;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const parentId = detail?.node.parentId ?? null;
  const baseId = detail?.type === "base" ? detail.node.baseId : null;
  const isForm = nodeType === "form";

  const parentQuery = useQuery(
    parentId
      ? { ...orpc.nodes.get.queryOptions({ input: { nodeId: parentId } }), enabled: true }
      : idle,
  );
  const shareQuery = useQuery(orpc.nodes.share.get.queryOptions({ input: { nodeId } }));
  const formQuery = useQuery(
    isForm ? { ...orpc.forms.getByNode.queryOptions({ input: { nodeId } }), enabled: true } : idle,
  );
  const countQuery = useQuery(
    baseId ? { ...orpc.records.count.queryOptions({ input: { baseId } }), enabled: true } : idle,
  );
  const baseQuery = useQuery(
    baseId ? { ...orpc.bases.get.queryOptions({ input: { baseId } }), enabled: true } : idle,
  );
  const viewsQuery = useQuery(
    baseId ? { ...orpc.bases.listViews.queryOptions({ input: { baseId } }), enabled: true } : idle,
  );
  const targetBaseId =
    formQuery.data && "targetBaseId" in formQuery.data ? formQuery.data.targetBaseId : null;
  const targetBaseQuery = useQuery(
    targetBaseId
      ? { ...orpc.bases.get.queryOptions({ input: { baseId: targetBaseId } }), enabled: true }
      : idle,
  );

  if (!detail) {
    return isLoading ? (
      <div className="space-y-3" aria-hidden>
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    ) : (
      <EmptyState body="" title={messages.common.none} />
    );
  }

  const linkHref =
    nodeSlug && typeof window !== "undefined"
      ? dashboardNodeShareUrl({
          currentHref: window.location.href,
          nodeSlug,
          nodeType,
        })
      : null;
  const sections = getNodeInfoSections(detail, messages, linkHref);
  const activityHref = nodeSlug
    ? nodeType === "base"
      ? `/base/${nodeSlug}/activity`
      : `/${nodeType}/${nodeSlug}/activity`
    : null;

  const form = formQuery.data && "submissionCount" in formQuery.data ? formQuery.data : null;
  const base = baseQuery.data && "fields" in baseQuery.data ? baseQuery.data : null;
  const targetBase =
    targetBaseQuery.data && "name" in targetBaseQuery.data ? targetBaseQuery.data : null;

  return (
    <div>
      {detail.node.description ? (
        <p className="mb-3 text-muted-foreground text-sm leading-6">{detail.node.description}</p>
      ) : null}

      <dl className="mb-3 flex flex-col gap-2 text-xs">
        {detail.attribution ? (
          <PersonRow
            id={detail.attribution.createdBy}
            label={messages.fieldTypes.created_by}
            user={detail.attribution.createdByUser}
          />
        ) : null}
        <TextRow
          label={messages.common.created}
          value={formatFullTime(detail.node.createdAt, locale)}
        />
        {detail.attribution ? (
          <PersonRow
            id={detail.attribution.updatedBy}
            label={messages.fieldTypes.updated_by}
            user={detail.attribution.updatedByUser}
          />
        ) : null}
        <TextRow
          label={messages.common.updated}
          value={formatFullTime(detail.node.updatedAt, locale)}
        />
      </dl>

      <PropertyList items={sections.identity} />
      <LocationRow
        isLoading={Boolean(parentId) && parentQuery.isPending}
        parent={parentQuery.data && "node" in parentQuery.data ? parentQuery.data : null}
        parentId={parentId}
      />
      {sections.link ? <PropertyList items={[sections.link]} /> : null}
      <PropertyList items={sections.access} />
      <ShareRow
        inherited={detail.node.sharedViaAncestor === true}
        isError={shareQuery.isError}
        isLoading={shareQuery.isPending}
        share={shareQuery.data && "scope" in shareQuery.data ? shareQuery.data : null}
      />

      {detail.type === "file" ? (
        <h2 className="mt-4 mb-2 font-medium text-muted-foreground text-xs uppercase">
          {messages.nodeDetail.backingAsset}
        </h2>
      ) : null}
      {sections.specifics.length > 0 ? <PropertyList items={sections.specifics} /> : null}

      {detail.type === "base" && baseId ? (
        <PropertyList
          items={[
            {
              label: messages.nodeDetail.rows,
              value: countQuery.isPending
                ? messages.common.loadingPlain
                : countQuery.data && "total" in countQuery.data
                  ? String(countQuery.data.total)
                  : messages.common.none,
            },
            {
              label: messages.common.fields,
              value: baseQuery.isPending
                ? messages.common.loadingPlain
                : base
                  ? String(base.fields.length)
                  : messages.common.none,
            },
            {
              label: messages.nodeDetail.views,
              value: viewsQuery.isPending
                ? messages.common.loadingPlain
                : viewsQuery.data
                  ? String(viewsQuery.data.length)
                  : messages.common.none,
            },
            ...(base
              ? [
                  {
                    label: messages.base.review,
                    value: fmt(messages.base.approvalRequired, {
                      count: base.reviewPolicy.requiredApprovals,
                    }),
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {isForm ? (
        formQuery.isError ? (
          <p className="mt-3 text-muted-foreground text-xs">
            {presentCoreError(messages, locale, formQuery.error, messages.form.notConfigured)}
          </p>
        ) : (
          <PropertyList
            items={[
              {
                key: "form-status",
                label: messages.nodeDetail.status,
                value: formQuery.isPending
                  ? messages.common.loadingPlain
                  : form?.status === "archived"
                    ? messages.nodeDetail.statusArchived
                    : messages.embedLinks.statusActive,
              },
              {
                label: messages.form.submitted,
                value: formQuery.isPending
                  ? messages.common.loadingPlain
                  : form
                    ? String(form.submissionCount)
                    : messages.common.none,
              },
              {
                label: messages.form.fieldBindings,
                value: formQuery.isPending
                  ? messages.common.loadingPlain
                  : form
                    ? String(form.bindings.length)
                    : messages.common.none,
              },
              {
                label: messages.form.targetBase,
                value: formQuery.isPending
                  ? messages.common.loadingPlain
                  : targetBase?.name || form?.targetBaseId || messages.common.none,
                href: targetBase?.slug ? `/base/${targetBase.slug}` : undefined,
              },
              {
                label: messages.share.capabilityLabel,
                value: formQuery.isPending
                  ? messages.common.loadingPlain
                  : form
                    ? formShareLabel(form.share, messages)
                    : messages.common.none,
              },
            ]}
          />
        )
      ) : null}

      {detail.type === "file" ? (
        <>
          <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs">
            <dt className="shrink-0 text-muted-foreground">{messages.nodeDetail.assetUrl}</dt>
            <dd className="min-w-0 truncate">
              <a
                className="text-primary underline-offset-2 hover:underline"
                href={detail.asset.url}
                rel="noreferrer"
                target="_blank"
              >
                {detail.asset.url}
              </a>
            </dd>
          </div>
          <AssetMetadataBlock compact metadata={detail.asset.metadata} />
        </>
      ) : null}

      <NodeActivitySummary activityHref={activityHref} nodeId={nodeId} orpc={orpc} />
    </div>
  );
}

function formShareLabel(
  share: { isPublic: boolean; anonymousSubmit: boolean },
  messages: ReturnType<typeof useCoreI18n>,
): string {
  if (!share.isPublic) return messages.form.private;
  return share.anonymousSubmit ? messages.form.publicAnonymous : messages.form.publicLogin;
}

function PersonRow({
  id,
  label,
  user,
}: {
  id: string | null;
  label: string;
  user: UserRefVO | null;
}) {
  const messages = useCoreI18n();
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground/80">
        {id ? (
          <UserRefButton fallbackId={id} user={user} />
        ) : (
          <span>{messages.identity.unknownUser}</span>
        )}
      </dd>
    </div>
  );
}

function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-foreground/80" title={value}>
        {value}
      </dd>
    </div>
  );
}

function LocationRow({
  isLoading,
  parent,
  parentId,
}: {
  isLoading: boolean;
  parent: NodeDetailVO | null;
  parentId: string | null;
}) {
  const messages = useCoreI18n();
  const parentNode = parent?.node;
  const href = parentNode ? nodeHref({ type: parentNode.type, slug: parentNode.slug }) : null;
  let value = messages.nodeDetail.workspaceRoot;
  if (parentId) {
    value = isLoading ? messages.common.loadingPlain : parentNode ? parentNode.name : parentId;
  }

  return (
    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted-foreground">{messages.nodeDetail.location}</dt>
      <dd className="min-w-0 truncate text-foreground/80" title={parentId ?? value}>
        {href && parentNode ? (
          <Link className="text-primary underline-offset-2 hover:underline" href={href}>
            {parentNode.name}
          </Link>
        ) : (
          <span className={parentId && !parentNode ? "font-mono" : undefined}>{value}</span>
        )}
      </dd>
    </div>
  );
}

function ShareRow({
  inherited,
  isError,
  isLoading,
  share,
}: {
  inherited: boolean;
  isError: boolean;
  isLoading: boolean;
  share: {
    scope: "none" | "public";
    capability: "read" | "submit";
    hasPassword: boolean;
    expiresAt: string | null;
  } | null;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  let value = messages.share.disabled;
  if (isLoading) value = messages.common.loadingPlain;
  else if (isError) value = messages.share.loadFailed;
  else if (share && shareIsLive(share)) {
    const capability =
      share.capability === "submit"
        ? messages.share.capabilitySubmit
        : messages.share.capabilityRead;
    const parts = [messages.share.enabled, capability];
    if (share.hasPassword) parts.push(messages.share.passwordLabel);
    if (share.expiresAt) {
      parts.push(`${messages.share.expiryLabel} ${formatFullTime(share.expiresAt, locale)}`);
    }
    value = parts.join(" · ");
  } else if (inherited) {
    value = messages.share.sharedViaAncestorMarker;
  }

  return (
    <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted-foreground">{messages.share.linkLabel}</dt>
      <dd className="min-w-0 truncate text-foreground/80" title={value}>
        {value}
      </dd>
    </div>
  );
}

const shareIsLive = (share: { scope: string; expiresAt: string | null }): boolean => {
  if (share.scope !== "public") return false;
  if (!share.expiresAt) return true;
  const time = new Date(share.expiresAt).getTime();
  return Number.isFinite(time) && time > Date.now();
};

function PropertyList({ items }: { items: NodePropertyItem[] }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(messages.nodeDetail.idCopied);
    } catch (error) {
      toast.error(presentCoreError(messages, locale, error, messages.share.failed));
    }
  };

  return (
    <dl className="mt-2 flex flex-col gap-2 text-xs">
      {items.map((item) => (
        <div
          className="flex min-w-0 items-center justify-between gap-3"
          key={item.key ?? item.label}
        >
          <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className="flex min-w-0 items-center justify-end gap-1.5 text-foreground/80">
            {item.href ? (
              <Link
                className={`min-w-0 truncate text-primary underline-offset-2 hover:underline ${item.mono ? "font-mono" : ""}`}
                href={item.href}
                title={item.value}
              >
                {item.value}
              </Link>
            ) : (
              <span
                className={`min-w-0 truncate ${item.mono ? "font-mono" : ""}`}
                title={item.value}
              >
                {item.value}
              </span>
            )}
            {item.copyable ? (
              <button
                aria-label={`${messages.nodeDetail.copyId}: ${item.label}`}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => void copy(item.copyValue ?? item.value)}
                type="button"
              >
                <Copy aria-hidden="true" className="size-3" />
              </button>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
