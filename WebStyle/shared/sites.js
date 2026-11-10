/*
 * WebStyle — site list helpers. Loaded by the service worker (importScripts), the popover and the importer.
 *
 * Storage (chrome.storage.local):
 *   sites: [{ domain: "example.com", added: <epoch ms>, features: { bold: true, helvetica: false } }, ...]
 *
 * An entry covers its domain and every subdomain (like Stylus's domain("example.com")). When entries
 * overlap, the most specific one decides, so "mail.example.com" can override "example.com".
 */
(function (root) {
  "use strict";

  const SITES = {};
  const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  // Chromium accepts underscores in hostnames (and "Add this site" can add one), so imports must too.
  const LABEL = /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/;

  /** Lowercase, drop a trailing dot and a single leading "www." */
  SITES.normalizeHost = function normalizeHost(host) {
    let h = String(host || "").trim().toLowerCase().replace(/\.+$/, "");
    if (h.startsWith("www.") && h.length > 4) h = h.slice(4);
    return h;
  };

  SITES.isIp = (h) => IPV4.test(h) || h.startsWith("[");

  /** True when `host` is `domain` or one of its subdomains. IP addresses only match exactly. */
  SITES.hostMatches = function hostMatches(host, domain) {
    const h = SITES.normalizeHost(host);
    const d = SITES.normalizeHost(domain);
    if (!h || !d) return false;
    if (h === d) return true;
    return h.endsWith("." + d) && !SITES.isIp(h);
  };

  /** The most specific entry covering `host`, or null. */
  SITES.findEntry = function findEntry(sites, host) {
    let best = null;
    for (const e of sites || []) {
      if (e && SITES.hostMatches(host, e.domain) && (!best || e.domain.length > best.domain.length)) best = e;
    }
    return best;
  };

  /** A domain name, a single-label host like "localhost", an IPv4 address, or a bracketed IPv6 address. */
  SITES.isValidHost = function isValidHost(host) {
    const h = String(host || "").toLowerCase();
    if (!h || h.length > 253) return false;
    if (IPV4.test(h)) return true;
    if (/^\[[0-9a-f:.]+\]$/.test(h)) {
      try {
        return new URL(`http://${h}/`).hostname === h;
      } catch (e) {
        return false;
      }
    }
    return h.split(".").every((l) => LABEL.test(l));
  };

  /** Match pattern for an entry: the host plus its subdomains (exact host only for IP addresses), like hostMatches. */
  SITES.matchPatterns = function matchPatterns(domain) {
    return SITES.isIp(domain) ? [`*://${domain}/*`] : [`*://*.${domain}/*`];
  };

  /** Pages where Chromium never lets extensions inject. */
  const RESTRICTED = [
    (u) => u.hostname === "chromewebstore.google.com",
    (u) => u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore"),
  ];

  /** The URL object if WebStyle can style this tab URL, else null. */
  SITES.eligibleUrl = function eligibleUrl(rawUrl) {
    let u;
    try {
      u = new URL(rawUrl);
    } catch (e) {
      return null;
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) return null;
    if (RESTRICTED.some((t) => t(u))) return null;
    return u;
  };

  /** Sorted newest first, then alphabetically. */
  SITES.sorted = (sites) =>
    [...(sites || [])].sort((a, b) => (b.added || 0) - (a.added || 0) || a.domain.localeCompare(b.domain));

  /** Merge `incoming` into `existing`: matching domains are replaced by the incoming entry. */
  SITES.merge = function merge(existing, incoming) {
    const map = new Map((existing || []).map((e) => [e.domain, e]));
    for (const e of incoming) map.set(e.domain, e);
    return [...map.values()];
  };

  root.WS_SITES = SITES;
})(typeof globalThis !== "undefined" ? globalThis : self);
