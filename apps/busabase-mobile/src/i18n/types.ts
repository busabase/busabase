import type { en } from "./en";

// Widen the English catalog's literal leaves while preserving its exact key shape.
export type CoreMessages = {
  [Section in keyof typeof en]: { [Key in keyof (typeof en)[Section]]: string };
};
