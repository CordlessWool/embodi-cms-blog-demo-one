type JSONSchema = Record<string, unknown>;

export const simplifySchema = (schema: JSONSchema): JSONSchema => {
  if (!Object.hasOwn(schema, "$ref")) {
    return schema;
  }

  const { ["$ref"]: ref, ...schemaWithoutRef } = schema;
  const [_, ...chunks] = (ref as string).split("/");

  return chunks.reduce((acc, chunk) => {
    const element = acc[chunk] as JSONSchema;
    const rest = { ...acc };
    delete rest[chunk];
    return { ...rest, ...element };
  }, schemaWithoutRef);
};
