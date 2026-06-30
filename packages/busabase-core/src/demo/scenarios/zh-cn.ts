import type { SeedScenario } from "../seed-types";
import { datasetZhCnScenario } from "./dataset.zh-cn";
import { directoryListingZhCnScenario } from "./directory-listing.zh-cn";
import { expandZhCnScenario } from "./expand.zh-cn";
import { financeInvoiceZhCnScenario } from "./finance-invoice.zh-cn";
import { readmeScenariosZhCnScenario } from "./readme-scenarios.zh-cn";

const mergeScenarios = (...scenarios: SeedScenario[]): SeedScenario => ({
  folders: scenarios.flatMap((s) => s.folders ?? []),
  bases: scenarios.flatMap((s) => s.bases ?? []),
  records: scenarios.flatMap((s) => s.records ?? []),
  views: scenarios.flatMap((s) => s.views ?? []),
  changeRequests: scenarios.flatMap((s) => s.changeRequests ?? []),
});

export const zhCnScenario: SeedScenario = mergeScenarios(
  datasetZhCnScenario,
  financeInvoiceZhCnScenario,
  readmeScenariosZhCnScenario,
  expandZhCnScenario,
  directoryListingZhCnScenario,
);
