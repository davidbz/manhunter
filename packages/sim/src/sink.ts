/**
 * The real filesystem behind `FileSink` (PLAN M2.4). This is the only module in `sim` that touches
 * a disk; everything above it takes the interface, so only the composition root ever names this.
 *
 * `node:fs/promises` rather than `Bun.write` so the same sink runs under Bun and under the Node
 * process Vitest uses, which is what lets it be tested at all rather than mocked away.
 */

import { writeFile } from "node:fs/promises";
import type { FileSink } from "./artifact";

const ENCODING = "utf8";

export const createFileSink = (): FileSink => ({
  write: async (path, contents) => {
    await writeFile(path, contents, ENCODING);
  },
});
