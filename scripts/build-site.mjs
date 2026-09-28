import { cp, mkdir, rm, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");

const publicFiles = [
  "index.html",
  "index.css",
  "index.js",
  "Pay-Now.html",
  "favicon-32x32.png",
  "Assets/Images",
];

// Check required sources before replacing the generated output.
for (const file of publicFiles) {
  await access(resolve(root, file));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of publicFiles) {
  const destination = resolve(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve(root, file), destination, { recursive: true });
}

console.log("Website built successfully in dist/");