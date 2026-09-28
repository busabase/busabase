import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import { describe, expect, it } from "vitest";
import { toolRunSummary } from "./tool-run-summary";

const t = {
  toolsExplored: "Explored {count} file{plural}",
  toolsSearched: "Ran {count} search{plural}",
  toolsEdited: "Edited {count} file{plural}",
  toolsRan: "Ran {count} command{plural}",
  toolsUsed: "Used {count} tool{plural}",
};

const call = (id: string, toolKind: AcpToolCallBlock["toolKind"]): AcpToolCallBlock => ({
  kind: "tool_call",
  id,
  title: id,
  toolKind,
  status: "completed",
});

describe("toolRunSummary", () => {
  it("joins categories present in the run, in a fixed order, each pluralized on its own count", () => {
    const blocks = [call("1", "read"), call("2", "read"), call("3", "execute")];
    expect(toolRunSummary(blocks, t)).toBe("Explored 2 files, Ran 1 command");
  });

  it("falls back to a generic 'used N tools' when every call is an uncategorized kind", () => {
    const blocks = [call("1", "other"), call("2", "switch_mode")];
    expect(toolRunSummary(blocks, t)).toBe("Used 2 tools");
  });

  it("singularizes a lone item in a category", () => {
    expect(toolRunSummary([call("1", "search")], t)).toBe("Ran 1 search");
  });
});
