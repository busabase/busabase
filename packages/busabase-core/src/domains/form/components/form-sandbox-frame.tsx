import { useEffect, useRef } from "react";
import { useCoreI18n } from "../../../i18n";

/**
 * Renders the agent-authored form page inside a STRICT sandbox iframe.
 *
 * Security boundary (see apps/busabase/content/spec/form-as-node.md §6):
 * - `sandbox="allow-scripts allow-forms"` WITHOUT `allow-same-origin` → the
 *   frame gets an opaque origin, so the agent's code cannot reach the host's
 *   cookies, storage or DOM. (AirApp's preview uses allow-same-origin; a form is
 *   anonymously reachable, so it must be stricter.) `allow-forms` only lets a
 *   `<form>` inside the frame fire its submit event — which the bridge
 *   intercepts and turns into a postMessage; it grants no origin access.
 * - The page's ONLY channel to Busabase is `busa.submit(values)`, which
 *   postMessages the host; the host validates the source frame and performs the
 *   real submit. The frame never holds credentials and can't read any data.
 * - The agent's JS is deliberately NOT stripped — authoring interactive pages is
 *   the point. Confinement comes from the sandbox, not from sanitizing.
 */
const BRIDGE = `
<script>
(function () {
  window.busa = {
    submit: function (values) {
      parent.postMessage({ type: "busa:submit", values: values || {} }, "*");
    },
  };
  // Convenience: a <form> submit collects named inputs automatically.
  document.addEventListener("submit", function (event) {
    event.preventDefault();
    var data = {};
    var elements = event.target.elements || [];
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (el.name) {
        data[el.name] = el.type === "checkbox" ? el.checked : el.value;
      }
    }
    window.busa.submit(data);
  });
})();
</script>`;

/**
 * Build the frame payload from the agent's single HTML document, injecting the
 * bridge last so it can intercept the page's own submit handlers. A full
 * document gets the bridge spliced in before `</body>`; a bare fragment is
 * wrapped in a minimal document first.
 */
export const buildFormSrcDoc = (page: { code?: string }) => {
  const code = page.code ?? "";
  if (/<\/body\s*>/i.test(code)) {
    return code.replace(/<\/body\s*>/i, `${BRIDGE}</body>`);
  }
  if (/<html[\s>]/i.test(code)) {
    return `${code}${BRIDGE}`;
  }
  return [
    "<!doctype html><html><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width,initial-scale=1'>",
    "</head><body>",
    code,
    BRIDGE,
    "</body></html>",
  ].join("");
};

export function FormSandboxFrame({
  page,
  onSubmit,
  height = 560,
}: {
  page: { code?: string };
  onSubmit: (values: Record<string, unknown>) => void;
  height?: number;
}) {
  const messages = useCoreI18n();
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Only accept messages from THIS frame. The frame is sandboxed without
      // allow-same-origin, so its origin is opaque ("null") — identity is
      // established by comparing the source window, not the origin string.
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) {
        return;
      }
      const data = event.data as { type?: string; values?: Record<string, unknown> };
      if (data?.type === "busa:submit") {
        onSubmit(data.values ?? {});
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSubmit]);

  return (
    <iframe
      className="w-full rounded-lg border border-border/60 bg-card"
      title={messages.form.tabForm}
      sandbox="allow-scripts allow-forms"
      srcDoc={buildFormSrcDoc(page)}
      style={{ height }}
      ref={frameRef}
    />
  );
}
