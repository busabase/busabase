import { enScenario } from "busabase-core/demo/scenarios/en";
import { seedScenario } from "busabase-core/logic/store";
import { seedDemoWebhookRules } from "./demo-webhook-rules";

// Demo webhook automation rules: not part of `SeedScenario` (webhooks are a
// standalone domain, not base/record content), so seeded directly against
// `createWebhookRule` after the scenario. Both ship `enabled: false` — the
// point is to show what a configured automation rule looks like in the UI,
// not to have a fresh demo environment actually fire HTTP calls on first run.
async function seedEnglishDemoWebhookRules() {
  // `targetUrl` is a clearly inert placeholder domain, not a real endpoint —
  // safe to ship disabled.
  await seedDemoWebhookRules({
    workflowFunctionRuleName: "Score lead fit",
    rules: [
      {
        name: "Notify on new record",
        eventType: "record.created",
        baseId: null,
        actionKind: "webhook",
        config: { targetUrl: "https://example.com/webhooks/busabase-demo" },
        enabled: false,
      },
      {
        name: "Log new record title",
        eventType: "record.created",
        baseId: null,
        actionKind: "run_function",
        config: {
          code: [
            'console.log("New record:", input.fields.title || input.recordId);',
            "// Sandboxed functions can call fetch(url, options) directly — e.g.:",
            '// const res = await fetch("https://example.com/webhooks/busabase-demo", {',
            '//   method: "POST",',
            "//   body: JSON.stringify({ title: input.fields.title }),",
            "// });",
            "return null;",
          ].join("\n"),
          timeoutMs: 2000,
        },
        enabled: false,
      },
      {
        name: "Score lead fit",
        eventType: "record.created",
        baseId: null,
        actionKind: "run_function",
        config: {
          code: [
            "const value = Number(input.fields?.score ?? 0);",
            "const score = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));",
            "return { score };",
          ].join("\n"),
          timeoutMs: 2000,
        },
        enabled: false,
      },
    ],
  });
}

async function main() {
  console.log("[Busabase seed:all] Seeding all English scenarios…");
  await seedScenario(enScenario);
  await seedEnglishDemoWebhookRules();
  console.log("[Busabase seed:all] Ensured 3 demo webhook rules (disabled by default).");
  console.log("[Busabase seed:all] Done.");
}

main().catch((error) => {
  console.error("[Busabase seed:all] failed", error);
  process.exitCode = 1;
});
