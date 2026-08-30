import { useCallback, useEffect, useRef, useState } from "react";
import { attachmentToContentBlock } from "../prompt/attachment-media";
import type { AcpAttachment, AcpBlock, AcpPermissionBlock, AcpUiEvent, AcpUsage } from "../reduce";
import {
  foldSessionTitle,
  foldUsage,
  reduceAcpEvent,
  reduceAcpEvents,
  sessionTitleOf,
  usageOf,
} from "../reduce";
import type { AcpSessionPort, AcpSessionState } from "./types";

/**
 * Drives one ACP conversation: session lifecycle, event reduction, prompt
 * sending, and permission answering.
 *
 * Headless by construction — it imports `react` and nothing else, so the same
 * hook serves a web, React Native or Taro binding. What it deliberately does
 * *not* own is transport: the host injects an `AcpSessionPort`, keeping each
 * app's hard-won connection code (acprouter's remote relay, busabase's stdio /
 * WebSocket `acp.Stream`) exactly where it is.
 *
 * `key` is the conversation's identity — a change means a different
 * conversation, not a refetch of the same one. `null` means there is no
 * conversation to drive yet (busabase renders the panel before any session
 * exists), and nothing is started.
 */
export function useAcpSession(port: AcpSessionPort, key: string | null): AcpSessionState {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<AcpBlock[]>([]);
  const [sending, setSending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [usage, setUsage] = useState<AcpUsage | null>(null);

  // `port` is typically an object literal rebuilt every render. Holding it in a
  // ref keeps it out of the effect's dependencies, so a re-render cannot tear
  // down and restart a live session.
  const portRef = useRef(port);
  portRef.current = port;

  // These two refs exist because of a bug real end-to-end verification caught in
  // acprouter, and the fix is subtler than it looks. `start()` spawns a real
  // agent process server-side. React StrictMode (dev only) mounts this effect,
  // cleans it up, and mounts it again — synchronously, same tick — precisely to
  // surface non-idempotent side effects like that one. Without
  // `startedForKeyRef` the replay fired two real sessions for one opened sheet.
  // But the guard alone is not enough: StrictMode's *synthetic* first cleanup
  // would mark the still-in-flight `start()` cancelled before it resolves,
  // discarding the one session that really was created. So `cancelledRef` is
  // reset on every effect invocation, not just the first — whichever invocation
  // is still mounted when the request resolves is the one that accepts it.
  const startedForKeyRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  // The in-flight `start()` — see the third branch below for why it is a ref.
  const startPromiseRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    cancelledRef.current = false;
    if (key === null) {
      startedForKeyRef.current = null;
      sessionIdRef.current = null;
      startPromiseRef.current = null;
      setSessionId(null);
      setBlocks([]);
      setEnded(false);
      setError(null);
      setTitle(null);
      setUsage(null);
      return;
    }
    const controller = new AbortController();
    let unsubscribe: (() => void) | undefined;
    // Guards `follow` per effect invocation, where `cancelledRef` cannot: the
    // ref is shared and reset by the NEXT invocation, so a `follow` queued by a
    // StrictMode-cleaned-up invocation would see it false again and happily
    // subscribe with this invocation's already-aborted controller. Real-agent
    // verification caught exactly that: the subscription died instantly against
    // a port that honours the abort signal, and the transcript stayed blank.
    let invocationAlive = true;

    const follow = async (id: string) => {
      sessionIdRef.current = id;
      if (!invocationAlive) return;
      setSessionId(id);

      // Persisted history first, then live — so a reopened session shows what
      // already happened instead of starting blank. Hosts whose subscription
      // already replays from a sequence number simply omit `history`, which is
      // why there is no gap between the two here.
      const loadHistory = portRef.current.history;
      if (loadHistory) {
        try {
          const past = await loadHistory(id, controller.signal);
          if (!invocationAlive) return;
          setBlocks((prev) => (prev.length === 0 ? reduceAcpEvents([], past) : prev));
          // Same "don't clobber a racing live update" guard as `blocks` above,
          // via each field's own untouched-default rather than a length check.
          const pastUsage = foldUsage(past);
          setUsage((prev) => prev ?? pastUsage);
          const pastTitle = foldSessionTitle(past);
          setTitle((prev) => (prev !== null ? prev : pastTitle));
        } catch {
          // History is an enhancement; failing to load it must not stop the
          // live conversation from working.
        }
      }

      if (!invocationAlive) return;
      unsubscribe = portRef.current.subscribe(
        id,
        (event) => {
          if (cancelledRef.current) return;
          setBlocks((prev) => reduceAcpEvent(prev, event));
          if (event.type === "note" && event.ended) setEnded(true);
          const eventUsage = usageOf(event);
          if (eventUsage) setUsage(eventUsage);
          const eventTitle = sessionTitleOf(event);
          if (eventTitle !== undefined) setTitle(eventTitle);
        },
        controller.signal,
      );
    };

    const reportStartFailure = (err: unknown) => {
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : "Could not start a session.");
      }
    };

    if (startedForKeyRef.current !== key) {
      startedForKeyRef.current = key;
      setBlocks([]);
      setEnded(false);
      setError(null);
      setTitle(null);
      setUsage(null);
      startPromiseRef.current = portRef.current.start(controller.signal).then((id) => {
        sessionIdRef.current = id;
        return id;
      });
      startPromiseRef.current.then(follow).catch(reportStartFailure);
    } else if (sessionIdRef.current) {
      // The real `start()` from an earlier, StrictMode-replayed invocation had
      // already resolved — re-follow rather than leaving this mount stuck on
      // "Starting…" with no subscription.
      void follow(sessionIdRef.current);
    } else if (startPromiseRef.current) {
      // `start()` is STILL in flight from that earlier invocation. Its own
      // `follow` will bail (its `invocationAlive` is false), so if this
      // invocation does not chain onto the same promise, nobody ever
      // subscribes and the transcript stays blank forever.
      startPromiseRef.current.then(follow).catch(reportStartFailure);
    }

    return () => {
      invocationAlive = false;
      cancelledRef.current = true;
      controller.abort();
      unsubscribe?.();
      // Best-effort: a conversation nobody ever prompted still gets its spawned
      // process released instead of orphaned.
      if (sessionIdRef.current) portRef.current.end?.(sessionIdRef.current);
    };
  }, [key]);

  const sendPrompt = useCallback(
    async (text: string, attachments?: readonly AcpAttachment[]) => {
      const id = sessionIdRef.current;
      if (!id || sending || ended) return;
      setError(null);
      setSending(true);
      if (!portRef.current.serverEchoesPrompt) {
        // One chunk for the text, one more per attachment — same shape a real
        // ACP client's `session/update` stream would take. They carry no
        // `messageId`, so they merge into a single block by (role, variant)
        // adjacency, same as every other id-less chunk this reducer sees.
        const echo: AcpUiEvent[] = [
          {
            type: "session_update",
            update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } },
          },
          ...(attachments ?? []).map(
            (attachment): AcpUiEvent => ({
              type: "session_update",
              update: {
                sessionUpdate: "user_message_chunk",
                content: attachmentToContentBlock(attachment),
              },
            }),
          ),
        ];
        setBlocks((prev) => reduceAcpEvents(prev, echo));
      }
      try {
        await portRef.current.prompt(id, text, attachments, new AbortController().signal);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The prompt failed.");
      } finally {
        setSending(false);
      }
    },
    [sending, ended],
  );

  const answerPermission = useCallback(async (block: AcpPermissionBlock, optionId: string) => {
    const id = sessionIdRef.current;
    // Only an unanswered request can be answered — this is what stops a second
    // click, or a click on an already-resolved card, from being sent.
    if (!id || block.resolution !== "pending") return;

    // Optimistic, so the buttons disable immediately rather than after the round
    // trip. The reducer treats a real `permission_resolved` as authoritative
    // from either state, so the answer that arrives moments later still lands.
    setBlocks((prev) =>
      reduceAcpEvent(prev, { type: "permission_answering", requestId: block.id }),
    );

    const restore = () =>
      setBlocks((prev) =>
        prev.map((b) =>
          b.kind === "permission" && b.id === block.id ? { ...b, resolution: "pending" } : b,
        ),
      );

    try {
      const answered = await portRef.current.answerPermission(id, block, optionId);
      if (!answered) {
        // Too late — the host resolved it on its own (acprouter's 5-minute
        // timeout). Put the card back rather than showing a choice that was
        // never applied; the terminal event is what explains this to the user.
        restore();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that answer.");
      restore();
    }
  }, []);

  const cancel = useCallback(async () => {
    const id = sessionIdRef.current;
    // Nothing to cancel once the turn has already finished — guards a stray
    // click on a stop button that hasn't yet noticed `sending` flipped false.
    if (!id || !sending) return;
    try {
      await portRef.current.cancel?.(id);
    } catch {
      // Best-effort by design (see AcpSessionPort.cancel's doc comment): the
      // in-flight `prompt()` call resolves on its own once the agent responds
      // with SOME stop reason, whether or not this notify actually landed —
      // there is nothing actionable to surface to the user here.
    }
  }, [sending]);

  return {
    sessionId,
    blocks,
    sending,
    ended,
    error,
    title,
    usage,
    sendPrompt,
    answerPermission,
    cancel,
  };
}
