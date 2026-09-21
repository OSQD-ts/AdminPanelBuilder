/** The React and Vue wrappers, against doubles of the few functions they call. They are browser code, so they are loaded by URL. */
import { describe, expect, it } from "vitest";

interface ReactModule {
  createAdminPanelComponent(React: { createElement(type: string, props: Record<string, unknown> | null): unknown; useEffect(effect: () => unknown): void }): (props: Record<string, unknown>) => unknown;
}
interface VueModule {
  createAdminPanelVueComponent(Vue: { defineComponent(options: Record<string, unknown>): unknown; h(type: string, props: Record<string, unknown>): unknown; onMounted(hook: () => void): void }): unknown;
}
const react = (await import(new URL("../src/react.ts", import.meta.url).href)) as ReactModule;
const vue = (await import(new URL("../src/vue.ts", import.meta.url).href)) as VueModule;

describe("the React wrapper", () => {
  it("renders <admin-panel> with its attributes and defines the element in an effect", () => {
    const effects: Array<() => unknown> = [];
    const created: unknown[] = [];
    const Component = react.createAdminPanelComponent({
      createElement: (type, props) => {
        created.push({ type, props });
        return null;
      },
      useEffect: (effect) => void effects.push(effect),
    });
    Component({ src: "/admin", scheme: "dark", className: "wide" });
    expect(created).toEqual([{ type: "admin-panel", props: { src: "/admin", scheme: "dark", class: "wide" } }]);
    expect(() => effects[0]?.()).not.toThrow();
  });
});

describe("the Vue wrapper", () => {
  it("renders <admin-panel> from its props", () => {
    let options: Record<string, unknown> = {};
    vue.createAdminPanelVueComponent({ defineComponent: (given) => (options = given), h: (type, props) => ({ type, props }), onMounted: () => undefined });
    const render = (options.setup as (props: { src: string }) => () => unknown)({ src: "/admin" });
    expect(render()).toEqual({ type: "admin-panel", props: { src: "/admin" } });
  });
});
