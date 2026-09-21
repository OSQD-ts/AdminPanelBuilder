/**
 * The fields an action asks for, checked the way modifiable values are.
 *
 * An input field is a modifiable value that exists for one request: the same kinds, the same
 * constraints, the same sentences when it is refused, so an operator filling in "ban player" gets
 * the answer they would get setting a value.
 */
import { AdminPanelConfigError, ValueError } from "../errors.js";
import { rejectUnknown } from "../internal/options.js";
import type { InputField, InputSchema, JsonValue } from "../types.js";
import { checkValue, inferKind, resolveConstraints, statelessPattern, toJson } from "./kinds.js";

const FIELD_KEYS = ["label", "description", "kind", "min", "max", "step", "integer", "options", "maxLength", "pattern", "multiline", "optional", "default"];
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export interface ResolvedField {
  schema: InputSchema;
  pattern: RegExp | undefined;
}

export function resolveInput(action: string, fields: Readonly<Record<string, InputField>>): ResolvedField[] {
  const resolved: ResolvedField[] = [];
  for (const [name, field] of Object.entries(fields)) {
    if (!NAME.test(name)) throw new AdminPanelConfigError(`action "${action}" has an input named ${JSON.stringify(name)}; a name is letters, digits and underscores, starting with a letter`);
    rejectUnknown(field, FIELD_KEYS, `action "${action}", input "${name}"`);
    const label = field.label ?? name;
    // Without a kind, the default decides, and a field with neither is text: what a person types.
    const kind = inferKind(field.default ?? "", { kind: field.kind, options: field.options });
    const constraints = resolveConstraints(label, kind, field as never);
    const pattern = field.pattern === undefined ? undefined : statelessPattern(field.pattern);
    const schema: InputSchema = { name, label, kind, constraints, optional: field.optional === true };
    if (field.description !== undefined) schema.description = field.description;
    if (field.default !== undefined) {
      try {
        checkValue(label, kind, constraints, field.default, pattern);
      } catch (error) {
        throw new AdminPanelConfigError(`action "${action}", input "${name}" defaults to ${JSON.stringify(field.default)}, which the field refuses: ${(error as Error).message}`);
      }
      schema.default = toJson(field.default);
    }
    resolved.push({ schema, pattern });
  }
  return resolved;
}

/** The operator's answers, checked. Unknown names and missing required fields are refused by name. */
export function checkInput(fields: readonly ResolvedField[], raw: unknown): Record<string, JsonValue> {
  const given = raw === undefined || raw === null ? {} : raw;
  if (typeof given !== "object" || Array.isArray(given)) throw new ValueError("the input must be an object of field values");
  const known = new Set(fields.map((field) => field.schema.name));
  for (const name of Object.keys(given)) if (!known.has(name)) throw new ValueError(`there is no input field "${name}"`);
  const out: Record<string, JsonValue> = {};
  for (const { schema, pattern } of fields) {
    const value = (given as Record<string, unknown>)[schema.name];
    if (value === undefined || value === null || value === "") {
      if (!schema.optional) throw new ValueError(`${schema.label} is required`);
      continue;
    }
    checkValue(schema.label, schema.kind, schema.constraints, value, pattern);
    out[schema.name] = toJson(value);
  }
  return out;
}
