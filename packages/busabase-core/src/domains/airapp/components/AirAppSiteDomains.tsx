"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteDomainBindingVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { airAppSiteHostnameSchema } from "busabase-contract/domains/airapp/contract";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Skeleton } from "kui/skeleton";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";

type DomainCopy = ReturnType<typeof useCoreI18n>["airapp"]["site"]["domains"];

/** Locales with a published `/docs/airapp-websites` guide; every other UI language links the English one. */
const DOMAIN_GUIDE_LOCALES: readonly string[] = ["zh-CN", "ja"];

export const airAppSiteDomainGuideUrl = (locale: string): string =>
  `${
    DOMAIN_GUIDE_LOCALES.includes(locale)
      ? `https://busabase.com/${locale}/docs/airapp-websites`
      : "https://busabase.com/docs/airapp-websites"
  }#custom-domains`;

/** An example name only: the real prefix is whatever the person's own subdomain is. */
const GUIDE_EXAMPLE_NAME = "shop";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const statusHint = (binding: AirAppSiteDomainBindingVO, copy: DomainCopy): string | null => {
  if (binding.status === "active") return null;
  if (binding.status === "error") {
    return binding.errors.length === 0 && binding.issues.length === 0 ? copy.errorHint : null;
  }
  if (binding.hostnameStatus === "active" && binding.sslStatus !== "active") {
    return copy.pendingHttpsHint;
  }
  return binding.dnsRecords.length === 0 ? copy.pendingDnsHint : null;
};

/**
 * One closed line until asked for, so an empty panel stays as quiet as before.
 * Its state lives here, so it is closed again whenever the guide comes back:
 * when the panel opens, and after the last domain is removed.
 */
function DomainSetupGuide({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 space-y-2">
      <button
        aria-controls={id}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 rounded-sm text-muted-foreground text-xs hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-airapp-site-domain-guide-toggle=""
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {label}
      </button>
      <div
        className="min-w-0 space-y-2 rounded-md border border-border bg-muted/40 p-3"
        data-airapp-site-domain-guide=""
        hidden={!open}
        id={id}
      >
        {children}
      </div>
    </div>
  );
}

/** Domain setup shares the site's controls, but a failed check never hides its default address. */
export function AirAppSiteDomains({
  orpc,
  nodeId,
  state,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  state: AirAppSiteStateVO;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = messages.airapp.site.domains;
  const id = useId();
  const queryClient = useQueryClient();
  const queryOptions = orpc.airapps.siteDomains.queryOptions({ input: { nodeId } });
  const domains = useQuery(queryOptions);
  const [hostname, setHostname] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [removeConfirmation, setRemoveConfirmation] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!copiedField) return;
    const timer = setTimeout(() => setCopiedField(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedField]);

  const bind = useMutation({
    mutationFn: (nextHostname: string) =>
      orpc.airapps.siteBindDomain.call({ nodeId, hostname: nextHostname }),
    onSuccess: (next) => {
      queryClient.setQueryData(queryOptions.queryKey, next);
      setHostname("");
      setValidationError(null);
    },
  });
  const unbind = useMutation({
    mutationFn: (nextHostname: string) =>
      orpc.airapps.siteUnbindDomain.call({ nodeId, hostname: nextHostname }),
    onSuccess: (next) => {
      queryClient.setQueryData(queryOptions.queryKey, next);
      setRemoveConfirmation(null);
    },
  });

  const copyText = async (field: string, value: string) => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
    } catch {
      setCopyFailed(true);
      setCopiedField(null);
    }
  };

  const mutationPending = bind.isPending || unbind.isPending;
  const hasCnameTarget = Boolean(domains.data?.cnameTarget);
  const canBind = hasCnameTarget && state.engine === "available" && state.liveVersion !== null;
  const inputError = validationError ?? (bind.isError ? errorMessage(bind.error) : null);

  const copyButton = (field: string, value: string, label: string) => (
    <Button
      aria-label={fmt(label, { value })}
      className="shrink-0 text-muted-foreground"
      onClick={() => void copyText(field, value)}
      size="icon-sm"
      title={copiedField === field ? copy.copied : fmt(label, { value })}
      type="button"
      variant="ghost"
    >
      {copiedField === field ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
    </Button>
  );

  const guideLink = (
    <a
      className="inline-flex w-fit items-center gap-1 rounded-sm text-primary text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-airapp-site-domain-guide-link=""
      href={airAppSiteDomainGuideUrl(locale)}
      rel="noreferrer"
      target="_blank"
    >
      {copy.guideLink}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );

  // Before anything is added there is no record to copy yet, but the target is
  // already known, so the whole setup can be taught (and DNS prepared) up front.
  const setupGuide = (cnameTarget: string) => (
    <DomainSetupGuide id={`${id}-guide`} label={copy.guideToggle}>
      <ol className="list-decimal space-y-2 ps-4 text-muted-foreground text-xs">
        <li>{fmt(copy.guideStepAdd, { add: copy.add })}</li>
        <li className="space-y-2">
          <p>{copy.guideStepDns}</p>
          <dl
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 rounded-md border border-border bg-background p-2"
            data-airapp-site-domain-guide-record=""
          >
            <dt>{copy.guideType}</dt>
            <dd className="font-mono text-foreground" dir="ltr">
              CNAME
            </dd>
            <dt>{copy.dnsName}</dt>
            <dd className="min-w-0 space-y-0.5">
              <p className="font-mono text-foreground" dir="ltr">
                {GUIDE_EXAMPLE_NAME}
              </p>
              <p>{copy.guideNameHint}</p>
            </dd>
            <dt className="pt-1">{copy.dnsValue}</dt>
            <dd className="flex min-w-0 items-start gap-1">
              <p
                className="min-w-0 flex-1 select-all break-all pt-1 font-mono text-foreground"
                data-airapp-site-domain-guide-target=""
                dir="ltr"
              >
                {cnameTarget}
              </p>
              {copyButton("guide-cname-target", cnameTarget, copy.copyValue)}
            </dd>
          </dl>
        </li>
        <li>{fmt(copy.guideStepCheck, { check: copy.check })}</li>
      </ol>
      <p className="text-muted-foreground text-xs">{copy.guideRootDomain}</p>
      {guideLink}
    </DomainSetupGuide>
  );

  const setupRecords = (binding: AirAppSiteDomainBindingVO) => (
    <div className="@container min-w-0 space-y-2">
      {binding.dnsRecords.some((record) => record.type !== "HTTP") ? (
        <>
          <p className="text-muted-foreground text-xs">{copy.dnsInstructions}</p>
          <p className="text-muted-foreground text-xs" data-airapp-site-domain-name-hint="">
            {copy.recordNameHint}
          </p>
        </>
      ) : null}
      {binding.dnsRecords.some((record) => record.type === "HTTP") ? (
        <p className="text-muted-foreground text-xs">{copy.httpInstructions}</p>
      ) : null}
      <dl className="space-y-3">
        {binding.dnsRecords.map((record) => {
          const isHttp = record.type === "HTTP";
          const recordId = `${binding.hostname}-${record.type}-${record.name}-${record.value}`;
          return (
            <div
              className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 @lg:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)]"
              data-airapp-site-dns-record={record.type}
              key={recordId}
            >
              <dt className="pt-1 font-medium text-foreground text-xs">{record.type}</dt>
              <dd className="flex min-w-0 items-start gap-1">
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-xs">
                    {isHttp ? copy.httpUrl : copy.dnsName}
                  </p>
                  <p className="select-all break-all font-mono text-foreground text-xs" dir="ltr">
                    {record.name}
                  </p>
                </div>
                {copyButton(
                  `${recordId}-name`,
                  record.name,
                  isHttp ? copy.copyHttpUrl : copy.copyName,
                )}
              </dd>
              <dd className="col-start-2 flex min-w-0 items-start gap-1 @lg:col-auto">
                <div className="min-w-0 flex-1">
                  <p className="text-muted-foreground text-xs">
                    {isHttp ? copy.httpBody : copy.dnsValue}
                  </p>
                  <p className="select-all break-all font-mono text-foreground text-xs" dir="ltr">
                    {record.value}
                  </p>
                </div>
                {copyButton(
                  `${recordId}-value`,
                  record.value,
                  isHttp ? copy.copyHttpBody : copy.copyValue,
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {guideLink}
    </div>
  );

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="min-w-0 space-y-3 border-border border-t pt-3"
      data-airapp-site-domains=""
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-foreground text-sm" id={`${id}-title`}>
          {copy.title}
        </h3>
        <Button
          className="text-muted-foreground"
          disabled={domains.isFetching || mutationPending}
          onClick={() => void domains.refetch()}
          size="sm"
          type="button"
          variant="ghost"
        >
          {domains.isFetching ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw aria-hidden="true" className="size-3.5" />
          )}
          {domains.isFetching ? copy.checking : copy.check}
        </Button>
      </div>

      {domains.isPending ? (
        <div aria-label={copy.loading} className="space-y-2" role="status">
          <Skeleton aria-hidden="true" className="h-4 w-2/3" />
          <Skeleton aria-hidden="true" className="h-9 w-full" />
        </div>
      ) : null}

      {domains.isError ? (
        <div className="space-y-1 break-words text-destructive text-xs" role="alert">
          <p>{copy.checkFailed}</p>
          <p>{errorMessage(domains.error)}</p>
          {domains.data ? <p>{copy.lastKnown}</p> : null}
        </div>
      ) : null}

      {domains.data && !domains.data.available ? (
        <p className="text-muted-foreground text-xs">{copy.unavailable}</p>
      ) : null}

      {domains.data?.available ? (
        <>
          {!state.isPublic && domains.data.bindings.length > 0 ? (
            <p className="text-muted-foreground text-xs">{copy.offlineHint}</p>
          ) : null}
          {domains.data.bindings.length > 0 ? (
            <ul className="divide-y divide-border" data-airapp-site-domain-list="">
              {domains.data.bindings.map((binding) => {
                const StatusIcon =
                  binding.status === "active"
                    ? CheckCircle2
                    : binding.status === "error"
                      ? TriangleAlert
                      : Clock3;
                const statusCopy =
                  binding.status === "active"
                    ? copy.active
                    : binding.status === "error"
                      ? copy.error
                      : copy.pending;
                const isRemoving = unbind.isPending && unbind.variables === binding.hostname;
                const hint = statusHint(binding, copy);
                return (
                  <li
                    className="min-w-0 space-y-3 py-3 first:pt-0"
                    data-airapp-site-domain={binding.hostname}
                    key={binding.hostname}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        {binding.status === "active" && state.isPublic ? (
                          <a
                            className="break-all text-primary text-sm underline-offset-2 hover:underline"
                            href={binding.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {binding.hostname}
                          </a>
                        ) : (
                          <p className="break-all font-medium text-foreground text-sm">
                            {binding.hostname}
                          </p>
                        )}
                        <p
                          aria-atomic="true"
                          aria-live="polite"
                          className={`flex items-start gap-1.5 text-xs ${
                            binding.status === "error"
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                          data-airapp-site-domain-status={binding.status}
                        >
                          <StatusIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            <span className="font-medium">{statusCopy}</span>
                            {hint ? (
                              <>
                                {" · "}
                                <span>{hint}</span>
                              </>
                            ) : null}
                          </span>
                        </p>
                      </div>
                      {removeConfirmation !== binding.hostname ? (
                        <Button
                          aria-label={fmt(copy.removeLabel, { hostname: binding.hostname })}
                          className="text-muted-foreground"
                          disabled={mutationPending}
                          onClick={() => {
                            unbind.reset();
                            setRemoveConfirmation(binding.hostname);
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {copy.remove}
                        </Button>
                      ) : null}
                    </div>
                    {binding.issues.length > 0 || binding.errors.length > 0 ? (
                      <ul
                        className={`space-y-1 break-words text-xs ${
                          binding.status === "error" ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {/* This deployment's findings in the viewer's language, then the provider's own words. */}
                        {binding.issues.map((issue) => (
                          <li data-airapp-site-domain-issue={issue} key={issue}>
                            {copy.issues[issue]}
                          </li>
                        ))}
                        {binding.errors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    ) : null}
                    {binding.dnsRecords.length > 0 ? (
                      binding.status === "active" ? (
                        <details className="min-w-0" data-airapp-site-domain-setup="">
                          <summary
                            aria-label={`${binding.hostname}: ${messages.nodeDetail.details}`}
                            className="w-fit cursor-pointer rounded-sm text-muted-foreground text-xs underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {messages.nodeDetail.details}
                          </summary>
                          <div className="pt-2">{setupRecords(binding)}</div>
                        </details>
                      ) : (
                        setupRecords(binding)
                      )
                    ) : null}
                    {removeConfirmation === binding.hostname ? (
                      <div className="space-y-2">
                        <p className="break-words text-foreground text-xs">
                          {fmt(copy.removeConfirm, { hostname: binding.hostname })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={mutationPending}
                            onClick={() => unbind.mutate(binding.hostname)}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            {isRemoving ? (
                              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                            ) : null}
                            {isRemoving ? copy.removing : copy.confirmRemove}
                          </Button>
                          <Button
                            disabled={mutationPending}
                            onClick={() => {
                              setRemoveConfirmation(null);
                              unbind.reset();
                            }}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {copy.cancel}
                          </Button>
                        </div>
                        {unbind.isError && unbind.variables === binding.hostname ? (
                          <p className="break-words text-destructive text-xs" role="alert">
                            {errorMessage(unbind.error)}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : domains.data.cnameTarget && state.engine === "available" ? (
            setupGuide(domains.data.cnameTarget)
          ) : (
            <p className="text-muted-foreground text-xs">{copy.empty}</p>
          )}
          <form
            className={
              domains.data.bindings.length > 0
                ? "space-y-2 border-border border-t pt-3"
                : "space-y-2"
            }
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!canBind || mutationPending) return;
              const parsed = airAppSiteHostnameSchema.safeParse(hostname);
              if (!parsed.success) {
                setValidationError(copy.invalidHostname);
                return;
              }
              setValidationError(null);
              bind.mutate(parsed.data);
            }}
          >
            <Label htmlFor={`${id}-hostname`}>{copy.hostnameLabel}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                aria-describedby={`${id}-hint${inputError ? ` ${id}-error` : ""}`}
                aria-invalid={Boolean(inputError)}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                className="min-w-0 flex-1 basis-44 text-base sm:text-sm"
                dir="ltr"
                disabled={!canBind || mutationPending}
                id={`${id}-hostname`}
                inputMode="url"
                maxLength={253}
                onChange={(event) => {
                  setHostname(event.target.value);
                  setValidationError(null);
                  bind.reset();
                }}
                placeholder="shop.company.com"
                spellCheck={false}
                value={hostname}
              />
              <Button
                disabled={!canBind || mutationPending || !hostname.trim()}
                size="sm"
                type="submit"
              >
                {bind.isPending ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : null}
                {bind.isPending ? copy.adding : copy.add}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs" id={`${id}-hint`}>
              {!canBind
                ? !hasCnameTarget
                  ? copy.unavailable
                  : state.engine !== "available"
                    ? copy.planLocked
                    : copy.publishFirst
                : copy.hostnameHint}
            </p>
            {inputError ? (
              <p className="break-words text-destructive text-xs" id={`${id}-error`} role="alert">
                {inputError}
              </p>
            ) : null}
          </form>
        </>
      ) : null}
      <p aria-live="polite" className="sr-only" role="status">
        {copiedField ? copy.copied : ""}
      </p>
      {copyFailed ? (
        <p className="text-destructive text-xs" role="alert">
          {copy.copyFailed}
        </p>
      ) : null}
    </section>
  );
}
