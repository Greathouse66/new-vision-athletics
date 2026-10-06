import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Keep demo pages out of the normal Netlify build. This command runs the
// ordinary build first and writes temporary local-only examples afterward.
await import("./build-site.mjs");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist", "design-preview");
const pages = [
  "auth/sign-in.html", "auth/callback.html",
  "parent/index.html", "parent/payments.html", "parent/sessions.html", "parent/drop-ins.html",
  "coach/index.html", "coach/today.html", "coach/records.html", "coach/groups.html",
  "coach/schedule.html", "coach/classes.html", "coach/drop-ins.html",
  "coach/cancellations.html", "coach/families.html", "coach/billing.html",
];
const titles = {
  "auth/sign-in.html": "Parent sign-in", "auth/callback.html": "Sign-in callback",
  "parent/index.html": "My athletes", "parent/payments.html": "Tuition & payments",
  "parent/sessions.html": "Upcoming sessions", "parent/drop-ins.html": "Drop-in requests",
  "coach/index.html": "Coach workspace", "coach/today.html": "Today roster",
  "coach/records.html": "Athlete roster", "coach/groups.html": "Skill groups",
  "coach/schedule.html": "Weekly venue", "coach/classes.html": "Class places",
  "coach/drop-ins.html": "Drop-in requests", "coach/cancellations.html": "Parent cancellations",
  "coach/families.html": "Parent account access", "coach/billing.html": "Monthly tuition",
};
const examples = {
  "families": "<article class='parent-athlete-card'><span class='parent-athlete-initial' aria-hidden='true'>S</span><div><h3>Sample Athlete</h3><span class='parent-group-chip'>Foundational</span></div></article>",
  "upcoming-preview": "<li>Sample Athlete · Foundational · Tue, 6:00 PM · Sample venue</li>",
  "charges": "<li>Sample Athlete · October tuition · $125.00 · Unpaid</li>",
  "payments": "<li>Example: a confirmed Venmo payment will appear here.</li>",
  "sessions": "<li>Sample Athlete · Foundational · Tuesday, 6:00–7:00 PM · Sample venue</li>",
  "groups": "<li>Foundational</li><li>Post-Bigs</li><li>Advanced</li>",
  "active-groups": "<li>Foundational</li><li>Post-Bigs</li><li>Advanced</li>",
  "requests": "<li>Example: requests will appear here after a parent sends one.</li>",
  "cancellations": "<li>Example: a parent cancellation will appear here after one is recorded.</li>",
};
const previewBanner = `<aside style="position:relative;z-index:20;padding:.65rem 1rem;background:#e0fafa;color:#003c3c;font:700 13px system-ui,sans-serif;text-align:center">DESIGN PREVIEW · fictional example data · no account or payment actions</aside>`;
for (const page of pages) {
  const source = resolve(root, "dist", page);
  let html = await readFile(source, "utf8");
  // The sample pages never load the auth client or call the database.
  html = html.replace(/<script type="module" src="\/(?:auth|parent|coach)\/[^"<>]+"><\/script>/g, "");
  html = html.replace(/id="(?:coach-content|family-content|parent-portal)" hidden/g,
    (match) => match.replace(" hidden", ""));
  html = html.replace(/(<p id="status"[^>]*>)[\s\S]*?(<\/p>)/, "$1Design preview with fictional data.$2");
  html = html.replace(/(<(?:ul|div) id="([^"]+)"[^>]*>)(<\/(?:ul|div)>)/g,
    (full, open, id, close) => examples[id] ? `${open}${examples[id]}${close}` : full);
  if (page === "parent/index.html") {
    html = html.replace('id="athlete-total" class="parent-count"></span>',
      'id="athlete-total" class="parent-count">1 rostered</span>');
    html = html.replace('id="balance-summary">Loading tuition summary…',
      'id="balance-summary">Example balance: $125.00 remaining');
  }
  if (page === "coach/index.html") {
    html = html.replace('id="athlete-count">—', 'id="athlete-count">24')
      .replace('id="family-count">—', 'id="family-count">21')
      .replace('id="group-count">—', 'id="group-count">3')
      .replace('id="class-count">—', 'id="class-count">8');
  }
  html = html.replace(/href="\/(auth|coach|parent)\/([^"]*)"/g, (_full, area, rest) =>
    `href="/design-preview/${area}/${rest || "index.html"}"`);
  html = html.replace(/(<body\b[^>]*>)/, `$1${previewBanner}`);
  html = html.replace("</body>", `<script>document.addEventListener('submit',event=>event.preventDefault());document.addEventListener('click',event=>{if(event.target.closest('button'))event.preventDefault()});</script></body>`);
  const destination = resolve(output, page);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, html);
}
const links = pages.map((page) => `<li><a href="/design-preview/${page}">${titles[page]}</a></li>`);
const menu = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Portal design preview</title><link rel="stylesheet" href="/styles/portal.css"></head><body class="portal-auth"><main class="card"><div class="brand">New Vision Athletics</div><h1>Portal design preview</h1><p>Fictional sample data. No sign-in, payment, or database actions. This preview is created only by the local preview command.</p><h2>Parent & sign-in</h2><ul>${links.slice(0,6).join("")}</ul><h2>Coach</h2><ul>${links.slice(6).join("")}</ul></main></body></html>`;
await writeFile(resolve(output, "index.html"), menu);
console.log("Local-only design preview built in dist/design-preview/");
