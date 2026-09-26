/**
 * `<AdminPanel src="/admin" />` for Vue 3, without depending on Vue.
 *
 *   import * as Vue from "vue";
 *   import { createAdminPanelVueComponent } from "@osqd/admin-panel-builder/vue";
 *   export const AdminPanel = createAdminPanelVueComponent(Vue);
 *
 * Tell Vue that `admin-panel` is a custom element (`compilerOptions.isCustomElement`) so it does not
 * try to resolve it as a component.
 */
import { defineAdminPanelElement } from "./element/index.js";

export interface VueLike {
  defineComponent(options: Record<string, unknown>): unknown;
  h(type: string, props: Record<string, unknown>): unknown;
  onMounted(hook: () => void): void;
}

export function createAdminPanelVueComponent(Vue: VueLike): unknown {
  return Vue.defineComponent({
    name: "AdminPanel",
    props: { src: { type: String, required: true }, scheme: { type: String, required: false }, group: { type: String, required: false }, compact: { type: Boolean, required: false } },
    setup(props: { src: string; scheme?: string; group?: string; compact?: boolean }) {
      Vue.onMounted(() => {
        defineAdminPanelElement();
      });
      return () => Vue.h("admin-panel", elementAttributes(props));
    },
  });
}

/** What `<admin-panel>` is given; a boolean attribute is present or absent, never "false". */
export function elementAttributes(props: { src: string; scheme?: string | undefined; group?: string | undefined; compact?: boolean | undefined }): Record<string, string> {
  const attributes: Record<string, string> = { src: props.src };
  if (props.scheme !== undefined) attributes.scheme = props.scheme;
  if (props.group !== undefined) attributes.group = props.group;
  if (props.compact === true) attributes.compact = "";
  return attributes;
}
