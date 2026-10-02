const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", ico: "image/x-icon", avif: "image/avif", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4",
};

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RepoLab workspace</title>
    <style>
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #e5e7eb; background: #111827; }
      main { max-width: 42rem; margin: 12vh auto; padding: 2rem; }
      h1 { margin-bottom: .5rem; }
      code { color: #93c5fd; }
    </style>
  </head>
  <body>
    <main>
      <h1>Workspace ready</h1>
      <p>This selection does not contain an <code>index.html</code> file. You can still browse and edit the selected files. Add an <code>index.html</code> file whenever you want a webpage preview.</p>
    </main>
  </body>
</html>`;

export const isBinaryPath = (path) => Object.hasOwn(MIME, path.split(".").pop().toLowerCase());

export function relativeToRoot(path, root) {
  if (!root) return `/${path}`;
  return `/${path.slice(root.length).replace(/^\//, "")}`;
}

export function prepareSandpackFiles(downloaded, root = "") {
  const assets = new Map();
  const textFiles = [];

  for (const file of downloaded) {
    const virtualPath = relativeToRoot(file.path, root);
    if (isBinaryPath(file.path)) {
      const ext = file.path.split(".").pop().toLowerCase();
      assets.set(virtualPath, `data:${MIME[ext]};base64,${file.content}`);
    } else {
      textFiles.push({ ...file, virtualPath, text: decodeBase64(file.content) });
    }
  }

  const hasIndex = textFiles.some((file) => file.virtualPath === "/index.html");
  const initialFile = hasIndex ? "/index.html" : textFiles[0]?.virtualPath;
  const files = {};

  for (const file of textFiles) {
    files[file.virtualPath] = {
      code: rewriteAssetReferences(file.text, file.virtualPath, assets),
      active: file.virtualPath === initialFile,
    };
  }

  if (!hasIndex) {
    files["/index.html"] = {
      code: FALLBACK_HTML,
      hidden: true,
    };
  }

  return files;
}

function decodeBase64(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\n/g, "")), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizePath(fromFile, reference) {
  if (/^(?:[a-z]+:|#|\/\/|data:)/i.test(reference)) return null;
  const base = fromFile.split("/").slice(0, -1);
  for (const part of reference.split(/[?#]/)[0].split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return `/${base.filter(Boolean).join("/")}`;
}

function rewriteAssetReferences(source, fromFile, assets) {
  return source.replace(/(["'(=]\s*)([^"'()=\s>]+\.(?:png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|otf|mp3|wav|mp4)(?:\?[^"'()\s>]*)?)/gi,
    (match, prefix, reference) => {
      const resolved = normalizePath(fromFile, reference);
      return resolved && assets.has(resolved) ? `${prefix}${assets.get(resolved)}` : match;
    });
}
