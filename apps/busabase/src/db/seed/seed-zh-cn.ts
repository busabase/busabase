import { zhCnScenario } from "busabase-core/demo/scenarios/zh-cn";
import { seedScenario } from "busabase-core/logic/store";

async function main() {
  console.log("[Busabase seed:all:zh-CN] Seeding all scenarios (zh-CN)…");
  await seedScenario(zhCnScenario);
  console.log("[Busabase seed:all:zh-CN] Done.");
}

main().catch((error) => {
  console.error("[Busabase seed:all:zh-CN] failed", error);
  process.exitCode = 1;
});
