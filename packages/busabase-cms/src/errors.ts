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
