import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/admin.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  // Workspace packages ship TypeScript sources, so they are bundled; npm dependencies stay external.
  noExternal: [/^@wow\//],
  clean: true,
});
