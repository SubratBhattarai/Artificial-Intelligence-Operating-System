import type { ReactElement } from 'react';

/** Props every built-in app receives from the shell. */
export interface ShellAppProps {
  /** Stable id of the hosting window (apps are sandboxed to their window). */
  windowId: string;
  appId: string;
  /** True while this window is focused — apps may highlight or pause work accordingly. */
  active: boolean;
}

/**
 * The window contract: any built-in app is just metadata + one component.
 * The shell owns placement, z-order, persistence and chrome; apps own their content area.
 */
export interface ShellApp {
  id: string;
  title: string;
  description: string;
  icon: ReactElement;
  defaultSize: { width: number; height: number };
  minSize?: { width: number; height: number };
  /** Focus an existing window instead of opening a second one (default: true). */
  singleton?: boolean;
  /** Open on first launch when no saved layout exists. */
  defaultOpen?: boolean;
  Component: (props: ShellAppProps) => ReactElement;
}
