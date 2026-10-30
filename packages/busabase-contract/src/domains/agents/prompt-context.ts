/** Client-safe Agent prompt clipboard and resource DTOs. Metadata grants no access. */
import { z } from "zod";

export const AGENT_PROMPT_CLIPBOARD_MIME = "application/x-busabase-agent-prompt+json";
export const AGENT_PROMPT_CONTEXT_LIMITS = {
  maxEnvelopeBytes: 1024 * 1024,
  maxLabelChars: 512,
  maxIdentifierChars: 256,
  maxSegments: 4,
  maxContexts: 20,
  maxTotalTextBytes: 2 * 1024 * 1024,
} as const;
export const agentPromptUtf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
const identifier = z.string().min(1).max(AGENT_PROMPT_CONTEXT_LIMITS.maxIdentifierChars);
const label = z.string().min(1).max(AGENT_PROMPT_CONTEXT_LIMITS.maxLabelChars);
export const AgentPromptSegmentSchema = z
  .object({
    kind: z.enum(["target", "task", "footer", "connection"]),
    text: z.string().min(1).max(AGENT_PROMPT_CONTEXT_LIMITS.maxEnvelopeBytes),
  })
  .strict();
export type AgentPromptSegment = z.infer<typeof AgentPromptSegmentSchema>;
export const joinAgentPromptSegments = (segments: readonly AgentPromptSegment[]): string =>
  segments.map((segment) => segment.text).join("\n\n");
export const AgentPromptSourceSchema = z
  .object({
    origin: z
      .string()
      .max(2048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return ["http:", "https:"].includes(url.protocol) && url.origin === value;
        } catch {
          return false;
        }
      }, "Expected an HTTP(S) origin"),
    edition: z.enum(["desktop", "cloud"]),
    spaceId: identifier.optional(),
  })
  .strict()
  .refine((source) => source.edition !== "cloud" || Boolean(source.spaceId), {
    message: "Cloud prompt context requires a space id",
  });
export type AgentPromptSource = z.infer<typeof AgentPromptSourceSchema>;
export const AgentPromptEnvelopeSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("busabase-agent-prompt"),
    scenario: z.object({ id: identifier, title: label }).strict(),
    target: z.object({ nodeId: identifier, nodeName: label, nodeType: identifier }).strict(),
    source: AgentPromptSourceSchema,
    segments: z.array(AgentPromptSegmentSchema).min(1).max(AGENT_PROMPT_CONTEXT_LIMITS.maxSegments),
  })
  .strict()
  .refine(
    (value) =>
      agentPromptUtf8Bytes(JSON.stringify(value)) <= AGENT_PROMPT_CONTEXT_LIMITS.maxEnvelopeBytes,
    {
      message: "Agent prompt envelope exceeds 1 MiB",
    },
  );
export type AgentPromptEnvelope = z.infer<typeof AgentPromptEnvelopeSchema>;
export const createAgentPromptEnvelope = (
  input: Omit<AgentPromptEnvelope, "version" | "kind">,
): AgentPromptEnvelope =>
  AgentPromptEnvelopeSchema.parse({ version: 1, kind: "busabase-agent-prompt", ...input });
export const isAgentPromptSourceCompatible = (
  source: AgentPromptSource,
  destination: AgentPromptSource,
): boolean =>
  source.origin === destination.origin &&
  source.edition === destination.edition &&
  (source.edition !== "cloud" || Boolean(source.spaceId && source.spaceId === destination.spaceId));
export const agentPromptResourceUri = (id: string): string =>
  `busabase-agent-prompt:///${encodeURIComponent(id)}`;
export const PromptResourceContextInputSchema = z
  .object({
    id: identifier,
    name: z
      .string()
      .min(1)
      .max(AGENT_PROMPT_CONTEXT_LIMITS.maxLabelChars * 2 + 3),
    uri: z.string().min(1).max(2048),
    mimeType: z.literal("text/plain"),
    text: z.string().min(1).max(AGENT_PROMPT_CONTEXT_LIMITS.maxTotalTextBytes),
    metadata: z.object({ "busabase.agentPrompt": AgentPromptEnvelopeSchema }).strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.text === joinAgentPromptSegments(value.metadata["busabase.agentPrompt"].segments),
    {
      message: "Prompt context text must exactly match its envelope segments",
    },
  );
export type PromptResourceContextInput = z.infer<typeof PromptResourceContextInputSchema>;
export const PromptResourceContextListSchema = z
  .array(PromptResourceContextInputSchema)
  .max(AGENT_PROMPT_CONTEXT_LIMITS.maxContexts)
  .refine(
    (values) =>
      values.reduce((sum, value) => sum + agentPromptUtf8Bytes(value.text), 0) <=
      AGENT_PROMPT_CONTEXT_LIMITS.maxTotalTextBytes,
    {
      message: "Total prompt context text exceeds 2 MiB",
    },
  );
export const createPromptResourceContext = (
  envelope: AgentPromptEnvelope,
  id: string,
): PromptResourceContextInput =>
  PromptResourceContextInputSchema.parse({
    id,
    name: `${envelope.scenario.title} · ${envelope.target.nodeName}`,
    uri: agentPromptResourceUri(id),
    mimeType: "text/plain",
    text: joinAgentPromptSegments(envelope.segments),
    metadata: { "busabase.agentPrompt": envelope },
  });
/** Decode only explicit paste-event data. Failure leaves the browser's ordinary paste intact. */
export const decodeAgentPromptClipboard = (
  serialized: string,
  plainText: string,
  destination: AgentPromptSource,
  id: string,
): PromptResourceContextInput | null => {
  if (
    !serialized ||
    serialized.length > AGENT_PROMPT_CONTEXT_LIMITS.maxEnvelopeBytes ||
    agentPromptUtf8Bytes(serialized) > AGENT_PROMPT_CONTEXT_LIMITS.maxEnvelopeBytes
  )
    return null;
  try {
    const parsed = AgentPromptEnvelopeSchema.safeParse(JSON.parse(serialized));
    if (
      !parsed.success ||
      !isAgentPromptSourceCompatible(parsed.data.source, destination) ||
      joinAgentPromptSegments(parsed.data.segments) !== plainText
    )
      return null;
    return createPromptResourceContext(parsed.data, id);
  } catch {
    return null;
  }
};
