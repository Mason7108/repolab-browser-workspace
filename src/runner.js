const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", ico: "image/x-icon", avif: "image/avif", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4",
};

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

  const files = {};
  for (const file of textFiles) {
    files[file.virtualPath] = {
      code: rewriteAssetReferences(file.text, file.virtualPath, assets),
      active: file.virtualPath === "/index.html",
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
