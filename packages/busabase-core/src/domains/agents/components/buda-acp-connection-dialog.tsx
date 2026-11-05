"use client";

import { useMutation } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { useEffect, useId, useRef, useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { budaAcpCopy } from "../../../i18n/buda-acp-copy";
import { presentCoreError } from "../../../i18n/localize-error";
import { DialogContent } from "../../dashboard/components/localized-dialog-content";

interface BudaAcpConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orpc: BusabaseQueryUtils;
  spaceId?: string;
  onSaved: (slug: string) => void;
}

export function BudaAcpConnectionDialog({
  open,
  onOpenChange,
  orpc,
  spaceId,
  onSaved,
}: BudaAcpConnectionDialogProps) {
  const locale = useCoreLocale();
  const messages = useCoreI18n();
  const copy = budaAcpCopy(locale);
  const id = useId();
  const [endpoint, setEndpoint] = useState("wss://buda.im/api/acp");
  const [agentId, setAgentId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(0);
  const active = useRef({ open, spaceId });
  active.current = { open, spaceId };
  const connect = useMutation({
    ...orpc.agents.connections.connectBuda.mutationOptions(),
    // The mutation includes a secret. Reset on completion/close and discard
    // inactive cache entries immediately rather than retaining its variables.
    gcTime: 0,
  });
  const resetMutation = connect.reset;
  useEffect(() => {
    active.current = { open, spaceId };
    attempt.current += 1;
    setApiToken("");
    setAgentId("");
    setEndpoint("wss://buda.im/api/acp");
    setError(null);
    resetMutation();
    return () => {
      attempt.current += 1;
      active.current = { open: false, spaceId };
    };
  }, [open, spaceId, resetMutation]);

  const submit = async () => {
    if (connect.isPending) return;
    const request = ++attempt.current;
    const requestedSpace = spaceId;
    const isCurrent = () =>
      attempt.current === request &&
      active.current.open &&
      active.current.spaceId === requestedSpace;
    setError(null);
    try {
      const result = await connect.mutateAsync({ endpoint, agentId, apiToken });
      if (!isCurrent()) return;
      setApiToken("");
      onOpenChange(false);
      onSaved(result.slug);
    } catch (failure) {
      if (isCurrent())
        setError(presentCoreError(messages, locale, failure, messages.agents.budaConnectionFailed));
    } finally {
      if (attempt.current === request) resetMutation();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] min-w-0 max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{copy.action}</DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-endpoint`}>{copy.endpoint}</Label>
            <Input
              id={`${id}-endpoint`}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              disabled={connect.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-agent`}>{copy.agentId}</Label>
            <Input
              id={`${id}-agent`}
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              disabled={connect.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-token`}>{copy.token}</Label>
            <Input
              id={`${id}-token`}
              type="password"
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              disabled={connect.isPending}
            />
          </div>
          {error && (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              disabled={
                connect.isPending || !endpoint.trim() || !agentId.trim() || !apiToken.trim()
              }
            >
              {connect.isPending ? copy.connecting : copy.submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
