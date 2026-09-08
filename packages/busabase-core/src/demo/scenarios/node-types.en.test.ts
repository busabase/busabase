import { describe, expect, it } from "vitest";
import {
  AIRAPP_DEMO_FUMADOCS,
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

  it("ships one complete Remote-only Fumadocs project", () => {
    const fumadocsNodes = (enNodeTypesScenario.fileTreeNodes ?? []).filter(
      (node) => node.nodeType === "airapp" && node.slug === AIRAPP_DEMO_FUMADOCS.slug,
    );
    expect(fumadocsNodes).toHaveLength(1);
    expect(fumadocsNodes[0]).toMatchObject({
      nodeId: "nod_airapp_fumadocs_demo",
      position: 6,
    });

    const files = Object.fromEntries(
      (fumadocsNodes[0]?.files ?? []).map((file) => [file.path, file.content]),
    );
    const plan = resolveRunPlan(files);

    expect(plan).toMatchObject({
      runtime: "node",
      install: "npm install",
      start: "npm run dev",
      port: 3000,
      requiredEngine: "remote",
    });
    expect(JSON.parse(files["package.json"] ?? "{}").dependencies).toMatchObject({
      "fumadocs-mdx": "15.3.0",
      "fumadocs-ui": "16.14.5",
      next: "16.3.3",
    });
    expect(files).toHaveProperty("content/docs/index.mdx");
    expect(files).toHaveProperty("content/docs/getting-started.mdx");
    expect(files).toHaveProperty("src/app/docs/[[...slug]]/page.tsx");
  });
});
