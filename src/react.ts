/**
 * `<AdminPanel src="/admin" />` for React, without depending on React.
 *
 *   import * as React from "react";
 *   import { createAdminPanelComponent } from "@osqd/admin-panel-builder/react";
 *   export const AdminPanel = createAdminPanelComponent(React);
 *
 * You hand in your React; this package imports none, so there is never a second copy of it or a
 * version to disagree about. The component renders `<admin-panel>` and defines the element on first
 * mount, so it is safe during a server render.
 */
import { defineAdminPanelElement } from "./element/index.js";

/** The parts of React the component uses. */
export interface ReactLike {
  createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useEffect(effect: () => undefined | (() => void), deps?: readonly unknown[]): void;
}

export interface AdminPanelProps {
  /** Where `panel.handler()` is mounted. */
  src: string;
  scheme?: "light" | "dark" | undefined;
  /** One group only, by title or id. */
  group?: string | undefined;
  /** Only the cards: no heading, tabs or Activity. */
  compact?: boolean | undefined;
  className?: string | undefined;
}

export function createAdminPanelComponent(React: ReactLike): (props: AdminPanelProps) => unknown {
  return function AdminPanel(props: AdminPanelProps) {
    React.useEffect(() => {
      defineAdminPanelElement();
      return undefined;
    }, []);
    const attributes: Record<string, unknown> = { src: props.src };
    if (props.scheme !== undefined) attributes.scheme = props.scheme;
    if (props.group !== undefined) attributes.group = props.group;
    // A boolean attribute is present or absent; React would write compact="false", which still counts.
    if (props.compact === true) attributes.compact = "";
    if (props.className !== undefined) attributes.class = props.className;
    return React.createElement("admin-panel", attributes);
  };
}
