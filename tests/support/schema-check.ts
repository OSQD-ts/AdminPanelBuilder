/**
 * The part of JSON Schema the OpenAPI document uses — type, enum, required, properties,
 * additionalProperties, items, oneOf and local $ref — checked by hand, so the suite needs no
 * validator. Returns every mismatch as "path: what", empty when the value fits.
 */
type Schema = Record<string, unknown>;

export function checkSchema(value: unknown, schema: Schema, root: Schema, path = "$"): string[] {
  if (typeof schema.$ref === "string") {
    const target = schema.$ref.replace(/^#\//, "").split("/").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], root);
    if (target === undefined) return [`${path}: $ref ${schema.$ref} names nothing`];
    return checkSchema(value, target as Schema, root, path);
  }
  if (Array.isArray(schema.oneOf)) {
    const fits = (schema.oneOf as Schema[]).filter((option) => checkSchema(value, option, root, path).length === 0);
    return fits.length === 1 ? [] : [`${path}: fits ${fits.length} of oneOf, not exactly one`];
  }
  const problems: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) problems.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  const type = schema.type;
  if (typeof type === "string") {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const fits = type === "integer" ? typeof value === "number" && Number.isInteger(value) : type === actual;
    if (!fits) return [...problems, `${path}: is ${actual}, the document says ${type}`];
  }
  if (typeof schema.minimum === "number" && typeof value === "number" && value < schema.minimum) problems.push(`${path}: ${value} is below ${schema.minimum}`);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!Object.hasOwn(record, key)) problems.push(`${path}: has no "${key}", which the document requires`);
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const [key, inner] of Object.entries(record)) {
      if (properties[key] !== undefined) problems.push(...checkSchema(inner, properties[key] as Schema, root, `${path}.${key}`));
      else if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === "object") problems.push(...checkSchema(inner, schema.additionalProperties as Schema, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}: has "${key}", which the document does not list`);
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) value.forEach((item, index) => problems.push(...checkSchema(item, schema.items as Schema, root, `${path}[${index}]`)));
  return problems;
}
