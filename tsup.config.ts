import { defineConfig } from "tsup";
import { copyFileSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["better-sqlite3", "sqlite-vec", "ioredis", "openclaw"],
  noExternal: ["ulid", "zod", "@sinclair/typebox"],
  onSuccess: async () => {
    copyFileSync("src/db/schema.sql", "dist/schema.sql");
  },
});
