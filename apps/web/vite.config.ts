import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Must track tsconfig.base.json's target: docs/PLAN.md M0.1 chose ES2023 for the immutable
// array methods architecture rule 3 relies on.
const BUILD_TARGET = "es2023";

export default defineConfig({
  plugins: [react()],
  build: {
    target: BUILD_TARGET,
  },
});
