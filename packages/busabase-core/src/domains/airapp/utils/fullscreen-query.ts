const FULLSCREEN_QUERY_KEY = "fullscreen";

export const isAirAppFullscreenSearch = (search: string): boolean =>
  new URLSearchParams(search).get(FULLSCREEN_QUERY_KEY) === "1";

export const updateAirAppFullscreenSearch = (search: string, fullscreen: boolean): string => {
  const searchParams = new URLSearchParams(search);

  if (fullscreen) {
    searchParams.set(FULLSCREEN_QUERY_KEY, "1");
  } else {
    searchParams.delete(FULLSCREEN_QUERY_KEY);
  }

  return searchParams.toString();
};
