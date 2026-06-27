import { enScenario } from "busabase-core/demo/scenarios/en";
import { seedScenario } from "busabase-core/logic/store";

async function main() {
  console.log("[Busabase seed:all] Seeding all English scenarios…");
  await seedScenario(enScenario);
  console.log("[Busabase seed:all] Done.");
}

main().catch((error) => {
  console.error("[Busabase seed:all] failed", error);
  process.exitCode = 1;
});
