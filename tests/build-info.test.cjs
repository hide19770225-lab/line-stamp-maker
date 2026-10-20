"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
const dest = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-build-"));
try {
  const env = { ...process.env, STAMP_BUILD_DIR: dest, BUILD_COMMIT: "a".repeat(40), DEPLOY_ENVIRONMENT: "test-preview" };
  execFileSync(process.execPath, ["scripts/build.cjs"], { env });
  const a = JSON.parse(fs.readFileSync(path.join(dest,"build-info.json")));
  assert.equal(a.version, fs.readFileSync("VERSION", "utf8").trim());
  assert.equal(a.commit, env.BUILD_COMMIT); assert.equal(a.environment, "test-preview");
  assert(Math.abs(Date.now()-Date.parse(a.builtAt)) < 10000);
  const html = fs.readFileSync(path.join(dest,"index.html"),"utf8");
  const resources = [...html.matchAll(/(?:src|href)="([\w-]+\.(?:js|css))(?:\?([^"\s]*))?"/g)];
  assert(resources.length > 10);
  for (const r of resources) { assert.equal(r[2], `v=${a.buildId}`); assert(fs.existsSync(path.join(dest,r[1]))); }
  assert(fs.readFileSync(path.join(dest,"build-info.js"),"utf8").includes(JSON.stringify(a)));
  execFileSync(process.execPath, ["scripts/build.cjs"], { env:{...env, BUILD_COMMIT:"unavailable", DEPLOY_ENVIRONMENT:""} });
  const unknown = JSON.parse(fs.readFileSync(path.join(dest,"build-info.json")));
  assert.equal(unknown.commit,null); assert.equal(unknown.environment,null);
  assert.notEqual(unknown.buildId,a.buildId);
  console.log("PASS build artifact metadata, cache keys, unavailable values");
} finally { fs.rmSync(dest,{recursive:true,force:true}); }
