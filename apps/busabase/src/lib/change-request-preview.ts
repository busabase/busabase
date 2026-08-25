export const CHANGE_REQUEST_PREVIEW_ID_PATTERN = /^crq[A-Za-z0-9_-]{1,125}$/;

export const getChangeRequestPreviewDashboardPath = (changeRequestId: string) =>
  `/inbox/${encodeURIComponent(changeRequestId)}`;
