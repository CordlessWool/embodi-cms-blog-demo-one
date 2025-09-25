import type { AstCollectionConfig, GlobLoaderConfig } from "./ast";
import fs from "fs/promises";
import { simplifySchema } from "./schema";

export type CmsCollection = {
  name: string;
  displayName: string;
  loader: {
    type: "glob";
    pattern: string;
    base: string;
  };
  formats: string[];
  schema: string;
};

export type CmsConfig = {
  collections: CmsCollection[];
  updatedAt: number;
};

const camelToReadable = (str: string) => {
  return str
    .replace(/([a-z])([A-Z])/g, "$1 $2") // Add space between lowercase and uppercase
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2") // Handle consecutive capitals
    .replace(/^./, (str) => str.toUpperCase());
};

const extractFormats = (pattern: string) => {
  // Handle {ext1,ext2,ext3} format
  const bracketMatch = pattern.match(/\{([^}]+)\}/);
  if (bracketMatch) {
    return bracketMatch[1]
      .split(",")
      .map((ext) => ext.trim())
      .filter((ext) => ext.length > 0);
  }

  // Handle single .ext format
  const singleMatch = pattern.match(/\.(\w+)(?:\s|$)/);
  if (singleMatch) {
    return [singleMatch[1]];
  }

  return [];
};

const loadSchema = async (collectionName: string, rootPath: string) => {
  const content = await fs.readFile(
    `${rootPath}/.astro/collections/${collectionName}.schema.json`,
    "utf-8",
  );
  return JSON.parse(content);
};

export const generateConfig = async (
  astCollections: AstCollectionConfig[],
  projectParams: { root: string },
): Promise<CmsConfig> => {
  const globAstCollections = astCollections.filter(
    (collection) => collection.loader.type === "glob",
  ) as AstCollectionConfig<GlobLoaderConfig>[];
  const collections = await Promise.all(
    globAstCollections.map(async (collection) => {
      const schema = await loadSchema(collection.name, projectParams.root);
      const simpleSchema = simplifySchema(schema);
      return {
        name: collection.name,
        displayName: camelToReadable(collection.name),
        loader: {
          type: collection.loader.type,
          pattern: collection.loader.pattern,
          base: collection.loader.base,
        },
        formats: extractFormats(collection.loader.pattern),
        schema: simpleSchema,
      };
    }),
  );
  return {
    collections,
    updatedAt: Date.now(),
  };
};
