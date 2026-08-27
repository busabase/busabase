"use client";

import { useQuery } from "@tanstack/react-query";
import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { InstallResultVO } from "busabase-contract/domains/install/types";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { useState } from "react";
import type { AgentIntegrationTarget } from "../../dashboard/components/agent-install-panel";
import { InstallFromGithubModal } from "../../dashboard/components/install-from-github-modal";
import { NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { TemplateDetailView } from "./template-detail-view";
import { TemplatesListView } from "./templates-list-view";

interface TemplateCenterProps {
  orpc: BusabaseQueryUtils;
  apiClient?: BusabaseDashboardApiClient;
  /**
   * The template named by the URL (`/templates/:templateName`), or null on the
   * gallery route.
   *
   * The selection lives in the address bar rather than in component state.
   * State was the first shape and it was wrong in the ordinary ways: Back went
   * to whatever preceded the gallery instead of to the gallery, a template
   * could not be linked to, and a refresh dropped the user back at the grid.
   */
  selectedName: string | null;
  onSelect: (template: TemplateCardVO) => void;
  onBack: () => void;
  onInstalled: (result: InstallResultVO | null) => void;
  onReviewChangeRequests: () => void;
  /** Passed through to the install dialog's Agent install tab. */
  agentIntegration?: AgentIntegrationTarget;
}

/**
 * Gallery → detail → install.
 *
 * Installing reuses the SAME dialog the "Install from GitHub…" menu opens,
 * pre-filled from the card. That is not just reuse: browsing and installing must
 * never disagree about what a package is, who may install it, or what it will
 * create — and they cannot, if the preview a user confirms is literally the
 * same preview.
 */
export function TemplateCenter({
  orpc,
  apiClient,
  selectedName,
  onSelect,
  onBack,
  onInstalled,
  onReviewChangeRequests,
  agentIntegration,
}: TemplateCenterProps) {
  const [installing, setInstalling] = useState<TemplateCardVO | null>(null);

  // Installing is a space owner/admin action and the server enforces it. With
  // no api client there is nothing to install THROUGH, which is the same
  // answer for the user either way: browse, don't install.
  const canInstall = Boolean(apiClient);

  // The same query the gallery runs, so arriving on a template URL directly —
  // a fresh tab, a shared link — resolves from cache when the gallery has
  // already loaded and fetches once when it has not.
  const catalog = useQuery(orpc.templates.list.queryOptions({ input: {} }));
  const selected = selectedName
    ? (catalog.data?.templates.find((template) => template.name === selectedName) ?? null)
    : null;

  return (
    <>
      {selectedName ? (
        selected ? (
          <TemplateDetailView
            template={selected}
            canInstall={canInstall}
            onBack={onBack}
            onInstall={() => setInstalling(selected)}
          />
        ) : // A named template that the catalog does not have is either still
        // loading or genuinely gone — a link to one that was unpublished, or
        // a typo. Say which, rather than showing an empty page.
        catalog.isPending ? (
          <NodeDetailSkeleton variant="doc" />
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-6">
            <p className="text-muted-foreground text-sm">
              {`No template named “${selectedName}” in this catalog.`}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="w-fit text-sm underline underline-offset-4"
            >
              Back to Templates
            </button>
          </div>
        )
      ) : (
        <TemplatesListView orpc={orpc} canInstall={canInstall} onOpenTemplate={onSelect} />
      )}

      {apiClient && installing ? (
        <InstallFromGithubModal
          agentIntegration={agentIntegration}
          // Remounted per template, so the dialog never opens showing the
          // preview of the one looked at before it.
          key={installing.id}
          open
          apiClient={apiClient}
          initialRepoUrl={installing.install.repoUrl}
          initialIntoFolder={installing.install.intoFolder}
          initialPackageName={installing.name}
          onOpenChange={(open) => {
            if (!open) setInstalling(null);
          }}
          onInstalled={onInstalled}
          onReviewChangeRequests={onReviewChangeRequests}
        />
      ) : null}
    </>
  );
}
