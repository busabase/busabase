"use client";

import { useCoreI18n } from "../../../i18n";

/** Names and provenance only; neither stored nor drafted values belong in this list. */
export function AirAppSiteConfigurationList({
  directValues,
  bindings,
  dirty = false,
}: {
  directValues: readonly { envName: string; kind: "secret" | "variable" }[];
  bindings: readonly {
    envName: string;
    kind: "secret" | "variable" | null;
    sourceKey: string | null;
  }[];
  dirty?: boolean;
}) {
  const copy = useCoreI18n().airapp.site.environment;
  return (
    <section
      className="min-w-0 space-y-2 rounded-md border border-border p-2"
      data-airapp-site-deployment-list=""
    >
      <h5 className="font-medium text-xs">{copy.deploymentList}</h5>
      {dirty ? <p className="text-muted-foreground text-xs">{copy.deploymentDraft}</p> : null}
      {directValues.length + bindings.length === 0 ? (
        <p className="text-muted-foreground text-xs">{copy.deploymentEmpty}</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {directValues.map((row, index) => (
            <li className="break-all" key={`direct-${index}-${row.envName}`}>
              <span className="font-mono">{row.envName || "—"}</span> ·{" "}
              {row.kind === "secret" ? copy.secret : copy.variable} · {copy.directSource}
            </li>
          ))}
          {bindings.map((row, index) => (
            <li className="break-all" key={`binding-${index}-${row.envName}`}>
              <span className="font-mono">{row.envName || "—"}</span> ·{" "}
              {row.kind === "secret" ? copy.secret : row.kind === "variable" ? copy.variable : "—"}{" "}
              · {copy.spaceSource}: <span className="font-mono">{row.sourceKey ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
