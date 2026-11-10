/*
 * WebStyle — feature registry.
 *
 * Every per-site style lives here and nowhere else: the popover's checkboxes, the export file, the importer
 * and the background injector are all generated from this list. To add a feature, add an entry below and a
 * matching stylesheet in css/ whose rules are guarded by
 *     :root:not([data-webstyle-off~="<id>"])
 * (that guard is how WebStyle switches a feature off on an already-open page without a reload).
 *
 *   id         stable identifier, used in storage and in export files (lowercase letters/digits only)
 *   label      checkbox label in the popover
 *   labelCss   inline style for the label, so it previews the effect
 *   css        stylesheet path, relative to the extension root
 *   defaultOn  whether the box starts checked when a site is added
 *   stylus     (optional) detects this feature in a Stylus CSS block, for importing Stylus backups
 *
 * PRESETS are the choices in each row's picker menu, in menu order: a label and the features it turns on.
 * A new feature also needs its preset(s) here.
 */
(function (root) {
  "use strict";

  const FEATURES = [
    {
      id: "bold",
      label: "Bold",
      labelCss: "font-weight: 700",
      css: "css/bold.css",
      defaultOn: false,
      stylus: /font-weight\s*:\s*(bold|[6-9]00)\b/i,
    },
    {
      id: "helvetica",
      label: "Helvetica",
      labelCss: "font-family: Helvetica, sans-serif",
      css: "css/helvetica.css",
      defaultOn: true,
      stylus: /font-family\s*:\s*["']?helvetica\b/i,
    },
  ];

  const PRESETS = [
    { label: "Both", ids: ["bold", "helvetica"] },
    { label: "Helvetica", ids: ["helvetica"] },
    { label: "Bold", ids: ["bold"] },
  ];

  const IDS = FEATURES.map((f) => f.id);
  const byId = (id) => FEATURES.find((f) => f.id === id) || null;

  /** A complete { id: boolean } map: known features only, missing ones false. */
  function normalize(features) {
    const out = {};
    for (const id of IDS) out[id] = !!(features && features[id]);
    return out;
  }

  const defaults = () => Object.fromEntries(FEATURES.map((f) => [f.id, !!f.defaultOn]));

  /** The full { id: boolean } map a preset stands for. */
  const fromPreset = (preset) => normalize(Object.fromEntries(preset.ids.map((id) => [id, true])));

  /** The preset matching a features map exactly, or null (e.g. an imported site with nothing turned on). */
  const presetFor = (features) => {
    const key = JSON.stringify(normalize(features));
    return PRESETS.find((p) => JSON.stringify(fromPreset(p)) === key) || null;
  };

  root.WS_FEATURES = { FEATURES, PRESETS, IDS, byId, normalize, defaults, fromPreset, presetFor };
})(typeof globalThis !== "undefined" ? globalThis : self);
