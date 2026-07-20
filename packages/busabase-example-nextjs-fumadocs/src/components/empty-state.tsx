import { Database, Settings2 } from "lucide-react";

interface EmptyStateProps {
  configured: boolean;
  kind: "posts" | "pages" | "content";
}

export function EmptyState({ configured, kind }: EmptyStateProps) {
  const Icon = configured ? Database : Settings2;

  return (
    <section className="empty-state" aria-live="polite">
      <Icon aria-hidden="true" size={24} />
      <div>
        <h2>{configured ? `No published ${kind}` : "Connect a Busabase space"}</h2>
        <p>
          {configured
            ? "Publish a canonical record in the configured Base, then refresh this page."
            : "Add the server-only variables from .env.example to .env.local and restart Next.js."}
        </p>
      </div>
    </section>
  );
}
