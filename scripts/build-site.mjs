import { cp, mkdir, rm, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");

const publicFiles = [
  "index.html",
  "index.css",
  "index.js",
  "Pay-Now.html",
  "favicon-32x32.png",
  "Assets/Images",
  "auth/sign-in.html",
  "auth/callback.html",
  "parent/index.html",
  "parent/payments.html",
  "parent/sessions.html",
  "parent/drop-ins.html",
  "parent/reports.html",
  "coach/index.html",
  "coach/today.html",
  "coach/families.html",
  "coach/groups.html",
  "coach/schedule.html",
  "coach/classes.html",
  "coach/drop-ins.html",
  "coach/cancellations.html",
  "coach/records.html",
  "coach/billing.html",
  "coach/reports.html",
  "styles/portal.css",
  "styles/coach-dashboard.css",
  "styles/reports.css",
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

const publishableKey = process.env.NVA_SUPABASE_PUBLISHABLE_KEY ?? "";
if (publishableKey && !publishableKey.startsWith("sb_publishable_")) {
  throw new Error("NVA_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key.");
}
if (process.env.CONTEXT === "deploy-preview" && !publishableKey) {
  throw new Error("Deploy Preview is missing NVA_SUPABASE_PUBLISHABLE_KEY in its build environment.");
}

await build({
  entryPoints: {
    "auth/sign-in": resolve(root, "scripts/auth/sign-in.js"),
    "auth/callback": resolve(root, "scripts/auth/callback.js"),
    "parent/index": resolve(root, "scripts/parent/index.js"),
    "parent/payments": resolve(root, "scripts/parent/payments.js"),
    "parent/sessions": resolve(root, "scripts/parent/sessions.js"),
    "parent/reports": resolve(root, "scripts/parent/reports.js"),
    "parent/drop-ins": resolve(root, "scripts/parent/drop-ins.js"),
    "coach/index": resolve(root, "scripts/coach/index.js"),
    "coach/today": resolve(root, "scripts/coach/today.js"),
    "coach/families": resolve(root, "scripts/coach/families.js"),
    "coach/groups": resolve(root, "scripts/coach/groups.js"),
    "coach/schedule": resolve(root, "scripts/coach/schedule.js"),
    "coach/classes": resolve(root, "scripts/coach/classes.js"),
    "coach/drop-ins": resolve(root, "scripts/coach/drop-ins.js"),
    "coach/cancellations": resolve(root, "scripts/coach/cancellations.js"),
    "coach/records": resolve(root, "scripts/coach/records.js"),
    "coach/reports": resolve(root, "scripts/coach/reports.js"),
    "coach/billing": resolve(root, "scripts/coach/billing.js"),
  },
  outdir: output,
  bundle: true,
  splitting: true,
  chunkNames: "scripts/chunks/[name]-[hash]",
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: {
    __NVA_SUPABASE_URL__: JSON.stringify("https://mmxvfsuxvodcqhiksxzr.supabase.co"),
    __NVA_SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
  },
});

console.log("Website built successfully in dist/");
