import { implement, ORPCError } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
// Record CR history is a kernel CR-lifecycle read, not a base handler.
import { listRecordChangeRequests } from "../../logic/store";
import {
  countRecords,
  createArchiveBaseChangeRequest,
  createBase,
  createBaseField,
  createBulkChangeRequest,
  createBulkUpdateChangeRequest,
  createChangeRequest,
  createConvertFieldChangeRequest,
  createDeleteChangeRequest,
  createDeleteFieldChangeRequest,
  createDeleteViewChangeRequest,
  createFieldChangeRequest,
  createReorderFieldsChangeRequest,
  createRestoreBaseChangeRequest,
  createRestoreChangeRequest,
  createRestoreFieldChangeRequest,
  createRestoreViewChangeRequest,
  createUpdateChangeRequest,
  createUpdateFieldChangeRequest,
  createUpdateViewChangeRequest,
  createViewChangeRequest,
  getBase,
  getRecord,
  getRecordByField,
  listArchivedBases,
  listArchivedRecordsPaged,
  listArchivedViews,
  listBases,
  listDeletedFields,
  listRecordLinks,
  listRecordsByFieldText,
  listRecordsPage,
  listRecordsPaged,
  listViews,
  previewFieldConversion,
} from "./handlers";

// Base domain oRPC handler slices (bases / records / views); aggregated in router.ts.
const os = implement(busabaseContract);

export const baseRouter = {
  list: os.bases.list.handler(async ({ input }) =>
    input.status === "archived" ? listArchivedBases() : listBases(),
  ),
  get: os.bases.get.handler(async ({ input }) => {
    const base = await getBase(input.baseId);
    if (!base) {
      throw new ORPCError("NOT_FOUND", { message: `Base not found: ${input.baseId}` });
    }
    return base;
  }),
  create: os.bases.create.handler(async ({ input }) => createBase(input)),
  createChangeRequest: os.bases.createChangeRequest.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createChangeRequest(baseId, rest);
  }),
  createBulkChangeRequest: os.bases.createBulkChangeRequest.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createBulkChangeRequest(baseId, rest);
  }),
  createBulkUpdateChangeRequest: os.bases.createBulkUpdateChangeRequest.handler(
    async ({ input }) => {
      const { baseId, ...rest } = input;
      return createBulkUpdateChangeRequest(baseId, rest);
    },
  ),
  createField: os.bases.createField.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createBaseField(baseId, rest);
  }),
  listViews: os.bases.listViews.handler(async ({ input }) =>
    input.status === "archived" ? listArchivedViews(input.baseId) : listViews(input.baseId),
  ),
  listDeletedFields: os.bases.listDeletedFields.handler(async ({ input }) =>
    listDeletedFields(input.baseId),
  ),
  // Six field verbs, one endpoint. Each branch still calls the logic function it
  // always called — the merge is in the transport layer only.
  fieldChangeRequest: os.bases.fieldChangeRequest.handler(async ({ input }) => {
    switch (input.operation) {
      case "create": {
        const { baseId, operation: _op, ...rest } = input;
        return createFieldChangeRequest(baseId, rest);
      }
      case "update":
        return createUpdateFieldChangeRequest(
          input.baseId,
          input.fieldId,
          input.patch,
          input.submittedBy,
          input.message,
          input.autoMerge,
        );
      case "delete":
        return createDeleteFieldChangeRequest(
          input.baseId,
          input.fieldId,
          input.submittedBy,
          input.message,
        );
      case "convert":
        return createConvertFieldChangeRequest(
          input.baseId,
          input.fieldId,
          input.newType,
          input.selectChoiceMode,
          input.submittedBy,
          input.message,
        );
      case "reorder":
        return createReorderFieldsChangeRequest(
          input.baseId,
          input.fieldIds,
          input.submittedBy,
          input.message,
          input.autoMerge,
        );
      case "restore":
        return createRestoreFieldChangeRequest(
          input.baseId,
          input.fieldId,
          input.submittedBy,
          input.message,
          input.autoMerge,
        );
    }
  }),
  previewFieldConversion: os.bases.previewFieldConversion.handler(async ({ input }) => {
    const { baseId, fieldId, newType } = input;
    return previewFieldConversion(baseId, fieldId, newType);
  }),
  lifecycleChangeRequest: os.bases.lifecycleChangeRequest.handler(async ({ input }) => {
    const { baseId, submittedBy, message } = input;
    switch (input.operation) {
      case "archive":
        return createArchiveBaseChangeRequest(baseId, submittedBy, message);
      case "restore":
        return createRestoreBaseChangeRequest(baseId, submittedBy, message, input.autoMerge);
    }
  }),
};

export const recordRouter = {
  list: os.records.list.handler(async ({ input }) =>
    input?.status === "archived" ? listArchivedRecordsPaged(input) : listRecordsPaged(input),
  ),
  listPage: os.records.listPage.handler(async ({ input }) => listRecordsPage(input)),
  count: os.records.count.handler(async ({ input }) => countRecords(input)),
  get: os.records.get.handler(async ({ input }) => {
    const record =
      "recordId" in input ? await getRecord(input.recordId) : await getRecordByField(input);
    if (!record) {
      const selector =
        "recordId" in input
          ? input.recordId
          : `${input.baseId}/${input.fieldSlug}=${input.valueText}`;
      throw new ORPCError("NOT_FOUND", { message: `Record not found: ${selector}` });
    }
    return record;
  }),
  search: os.records.search.handler(async ({ input }) => listRecordsByFieldText(input)),
  changeRequest: os.records.changeRequest.handler(async ({ input }) => {
    switch (input.operation) {
      case "update": {
        const { recordId, operation: _op, ...rest } = input;
        return createUpdateChangeRequest(recordId, rest);
      }
      case "delete": {
        const { recordId, operation: _op, ...rest } = input;
        return {
          ...(await createDeleteChangeRequest(recordId, rest)),
          materialized: false as const,
        };
      }
      case "restore":
        return {
          ...(await createRestoreChangeRequest(input.recordId, input.submittedBy, input.message)),
          materialized: false as const,
        };
    }
  }),
  listChangeRequests: os.records.listChangeRequests.handler(async ({ input }) =>
    listRecordChangeRequests(input.recordId),
  ),
  listLinks: os.records.listLinks.handler(async ({ input }) => listRecordLinks(input.recordId)),
};

export const viewRouter = {
  // `create` is addressed by baseId (no view exists yet), the rest by viewId —
  // which is why these used to sit on two different route prefixes.
  changeRequest: os.views.changeRequest.handler(async ({ input }) => {
    switch (input.operation) {
      case "create": {
        const { baseId, operation: _op, ...rest } = input;
        return createViewChangeRequest(baseId, rest);
      }
      case "update": {
        const { viewId, operation: _op, ...rest } = input;
        return createUpdateViewChangeRequest(viewId, rest);
      }
      case "delete": {
        const { viewId, operation: _op, ...rest } = input;
        return createDeleteViewChangeRequest(viewId, rest);
      }
      case "restore": {
        const { viewId, operation: _op, ...rest } = input;
        return createRestoreViewChangeRequest(viewId, rest);
      }
    }
  }),
};
