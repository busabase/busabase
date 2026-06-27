import { listBases, listRecords } from "busabase-core/domains/base/handlers";
import { listSkills } from "busabase-core/domains/skill/handlers";
import { listChangeRequests } from "busabase-core/logic/store";

async function main() {
  const [bases, changeRequests, records, skills] = await Promise.all([
    listBases(),
    listChangeRequests({ limit: 100 }),
    listRecords({ limit: 100 }),
    listSkills(),
  ]);
  const skillChangeRequests = changeRequests.filter((item) =>
    item.operations.some((operation) => operation.operation.startsWith("skill_")),
  );

  console.log(
    `[Busabase seed] ready: ${bases.length} bases, ${skills.length} skills, ${changeRequests.length} change requests (${skillChangeRequests.length} skill), ${records.length} records`,
  );
}

main().catch((error) => {
  console.error("[Busabase seed] failed", error);
  process.exitCode = 1;
});
