/*
 * WebStyle — settings export file format. Shared by the exporter (background.js) and the importer.
 * Requires shared/features.js and shared/sites.js.
 *
 *   WEBSTYLE1-3f8a61c2d95e07b4
 *
 *   WebStyle Settings
 *   Exported 2026-11-09 at 14.03.11
 *   ––––––––––––––––––––––––––––––––––––––––
 *   ebay.com       bold helvetica    added 2026-11-09 at 14.03.11
 *   imdb.com       helvetica         added 2026-10-02 at 09.15.00
 *   example.org    none              added 2026-09-30 at 18.40.27
 *
 * Each line: the site, its enabled features (space-separated feature ids, or "none"), and when it was added.
 */
(function (root) {
  "use strict";

  const SITES = root.WS_SITES;
  const F = root.WS_FEATURES;
  const SIGNATURE = "WEBSTYLE1-3f8a61c2d95e07b4";
  const TITLE = "WebStyle Settings";
  const RULE = "–".repeat(40);
  const MAX_ENTRIES = 10000;

  const pad = (n) => String(n).padStart(2, "0");

  /** Local date/time as "2026-11-09 at 14.03.11" (same style as TabBackup and Autoplay Stopper). */
  function stamp(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  }

  const featureWords = (features) => F.IDS.filter((id) => features && features[id]).join(" ") || "none";

  function buildText(sites, now = new Date()) {
    const entries = SITES.sorted(sites);
    const dw = Math.max(0, ...entries.map((e) => e.domain.length));
    const fw = Math.max(0, ...entries.map((e) => featureWords(e.features).length));
    const lines = entries.map((e) => {
      const base = `${e.domain.padEnd(dw)}    ${featureWords(e.features).padEnd(fw)}`;
      return e.added ? `${base}    added ${stamp(new Date(e.added))}` : base.trimEnd();
    });
    return [SIGNATURE, "", TITLE, `Exported ${stamp(now)}`, RULE, ...lines].join("\n") + "\n";
  }

  const DATE = /^added\s+(\d{4})-(\d{2})-(\d{2})\s+at\s+(\d{2})\.(\d{2})\.(\d{2})$/i;

  /**
   * Parse an export file. Returns [{ domain, added, features }]. Throws an Error with a user-facing message
   * if the file isn't a well-formed WebStyle settings file.
   */
  function parseText(text, now = Date.now()) {
    const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
    if (lines[0].trim() !== SIGNATURE) throw new Error("This isn't a WebStyle settings file.");
    const ruleAt = lines.findIndex((l, i) => i > 0 && /^[–-]{10,}$/.test(l.trim()));
    if (ruleAt < 0 || !lines.slice(1, ruleAt).some((l) => l.trim() === TITLE)) {
      throw new Error("This settings file is incomplete or has been altered.");
    }
    const out = [];
    const seen = new Set();
    for (let i = ruleAt + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const shown = line.length > 40 ? line.slice(0, 40) + "…" : line;
      const at = line.search(/\s+added\s/i);
      const head = (at < 0 ? line : line.slice(0, at)).split(/\s+/);
      const tail = at < 0 ? "" : line.slice(at).trim();
      const domain = SITES.normalizeHost(head[0]);
      if (!SITES.isValidHost(domain)) throw new Error(`Line ${i + 1} isn't a valid site: “${shown}”`);

      const words = head.slice(1).map((w) => w.toLowerCase());
      const features = F.normalize({});
      if (!(words.length === 1 && words[0] === "none")) {
        for (const w of words) {
          if (!F.byId(w)) throw new Error(`Line ${i + 1} has an unknown style “${w}”.`);
          features[w] = true;
        }
      }

      let added = now;
      if (tail) {
        const m = DATE.exec(tail);
        const d = m && new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
        if (!m || isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) {
          throw new Error(`Line ${i + 1} has an invalid date.`);
        }
        added = d.getTime();
      }
      if (seen.has(domain)) continue;
      seen.add(domain);
      out.push({ domain, added, features });
      if (out.length > MAX_ENTRIES) throw new Error("This file has too many entries to be a WebStyle settings file.");
    }
    return out;
  }

  root.WS_FORMAT = { SIGNATURE, buildText, parseText, stamp };
})(typeof globalThis !== "undefined" ? globalThis : self);
