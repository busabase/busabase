"use client";

import { Button } from "kui/button";
import { Input } from "kui/input";
import { ArrowUpCircle, Lock } from "lucide-react";
import { fmt, useCoreI18n } from "../../../i18n";
import {
  useAirAppEngineAvailability,
  useAirAppEnginePlanGate,
} from "../../airapp/components/engine-availability-context";

/** Where a Function step's code runs, and what a sandbox needs. */
export interface WorkflowFunctionRunInValue {
  runIn: "server" | "sandbox";
  language: "javascript" | "python";
  packages: string;
}

interface Props {
  value: WorkflowFunctionRunInValue;
  onChange: (patch: Partial<WorkflowFunctionRunInValue>) => void;
}

/**
 * "Run on": the app itself (fast, JavaScript, no packages) or a sandbox
 * machine (JavaScript or Python, packages, minutes). A sandbox is the same
 * machine an AirApp's remote engine uses, so it is offered exactly when that
 * engine is: available, locked by the space's plan (shown, with the way to
 * upgrade), or not configured on this server (shown, so a step saved elsewhere
 * explains itself instead of failing later).
 */
export function WorkflowFunctionRunIn({ value, onChange }: Props) {
  const messages = useCoreI18n();
  const copy = messages.richNodes;
  const available = useAirAppEngineAvailability().includes("remote");
  const planGate = useAirAppEnginePlanGate();
  const locked = Boolean(planGate?.lockedEngines.includes("remote"));
  const sandbox = value.runIn === "sandbox";
  return (
    <div className="grid gap-3" data-workflow-function-run-in="">
      <label className="grid gap-1.5 text-muted-foreground text-xs" htmlFor="rich-node-run-in">
        {copy.runIn}
        <select
          className="h-9 border border-input bg-card px-3 text-foreground text-sm"
          data-workflow-run-in=""
          id="rich-node-run-in"
          onChange={(event) =>
            onChange({ runIn: event.target.value === "sandbox" ? "sandbox" : "server" })
          }
          value={value.runIn}
        >
          <option value="server">{copy.runInServer}</option>
          {/* A step already set to sandbox keeps showing it, even where it cannot run. */}
          <option disabled={!available && !sandbox} value="sandbox">
            {copy.runInSandbox}
          </option>
        </select>
        <span className="text-[11px] leading-snug text-muted-foreground/80">
          {sandbox ? copy.runInSandboxHint : copy.runInServerHint}
        </span>
      </label>
      {!available && planGate && locked ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs"
          data-workflow-run-in-locked=""
        >
          <Lock aria-hidden="true" className="size-3" />
          <span>{fmt(copy.runInSandboxLocked, { plan: planGate.planLabel })}</span>
          {planGate.onUpgrade ? (
            <Button
              className="h-auto gap-1 p-0 text-xs"
              onClick={planGate.onUpgrade}
              type="button"
              variant="link"
            >
              <ArrowUpCircle className="size-3" />
              {fmt(messages.airapp.enginePlan.upgrade, { plan: planGate.planLabel })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!available && !locked ? (
        <p
          className="text-[11px] leading-snug text-muted-foreground/80"
          data-workflow-run-in-unavailable=""
        >
          {copy.runInSandboxNotConfigured}
        </p>
      ) : null}
      {sandbox ? (
        <>
          <label
            className="grid gap-1.5 text-muted-foreground text-xs"
            htmlFor="rich-node-sandbox-language"
          >
            {copy.sandboxLanguage}
            <select
              className="h-9 border border-input bg-card px-3 text-foreground text-sm"
              data-workflow-sandbox-language=""
              id="rich-node-sandbox-language"
              onChange={(event) =>
                onChange({ language: event.target.value === "python" ? "python" : "javascript" })
              }
              value={value.language}
            >
              <option value="javascript">{copy.sandboxLanguageJavascript}</option>
              <option value="python">{copy.sandboxLanguagePython}</option>
            </select>
          </label>
          <label
            className="grid gap-1.5 text-muted-foreground text-xs"
            htmlFor="rich-node-sandbox-packages"
          >
            {copy.sandboxPackages}
            <Input
              data-workflow-sandbox-packages=""
              id="rich-node-sandbox-packages"
              onChange={(event) => onChange({ packages: event.target.value })}
              placeholder={value.language === "python" ? "requests pycryptodome" : "dayjs lodash"}
              spellCheck={false}
              value={value.packages}
            />
            <span className="text-[11px] leading-snug text-muted-foreground/80">
              {value.language === "python"
                ? copy.sandboxPackagesHintPython
                : copy.sandboxPackagesHintJavascript}
            </span>
          </label>
        </>
      ) : null}
    </div>
  );
}
