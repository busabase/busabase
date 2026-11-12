/** Budget the complete overflow count and expand button before choosing a prefix. */
export function attachmentGridLayout(
  width: number,
  itemWidths: number[],
  maxVisible = itemWidths.length,
) {
  const gap = 6;
  const expandWidth = 24;
  const total = itemWidths.length;
  const overflowWidth = (hidden: number) => Math.max(32, String(hidden).length * 8 + 16);
  let visible = 0;
  let itemsWidth = 0;
  for (let candidate = 1; candidate <= Math.min(total, maxVisible); candidate++) {
    itemsWidth += itemWidths[candidate - 1] ?? 0;
    const hidden = total - candidate;
    const required =
      itemsWidth + candidate * gap + expandWidth + (hidden ? overflowWidth(hidden) + gap : 0);
    if (required <= width) visible = candidate;
  }
  const hidden = total - visible;
  return {
    visible,
    hidden,
    overflowWidth: overflowWidth(hidden),
    combinedControls: total > 0 && width < overflowWidth(total) + gap + expandWidth,
  };
}

/** Keep compact rows unchanged while allowing a useful preview in taller cells. */
export function attachmentGridThumbnailSize(rowHeight: number, width = 0, count = 1) {
  const desired = Math.max(24, Math.min(128, rowHeight - 16));
  if (desired <= 32 || width <= 0) return desired;
  // Leave room for both the full-count overflow and expansion controls. A narrow
  // attachment column must still show a thumbnail when a smaller one can fit.
  const controls = count > 1 ? 68 : 30;
  return Math.max(24, Math.min(desired, width - controls));
}
