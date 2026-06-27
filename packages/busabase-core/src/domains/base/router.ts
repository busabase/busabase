import { implement } from "@orpc/server";
import { busabaseContract } from "../../contract/busabase";
// Record CR history is a kernel CR-lifecycle read, not a base handler.
import { listRecordChangeRequests } from "../../logic/store";
import {
  createBase,
  createBaseField,
  createChangeRequest,
  createDeleteChangeRequest,
  createDeleteViewChangeRequest,
  createFieldChangeRequest,
  createUpdateChangeRequest,
  createUpdateViewChangeRequest,
  createViewChangeRequest,
  getRecord,
  listBases,
  listRecords,
  listRecordsByFieldText,
  listViews,
} from "./handlers";

// Base domain oRPC handler slices (bases / records / views); aggregated in router.ts.
const os = implement(busabaseContract);

export const baseRouter = {
  list: os.bases.list.handler(async () => listBases()),
  create: os.bases.create.handler(async ({ input }) => createBase(input)),
  createChangeRequest: os.bases.createChangeRequest.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createChangeRequest(baseId, rest);
  }),
  createField: os.bases.createField.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createBaseField(baseId, rest);
  }),
  listViews: os.bases.listViews.handler(async ({ input }) => listViews(input.baseId)),
  createFieldChangeRequest: os.bases.createFieldChangeRequest.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createFieldChangeRequest(baseId, rest);
  }),
  createViewChangeRequest: os.bases.createViewChangeRequest.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createViewChangeRequest(baseId, rest);
  }),
};

export const recordRouter = {
  list: os.records.list.handler(async ({ input }) => listRecords(input)),
  get: os.records.get.handler(async ({ input }) => {
    const record = await getRecord(input.recordId);
    if (!record) {
      throw new Error(`Record not found: ${input.recordId}`);
    }
    return record;
  }),
  search: os.records.search.handler(async ({ input }) => listRecordsByFieldText(input)),
  updateChangeRequest: os.records.updateChangeRequest.handler(async ({ input }) => {
    const { recordId, ...rest } = input;
    return createUpdateChangeRequest(recordId, rest);
  }),
  deleteChangeRequest: os.records.deleteChangeRequest.handler(async ({ input }) => {
    const { recordId, ...rest } = input;
    return createDeleteChangeRequest(recordId, rest);
  }),
  listChangeRequests: os.records.listChangeRequests.handler(async ({ input }) =>
    listRecordChangeRequests(input.recordId),
  ),
};

export const viewRouter = {
  updateChangeRequest: os.views.updateChangeRequest.handler(async ({ input }) => {
    const { viewId, ...rest } = input;
    return createUpdateViewChangeRequest(viewId, rest);
  }),
  deleteChangeRequest: os.views.deleteChangeRequest.handler(async ({ input }) => {
    const { viewId, ...rest } = input;
    return createDeleteViewChangeRequest(viewId, rest);
  }),
};
