"use client";

import { createContext, useContext } from "react";
import type { WorkflowRunStepState } from "../utils/run-view";

const EMPTY_RUN_HIGHLIGHT: ReadonlyMap<string, WorkflowRunStepState> = new Map();

/**
 * Per-step state of the run selected in the Runs panel, read by the canvas
 * step nodes. Lives in context, not in React Flow node data: node data is what
 * gets saved as `graph.json`, and run state must never be persisted with it.
 */
export const WorkflowRunHighlightContext =
  createContext<ReadonlyMap<string, WorkflowRunStepState>>(EMPTY_RUN_HIGHLIGHT);

export const useWorkflowRunStepState = (stepId: string): WorkflowRunStepState | null =>
  useContext(WorkflowRunHighlightContext).get(stepId) ?? null;
