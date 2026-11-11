import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ job: null as unknown }));
vi.mock("bullmq", () => ({
  Queue: class {
    async getJob() {
      return fixture.job;
    }
  },
  QueueEvents: class {},
}));
vi.mock("ioredis", () => ({
  default: class {
    on() {}
  },
}));

import { getConversionJobStatus } from "./conversion-queue";

beforeEach(() => {
  vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6379");
});
afterEach(() => vi.unstubAllEnvs());

describe("conversion queue status privacy", () => {
  it.each(["active", "completed", "failed"])(
    "omits source capabilities and unrecognized fields in %s status",
    async (state) => {
      fixture.job = {
        getState: async () => state,
        progress: 50,
        data: {
          jobId: "private-job",
          fileName: "report.doc",
          mimeType: "application/msword",
          outputFormat: "pdf",
          fileUrl: "https://host.test/conversions/sources/private-capability",
          sourceAuthorization: { Cookie: "private-cookie", Authorization: "Bearer private-token" },
        },
        returnvalue: { success: true, outputUrl: "/converted.pdf" },
        failedReason: "Conversion unavailable",
      };
      const status = await getConversionJobStatus("private-job", "privacy-fixture");
      expect(status?.data).toEqual({
        jobId: "private-job",
        fileName: "report.doc",
        mimeType: "application/msword",
        outputFormat: "pdf",
      });
      expect(JSON.stringify(status)).not.toMatch(
        /private-capability|private-cookie|private-token|sourceAuthorization|fileUrl/,
      );
    },
  );
});
