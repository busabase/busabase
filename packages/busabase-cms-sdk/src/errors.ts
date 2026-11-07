export class BusabaseCmsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BusabaseCmsError";
  }
}

export class BusabaseCmsSetupError extends BusabaseCmsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BusabaseCmsSetupError";
  }
}

export class BusabaseCmsSchemaDriftError extends BusabaseCmsSetupError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BusabaseCmsSchemaDriftError";
  }
}

/**
 * A configured CMS did not answer a read whose result the page needed (`requireCmsRead`).
 *
 * Thrown on purpose: an error response is not cached, so the page recovers on the next request,
 * whereas rendering the miss would cache a 404 or a narrowed hreflang set. Its own class so
 * error reporting can tell an outage from a bug, and so code that degrades optional parts of a
 * page can let an outage through.
 */
export class CmsUnavailableError extends BusabaseCmsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CmsUnavailableError";
  }
}

/**
 * Whether `error` is a `CmsUnavailableError`. Also matched by `name`, because `instanceof` fails
 * when the throwing and the checking code each load their own copy of this package (separately
 * bundled entry points, server bundles that do not share modules).
 */
export const isCmsUnavailableError = (error: unknown): error is CmsUnavailableError =>
  error instanceof CmsUnavailableError ||
  (error instanceof Error && error.name === "CmsUnavailableError");
