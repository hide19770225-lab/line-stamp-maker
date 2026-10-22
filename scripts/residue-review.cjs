/* RGBA bridge for the offline PNG review tool. Uses the same detector as the app. */
"use strict";
const fs = require("node:fs"), R = require("../residue.js");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
const results = request.map(({ name, width, height, rgba, remove = [] }) => {
  const data = new Uint8ClampedArray(Buffer.from(rgba, "base64"));
  if (data.length !== width * height * 4) throw Error("Invalid RGBA dimensions");
  const mask = Uint8ClampedArray.from({ length: width * height }, (_, i) => data[i * 4 + 3]);
  const scan = R.analyse({ width, height, data }, mask, undefined, true);
  const result = R.removeSelected(mask, scan, remove);
  for (let i = 0; i < mask.length; i++) data[i * 4 + 3] = result.mask[i];
  return { name, candidates: scan.candidates, removed: result.removed,
    rgba: Buffer.from(data).toString("base64") };
});
process.stdout.write(JSON.stringify(results));
