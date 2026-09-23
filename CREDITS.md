# Credits

Manhunter uses no third-party art, font, or audio assets. The map, the heatmap, the report feed
and every other visual are code-drawn (SVG plus system fonts), per `docs/DESIGN.md`'s "Visual
direction": "Code-drawn, no illustrated assets required for MVP."

`apps/web/src/theme.ts` is the palette, type scale and heat ramp every dispatch component reads;
it is original data authored for this project, not sourced from elsewhere.

The M6 visual overhaul (PLAN M6.1-M6.10) added no third-party assets either. The avatars are
generated from the seed, the action icons, district blocks, map symbols and filters are
hand-written SVG, the motion is CSS keyframes over `theme.ts` tokens, and the type is the system
font stack. No font, icon set, image, sound or stylesheet was imported.

This file exists so a future asset has somewhere to be listed (AGENTS.md: "Do not add art assets
without a matching entry in CREDITS.md"). Add a source and licence line per asset here the first
time one is actually added; none has been yet.
