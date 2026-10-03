// Packs @telltale/detectors as it would be published, then checks that the tarball holds only
// the built JavaScript, types and license files, loads in plain Node, and type-checks in a
// strict consumer project. `pnpm detectors:pack` runs it; CI runs it on every push.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pkgDir, "../..");
const tmp = mkdtempSync(join(tmpdir(), "telltale-pack-"));

try {
  execFileSync("pnpm", ["pack", "--pack-destination", tmp], { cwd: pkgDir, stdio: ["ignore", "ignore", "inherit"] });
  const tarball = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  assert.ok(tarball, "pnpm pack wrote no tarball");
  execFileSync("tar", ["-xzf", join(tmp, tarball), "-C", tmp]);

  // node_modules/@telltale/detectors inside a throwaway consumer project.
  const consumer = join(tmp, "consumer");
  const installed = join(consumer, "node_modules/@telltale/detectors");
  mkdirSync(dirname(installed), { recursive: true });
  renameSync(join(tmp, "package"), installed);

  const files = walk(installed).map((f) => relative(installed, f)).sort();
  const bytes = walk(installed).reduce((n, f) => n + statSync(f).size, 0);
  for (const f of ["package.json", "README.md", "LICENSE", "NOTICE", "dist/index.js", "dist/index.d.ts"]) assert.ok(files.includes(f), `${f} is missing`);
  const stray = files.filter((f) => !/^(package\.json|README\.md|LICENSE|NOTICE|dist\/.+\.(js|d\.ts))$/.test(f));
  assert.deepEqual(stray, [], "only the build, the readme and the license files are published");

  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.deepEqual(manifest.exports, { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } });
  assert.equal(manifest.publishConfig?.exports, undefined, "publishConfig was applied to the packed manifest");

  // Plain JavaScript in Node, without type stripping.
  const lib = await import(pathToFileURL(join(installed, "dist/index.js")).href);
  for (const name of ["summarizeBook", "toLevels", "WallTracker", "pulledWallSignal", "marketMetrics", "gradeMarket", "detectMinute"]) {
    assert.equal(typeof lib[name], "function", `${name} isn't exported`);
  }
  const book = lib.summarizeBook([{ px: 99, sz: 10 }], [{ px: 101, sz: 10 }]);
  assert.equal(book.mid, 100);

  // A strict TypeScript consumer that checks the published types too (no skipLibCheck).
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, noEmit: true, types: [] }, files: ["index.ts"] }),
  );
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(
    join(consumer, "index.ts"),
    [
      `import { gradeMarket, summarizeBook, toLevels, WallTracker, type Grade, type Signal } from "@telltale/detectors";`,
      `const book = summarizeBook(toLevels([{ px: "99", sz: "1" }]), toLevels([{ px: "101", sz: "1" }]));`,
      `const depth: number = book.bidDepth[2];`,
      `const walls = new WallTracker();`,
      `const events = walls.onBook("BTC", [], [], 0);`,
      `const grade: Grade | null = null;`,
      `const signals: Signal[] = [];`,
      `export { depth, events, grade, gradeMarket, signals };`,
    ].join("\n"),
  );
  execFileSync(join(repoRoot, "node_modules/.bin/tsc"), ["-p", consumer], { stdio: "inherit" });

  console.log(`${tarball}: ${files.length} files, ${(bytes / 1024).toFixed(1)} KB unpacked`);
  for (const f of files) console.log(`  ${f}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
