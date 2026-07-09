import {
  DEMO_BASES,
  DEMO_CHANGE_REQUESTS,
  DEMO_FOLDERS,
  DEMO_RECORDS,
  DEMO_VIEWS,
} from "../dataset";
import type { SeedScenario } from "../seed-types";
import { enNodeTypesScenario } from "./node-types.en";

/** All English demo content — same data set as the in-memory demo and `pnpm demo` API suite. */
export const enScenario: SeedScenario = {
  folders: DEMO_FOLDERS,
  bases: DEMO_BASES,
  records: DEMO_RECORDS,
  views: DEMO_VIEWS,
  changeRequests: DEMO_CHANGE_REQUESTS,
  docs: enNodeTypesScenario.docs,
  files: enNodeTypesScenario.files,
  comments: enNodeTypesScenario.comments,
};
