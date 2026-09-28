/** The one-line page an embed shows instead of its content (unavailable / expired). */
export function EmbedStatus({ label }: { label: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background text-foreground">{label}</main>
  );
}
