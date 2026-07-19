import type { SeedScenario } from "../seed-types";
import { agentIntegrationsZhCnScenario } from "./agent-integrations.zh-cn";
import { datasetZhCnScenario } from "./dataset.zh-cn";
import { directoryListingZhCnScenario } from "./directory-listing.zh-cn";
import { expandZhCnScenario } from "./expand.zh-cn";
import { financeInvoiceZhCnScenario } from "./finance-invoice.zh-cn";
import { zhCnNodeTypesScenario } from "./node-types.zh-cn";
import { agentGalleryZhCnScenario } from "./product-gallery.zh-cn";
import { roadmapZhCnScenario } from "./product-roadmap.zh-cn";
import { readmeScenariosZhCnScenario } from "./readme-scenarios.zh-cn";

const mergeScenarios = (...scenarios: SeedScenario[]): SeedScenario => ({
  folders: scenarios.flatMap((s) => s.folders ?? []),
  bases: scenarios.flatMap((s) => s.bases ?? []),
  records: scenarios.flatMap((s) => s.records ?? []),
  views: scenarios.flatMap((s) => s.views ?? []),
  changeRequests: scenarios.flatMap((s) => s.changeRequests ?? []),
  docs: scenarios.flatMap((s) => s.docs ?? []),
  files: scenarios.flatMap((s) => s.files ?? []),
  comments: scenarios.flatMap((s) => s.comments ?? []),
});

export const zhCnScenario: SeedScenario = mergeScenarios(
  datasetZhCnScenario,
  financeInvoiceZhCnScenario,
  readmeScenariosZhCnScenario,
  expandZhCnScenario,
  directoryListingZhCnScenario,
  agentIntegrationsZhCnScenario,
  agentGalleryZhCnScenario,
  roadmapZhCnScenario,
  zhCnNodeTypesScenario,
);
