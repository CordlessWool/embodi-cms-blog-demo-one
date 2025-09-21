import { type Plugin } from "vite";
import { extractFromAST } from "./ast";
import fs from "fs/promises";
import { generateConfig } from "./config";
import { dirname } from "path";

export default (): Plugin[] => {
  let root: string;
  return [
    {
      name: "vite-astro-ast-analyses",
      configResolved(config) {
        root = config.root;
      },
      async buildEnd() {
        const resolved = await this.resolve("./src/content.config.js");
        if (!resolved) {
          throw new Error("content.config.js not found");
        }

        const loaded = await this.load({ id: resolved.id });

        if (!loaded || !loaded.ast) {
          throw new Error("content.config.js could not loaded");
        }

        const astCollectionConfig = extractFromAST(loaded.ast);
        const config = await generateConfig(astCollectionConfig, { root });

        const configPath = `${root}/.embodi/cms/config.json`;
        await fs.mkdir(dirname(configPath), { recursive: true });
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      },
    },
  ];
};
