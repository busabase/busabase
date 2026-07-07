import { userInfo } from "node:os";

const humanizeLocalUsername = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .split(/[._-\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};

export const getLocalUserName = () => {
  const configuredName = process.env.BUSABASE_LOCAL_USER_NAME?.trim();
  if (configuredName) {
    return configuredName;
  }

  try {
    return humanizeLocalUsername(userInfo().username);
  } catch {
    return humanizeLocalUsername(process.env.USER ?? process.env.USERNAME);
  }
};
