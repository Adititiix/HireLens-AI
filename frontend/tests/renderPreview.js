// Test helper: renders the REAL ResumePreview component (the same one the editor's live preview and the
// print/PDF export root use) to static HTML. esbuild is already installed as Vite's dependency.
import { buildSync } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function loadPreviewRenderer() {
  const out = buildSync({
    stdin: {
      contents: `import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import ResumePreview from "./src/components/editor/ResumePreview.jsx";
        export const render = props => renderToStaticMarkup(React.createElement(ResumePreview, props));`,
      resolveDir: root, loader: "jsx",
    },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic", write: false, logLevel: "silent",
    loader: { ".js": "jsx" }, define: { "import.meta.env": "{}" },
  });
  const file = join(mkdtempSync(join(tmpdir(), "preview-")), "preview.cjs");
  writeFileSync(file, out.outputFiles[0].text);
  return createRequire(import.meta.url)(file).render;
}

/** Same, for any component: `exportName` of `relPath` (relative to frontend/). Returns props → static HTML. */
export async function loadComponentRenderer(relPath, exportName = "default") {
  const imp = exportName === "default" ? `import C from "./${relPath}";` : `import { ${exportName} as C } from "./${relPath}";`;
  const out = buildSync({
    stdin: {
      contents: `import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        ${imp}
        export const render = props => renderToStaticMarkup(React.createElement(C, props));`,
      resolveDir: root, loader: "jsx",
    },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic", write: false, logLevel: "silent",
    loader: { ".js": "jsx" }, define: { "import.meta.env": "{}" },
  });
  const file = join(mkdtempSync(join(tmpdir(), "component-")), "component.cjs");
  writeFileSync(file, out.outputFiles[0].text);
  return createRequire(import.meta.url)(file).render;
}

/** All exports of a JSX module (bundled), e.g. a component file's handler functions. */
export function loadJsxModule(relPath) {
  const out = buildSync({
    stdin: { contents: `export * from "./${relPath}";`, resolveDir: root, loader: "jsx" },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic", write: false, logLevel: "silent",
    loader: { ".js": "jsx" }, define: { "import.meta.env": "{}" },
  });
  const file = join(mkdtempSync(join(tmpdir(), "module-")), "module.cjs");
  writeFileSync(file, out.outputFiles[0].text);
  return createRequire(import.meta.url)(file);
}
