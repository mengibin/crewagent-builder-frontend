import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const runtimeSchemasDir = path.resolve(
  frontendRoot,
  "..",
  "crewagent-runtime",
  "spec",
  "bmad-package-spec",
  "v1.1",
  "schemas",
);
const destDir = path.resolve(frontendRoot, "src", "lib", "bmad-spec", "v1.1");

const schemaFiles = [
  "agents.schema.json",
  "bmad.schema.json",
  "step-frontmatter.schema.json",
  "workflow-frontmatter.schema.json",
  "workflow-graph.schema.json",
];

if (!existsSync(runtimeSchemasDir)) {
  console.error(`Runtime schema directory not found: ${runtimeSchemasDir}`);
  console.error("Run this script from the monorepo checkout that contains `crewagent-runtime/`.");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

for (const filename of schemaFiles) {
  const sourcePath = path.join(runtimeSchemasDir, filename);
  const destPath = path.join(destDir, filename);
  if (!existsSync(sourcePath)) {
    console.error(`Missing schema file: ${sourcePath}`);
    process.exit(1);
  }
  copyFileSync(sourcePath, destPath);
  console.log(`Synced ${filename} -> ${path.relative(frontendRoot, destPath)}`);
}
