import type { liveEventSchema } from "busabase-contract/contract/busabase";
import { publishRealtimeMessage, subscribeRealtimeMessages } from "openlib/realtime";
import type { z } from "zod";

export type BusabaseLiveEvent = z.infer<typeof liveEventSchema>;

const channelForSpace = (spaceId: string) => `busabase:live:${spaceId}`;

export const publishBusabaseLiveEvent = async (event: BusabaseLiveEvent) => {
  await publishRealtimeMessage(channelForSpace(event.spaceId), event);
};

export async function* subscribeBusabaseLiveEvents(
  spaceId: string,
  signal?: AbortSignal,
): AsyncGenerator<BusabaseLiveEvent> {
  const queue: BusabaseLiveEvent[] = [];
  let wake: (() => void) | null = null;

  const unsubscribe = subscribeRealtimeMessages<BusabaseLiveEvent>(
    channelForSpace(spaceId),
    (event) => {
      queue.push(event);
      wake?.();
      wake = null;
    },
    signal,
  );

  try {
    while (!signal?.aborted) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }

      await new Promise<void>((resolve) => {
        wake = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    unsubscribe();
  }
}
