"use client";

import type { BusabaseDashboardApiClient } from "busabase-contract/api-client";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { InstallResultVO } from "busabase-contract/domains/install/types";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { useState } from "react";
import { InstallFromGithubModal } from "../../dashboard/components/install-from-github-modal";
import { TemplateDetailView } from "./template-detail-view";
import { TemplatesListView } from "./templates-list-view";

interface TemplateCenterProps {
  orpc: BusabaseQueryUtils;
  apiClient?: BusabaseDashboardApiClient;
  onInstalled: (result: InstallResultVO) => void;
  onReviewChangeRequests: () => void;
}

/**
 * Gallery → detail → install, in one place.
 *
 * Installing reuses the SAME dialog the "Install from GitHub…" menu opens,
 * pre-filled from the card. That is not just reuse: browsing and installing must
 * never disagree about what a package is, who may install it, or what it will
 * create — and they cannot, if the preview a user confirms is literally the
 * same preview.
 *
 * The selected template lives in state rather than in the URL because its id
 * contains slashes (`owner/repo/skills/name`); a route pattern would need
 * escaping on both sides for no gain over a back button.
 */
export function TemplateCenter({
  orpc,
  apiClient,
  onInstalled,
  onReviewChangeRequests,
}: TemplateCenterProps) {
  const [selected, setSelected] = useState<TemplateCardVO | null>(null);
  const [installing, setInstalling] = useState<TemplateCardVO | null>(null);

  // Installing is a space owner/admin action and the server enforces it. With
  // no api client there is nothing to install THROUGH, which is the same
  // answer for the user either way: browse, don't install.
  const canInstall = Boolean(apiClient);

  return (
    <>
      {selected ? (
        <TemplateDetailView
          template={selected}
          canInstall={canInstall}
          onBack={() => setSelected(null)}
          onInstall={() => setInstalling(selected)}
        />
      ) : (
        <TemplatesListView orpc={orpc} canInstall={canInstall} onOpenTemplate={setSelected} />
      )}

      {apiClient && installing ? (
        <InstallFromGithubModal
          // Remounted per template, so the dialog never opens showing the
          // preview of the one looked at before it.
          key={installing.id}
          open
          apiClient={apiClient}
          initialRepoUrl={installing.install.repoUrl}
          initialIntoFolder={installing.install.intoFolder}
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
