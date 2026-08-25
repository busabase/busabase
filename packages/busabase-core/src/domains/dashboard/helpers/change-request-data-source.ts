/** The Home digest is the only route backed by the global cursor list. */
export const shouldQueryGlobalChangeRequests = (locationPath: string): boolean =>
  locationPath === "/" || locationPath === "/home";
