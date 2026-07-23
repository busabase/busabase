"use client";

// Actual Crepe (Milkdown) mount — split out from doc-editor.tsx and loaded via
// a client-only `import()` there, never eagerly. ProseMirror's view module
// touches `document`/`window` at import-evaluation time, which crashes during
// a server-rendered pass even inside a "use client" component; deferring the
// import to a `useEffect` sidesteps that without depending on a Next.js-only
// API (this package stays framework-agnostic — see its use of `wouter`).
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useEffect, useRef } from "react";
import { useCoreI18n } from "../../../i18n";
import "./doc-editor.css";

export interface DocEditorCrepeProps {
  /** Markdown source. Only read once, at mount — the caller remounts (via a
   * `key`) to load different content instead of pushing updates in-place. */
  content: string;
  onChange: (markdown: string) => void;
  /** @default true */
  editable?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  className?: string;
}

function DocEditorInner({
  content,
  onChange,
  editable = true,
  onImageUpload,
  className,
}: DocEditorCrepeProps) {
  const messages = useCoreI18n();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onImageUploadRef = useRef(onImageUpload);
  onImageUploadRef.current = onImageUpload;
  const crepeRef = useRef<Crepe | null>(null);

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: content,
      // Placeholder's decoration computation throws ("Cannot read properties
      // of undefined (reading 'localsInner')") when the doc briefly becomes
      // empty (e.g. select-all + delete while editing) — and that crash was
      // observed to silently break the markdownUpdated listener for the rest
      // of the session, so further typing never reached `onChange` and got
      // lost on save. Disabling the feature removes the crash (and the data
      // loss with it); re-enable once fixed upstream in @milkdown/crepe.
      features: {
        [Crepe.Feature.Placeholder]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: messages.docEditor.placeholder,
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: (file) => {
            const upload = onImageUploadRef.current;
            return upload ? upload(file) : Promise.reject(new Error("Image upload unavailable"));
          },
          inlineUploadButton: messages.docEditor.imageUploadButton,
          inlineUploadPlaceholderText: messages.docEditor.imageUploadPlaceholder,
          inlineConfirmButton: messages.docEditor.imageConfirmButton,
          blockUploadButton: messages.docEditor.imageUploadButton,
          blockUploadPlaceholderText: messages.docEditor.imageUploadPlaceholder,
          blockCaptionPlaceholderText: messages.docEditor.imageCaptionPlaceholder,
          blockConfirmButton: messages.docEditor.imageConfirmButton,
        },
        [Crepe.Feature.LinkTooltip]: {
          inputPlaceholder: messages.docEditor.linkPlaceholder,
        },
        [Crepe.Feature.CodeMirror]: {
          searchPlaceholder: messages.docEditor.codeSearchPlaceholder,
          noResultText: messages.docEditor.codeNoResult,
          copyText: messages.docEditor.codeCopy,
          previewLabel: messages.docEditor.codePreviewLabel,
          previewLoading: messages.docEditor.codePreviewLoading,
        },
        [Crepe.Feature.BlockEdit]: {
          textGroup: {
            label: messages.docEditor.blockTextGroup,
            text: { label: messages.docEditor.blockText },
            h1: { label: messages.docEditor.blockH1 },
            h2: { label: messages.docEditor.blockH2 },
            h3: { label: messages.docEditor.blockH3 },
            h4: { label: messages.docEditor.blockH4 },
            h5: { label: messages.docEditor.blockH5 },
            h6: { label: messages.docEditor.blockH6 },
            quote: { label: messages.docEditor.blockQuote },
            divider: { label: messages.docEditor.blockDivider },
          },
          listGroup: {
            label: messages.docEditor.blockListGroup,
            bulletList: { label: messages.docEditor.blockBulletList },
            orderedList: { label: messages.docEditor.blockOrderedList },
            taskList: { label: messages.docEditor.blockTaskList },
          },
          advancedGroup: {
            label: messages.docEditor.blockAdvancedGroup,
            image: { label: messages.docEditor.blockImage },
            codeBlock: { label: messages.docEditor.blockCodeBlock },
            table: { label: messages.docEditor.blockTable },
            math: { label: messages.docEditor.blockMath },
          },
        },
      },
    });
    crepe.setReadonly(!editable);
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => onChangeRef.current(markdown));
    });
    crepeRef.current = crepe;
    return crepe;
  });

  // Only matters for a caller that toggles `editable` without remounting
  // (this repo's own DocDetailView remounts via `key` instead, so the initial
  // `setReadonly` call above already covers it in practice).
  useEffect(() => {
    crepeRef.current?.setReadonly(!editable);
  }, [editable]);

  return (
    <div className={className}>
      <Milkdown />
    </div>
  );
}

export default function DocEditorCrepe(props: DocEditorCrepeProps) {
  return (
    <MilkdownProvider>
      <DocEditorInner {...props} />
    </MilkdownProvider>
  );
}
