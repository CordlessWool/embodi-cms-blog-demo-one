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

const followThePathToLeaf = (
  schema: JSONSChemasObject,
  path: string,
): JSONSchema => {
  return path.split(".").reduce((acc, key) => {
    if (!acc.properties || !acc.properties[key]) {
      throw new Error(`Path ${path} not found`);
    }
    return acc.properties[key];
  }, schema);
};

export const getObjectTypes = (schemaFileds: ZodField[]): string[] => {
  return schemaFileds
    .filter((field) => field.fieldName.includes("."))
    .map((field) => field.fieldName);
};

export const flatSchema = (
  schema: JSONSChemasObject,
  objectFields: string[],
): JSONSchema => {
  const objectOriginMap = objectFields.map((field) => {
    const [key, ...rest] = field.split(".");
    return [key, rest.join(".")];
  });
  const futureSchema = Object.entries(schema.properties).filter(
    ([key, value]) => value.type !== "object",
  );
  for (const [key, path] of objectOriginMap) {
    futureSchema.push([
      `${key}.${path}`,
      followThePathToLeaf(schema.properties[key] as JSONSChemasObject, path),
    ]);
  }

  return {
    ...schema,
    properties: Object.fromEntries(futureSchema),
  };
};

export const simplifySchema = (
  schema: JSONSchema,
  schemaFields: ZodField[],
): JSONSchema => {
  if (!Object.hasOwn(schema, "$ref")) {
    return schema;
  }

  const schemaWithoutRef = resolveRef(schema);
  const dateFields = getDateTypes(schemaFields);
  const simplifedDataTypes = simplifyDateType(schemaWithoutRef, dateFields);
  const objectFields = getObjectTypes(schemaFields);
  const flatDataSchema = flatSchema(simplifedDataTypes, objectFields);
  return flatDataSchema;
};
