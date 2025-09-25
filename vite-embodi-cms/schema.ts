import type { ZodField } from "./ast";

type JSONSChemasObject = {
  $ref?: string;
  type: "object";
  properties: Record<string, JSONSchema>;
  required?: string[];
  [t: string]: unknown;
  // ... add what you need
};

type JSONSchema =
  | JSONSChemasObject
  | {
      type: "string";
      format?: string;
      pattern?: string;
    }
  | {
      type: "array";
      items?: JSONSchema;
      required?: string[];
      anyOf?: JSONSchema[];
      [t: string]: unknown;
      // ... add what you need
    };

export const resolveRef = (schema: JSONSChemasObject): JSONSchema => {
  const { ["$ref"]: ref, ...schemaWithoutRef } = schema;
  const [_, ...chunks] = (ref as string).split("/");

  return chunks.reduce((acc, chunk) => {
    const element = acc[chunk] as JSONSchema;
    const rest = { ...acc };
    delete rest[chunk];
    return { ...rest, ...element };
  }, schemaWithoutRef);
};

export const getDateTypes = (schemaFileds: ZodField[]): string[] => {
  return schemaFileds
    .filter((field) => field.type === "date")
    .map((field) => field.fieldName);
};

export const changeAtPath = <T extends Record<string, JSONSchema>>(
  schema: T,
  path: string[],
  value: unknown,
): T => {
  if (path.length === 1) {
    return { ...schema, [path[0]]: value };
  } else {
    const [first, ...rest] = path;
    if (schema[first].type !== "object") {
      throw new Error(`Path ${path.join(".")} not found`);
    }
    return {
      ...schema,
      [first]: changeAtPath(schema[first]!.properties, rest, value),
    };
  }
};

export const simplifyDateType = (
  schema: JSONSchema,
  dateFields: string[],
): JSONSchema => {
  return dateFields.reduce((acc, field) => {
    const path = field.split(".");
    const value = { type: "string", format: "date-time" };
    return {
      ...acc,
      properties: changeAtPath(acc.properties!, path, value),
    };
  }, schema);
};

export const simplifySchema = (
  schema: JSONSchema,
  schemaFields: ZodField[],
): JSONSchema => {
  if (!Object.hasOwn(schema, "$ref")) {
    return schema;
  }

  const schemaWithoutRef = resolveRef(schema);
  const dateFileds = getDateTypes(schemaFields);
  const simplifiedDateSchema = simplifyDateType(schemaWithoutRef, dateFileds);
  return simplifiedDateSchema;
};
