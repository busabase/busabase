import type { SearchResultVO } from "busabase-contract/types";
import { buildDemoDataset } from "busabase-core/demo/dataset";

export const QUICK_RESULT_LIMIT = 6;
export const ADVANCED_VISIBLE_RESULT_LIMIT = 20;
export const DEFAULT_SEARCH_QUALITY_SESSIONS = 500;
export const DEFAULT_SEARCH_QUALITY_URL = "http://127.0.0.1:15419";
export const DEFAULT_SEARCH_QUALITY_OUTPUT = "/tmp/busabase-search-quality-eval.json";

export const isLoopbackSearchEvalUrl = (value: string): boolean => {
  const hostname = new URL(value).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
};

export type SearchQualityCategory = "record" | "base" | "doc" | "file-content";

export interface SearchQualityCase {
  id: string;
  category: SearchQualityCategory;
  query: string;
  target: {
    href: string;
    label: string;
  };
}

export interface RankedSearchResult {
  href: string;
  kind: SearchResultVO["kind"] | "node-name";
  title: string;
}

export interface SearchQualityObservation {
  caseId: string;
  quickLatencyMs: number;
  quickRank: number | null;
  quickResultCount: number;
  advancedLatencyMs: number | null;
  advancedRank: number | null;
  advancedResultCount: number | null;
}

const RECORD_CASES = [
  ["rec_seed_blog_approval", "operator workflows"],
  ["rec_seed_newsletter_founders", "policy pressure increasing"],
  ["rec_seed_media_clip_review", "field-level diffs"],
  ["rec_seed_crm_contact_alice", "Alice Chen"],
  ["rec_seed_ins_client_new_parents", "single income"],
] as const;

const BASE_CASES = [
  ["bse_local_field_type_lab", "Field Type Lab"],
  ["bse_local_stock_watchlist", "Stock Watchlist"],
  ["bse_local_directory_listings", "Directory Listings"],
  ["bse_local_evals", "Model Evals"],
  ["bse_local_compliance_checklists", "Compliance Checklists"],
] as const;

const DOC_CASES = [
  ["nod_doc_agent_operating_guide", "raw write speed"],
  ["nod_doc_launch_runbook", "open conflicting change requests"],
  ["nod_doc_data_dictionary", "legal entity name"],
  ["nod_doc_insurance_playbook", "income, the debt"],
  ["nod_doc_insurance_product_matrix", "medical exam waived"],
] as const;

const FILE_CONTENT_CASES = [
  ["nod_file_product_brief", "editable source of truth"],
  ["nod_file_q3_metrics", "weekly_active_agents"],
  ["nod_file_brand_palette", "always leaves a diff"],
  ["nod_file_insurance_commission_ledger", "POL-CI-2026-0415"],
  ["nod_file_insurance_underwriting_rules", "bariatric"],
] as const;

const includesQuery = (value: unknown, query: string) =>
  JSON.stringify(value).toLocaleLowerCase().includes(query.toLocaleLowerCase());

const required = <T>(value: T | undefined, description: string): T => {
  if (value === undefined) throw new Error(`Search quality fixture is missing ${description}`);
  return value;
};

const fileBody = (url: string) => {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) {
    throw new Error("Search quality fixture expected an inline text data URL");
  }
  return decodeURIComponent(url.slice(comma + 1));
};

/**
 * Fixed queries, but targets and validation come from the same English default
 * dataset that seeds a fresh local server. A seed rename therefore fails the
 * evaluator loudly instead of quietly measuring a stale hand-written corpus.
 */
export const buildSearchQualityCases = (): SearchQualityCase[] => {
  const dataset = buildDemoDataset("1", new Date("2026-09-16T00:00:00.000Z"));

  const records = RECORD_CASES.map(([recordId, query]) => {
    const record = required(
      dataset.records.find((candidate) => candidate.id === recordId),
      `record ${recordId}`,
    );
    if (!includesQuery(record.headCommit.payload, query)) {
      throw new Error(`Record ${recordId} no longer contains query ${JSON.stringify(query)}`);
    }
    return {
      id: `record:${recordId}`,
      category: "record" as const,
      query,
      target: {
        href: `/base/${record.base.slug}/${record.id}`,
        label: String(record.headCommit.payload.title ?? record.id),
      },
    };
  });

  const bases = BASE_CASES.map(([baseId, query]) => {
    const base = required(
      dataset.bases.find((candidate) => candidate.id === baseId),
      `base ${baseId}`,
    );
    if (
      !includesQuery({ name: base.name, description: base.description, fields: base.fields }, query)
    ) {
      throw new Error(`Base ${baseId} no longer contains query ${JSON.stringify(query)}`);
    }
    return {
      id: `base:${baseId}`,
      category: "base" as const,
      query,
      target: { href: `/base/${base.slug}`, label: base.name },
    };
  });

  const docs = DOC_CASES.map(([nodeId, query]) => {
    const doc = required(
      dataset.docs.find((candidate) => candidate.node.id === nodeId),
      `doc ${nodeId}`,
    );
    if (!includesQuery(doc.body, query)) {
      throw new Error(`Doc ${nodeId} no longer contains query ${JSON.stringify(query)}`);
    }
    return {
      id: `doc:${nodeId}`,
      category: "doc" as const,
      query,
      target: { href: `/doc/${doc.node.slug}`, label: doc.node.name },
    };
  });

  const files = FILE_CONTENT_CASES.map(([nodeId, query]) => {
    const file = required(
      dataset.files.find((candidate) => candidate.node.id === nodeId),
      `file ${nodeId}`,
    );
    const body = fileBody(file.asset.url);
    if (!includesQuery(body, query)) {
      throw new Error(`File ${nodeId} no longer contains query ${JSON.stringify(query)}`);
    }
    if (
      includesQuery(
        {
          description: file.node.description,
          fileName: file.asset.fileName,
          name: file.node.name,
          slug: file.node.slug,
        },
        query,
      )
    ) {
      throw new Error(`File query ${JSON.stringify(query)} is not content-only for ${nodeId}`);
    }
    return {
      id: `file-content:${nodeId}`,
      category: "file-content" as const,
      query,
      target: { href: `/file/${file.node.slug}`, label: file.node.name },
    };
  });

  return [...records, ...bases, ...docs, ...files];
};

export const mergeQuickResults = ({
  nodeNames,
  records,
  files,
  nodes,
  names,
}: {
  nodeNames: RankedSearchResult[];
  records: SearchResultVO[];
  files: SearchResultVO[];
  nodes: SearchResultVO[];
  names: SearchResultVO[];
}): RankedSearchResult[] => {
  const workspace = nodeNames;
  const recordRows = records.filter((result) => result.kind === "record");
  const fileRows = files.filter((result) => result.kind === "file");
  const nodeRows = nodes.filter((result) => result.kind === "node");
  const seenNodeHrefs = new Set(workspace.map((result) => result.href));
  const baseRows = names.filter(
    (result) => result.kind === "base" && !seenNodeHrefs.has(result.href),
  );
  const changeRequestRows = records.filter((result) => result.kind === "change_request");

  return [workspace, recordRows, fileRows, nodeRows, baseRows, changeRequestRows]
    .flat()
    .map((result) => ({ href: result.href, kind: result.kind, title: result.title }))
    .slice(0, QUICK_RESULT_LIMIT);
};

export const rankOfTarget = (results: RankedSearchResult[], href: string) => {
  const index = results.findIndex((result) => result.href === href);
  return index < 0 ? null : index + 1;
};

const rounded = (value: number) => Number(value.toFixed(4));

export const percentile = (values: number[], percentileValue: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return rounded(sorted[Math.max(0, index)] ?? 0);
};

const rate = (count: number, denominator: number) => ({
  count,
  denominator,
  rate: denominator === 0 ? 0 : rounded(count / denominator),
});

const rankSummary = (ranks: Array<number | null>, denominator = ranks.length) => {
  const observed = ranks.filter((rank): rank is number => rank !== null);
  return {
    observed: observed.length,
    absent: ranks.length - observed.length,
    mean: observed.length
      ? rounded(observed.reduce((sum, rank) => sum + rank, 0) / observed.length)
      : null,
    p50: percentile(observed, 50),
    p95: percentile(observed, 95),
    top1: rate(observed.filter((rank) => rank <= 1).length, denominator),
    top3: rate(observed.filter((rank) => rank <= 3).length, denominator),
    top6: rate(observed.filter((rank) => rank <= 6).length, denominator),
  };
};

export const summarizeSearchQuality = (
  observations: SearchQualityObservation[],
  cases: SearchQualityCase[],
) => {
  const escalated = observations.filter((observation) => observation.quickRank === null);
  const journeyHasZeroResults = observations.filter(
    (observation) =>
      observation.quickResultCount === 0 &&
      (observation.advancedResultCount === null || observation.advancedResultCount === 0),
  );
  const targetAbsent = observations.filter(
    (observation) => observation.quickRank === null && observation.advancedRank === null,
  );
  const noClickProxy = observations.filter(
    (observation) =>
      (observation.quickRank === null || observation.quickRank > QUICK_RESULT_LIMIT) &&
      (observation.advancedRank === null ||
        observation.advancedRank > ADVANCED_VISIBLE_RESULT_LIMIT),
  );
  const advancedLatencies = observations.flatMap((observation) =>
    observation.advancedLatencyMs === null ? [] : [observation.advancedLatencyMs],
  );

  return {
    validQueryFalseZeroRate: rate(journeyHasZeroResults.length, observations.length),
    targetAbsentRate: rate(targetAbsent.length, observations.length),
    noClickProxyRate: rate(noClickProxy.length, observations.length),
    quickCoverageRate: rate(observations.length - escalated.length, observations.length),
    escalationRate: rate(escalated.length, observations.length),
    targetRank: {
      quick: rankSummary(
        observations.map((observation) => observation.quickRank),
        observations.length,
      ),
      advancedAfterEscalation: rankSummary(
        escalated.map((observation) => observation.advancedRank),
        escalated.length,
      ),
    },
    latencyMs: {
      quick: {
        samples: observations.length,
        p50: percentile(
          observations.map((observation) => observation.quickLatencyMs),
          50,
        ),
        p95: percentile(
          observations.map((observation) => observation.quickLatencyMs),
          95,
        ),
      },
      full: {
        samples: advancedLatencies.length,
        p50: percentile(advancedLatencies, 50),
        p95: percentile(advancedLatencies, 95),
      },
    },
    byCase: cases.map((searchCase) => {
      const caseObservations = observations.filter(
        (observation) => observation.caseId === searchCase.id,
      );
      const caseEscalations = caseObservations.filter(
        (observation) => observation.quickRank === null,
      );
      return {
        id: searchCase.id,
        category: searchCase.category,
        query: searchCase.query,
        target: searchCase.target,
        sessions: caseObservations.length,
        quickCoverageRate: rate(
          caseObservations.length - caseEscalations.length,
          caseObservations.length,
        ),
        quickRank: rankSummary(
          caseObservations.map((observation) => observation.quickRank),
          caseObservations.length,
        ),
        advancedRank: rankSummary(
          caseEscalations.map((observation) => observation.advancedRank),
          caseEscalations.length,
        ),
      };
    }),
  };
};
