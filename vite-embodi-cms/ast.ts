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

export interface AstCollectionConfig<
  Loader extends LoaderConfig = LoaderConfig,
> {
  name: string;
  loader: Loader;
  hasSchema?: boolean;
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
        // TODO: Extract actual schema shape if needed
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
