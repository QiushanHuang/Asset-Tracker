"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const source = process.env.ASSET_DB || path.join(__dirname, "data/book.sqlite");
const target = process.argv[2];
if (!target || !path.isAbsolute(target)) {
  console.error(
    "Usage: node server/backup.cjs /absolute/path/new-backup.sqlite",
  );
  process.exit(1);
}
if (!fs.existsSync(source) || fs.existsSync(target)) {
  console.error("Source must exist and destination must be new.");
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source);
try {
  db.prepare("VACUUM INTO ?").run(target);
  fs.chmodSync(target, 0o600);
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    if (copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("Backup integrity check failed");
  } finally {
    copy.close();
  }
  console.log("Consistent backup created and verified.");
} finally {
  db.close();
}
