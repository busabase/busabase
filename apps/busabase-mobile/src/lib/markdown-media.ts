import { isPlayableVideoUrl } from "busabase-core/domains/doc/utils/video-url";
import { resolveAttachmentUrl } from "./attachment";

/**
 * What a markdown image source should become on the phone.
 *
 * Both halves are deliberately not `react-native-markdown-display`'s default:
 * its fallback for a relative source prefixes `https://`, so a self-hosted
 * `/api/storage/x.png` became `https:///api/storage/x.png` — broken every time.
 * And markdown carries video as an image (`![caption](clip.mp4)`), which drawn
 * as an image is a broken picture.
 */
export const markdownMediaFor = (
  src: string,
  serverUrl: string | null,
): { kind: "image" | "video"; uri: string } => ({
  kind: isPlayableVideoUrl(src) ? "video" : "image",
  uri: resolveAttachmentUrl(serverUrl, src),
});
