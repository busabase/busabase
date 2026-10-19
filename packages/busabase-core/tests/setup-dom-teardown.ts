import { afterAll } from "vitest";

// Radix (Dialog/Popover FocusScope) schedules a `setTimeout(0)` on unmount that
// dispatches a jsdom `CustomEvent`. When that unmount is the file's last
// `cleanup()`, the jsdom environment can be torn down before the timer runs; the
// timer then fires with Node's `CustomEvent` against a jsdom element and Vitest
// fails the whole run with an unhandled "parameter 1 is not of type 'Event'".
// Same-delay Node timers run in scheduling order, so waiting one zero-delay
// tick here guarantees every timer queued by the tests has run while jsdom is
// still alive.
afterAll(async () => {
  if (typeof window === "undefined") return;
  await new Promise((resolve) => setTimeout(resolve, 0));
});
