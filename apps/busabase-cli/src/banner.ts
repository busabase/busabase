// Branded splash for the CLI's help screen. Mirrors the `busabase server` boot
// splash so the client and the server feel like one product.

// Colorize only on a real terminal that hasn't opted out (NO_COLOR).
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string, s: string): string =>
  useColor ? `\x1b[${code}m${s}\x1b[0m` : s;

const c = {
  brand: (s: string) => paint("38;5;43", s), // teal — Busabase accent
  bold: (s: string) => paint("1", s),
  dim: (s: string) => paint("2", s),
  cyan: (s: string) => paint("36", s),
};

const LOGO = [
  "  ____                  _                     ",
  " | __ ) _   _ ___  __ _| |__   __ _ ___  ___  ",
  " |  _ \\| | | / __|/ _` | '_ \\ / _` / __|/ _ \\ ",
  " | |_) | |_| \\__ \\ (_| | |_) | (_| \\__ \\  __/ ",
  " |____/ \\__,_|___/\\__,_|_.__/ \\__,_|___/\\___| ",
];

/** Branded banner shown above the help text, including the target server. */
export function banner(baseUrl: string): string {
  const out: string[] = [""];
  for (const line of LOGO) out.push(c.brand(line));
  out.push(
    `${c.dim("   OpenAPI client for Busabase")} ${c.dim("·")} ${c.dim("talks to /api/v1")}`,
  );
  out.push(`   ${c.bold("Server")}  ${c.cyan(baseUrl)}`);
  out.push("");
  return out.join("\n");
}
