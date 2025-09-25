import type { Program } from "estree";

export type GlobLoaderConfig = {
  type: "glob";
  pattern: string;
  base: string;
};

export type FileLoaderConfig = {
  type: "file";
  path: string;
};

export type LoaderConfig = GlobLoaderConfig | FileLoaderConfig;

export type ZodField = {
  fieldName: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "image"
    | "array"
    | "object"
    | "unknown";
  isOptional?: boolean;
  arrayElementType?: string; // simplified to just the type name
};

export type SchemaFields = ZodField[];

export interface AstCollectionConfig<
  Loader extends LoaderConfig = LoaderConfig,
> {
  name: string;
  loader: Loader;
  hasSchema?: boolean;
  schemaFields?: SchemaFields;
}

export function extractFromAST(ast: Program): AstCollectionConfig[] {
  // First pass: collect all defineCollection variables
  const definitions = new Map();

  walkAST(ast, (node, parent) => {
    if (isDefineCollection(node, parent)) {
      const varName = parent.id.name;
      const config = parseCollectionConfig(node.arguments[0]);
      if (config) definitions.set(varName, config);
    }
  });

  // Second pass: find the export mapping
  const collections: AstCollectionConfig[] = [];

  walkAST(ast, (node) => {
    if (isCollectionsExport(node)) {
      const mapping = extractExportMapping(node);

      // Map exported names to their configs
      Object.entries(mapping).forEach(([exportedName, varName]) => {
        if (definitions.has(varName)) {
          collections.push({ ...definitions.get(varName), name: exportedName });
        }
      });
    }
  });

  // If no export mapping found, use the definitions directly
  return collections;
}

function isCollectionsExport(node) {
  // export const collections = { ... }
  return (
    node.type === "ExportNamedDeclaration" &&
    node.declaration?.type === "VariableDeclaration" &&
    node.declaration.declarations?.[0]?.id?.name === "collections"
  );
}

function extractExportMapping(node) {
  const mapping = {};
  const collectionsObj = node.declaration.declarations[0].init;

  if (collectionsObj?.type === "ObjectExpression") {
    collectionsObj.properties.forEach((prop) => {
      // blogs: blogsCollection
      const exportName = prop.key.name || prop.key.value;
      const varName = prop.value.name; // The identifier being referenced

      if (exportName && varName) {
        mapping[exportName] = varName;
      }
    });
  }

  return mapping;
}

function walkAST(node, callback, parent = null) {
  if (!node || typeof node !== "object") return;

  callback(node, parent);

  Object.entries(node).forEach(([key, value]) => {
    if (key === "parent") return; // Skip circular references

    if (Array.isArray(value)) {
      value.forEach((child) => walkAST(child, callback, node));
    } else {
      walkAST(value, callback, node);
    }
  });
}

function isDefineCollection(node, parent) {
  return (
    node.type === "CallExpression" &&
    node.callee?.name === "defineCollection" &&
    parent?.type === "VariableDeclarator"
  );
}

function parseCollectionConfig(node) {
  if (node?.type !== "ObjectExpression") return null;

  const config = {};

  node.properties.forEach((prop) => {
    switch (prop.key.name) {
      case "loader":
        config.loader = parseLoader(prop.value);
        break;
      case "schema":
        config.hasSchema = true;
        config.schemaFields = parseZodSchema(prop.value);
        break;
    }
  });

  return config;
}

function parseLoader(node) {
  if (node.type !== "CallExpression") return null;

  const loader = {
    type: node.callee.name, // 'glob' or 'file'
  };

  const arg = node.arguments[0];
  if (arg?.type !== "ObjectExpression") return loader;

  arg.properties.forEach((prop) => {
    const value = extractValue(prop.value);
    if (value !== undefined) {
      loader[prop.key.name] = value;
    }
  });

  return loader;
}

function extractValue(node) {
  switch (node.type) {
    case "Literal":
      return node.value;
    case "TemplateLiteral":
      // Simple template literal handling
      return node.quasis.map((q) => q.value.raw).join("${...}");
    default:
      return undefined;
  }
}

function parseZodSchema(schemaNode): SchemaFields | null {
  // Handle schema: ({ image }) => z.object({...})
  if (schemaNode.type === "ArrowFunctionExpression") {
    const body = schemaNode.body;

    // Look for z.object() call
    if (isZodObjectCall(body)) {
      return parseZodObjectFields(body.arguments[0]);
    }
  }

  // Handle direct z.object({...}) call
  if (isZodObjectCall(schemaNode)) {
    return parseZodObjectFields(schemaNode.arguments[0]);
  }

  return null;
}

function parseZodObjectFields(objectNode, prefix = ""): SchemaFields {
  const fields: SchemaFields = [];

  if (objectNode?.type !== "ObjectExpression") return fields;

  objectNode.properties.forEach((prop) => {
    if (prop.type === "Property") {
      const fieldName = prop.key.name || prop.key.value;
      const fullFieldName = prefix ? `${prefix}.${fieldName}` : fieldName;

      flattenZodField(prop.value, fullFieldName, fields);
    }
  });

  return fields;
}

function flattenZodField(node, fieldName: string, fields: SchemaFields): void {
  const fieldType = analyzeZodType(node);

  if (!fieldType) return;

  // If it's an object, only add the nested fields (skip the object container itself)
  if (fieldType.type === "object" && fieldType.objectFields) {
    const nestedFields = parseZodObjectFields(
      fieldType.objectFields,
      fieldName,
    );
    fields.push(...nestedFields);
  } else {
    // Add non-object fields
    fields.push({
      fieldName,
      type: fieldType.type,
      isOptional: fieldType.isOptional,
      arrayElementType: fieldType.arrayElementType,
    });
  }
}

type AnalyzedZodType = {
  type:
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "image"
    | "array"
    | "object"
    | "unknown";
  isOptional?: boolean;
  arrayElementType?: string;
  objectFields?: any; // Will contain the AST node for objects
};

function analyzeZodType(node): AnalyzedZodType | null {
  if (!node) return null;

  // Handle chained calls like z.string().optional()
  if (node.type === "CallExpression") {
    const baseType = analyzeZodType(node.callee);

    // Check for .optional() call
    if (
      node.callee?.type === "MemberExpression" &&
      node.callee.property?.name === "optional"
    ) {
      return {
        ...baseType,
        isOptional: true,
      };
    }

    // Direct zod type calls
    if (
      node.callee?.type === "MemberExpression" &&
      node.callee.object?.name === "z"
    ) {
      const zodMethod = node.callee.property?.name;

      switch (zodMethod) {
        case "string":
          return { type: "string" };
        case "number":
          return { type: "number" };
        case "boolean":
          return { type: "boolean" };
        case "date":
          return { type: "date" };
        case "array":
          const elementType = node.arguments[0]
            ? analyzeZodType(node.arguments[0])
            : null;
          return {
            type: "array",
            arrayElementType: elementType?.type || "unknown",
          };
        case "object":
          return {
            type: "object",
            objectFields: node.arguments[0], // Pass the AST node for recursive processing
          };
      }
    }

    // Handle image() function call - this comes from the schema function parameter
    if (node.callee?.name === "image") {
      return { type: "image" };
    }
  }

  // Handle member expressions for chained calls
  if (node.type === "MemberExpression") {
    return analyzeZodType(node.object);
  }

  return { type: "unknown" };
}

function isZodObjectCall(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.name === "z" &&
    node.callee.property?.name === "object"
  );
}
