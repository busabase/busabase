/** Keep rendered CMS attachments on protocols browsers can navigate safely. */
export const getSafeCmsExternalUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};
