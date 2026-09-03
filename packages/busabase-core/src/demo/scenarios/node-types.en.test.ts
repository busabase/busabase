import { describe, expect, it } from "vitest";
import {
  AIRAPP_DEMO_PURE_HTML,
  AIRAPP_DEMO_PYTHON_EXPLICIT,
} from "../../domains/airapp/demo-content";
import { resolveRunPlan } from "../../domains/airapp/utils/airapp-runtime-descriptor";
import { enNodeTypesScenario } from "./node-types.en";

describe("English node-type demo seed", () => {
  it("keeps Node demos and adds a stable explicit Python AirApp", () => {
    const airapps = (enNodeTypesScenario.fileTreeNodes ?? []).filter(
      (node) => node.nodeType === "airapp",
    );
    const nodeDemo = airapps.find((node) => node.slug === AIRAPP_DEMO_PURE_HTML.slug);
    const pythonDemo = airapps.find((node) => node.slug === AIRAPP_DEMO_PYTHON_EXPLICIT.slug);

    expect(nodeDemo).toBeDefined();
    expect(pythonDemo).toMatchObject({
      nodeId: "nod_airapp_python_explicit_demo",
      position: 5,
    });

    const files = Object.fromEntries(
      (pythonDemo?.files ?? []).map((file) => [file.path, file.content]),
    );
    expect(JSON.parse(files["airapp.json"] ?? "{}")).toMatchObject({ runtime: "python" });
    expect(resolveRunPlan(files).runtime).toBe("python");
    expect(files).not.toHaveProperty("requirements.txt");
  });
});
