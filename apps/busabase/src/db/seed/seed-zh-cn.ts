import { LOCAL_SPACE_ID } from "busabase-core/context";
import { getDb } from "busabase-core/db";
import { DEMO_ACTOR_ID } from "busabase-core/demo/dataset";
import { zhCnScenario } from "busabase-core/demo/scenarios/zh-cn";
import { createWebhookRule } from "busabase-core/domains/webhook/logic";
import { seedScenario } from "busabase-core/logic/store";

// Demo webhook automation rules: not part of `SeedScenario` (webhooks are a
// standalone domain, not base/record content), so seeded directly against
// `createWebhookRule` after the scenario. Both ship `enabled: false` — the
// point is to show what a configured automation rule looks like in the UI,
// not to have a fresh demo environment actually fire HTTP calls on first run.
async function seedDemoWebhookRules() {
  const db = await getDb();
  // `targetUrl` is a clearly inert placeholder domain, not a real endpoint —
  // safe to ship disabled.
  await createWebhookRule(db, LOCAL_SPACE_ID, DEMO_ACTOR_ID, {
    name: "新记录通知",
    eventType: "record.created",
    baseId: null,
    actionKind: "webhook",
    config: { targetUrl: "https://example.com/webhooks/busabase-demo" },
    enabled: false,
  });
  await createWebhookRule(db, LOCAL_SPACE_ID, DEMO_ACTOR_ID, {
    name: "记录新记录标题日志",
    eventType: "record.created",
    baseId: null,
    actionKind: "run_snippet",
    config: {
      code: 'console.log("New record:", input.fields.title || input.recordId); return null;',
      timeoutMs: 2000,
    },
    enabled: false,
  });
}

async function main() {
  console.log("[Busabase seed:all:zh-CN] Seeding all scenarios (zh-CN)…");
  await seedScenario(zhCnScenario);
  await seedDemoWebhookRules();
  console.log("[Busabase seed:all:zh-CN] Seeded 2 demo webhook rules (disabled by default).");
  console.log("[Busabase seed:all:zh-CN] Done.");
}

main().catch((error) => {
  console.error("[Busabase seed:all:zh-CN] failed", error);
  process.exitCode = 1;
});
