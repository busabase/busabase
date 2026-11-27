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

For image and PDF previews inside a bounded frame, both `FileViewer` and
`EmbeddedFileViewer` accept `fitToContainer`. The host must provide a definite
height and width. Images fit completely without enlarging small originals.
PDFs initially fit the whole page and offer fit-width and whole-page modes;
manual zoom and the current page survive frame resizing. The option defaults
to `false`, preserving existing standalone and embedding-host behavior.

PDF reading also accepts `pdfScrollMode="continuous"` on `FileViewer` and
`EmbeddedFileViewer`. It keeps the existing toolbar while arranging pages in
a continuous vertical document. React-PDF renders the pages; react-window
mounts only the nearby rows. The current page follows scrolling, and toolbar
navigation scrolls to the selected page. Page dimensions are read with two
background workers, preserving the reading position as dimensions arrive or
the frame changes. This option defaults to `"single"`; Busabase opts its
attachment dialogs into continuous reading.
