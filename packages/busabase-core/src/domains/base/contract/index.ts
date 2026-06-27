// Base domain contract barrel. Zod schemas live in entity-split leaf files
// (base-schemas / view-schemas / record-schemas); routes in routes.ts.
export * from "./base-schemas";
export * from "./record-schemas";
export { baseContract, recordContract, viewContract } from "./routes";
export * from "./view-schemas";
