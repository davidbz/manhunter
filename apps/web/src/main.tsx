import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const MOUNT_ELEMENT_ID = "root";

const mount = document.getElementById(MOUNT_ELEMENT_ID);
if (!mount) {
  throw new Error(`index.html is missing the #${MOUNT_ELEMENT_ID} mount point`);
}

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
