"use client";

import { Label } from "kui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { fmt, useCoreI18n } from "../../../i18n";
import type { AirAppRunnerKind } from "./runners/types";

export const resolveAvailableAirAppRunnerKind = (
  selected: AirAppRunnerKind,
  availableEngines: readonly AirAppRunnerKind[],
): AirAppRunnerKind =>
  availableEngines.includes(selected) ? selected : (availableEngines[0] ?? "browser");

/** "Follow the app" — no override; `airapp.json` (or the default) decides. */
export const FOLLOW_APP = "__follow_app__" as const;

export type AirAppEngineChoice = AirAppRunnerKind | typeof FOLLOW_APP;

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
}

/** Controlled settings field. Its parent owns draft/save semantics so closing
 * the node settings dialog never commits a half-finished engine change. */
export function AirAppEngineSetting({
  availableEngines,
  disabled = false,
  onValueChange,
  value,
  appPreferred,
}: AirAppEngineSettingProps) {
  const messages = useCoreI18n();
  const engineLabel: Record<AirAppRunnerKind, string> = {
    browser: messages.airapp.engineBrowser,
    local: messages.airapp.engineLocal,
    remote: messages.airapp.engineRemote,
  };
  const engineHint: Record<AirAppRunnerKind, string> = {
    browser: messages.airapp.engineBrowserHint,
    local: messages.airapp.engineLocalHint,
    remote: messages.airapp.engineRemoteHint,
  };

  // Rendered even with one engine, unlike before. The control is no longer only
  // a choice — it is also the only place that says whether this node follows its
  // `airapp.json` or overrides it, and that is worth showing even when there is
  // nothing to switch to.
  const followLabel = appPreferred
    ? fmt(messages.airapp.engineFollowAppNamed, { engine: engineLabel[appPreferred] })
    : messages.airapp.engineFollowApp;

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
          {availableEngines.map((engine) => (
            <SelectItem key={engine} value={engine}>
              {engineLabel[engine]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        {value === FOLLOW_APP ? messages.airapp.engineFollowAppHint : engineHint[value]}
      </p>
    </div>
  );
}
