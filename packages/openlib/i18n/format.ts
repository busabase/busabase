export const templateFormat = (
  template: string,
  vars?: Record<string, string | number>,
): string => {
  if (!vars) return template;
  return template.replace(/\{(.*?)\}/g, (_, k) => (vars[k] ?? `{${k}}`).toString());
};
