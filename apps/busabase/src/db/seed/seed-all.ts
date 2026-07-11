import { LOCAL_SPACE_ID } from "busabase-core/context";
import { getDb } from "busabase-core/db";
import { DEMO_ACTOR_ID } from "busabase-core/demo/dataset";
import { enScenario } from "busabase-core/demo/scenarios/en";
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
    name: "Notify on new record",
    eventType: "record.created",
    baseId: null,
    actionKind: "webhook",
    config: { targetUrl: "https://example.com/webhooks/busabase-demo" },
    enabled: false,
  });
  await createWebhookRule(db, LOCAL_SPACE_ID, DEMO_ACTOR_ID, {
    name: "Log new record title",
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
  console.log("[Busabase seed:all] Seeding all English scenarios…");
  await seedScenario(enScenario);
  await seedDemoWebhookRules();
  console.log("[Busabase seed:all] Seeded 2 demo webhook rules (disabled by default).");
  console.log("[Busabase seed:all] Done.");
}

main().catch((error) => {
  console.error("[Busabase seed:all] failed", error);
  process.exitCode = 1;
});
