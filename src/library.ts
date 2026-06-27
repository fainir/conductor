// library.ts — the statically-imported command set.
// Explicit imports (not a runtime directory scan) so the MCP server can be bundled
// into a single self-contained file. Still enforces the core invariant: every
// command must export a verifier.
//
// To add a command: create commands/<name>/index.ts, then add it here.

import type { CommandModule } from "./types.js";

import * as slugify from "../commands/slugify/index.js";
import * as word_count from "../commands/word_count/index.js";
import * as normalize_phone from "../commands/normalize_phone/index.js";
import * as extract_contact from "../commands/extract_contact/index.js";
import * as summarize from "../commands/summarize/index.js";
import * as extract_keywords from "../commands/extract_keywords/index.js";
import * as classify_sentiment from "../commands/classify_sentiment/index.js";
import * as redact_pii from "../commands/redact_pii/index.js";
import * as json_extract from "../commands/json_extract/index.js";
import * as truncate from "../commands/truncate/index.js";
import * as dedupe_lines from "../commands/dedupe_lines/index.js";
import * as extract_urls from "../commands/extract_urls/index.js";
import * as template_fill from "../commands/template_fill/index.js";
import * as fix_json from "../commands/fix_json/index.js";
import * as extract_dates from "../commands/extract_dates/index.js";
import * as categorize from "../commands/categorize/index.js";
import * as translate from "../commands/translate/index.js";
import * as base64_encode from "../commands/base64_encode/index.js";
import * as base64_decode from "../commands/base64_decode/index.js";
import * as extract_emails from "../commands/extract_emails/index.js";
import * as json_minify from "../commands/json_minify/index.js";
import * as to_snake_case from "../commands/to_snake_case/index.js";
import * as detect_language from "../commands/detect_language/index.js";

const MODULES = [
  slugify, word_count, normalize_phone, extract_contact, summarize,
  extract_keywords, classify_sentiment, redact_pii, json_extract,
  truncate, dedupe_lines, extract_urls, template_fill,
  fix_json, extract_dates, categorize, translate,
  base64_encode, base64_decode, extract_emails, json_minify, to_snake_case, detect_language,
] as any[];

export function library(): Map<string, CommandModule> {
  const map = new Map<string, CommandModule>();
  for (const mod of MODULES) {
    const { manifest, verify, run } = mod;
    if (!manifest) throw new Error("command module is missing a 'manifest' export");
    if (typeof verify !== "function") {
      throw new Error(`command '${manifest.name}': MANDATORY 'verify' export missing.`);
    }
    map.set(manifest.name, { manifest, verify, run });
  }
  return map;
}
