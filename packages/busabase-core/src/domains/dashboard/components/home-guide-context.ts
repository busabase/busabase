"use client";

import { createContext } from "react";

/**
 * Set by Home around the host-supplied `emptyGuide` element, which tells
 * `EmptyAgentGuide` it is Home's built-in Getting started card rather than an
 * empty-state filler on Inbox / Assets / Activity.
 *
 * A context rather than props because the host builds the element (it owns the
 * edition, language, create modal and Cloud's agent cue) while only Home knows
 * which audience it is for and how to dismiss it. Outside Home there is no
 * provider and the guide renders exactly as before.
 */
export interface HomeGuideMode {
  /**
   * `newSpace`: nothing exists yet — the guide replaces Home's empty sections
   * and keeps every way to fill the space. `member`: the space has content but
   * this member has not visited anything (an invited customer) — no template
   * CTA, since filling the space is not their job.
   */
  audience: "newSpace" | "member";
  /** Closes the card for this member; Home offers a button to reopen it. */
  onDismiss: () => void;
}

export const HomeGuideContext = createContext<HomeGuideMode | null>(null);
