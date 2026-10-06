import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exceedsLimits, parseRequiredVersions, UOS20_ABI_LIMITS } from "../scripts/elf-abi.mjs";

// Trimmed real `readelf -V -W` output: a verdef section (what a lib provides)
// followed by verneed (what it requires). Only verneed must count.
const READELF_SAMPLE = `
Version definition section '.gnu.version_d' contains 2 entries:
  0x0000: Rev: 1  Flags: BASE  Index: 1  Cnt: 1  Name: libfoo.so
  0x001c: Rev: 1  Flags: none  Index: 2  Cnt: 1  Name: GLIBC_2.99

Version needs section '.gnu.version_r' contains 3 entries:
 Addr: 0x00000000000521bc  Offset: 0x000521bc  Link: 9 (.dynstr)
  000000: Version: 1  File: libc.so.6  Cnt: 3
  0x00d0:   Name: GLIBC_2.2.5  Flags: none  Version: 11
  0x00e0:   Name: GLIBC_2.28  Flags: none  Version: 4
  0x00f0:   Name: GLIBC_2.34  Flags: none  Version: 14
  0x0010: Version: 1  File: libstdc++.so.6  Cnt: 2
  0x0100:   Name: GLIBCXX_3.4.21  Flags: none  Version: 13
  0x0110:   Name: CXXABI_1.3.13  Flags: none  Version: 12
`;

describe("ELF ABI gate", () => {
  it("reads only required (verneed) symbol versions", () => {
    const required = parseRequiredVersions(READELF_SAMPLE);
    assert.ok(required.includes("GLIBC_2.34"));
    assert.ok(required.includes("GLIBCXX_3.4.21"));
    assert.ok(!required.includes("GLIBC_2.99"), "verdef entries must be ignored");
  });

  it("flags anything newer than UOS 20 provides, using numeric comparison", () => {
    const required = parseRequiredVersions(READELF_SAMPLE);
    assert.deepEqual(exceedsLimits(required, UOS20_ABI_LIMITS).sort(), [
      "CXXABI_1.3.13",
      "GLIBC_2.34",
    ]);
    // 2.3 < 2.28 numerically even though "2.3" > "2.28" as strings.
    assert.deepEqual(exceedsLimits(["GLIBC_2.3.4", "GLIBC_2.28"], UOS20_ABI_LIMITS), []);
    assert.deepEqual(exceedsLimits(["GLIBC_2.39"], UOS20_ABI_LIMITS), ["GLIBC_2.39"]);
    assert.deepEqual(exceedsLimits(["GLIBCXX_3.4.26"], UOS20_ABI_LIMITS), ["GLIBCXX_3.4.26"]);
  });
});
