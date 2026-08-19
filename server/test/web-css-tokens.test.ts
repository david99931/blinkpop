/**
 * Every `var(--token)` used in the web app must be defined in index.css.
 *
 * CSS fails SILENTLY here: an undefined custom property makes the whole
 * declaration invalid at computed-value time, so the property quietly falls
 * back to its inherited or initial value. The code looks right, typecheck
 * passes, the build succeeds, and the style simply does not apply.
 *
 * That is exactly how TrophyCase shipped with `--line`, `--bg-2` and
 * `--text-1` — none of which exist — leaving its slots with no borders and no
 * earned/locked background at all.
 *
 * This lives under server/test because vitest already runs here; web has no
 * test runner and adding one purely for this check would cost a dependency.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "src");
const CSS = path.join(WEB_SRC, "index.css");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Names on the left of a declaration — `--foo: value`, wherever it appears. */
function definedTokens(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

/** Names referenced through var(), including inside fallbacks. */
function usedTokens(source: string): Set<string> {
  return new Set([...source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]!));
}

describe("web CSS custom properties", () => {
  const defined = definedTokens(readFileSync(CSS, "utf8"));
  const files = walk(WEB_SRC);

  it("defines a non-trivial token set", () => {
    // Guards the parser itself — a regex that silently matched nothing would
    // make every assertion below pass for the wrong reason.
    expect(defined.size).toBeGreaterThan(5);
  });

  it("has no var(--token) that index.css never defines", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const token of usedTokens(readFileSync(file, "utf8"))) {
        if (!defined.has(token)) offenders.push(`${path.relative(WEB_SRC, file)}: ${token}`);
      }
    }
    expect(offenders, `undefined CSS custom properties:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
