import { notFound } from "next/navigation";
import { renderDashboardPage } from "~/app/dashboard/dashboard-page";
import {
  CHANGE_REQUEST_PREVIEW_ID_PATTERN,
  getChangeRequestPreviewDashboardPath,
} from "~/lib/change-request-preview";

export const dynamic = "force-dynamic";

export default async function ChangeRequestPreviewPage({
  params,
}: {
  params: Promise<{ changeRequestId: string }>;
}) {
  const { changeRequestId } = await params;
  if (!CHANGE_REQUEST_PREVIEW_ID_PATTERN.test(changeRequestId)) {
    notFound();
  }

  return renderDashboardPage(getChangeRequestPreviewDashboardPath(changeRequestId), {
    chromeless: true,
    readOnlyChangeRequestPreview: true,
  });
}
