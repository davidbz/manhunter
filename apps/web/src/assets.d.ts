/**
 * The one Vite asset-import shape `apps/web` uses, declared by hand rather than by pulling in
 * `vite/client`: `apps/web/tsconfig.json` sets `"types": []` deliberately, and the full client
 * declarations reach `ImportMeta.env` and every asset extension for the sake of one import.
 *
 * `cssvariables.test.ts` reads `index.css` as text to check its `var(--mh-*)` references against
 * the published tokens. It cannot use `node:fs` for that: `apps/web`'s Biome override turns on
 * `correctness/noNodejsModules`, because everything under `apps/web/src` ships to a browser.
 */
declare module "*.css?raw" {
  const content: string;
  export default content;
}
