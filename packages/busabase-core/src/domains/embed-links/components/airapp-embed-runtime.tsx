"use client";

import { EMBED_RUNTIME_CAPABILITY_HEADER, EMBED_RUNTIME_NODE_HEADER } from "../capability";
import { AirAppBridgeRuntime } from "./airapp-bridge-runtime";

/**
 * The standalone Embed Link runtime (`/embed/{id}/airapp`).
 *
 * Everything mechanical — the injected `window.fetch` override, the postMessage
 * relay, the Nodepod pod, the revocation heartbeat — lives in
 * `AirAppBridgeRuntime`, which the publicly shared AirApp surface uses too.
 * The only thing that differs between the two is the credential the relay
 * carries, so that is the only thing this file states.
 */

interface Props {
  capability: string;
  expiresAt: string;
  files: Record<string, string>;
  labels: {
    loading: string;
    unavailable: string;
  };
  nodeId: string;
  title: string;
}

export function AirAppEmbedRuntime({ capability, expiresAt, files, labels, nodeId, title }: Props) {
  return (
    <AirAppBridgeRuntime
      bridgeHeaders={{
        [EMBED_RUNTIME_CAPABILITY_HEADER]: capability,
        [EMBED_RUNTIME_NODE_HEADER]: nodeId,
      }}
      expiresAt={expiresAt}
      files={files}
      labels={labels}
      layout="fullscreen"
      // `"embed"` reaches the app as `BUSABASE_AIRAPP_RUNTIME`: same in-browser
      // engine as the dashboard preview, but `/api/v1` here is relayed through a
      // capability-scoped read-only route rather than the viewer's session.
      runtimeKind="embed"
      title={title}
    />
  );
}
