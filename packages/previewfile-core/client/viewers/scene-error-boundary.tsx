"use client";

import { Component, type ReactNode } from "react";

interface SceneErrorBoundaryProps {
  /** Told what went wrong, to show it in the viewer's own error state. */
  onError: (error: Error) => void;
  children: ReactNode;
}

/**
 * Keeps a failure inside a 3D scene from taking the host's whole page down
 * with it: whatever throws while the scene renders — a texture that cannot be
 * loaded, a model the renderer chokes on — is handed to `onError`, and the
 * viewer shows it the way it shows any other load error. (React has no hook for
 * this: an error boundary has to be a class.)
 *
 * Renders nothing once it has caught one: the viewer replaces the scene with
 * its error state, which unmounts this, so a retry starts a fresh boundary.
 */
export class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error : new Error(String(error)));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
