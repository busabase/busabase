/**
 * Zoom and pan limits for the shared avatar/logo cropper.
 *
 * react-easy-crop's default wheel gain is `pixelY / 200`. A mouse notch is
 * about 100 pixels, so one click changes zoom by 0.5 and the 1–3 range is
 * only four clicks wide. The same library refuses to pan once the scaled
 * image no longer sticks out past the crop: the allowed offset becomes 0,
 * and below a cover-fit it becomes negative, which `clamp(value, -max, max)`
 * collapses to a single point. A logo zoomed all the way out then cannot move.
 */

export interface CropPoint {
  x: number;
  y: number;
}

export interface CropSize {
  width: number;
  height: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const INITIAL_ZOOM = 1.2;

/** Largest zoom change applied for a single wheel event. */
export const MAX_WHEEL_ZOOM_STEP = 0.08;

/**
 * Gain applied to a pixel wheel delta before the per-event cap.
 * 100px * 0.16 / 200 = 0.08, so a normal notch lands on the cap instead of 0.5.
 */
export const WHEEL_ZOOM_GAIN = 0.16 / 200;

/**
 * Minimum pan, as a fraction of the crop, when the image does not extend past
 * the frame. Half the frame lets a fitted logo slide until its center reaches
 * the crop edge, while a zoomed-in image that already overflows keeps the
 * tighter "stay covering the frame" limit.
 */
export const MIN_PAN_RATIO = 0.5;

const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Signed zoom delta. Positive `deltaY` (scroll down) zooms out. */
export const zoomChangeFromWheel = (deltaY: number, deltaMode = 0): number => {
  const pixelY =
    deltaMode === 1 ? deltaY * LINE_HEIGHT : deltaMode === 2 ? deltaY * PAGE_HEIGHT : deltaY;
  return clampNumber(pixelY * WHEEL_ZOOM_GAIN, -MAX_WHEEL_ZOOM_STEP, MAX_WHEEL_ZOOM_STEP);
};

export const nextZoomFromWheel = (zoom: number, deltaY: number, deltaMode = 0): number =>
  clampNumber(zoom - zoomChangeFromWheel(deltaY, deltaMode), MIN_ZOOM, MAX_ZOOM);

/**
 * How far the media may move on one axis.
 * `media` and `frame` are the rendered sizes at zoom 1, matching react-easy-crop.
 *
 * Once the image overflows the frame by at least `MIN_PAN_RATIO`, this matches
 * the library (the crop stays covered). Closer to a fit, extra room fades in
 * so a fully zoomed-out image can still be dragged, and one wheel step does
 * not snap that offset back to zero.
 */
export const cropDragLimit = (media: number, frame: number, zoom: number): number => {
  if (frame <= 0 || media <= 0 || !Number.isFinite(zoom)) return 0;
  const coverSlack = (media * zoom) / 2 - frame / 2;
  const floor = frame * MIN_PAN_RATIO;
  if (coverSlack >= floor) return coverSlack;
  // The cover bound must remain a lower bound while extra room fades away.
  // Otherwise the left-hand limit tends to zero before jumping to `floor`.
  if (coverSlack >= 0) return Math.max(coverSlack, floor - coverSlack);
  return Math.max(floor, -coverSlack);
};

export const clampCropPoint = (
  point: CropPoint,
  media: CropSize,
  frame: CropSize,
  zoom: number,
): CropPoint => ({
  x: clampNumber(
    point.x,
    -cropDragLimit(media.width, frame.width, zoom),
    cropDragLimit(media.width, frame.width, zoom),
  ),
  y: clampNumber(
    point.y,
    -cropDragLimit(media.height, frame.height, zoom),
    cropDragLimit(media.height, frame.height, zoom),
  ),
});

/**
 * Map a crop rectangle that may extend outside the source image onto the
 * pixels that should be drawn, plus where those pixels sit in the output.
 * Padding (the part of the crop with no source pixel) is left for the caller
 * to fill — transparent for PNG logos, opaque for JPEG.
 */
export const placeCropOnImage = (
  crop: CropRect,
  image: CropSize,
): { source: CropRect; destination: CropRect } | null => {
  if (crop.width <= 0 || crop.height <= 0 || image.width <= 0 || image.height <= 0) return null;
  const x1 = Math.max(0, crop.x);
  const y1 = Math.max(0, crop.y);
  const x2 = Math.min(image.width, crop.x + crop.width);
  const y2 = Math.min(image.height, crop.y + crop.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return {
    source: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 },
    destination: { x: x1 - crop.x, y: y1 - crop.y, width: x2 - x1, height: y2 - y1 },
  };
};
