import type { BusabaseConnection } from "~/connection/types";

export function getMobileQueryScope(connection: BusabaseConnection): string {
  return `mobile:${JSON.stringify([
    connection.serverUrl.replace(/\/+$/, ""),
    connection.mode,
    connection.cloudUser?.id ?? null,
    connection.selectedSpace?.id ?? null,
  ])}`;
}

export function isMobileQueryInScope(queryKey: readonly unknown[], scopeKey: string): boolean {
  const first = queryKey[0];
  return first === scopeKey || (Array.isArray(first) && first[0] === scopeKey);
}
