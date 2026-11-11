# previewfile-core

Shared file preview core, used as TypeScript source (no build step) by
`the standalone host`, `other embedding hosts` and `the hosted workspace`.

- **`utils/file-types`** — the one classification every host routes by:
  `detectFileType`, `needsConverter`, `canPreview`, `mimeTypeForFileName`.
  Pure and isomorphic.
- **`client`** — `FileViewer` (picks the viewer for a file), the viewers, the
  converter port, and viewer strings in ten languages (English, Simplified and
  Traditional Chinese, Japanese, Korean, Portuguese, German, Spanish, French,
  Vietnamese; `MessagesProvider locale=…`).
- **`client/embedded`** / **`client/embedded/lazy`** — `EmbeddedFileViewer`
  for a host's preview frame (fill layout, converter, memoized), and a lazily
  loaded wrapper for it.
- **`client/viewers/model-3d`** — the opt-in 3D viewer. Kept out of every
  other entry point because @react-three/fiber augments JSX globally.
- **`server`** — Office → PDF conversion: the convert route
  (`createConvertRoute`), BullMQ queue and worker (`defineConversionHost`,
  `startConversionHostWorker`), conversion storage and cache, and
  `fetchPublicUrl` for fetching addresses only on the public internet.
- **`scripts/copy-viewer-assets.mjs`** — copies the SQLite and archive viewers'
  wasm/worker files into a host's `public/` before `dev` and `build`.
- **`docker/libreoffice.sh`** — installs and verifies LibreOffice the same way
  in every image that converts.

```tsx
import { FileViewer } from "previewfile-core/client";
import { canPreview } from "previewfile-core/utils/file-types";

<FileViewer url={url} fileName="deck.pptx" mimeType={mimeType} />;
```
