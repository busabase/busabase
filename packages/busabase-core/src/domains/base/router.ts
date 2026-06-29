import { implement } from "@orpc/server";
import { busabaseContract } from "../../contract/busabase";
// Record CR history is a kernel CR-lifecycle read, not a base handler.
import { listRecordChangeRequests } from "../../logic/store";
import {
  createArchiveBaseChangeRequest,
  createBase,
  createBaseField,
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
  listArchivedBases,
  listArchivedRecords,
  listArchivedViews,
  listBases,
  listDeletedFields,
  listRecordLinks,
  listRecords,
  listRecordsByFieldText,
  listRecordsPaged,
  listViews,
  previewFieldConversion,
} from "./handlers";

// Base domain oRPC handler slices (bases / records / views); aggregated in router.ts.
const os = implement(busabaseContract);

export const baseRouter = {
  list: os.bases.list.handler(async () => listBases()),
  listArchived: os.bases.listArchived.handler(async () => listArchivedBases()),
  get: os.bases.get.handler(async ({ input }) => getBase(input.baseId)),
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
  listDeletedFields: os.bases.listDeletedFields.handler(async ({ input }) =>
    listDeletedFields(input.baseId),
  ),
  listArchivedViews: os.bases.listArchivedViews.handler(async ({ input }) =>
    listArchivedViews(input.baseId),
  ),
  listArchivedRecords: os.bases.listArchivedRecords.handler(async ({ input }) =>
    listArchivedRecords(input.baseId),
  ),
  createFieldChangeRequest: os.bases.createFieldChangeRequest.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createFieldChangeRequest(baseId, rest);
  }),
  createViewChangeRequest: os.bases.createViewChangeRequest.handler(async ({ input }) => {
    const { baseId, ...rest } = input;
    return createViewChangeRequest(baseId, rest);
  }),
  deleteFieldChangeRequest: os.bases.deleteFieldChangeRequest.handler(async ({ input }) => {
    const { baseId, fieldId, submittedBy, message } = input;
    return createDeleteFieldChangeRequest(baseId, fieldId, submittedBy, message);
  }),
  updateFieldChangeRequest: os.bases.updateFieldChangeRequest.handler(async ({ input }) => {
    const { baseId, fieldId, patch, submittedBy, message } = input;
    return createUpdateFieldChangeRequest(baseId, fieldId, patch, submittedBy, message);
  }),
  previewFieldConversion: os.bases.previewFieldConversion.handler(async ({ input }) => {
    const { baseId, fieldId, newType } = input;
    return previewFieldConversion(baseId, fieldId, newType);
  }),
  convertFieldChangeRequest: os.bases.convertFieldChangeRequest.handler(async ({ input }) => {
    const { baseId, fieldId, newType, selectChoiceMode, submittedBy, message } = input;
    return createConvertFieldChangeRequest(
      baseId,
      fieldId,
      newType,
      selectChoiceMode,
      submittedBy,
      message,
    );
  }),
  reorderFieldsChangeRequest: os.bases.reorderFieldsChangeRequest.handler(async ({ input }) => {
    const { baseId, fieldIds, submittedBy, message } = input;
    return createReorderFieldsChangeRequest(baseId, fieldIds, submittedBy, message);
  }),
  archiveChangeRequest: os.bases.archiveChangeRequest.handler(async ({ input }) => {
    const { baseId, submittedBy, message } = input;
    return createArchiveBaseChangeRequest(baseId, submittedBy, message);
  }),
  restoreChangeRequest: os.bases.restoreChangeRequest.handler(async ({ input }) => {
    const { baseId, submittedBy, message } = input;
    return createRestoreBaseChangeRequest(baseId, submittedBy, message);
  }),
  restoreFieldChangeRequest: os.bases.restoreFieldChangeRequest.handler(async ({ input }) => {
    const { baseId, fieldId, submittedBy, message } = input;
    return createRestoreFieldChangeRequest(baseId, fieldId, submittedBy, message);
  }),
};

export const recordRouter = {
  list: os.records.list.handler(async ({ input }) => listRecords(input)),
  listPaged: os.records.listPaged.handler(async ({ input }) => listRecordsPaged(input)),
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
  restoreChangeRequest: os.records.restoreChangeRequest.handler(async ({ input }) => {
    const { recordId, submittedBy, message } = input;
    return createRestoreChangeRequest(recordId, submittedBy, message);
  }),
  listLinks: os.records.listLinks.handler(async ({ input }) => listRecordLinks(input.recordId)),
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
  restoreChangeRequest: os.views.restoreChangeRequest.handler(async ({ input }) => {
    const { viewId, ...rest } = input;
    return createRestoreViewChangeRequest(viewId, rest);
  }),
};
