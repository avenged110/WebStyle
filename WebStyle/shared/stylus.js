/*
 * WebStyle — one-way importer for Stylus backups (the .json from Stylus's "Export" button), so moving off
 * Stylus is a single import. Reads every enabled style's domain("…") rules and turns on each WebStyle feature
 * whose CSS appears inside that @-moz-document block (see `stylus` in shared/features.js).
 * Requires shared/features.js and shared/sites.js.
 */
(function (root) {
  "use strict";

  const SITES = root.WS_SITES;
  const F = root.WS_FEATURES;

  /** [{ domains: [...], code }] from a usercss source, matching braces to find each block's end. */
  function mozDocumentBlocks(source) {
    const blocks = [];
    const re = /@-moz-document\s+([^{]*)\{/g;
    let m;
    while ((m = re.exec(source))) {
      let depth = 1;
      let i = re.lastIndex;
      for (; i < source.length && depth; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
      }
      const domains = [...m[1].matchAll(/domain\(\s*["']?([^"')\s]+)["']?\s*\)/g)].map((d) => d[1]);
      blocks.push({ domains, code: source.slice(re.lastIndex, i - 1) });
      re.lastIndex = i;
    }
    return blocks;
  }

  /** Returns [{ domain, added, features }] or throws if `text` isn't a Stylus backup. */
  function parse(text) {
    let data;
    try {
      data = JSON.parse(String(text).replace(/^﻿/, ""));
    } catch (e) {
      throw new Error("This isn't a WebStyle settings file or a Stylus backup.");
    }
    const styles = Array.isArray(data) ? data.filter((s) => s && typeof s === "object" && Array.isArray(s.sections)) : [];
    if (!styles.length) throw new Error("This JSON file isn't a Stylus backup.");

    const map = new Map();
    for (const style of styles) {
      if (style.enabled === false) continue;
      const added = Number(style.installDate) || Date.now();
      const blocks = typeof style.sourceCode === "string" ? mozDocumentBlocks(style.sourceCode) : [];
      // Older (non-usercss) styles keep their rules in `sections` instead.
      if (!blocks.length) for (const s of style.sections) blocks.push({ domains: s.domains || [], code: s.code || "" });
      for (const { domains, code } of blocks) {
        const on = F.FEATURES.filter((f) => f.stylus && f.stylus.test(code)).map((f) => f.id);
        if (!on.length) continue;
        for (const raw of domains) {
          const domain = SITES.normalizeHost(raw);
          if (!SITES.isValidHost(domain)) continue;
          const e = map.get(domain) || { domain, added, features: F.normalize({}) };
          e.added = Math.min(e.added, added);
          for (const id of on) e.features[id] = true;
          map.set(domain, e);
        }
      }
    }
    if (!map.size) throw new Error("This Stylus backup has no bold or Helvetica site styles to import.");
    return [...map.values()];
  }

  root.WS_STYLUS = { parse };
})(typeof globalThis !== "undefined" ? globalThis : self);
