// The 3D model viewer is not exported here: it imports @react-three/fiber,
// whose global JSX augmentation would reach every host that compiles this
// barrel. Hosts that want it import `previewfile-core/client/viewers/model-3d`
// and pass it to `FileViewer` as `model3dViewer`.
export { ConverterProvider, type ConverterProviderProps, useConverter } from "./converter";
export type { Messages, MessagesProviderProps } from "./i18n";
export { defaultMessages, MessagesProvider, messagesForLocale, useI18n } from "./i18n";
export type { FileViewerProps } from "./viewers/file-viewer";
export { FileType, FileViewer } from "./viewers/file-viewer";
export { LoadingState } from "./viewers/LoadingState";
export type { ViewerLayout } from "./viewers/viewer-layout";
export { ViewerLayoutProvider } from "./viewers/viewer-layout";
export type { ViewerProps } from "./viewers/viewer-props";
