/** Budget the complete overflow count and expand button before choosing a prefix. */
export function attachmentGridLayout(width: number, itemWidths: number[]) {
  const gap = 6;
  const expandWidth = 24;
  const total = itemWidths.length;
  const overflowWidth = (hidden: number) => Math.max(32, String(hidden).length * 8 + 16);
  let visible = 0;
  let itemsWidth = 0;
  for (let candidate = 1; candidate <= total; candidate++) {
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
