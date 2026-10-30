"use client";

import type { AcpInputBlock, AcpInputResponse } from "@acp-ui/core/reduce";
import { parseAcpInputFields, validateAcpInputResponse } from "@acp-ui/core/reduce";
import { Button } from "kui/button";
import { useId, useState } from "react";

export interface AcpInputLabels {
  waiting: string;
  submit: string;
  sending: string;
  decline: string;
  cancel: string;
  answered: string;
  declined: string;
  cancelled: string;
  unsupported: string;
  choose: string;
  confirmationUnknown: string;
  retry: string;
}
const defaults: AcpInputLabels = {
  waiting: "Your answer is needed",
  submit: "Send answer",
  sending: "Sending…",
  decline: "Decline",
  cancel: "Cancel",
  answered: "Answered",
  declined: "Declined",
  cancelled: "Cancelled",
  unsupported: "This client cannot answer this request.",
  choose: "Choose an option",
  confirmationUnknown: "Delivery could not be confirmed. Retry the same answer.",
  retry: "Retry the same answer",
};

export function AcpInputView({
  block,
  onAnswer,
  labels: supplied,
}: {
  block: AcpInputBlock;
  onAnswer?: (response: AcpInputResponse) => void;
  labels?: Partial<AcpInputLabels>;
}) {
  const labels = { ...defaults, ...supplied };
  const fields = parseAcpInputFields(block.requestedSchema);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...Object.fromEntries(
      (fields ?? []).flatMap((field) =>
        field.defaultValue !== undefined
          ? [[field.name, field.defaultValue]]
          : field.type === "boolean"
            ? [[field.name, false]]
            : field.type === "array"
              ? [[field.name, []]]
              : [],
      ),
    ),
    ...(block.submittedResponse?.content ?? {}),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const prefix = useId();
  const answering = block.resolution === "answering";
  const resolved = typeof block.resolution === "object" ? block.resolution : null;
  const disabled =
    answering || Boolean(resolved) || !onAnswer || Boolean(block.confirmationUnknown);
  const update = (name: string, value: unknown) =>
    setValues((previous) => ({ ...previous, [name]: value }));
  const submit = () => {
    const content = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined && value !== ""),
    );
    const response: AcpInputResponse = { action: "accept", content };
    const validation = validateAcpInputResponse(block.requestedSchema, response);
    setErrors(validation);
    if (Object.keys(validation).length === 0) onAnswer?.(response);
  };
  return (
    <section
      className="my-3 min-w-0 rounded-lg border bg-muted/20 p-3"
      data-testid="acp-input-request"
      aria-busy={answering}
    >
      <p className="mb-1 font-medium text-sm">
        {resolved
          ? resolved.action === "accept"
            ? labels.answered
            : resolved.action === "decline"
              ? labels.declined
              : labels.cancelled
          : labels.waiting}
      </p>
      <p className="mb-3 whitespace-pre-wrap break-words text-sm">{block.message}</p>
      {resolved ? (
        <dl className="space-y-1 text-sm">
          {Object.entries(resolved.content ?? {}).map(([name, value]) => (
            <div key={name}>
              <dt className="font-medium">
                {fields?.find((field) => field.name === name)?.title ?? name}
              </dt>
              <dd className="break-words text-muted-foreground">
                {Array.isArray(value) ? value.join(", ") : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : fields && onAnswer ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-3"
        >
          {fields.map((field) => {
            const id = `${prefix}-${field.name}`;
            const error = errors[field.name];
            const common = {
              id,
              disabled,
              "aria-invalid": Boolean(error),
              "aria-describedby": error ? `${id}-error` : undefined,
            };
            return (
              <div key={field.name} className="space-y-1">
                <label className="block font-medium text-sm" htmlFor={id}>
                  {field.title}
                  {field.required ? " *" : ""}
                </label>
                {field.description ? (
                  <p className="text-muted-foreground text-xs">{field.description}</p>
                ) : null}
                {field.type === "array" ? (
                  <fieldset disabled={disabled} className="space-y-1" aria-label={field.title}>
                    {field.options?.map((option) => (
                      <label key={option.value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={
                            Array.isArray(values[field.name]) &&
                            (values[field.name] as string[]).includes(option.value)
                          }
                          onChange={(event) => {
                            const current = Array.isArray(values[field.name])
                              ? (values[field.name] as string[])
                              : [];
                            update(
                              field.name,
                              event.target.checked
                                ? [...current, option.value]
                                : current.filter((item) => item !== option.value),
                            );
                          }}
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>
                ) : field.type === "boolean" ? (
                  <input
                    {...common}
                    type="checkbox"
                    checked={values[field.name] === true}
                    onChange={(event) => update(field.name, event.target.checked)}
                  />
                ) : field.options ? (
                  <select
                    {...common}
                    className="w-full rounded border bg-background p-2 text-sm"
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => update(field.name, event.target.value)}
                  >
                    <option value="">{labels.choose}</option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    className="w-full rounded border bg-background p-2 text-sm"
                    type={field.type === "number" || field.type === "integer" ? "number" : "text"}
                    step={field.type === "integer" ? 1 : "any"}
                    value={
                      typeof values[field.name] === "number" ||
                      typeof values[field.name] === "string"
                        ? (values[field.name] as string | number)
                        : ""
                    }
                    onChange={(event) =>
                      update(
                        field.name,
                        field.type === "string" || event.target.value === ""
                          ? event.target.value
                          : event.target.valueAsNumber,
                      )
                    }
                  />
                )}
                {error ? (
                  <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
          {block.confirmationUnknown ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm" role="status">
                {labels.confirmationUnknown}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={!block.submittedResponse}
                onClick={() => {
                  if (block.submittedResponse) onAnswer(block.submittedResponse);
                }}
              >
                {labels.retry}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={disabled}>
                {answering ? labels.sending : labels.submit}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onAnswer({ action: "decline" })}
              >
                {labels.decline}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => onAnswer({ action: "cancel" })}
              >
                {labels.cancel}
              </Button>
            </div>
          )}
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">{labels.unsupported}</p>
      )}
      {block.error ? (
        <p role="alert" className="mt-2 text-destructive text-sm">
          {block.error}
        </p>
      ) : null}
    </section>
  );
}
