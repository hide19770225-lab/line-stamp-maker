// Build a standalone static artifact. Metadata describes this artifact, never a remote PR head.
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dest = path.resolve(process.env.STAMP_BUILD_DIR || path.join(root, "dist"));
if (dest === root || root.startsWith(dest + path.sep)) throw new Error("Unsafe build directory");
const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error("Invalid VERSION");
let commit = process.env.BUILD_COMMIT || process.env.GITHUB_SHA || null;
if (!commit) { try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {} }
if (!/^[a-f0-9]{40}$/i.test(commit || "")) commit = null;
const environment = process.env.DEPLOY_ENVIRONMENT?.trim() || null;
const files = fs.readdirSync(root).filter(f => /\.(js|css|html)$/.test(f) && !["build-info.js", "regression-10.html"].includes(f));
const hash = crypto.createHash("sha256");
for (const f of [...files, "VERSION"].sort()) hash.update(f).update(fs.readFileSync(path.join(root, f)));
const info = { version, commit, builtAt: new Date().toISOString(), environment, buildId: hash.update(commit || "").update(environment || "").digest("hex") };
fs.mkdirSync(dest, { recursive: true });
for (const f of files) {
  let content = fs.readFileSync(path.join(root, f), "utf8");
  if (f === "index.html") content = content.replace(/((?:src|href)="[\w-]+\.(?:js|css))(?:\?[^"\s]*)?"/g, `$1?v=${info.buildId}"`);
  fs.writeFileSync(path.join(dest, f), content);
}
fs.writeFileSync(path.join(dest, "build-info.js"), `window.STAMP_BUILD_INFO = ${JSON.stringify(info)};\n`);
fs.writeFileSync(path.join(dest, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
fs.writeFileSync(path.join(dest, ".nojekyll"), "");
console.log(`Built ${version} (${commit || "不明"}) -> ${dest}`);
