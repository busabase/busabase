import {
  type AcpBlock,
  type AcpInputBlock,
  type AcpInputResponse,
  type AcpResource,
  parseAcpInputFields,
  validateAcpInputResponse,
} from "@acp-ui/core/reduce";
import { useEffect, useRef, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { fmt, useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

export type AcpResourceResolver = (resource: AcpResource) => Promise<AcpResource>;
export type AcpObservationBlock = Extract<AcpBlock, { kind: "plan" | "step" | "turn" | "job" }>;

export function AcpObservationCard({ block }: { block: AcpObservationBlock }) {
  const tokens = useTokens();
  const { t } = useI18n();
  const status = (value: string) =>
    (
      ({
        completed: t.agents.toolStatusCompleted,
        succeeded: t.agents.toolStatusCompleted,
        pending: t.agents.toolStatusPending,
        queued: t.agents.toolStatusPending,
        running: t.agents.toolStatusRunning,
        in_progress: t.agents.toolStatusRunning,
        cancelled: t.agents.cancelled,
        failed: t.agents.toolStatusError,
        interrupted: t.agents.interrupted,
        limited: t.agents.limitReached,
        refused: t.agents.inputDeclined,
        end_turn: t.agents.toolStatusCompleted,
        max_tokens: t.agents.limitReached,
        refusal: t.agents.inputDeclined,
      }) as Record<string, string>
    )[value] ?? value;
  const text = (value: string, index: number) => (
    <Text key={index} selectable style={[typography.small, { color: tokens.foreground }]}>
      {value}
    </Text>
  );
  let title: string;
  let lines: string[];
  switch (block.kind) {
    case "plan":
      title = t.agents.plan;
      lines = block.entries.map((entry) => `${status(entry.status)} · ${entry.content}`);
      break;
    case "step":
      title = block.label ?? t.agents.step;
      lines = [block.startedAt, ...(block.endedAt ? [block.endedAt] : [])];
      break;
    case "turn":
      title = `${block.label ?? t.agents.process} · ${status(block.status)}`;
      lines = [
        block.startedAt,
        ...(block.endedAt ? [block.endedAt] : []),
        ...(block.stopReason ? [status(block.stopReason)] : []),
        ...(block.usage
          ? [
              Object.entries(block.usage)
                .map(
                  ([name, value]) =>
                    `${({ inputTokens: t.agents.inputTokens, outputTokens: t.agents.outputTokens, totalTokens: t.agents.totalTokens, cachedReadTokens: t.agents.cachedReadTokens, cachedWriteTokens: t.agents.cachedWriteTokens, thoughtTokens: t.agents.thoughtTokens } as Record<string, string>)[name] ?? name}: ${value}`,
                )
                .join(" · "),
            ]
          : []),
      ];
      break;
    case "job":
      title = `${block.job.title} · ${status(block.job.status)}`;
      lines = [
        ...(block.job.message ? [block.job.message] : []),
        ...(block.job.resourceIds?.length
          ? [fmt(t.agents.outputCount, { count: block.job.resourceIds.length })]
          : []),
      ];
      break;
  }
  return (
    <View style={[styles.card, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
      <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{title}</Text>
      {lines.map(text)}
    </View>
  );
}

export function AcpResourceCard({
  resource,
  resolveResource,
}: {
  resource: AcpResource;
  resolveResource?: AcpResourceResolver;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const [resolved, setResolved] = useState<{ source: AcpResource; value: AcpResource }>();
  const source = useRef(resource);
  source.current = resource;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const current = resolved?.source === resource ? resolved.value : resource;
  useEffect(() => {
    if (source.current === resource) {
      setLoading(false);
      setError(undefined);
    }
  }, [resource]);
  const open = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = resolveResource ? await resolveResource(resource) : resource;
      if (source.current !== resource) return;
      const url = new URL(next.uri);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error(t.agents.resourceUnavailable);
      setResolved({ source: resource, value: next });
      await Linking.openURL(url.toString());
    } catch (failure) {
      if (source.current === resource)
        setError(failure instanceof Error ? failure.message : t.agents.resourceUnavailable);
    } finally {
      if (source.current === resource) setLoading(false);
    }
  };
  return (
    <View style={[styles.card, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
      <Text selectable style={[typography.bodyEm, { color: tokens.foreground }]}>
        {current.name}
      </Text>
      {current.description ? (
        <Text selectable style={{ color: tokens.mutedForeground }}>
          {current.description}
        </Text>
      ) : null}
      <Text selectable style={[typography.small, { color: tokens.mutedForeground }]}>
        {[
          current.mimeType,
          current.status,
          current.size !== undefined ? `${current.size} B` : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {resolved?.source === resource &&
      resolved.value.previewUri &&
      resolved.value.mimeType?.startsWith("image/") &&
      /^https?:\/\//i.test(resolved.value.previewUri) ? (
        <Image
          source={{ uri: resolved.value.previewUri }}
          accessibilityLabel={resolved.value.name}
          style={styles.preview}
          resizeMode="contain"
        />
      ) : null}
      <Button
        label={t.agents.openResource}
        loading={loading}
        variant="secondary"
        onPress={() => void open()}
      />
      {error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function AcpInputCard({
  block,
  onAnswer,
}: {
  block: AcpInputBlock;
  onAnswer?: (response: AcpInputResponse) => void;
}) {
  const tokens = useTokens();
  const { t } = useI18n();
  const fields = parseAcpInputFields(block.requestedSchema);
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      (fields ?? []).flatMap((field) =>
        field.defaultValue === undefined ? [] : [[field.name, field.defaultValue]],
      ),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const locked = block.resolution !== "pending" || block.confirmationUnknown === true || !onAnswer;
  const submit = () => {
    const response: AcpInputResponse = { action: "accept", content: values };
    const invalid = validateAcpInputResponse(block.requestedSchema, response);
    setErrors(invalid);
    if (!Object.keys(invalid).length) onAnswer?.(response);
  };
  const set = (name: string, value: unknown) =>
    setValues((previous) => ({ ...previous, [name]: value }));
  const status =
    typeof block.resolution === "object"
      ? block.resolution.action === "accept"
        ? t.agents.inputAnswered
        : block.resolution.action === "cancel"
          ? t.agents.cancelled
          : t.agents.inputDeclined
      : block.confirmationUnknown
        ? t.agents.confirmationUnknown
        : block.resolution === "answering"
          ? t.agents.confirmingDecision
          : t.agents.inputRequired;
  const confirmed = typeof block.resolution === "object" ? block.resolution.content : undefined;
  return (
    <View style={[styles.card, { borderColor: tokens.border, backgroundColor: tokens.card }]}>
      <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{status}</Text>
      <Text selectable style={[typography.body, { color: tokens.foreground }]}>
        {block.message}
      </Text>
      {confirmed
        ? Object.entries(confirmed).map(([name, value]) => (
            <Text
              key={name}
              selectable
              style={{ color: tokens.mutedForeground }}
            >{`${fields?.find((field) => field.name === name)?.title ?? name}: ${Array.isArray(value) ? value.join(", ") : String(value)}`}</Text>
          ))
        : null}
      {!fields ? (
        <Text style={{ color: tokens.mutedForeground }}>{t.agents.unsupportedForm}</Text>
      ) : null}
      {fields && typeof block.resolution !== "object"
        ? fields.map((field) => {
            const label = `${field.title}${field.required ? " *" : ""}`;
            const value = block.confirmationUnknown
              ? block.submittedResponse?.content?.[field.name]
              : values[field.name];
            return (
              <View key={field.name} style={styles.field}>
                <Text style={[typography.small, { color: tokens.foreground }]}>{label}</Text>
                {field.description ? (
                  <Text style={{ color: tokens.mutedForeground }}>{field.description}</Text>
                ) : null}
                {field.options || field.type === "boolean" ? (
                  <View style={styles.options}>
                    {(
                      field.options ?? [
                        { value: "true", label: t.agents.yes },
                        { value: "false", label: t.agents.no },
                      ]
                    ).map((option) => {
                      const selected =
                        field.type === "array"
                          ? Array.isArray(value) && value.includes(option.value)
                          : field.type === "boolean"
                            ? value === (option.value === "true")
                            : value === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          accessibilityRole={field.type === "array" ? "checkbox" : "radio"}
                          accessibilityLabel={option.label}
                          accessibilityState={{ checked: selected, disabled: locked }}
                          disabled={locked}
                          style={[
                            styles.choice,
                            {
                              borderColor: tokens.border,
                              backgroundColor: selected ? tokens.primaryMuted : tokens.card,
                            },
                          ]}
                          onPress={() =>
                            set(
                              field.name,
                              field.type === "array"
                                ? selected
                                  ? (Array.isArray(value) ? value : []).filter(
                                      (item) => item !== option.value,
                                    )
                                  : [...(Array.isArray(value) ? value : []), option.value]
                                : field.type === "boolean"
                                  ? option.value === "true"
                                  : option.value,
                            )
                          }
                        >
                          <Text style={{ color: tokens.foreground }}>
                            {selected ? "✓ " : ""}
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput
                    accessibilityLabel={label}
                    editable={!locked}
                    value={value === undefined ? "" : String(value)}
                    keyboardType={
                      field.type === "number" || field.type === "integer" ? "numeric" : "default"
                    }
                    onChangeText={(text) =>
                      set(
                        field.name,
                        field.type === "number" || field.type === "integer"
                          ? text === ""
                            ? undefined
                            : Number(text)
                          : text,
                      )
                    }
                  />
                )}
                {errors[field.name] ? (
                  <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
                    {errors[field.name]}
                  </Text>
                ) : null}
              </View>
            );
          })
        : null}
      {block.error ? (
        <Text accessibilityRole="alert" style={{ color: tokens.destructive }}>
          {block.error}
        </Text>
      ) : null}
      {block.confirmationUnknown &&
      block.resolution === "pending" &&
      block.submittedResponse &&
      onAnswer ? (
        <Button
          label={t.agents.retryDecision}
          onPress={() => onAnswer(block.submittedResponse ?? { action: "cancel" })}
        />
      ) : null}
      {!locked && fields ? (
        <View style={styles.options}>
          <Button label={t.agents.sendAnswer} onPress={submit} />
          <Button
            label={t.agents.declineAnswer}
            variant="secondary"
            onPress={() => onAnswer?.({ action: "decline" })}
          />
          <Button
            label={t.agents.cancelAnswer}
            variant="ghost"
            onPress={() => onAnswer?.({ action: "cancel" })}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing[3],
    marginHorizontal: spacing[3],
    gap: spacing[2],
  },
  field: { gap: spacing[2] },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  choice: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing[3],
    justifyContent: "center",
  },
  preview: { height: 180, width: "100%" },
});
