"use client";

import { Button } from "kui/button";
import { Label } from "kui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "kui/select";
import { ArrowUpCircle, Lock } from "lucide-react";
import { fmt, useCoreI18n } from "../../../i18n";
import type { ResolvedAirAppEnginePlanGate } from "./engine-availability-context";
import type { AirAppRunnerKind } from "./runners/types";

export const resolveAvailableAirAppRunnerKind = (
  selected: AirAppRunnerKind,
  availableEngines: readonly AirAppRunnerKind[],
): AirAppRunnerKind =>
  availableEngines.includes(selected) ? selected : (availableEngines[0] ?? "browser");

/** "Follow the app" — no override; `airapp.json` (or the default) decides. */
export const FOLLOW_APP = "__follow_app__" as const;

export type AirAppEngineChoice = AirAppRunnerKind | typeof FOLLOW_APP;

/** Which engine this field currently means, once "follow the app" is resolved. */
export const resolveEffectiveEngineChoice = (
  choice: AirAppEngineChoice,
  appPreferred?: AirAppRunnerKind,
  appRequired?: AirAppRunnerKind,
): AirAppRunnerKind | null =>
  appRequired ?? (choice === FOLLOW_APP ? (appPreferred ?? null) : choice);

interface AirAppEngineSettingProps {
  availableEngines: readonly AirAppRunnerKind[];
  disabled?: boolean;
  onValueChange: (value: AirAppEngineChoice) => void;
  value: AirAppEngineChoice;
  /**
   * What the app itself asks for, from its `airapp.json`.
   *
   * Shown so "follow the app" names a concrete engine instead of being a
   * mystery. Without it the dialog could only say "follow the app" while the
   * file said `remote` — which is the shape of the bug this control was
   * introduced to end, one level up.
   */
  appPreferred?: AirAppRunnerKind;
  appRequired?: AirAppRunnerKind;
  /**
   * The host's plan gate (Busabase Cloud). Its locked engines are listed but
   * disabled, with the plan that unlocks them — never silently dropped, or a
   * person could not tell "this deployment has no remote machines" from "this
   * space's plan doesn't include them".
   */
  planGate?: ResolvedAirAppEnginePlanGate | null;
  /**
   * Engines an operator could turn on by configuring this deployment. Listed but
   * disabled with that reason, the same way locked engines are, so a person can
   * tell "ask an administrator" from "this doesn't exist". An engine this
   * deployment can never offer is simply not passed, and stays hidden.
   */
  notConfiguredEngines?: readonly AirAppRunnerKind[];
}

function AirAppEngineUpgradeHint({
  engineName,
  planGate,
}: {
  engineName: string;
  planGate: ResolvedAirAppEnginePlanGate;
}) {
  const messages = useCoreI18n();
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs"
      data-airapp-engine-locked-hint
    >
      <Lock aria-hidden="true" className="size-3" />
      <span>
        {fmt(messages.airapp.enginePlan.lockedHint, {
          engine: engineName,
          plan: planGate.planLabel,
        })}
      </span>
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
  );
}

interface EngineRow {
  engine: AirAppRunnerKind;
  /** The plan that unlocks this engine, when only the space's plan stands in the way. */
  lockedOn?: string;
  notConfigured?: boolean;
}

/** Controlled settings field. Its parent owns draft/save semantics so closing
 * the node settings dialog never commits a half-finished engine change. */
export function AirAppEngineSetting({
  availableEngines,
  disabled = false,
  onValueChange,
  value,
  appPreferred,
  appRequired,
  planGate,
  notConfiguredEngines = [],
}: AirAppEngineSettingProps) {
  const messages = useCoreI18n();
  const engineLabel: Record<AirAppRunnerKind, string> = {
    browser: messages.airapp.engineBrowser,
    local: messages.airapp.engineLocal,
    remote: messages.airapp.engineRemote,
    site: messages.airapp.engineSite,
  };
  const engineHint: Record<AirAppRunnerKind, string> = {
    browser: messages.airapp.engineBrowserHint,
    local: messages.airapp.engineLocalHint,
    remote: messages.airapp.engineRemoteHint,
    site: messages.airapp.engineSiteHint,
  };

  // Rendered even with one engine, unlike before. The control is no longer only
  // a choice — it is also the only place that says whether this node follows its
  // `airapp.json` or overrides it, and that is worth showing even when there is
  // nothing to switch to.
  const followLabel = appPreferred
    ? fmt(messages.airapp.engineFollowAppNamed, { engine: engineLabel[appPreferred] })
    : messages.airapp.engineFollowApp;

  const lockedEngines = planGate?.lockedEngines ?? [];
  const engineRows: EngineRow[] = [
    ...availableEngines.map((engine) => ({ engine })),
    ...(planGate
      ? lockedEngines.map((engine) => ({
          engine,
          lockedOn: planGate.planLabel,
        }))
      : []),
    ...notConfiguredEngines.map((engine) => ({ engine, notConfigured: true })),
  ];
  const siteRows = engineRows.filter((row) => row.engine === "site");
  const renderRows = (rows: EngineRow[]) =>
    rows.map(({ engine, lockedOn, notConfigured }) => {
      const reason = lockedOn
        ? fmt(messages.airapp.enginePlan.availableOn, { plan: lockedOn })
        : notConfigured
          ? messages.airapp.engineNotConfigured
          : null;
      return (
        <SelectItem
          data-airapp-engine-locked={lockedOn ? engine : undefined}
          data-airapp-engine-not-configured={notConfigured ? engine : undefined}
          disabled={Boolean(reason)}
          key={engine}
          value={engine}
        >
          {reason ? `${engineLabel[engine]} · ${reason}` : engineLabel[engine]}
        </SelectItem>
      );
    });

  if (appRequired) {
    const requirementAvailable = availableEngines.includes(appRequired);
    const requirementLocked = !requirementAvailable && lockedEngines.includes(appRequired);
    return (
      <div className="space-y-2" data-airapp-engine-required data-airapp-engine-setting>
        <Label>{messages.airapp.engineLabel}</Label>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          {fmt(messages.airapp.engineRequired, { engine: engineLabel[appRequired] })}
        </div>
        {requirementLocked && planGate ? (
          <AirAppEngineUpgradeHint engineName={engineLabel[appRequired]} planGate={planGate} />
        ) : (
          <p className="text-muted-foreground text-xs">
            {requirementAvailable
              ? messages.airapp.engineRequiredHint
              : messages.airapp.requiredEngineUnavailable[appRequired]}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-airapp-engine-setting>
      <Label htmlFor="node-settings-airapp-engine">{messages.airapp.engineLabel}</Label>
      <Select
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as AirAppRunnerKind)}
        value={value}
      >
        <SelectTrigger className="w-full" id="node-settings-airapp-engine">
          <SelectValue>{value === FOLLOW_APP ? followLabel : engineLabel[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FOLLOW_APP}>{followLabel}</SelectItem>
          {renderRows(engineRows.filter((row) => row.engine !== "site"))}
          {/* A website is a deployment, not a run: set apart so it does not read
              as one more place to run the same thing. */}
          {siteRows.length > 0 ? <SelectSeparator /> : null}
          {renderRows(siteRows)}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        {value === FOLLOW_APP ? messages.airapp.engineFollowAppHint : engineHint[value]}
      </p>
      {planGate
        ? lockedEngines.map((engine) => (
            <AirAppEngineUpgradeHint
              engineName={engineLabel[engine]}
              key={engine}
              planGate={planGate}
            />
          ))
        : null}
    </div>
  );
}
