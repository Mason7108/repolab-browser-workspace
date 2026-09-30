const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION_HOURS = 8;
const MAX_FILES = 200;
const MAX_BYTES = 10 * 1024 * 1024;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
      return json({ error: "The server could not complete that request." }, 500, request, env);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return corsResponse(request, env);

  if (url.pathname === "/api/health") return json({ ok: true }, 200, request, env);
  if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
  if (url.pathname === "/api/oauth/callback") return oauthCallback(request, env);

  const session = await requireSession(request, env);
  if (!session) return json({ error: "Your session has expired. Please unlock RepoLab again." }, 401, request, env);
  if (url.pathname === "/api/oauth/start" && request.method === "POST") return oauthStart(request, env, session);
  if (url.pathname === "/api/me") return session.gh ? githubJson("/user", session.gh, request, env, (user) => ({ user: pickUser(user) })) : json({ user: null }, 200, request, env);
  if (!session.gh) return json({ error: "Connect GitHub to continue." }, 403, request, env);
  if (url.pathname === "/api/repos") return listRepos(request, env, session.gh);
  if (url.pathname === "/api/tree") return getTree(request, env, session.gh);
  if (url.pathname === "/api/files" && request.method === "POST") return getFiles(request, env, session.gh);
  return json({ error: "Not found." }, 404, request, env);
}

async function login(request, env) {
  if (!env.ACCESS_PASSWORD_HASH || !env.SESSION_SECRET) return json({ error: "Server secrets are not configured." }, 503, request, env);
  const body = await request.json().catch(() => ({}));
  if (typeof body.password !== "string" || body.password.length < 1 || body.password.length > 256) return json({ error: "Enter a valid password." }, 400, request, env);
  if (!(await verifyPassword(body.password, env.ACCESS_PASSWORD_HASH))) return json({ error: "That password is not correct." }, 401, request, env);
  const session = await seal({ access: true, exp: expiresAt() }, env.SESSION_SECRET);
  return json({ session }, 200, request, env);
}

async function oauthStart(request, env, session) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return json({ error: "GitHub OAuth is not configured." }, 503, request, env);
  const state = await seal({ session, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60_000 }, env.SESSION_SECRET);
  const callback = `${new URL(request.url).origin}/api/oauth/callback`;
  const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callback, scope: "repo read:user", state, allow_signup: "true" });
  return json({ url: `https://github.com/login/oauth/authorize?${params}` }, 200, request, env);
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  let message;
  try {
    if (url.searchParams.get("error")) throw new Error("GitHub authorization was cancelled.");
    const state = await unseal(url.searchParams.get("state") || "", env.SESSION_SECRET);
    const existing = await unseal(state?.session || "", env.SESSION_SECRET);
    if (!state || !existing?.access || state.exp < Date.now()) throw new Error("The sign-in request expired. Please try again.");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("GitHub did not return an authorization code.");
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "RepoLab" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/api/oauth/callback` }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error("GitHub could not complete authorization.");
    message = { type: "repolab-oauth", session: await seal({ access: true, gh: token.access_token, exp: expiresAt() }, env.SESSION_SECRET) };
  } catch (error) {
    message = { type: "repolab-oauth", error: error instanceof Error ? error.message : "GitHub sign-in failed." };
  }
  const target = allowedOrigins(env)[0];
  const payload = JSON.stringify(message).replace(/</g, "\\u003c");
  return new Response(`<!doctype html><meta charset="utf-8"><title>GitHub connected</title><style>body{font:16px system-ui;background:#07110e;color:#edf4f0;display:grid;place-items:center;height:100vh;margin:0}</style><p>Finishing GitHub sign-in…</p><script>window.opener?.postMessage(${payload},${JSON.stringify(target)});window.close()</script>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';", "Referrer-Policy": "no-referrer" } });
}

async function listRepos(request, env, token) {
  const response = await githubFetch("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member", token);
  if (!response.ok) return githubError(response, request, env);
  const repos = (await response.json()).map((repo) => ({ id: repo.id, name: repo.name, full_name: repo.full_name, private: repo.private, default_branch: repo.default_branch, owner: { login: repo.owner.login } }));
  return json({ repos }, 200, request, env);
}

async function getTree(request, env, token) {
  const url = new URL(request.url);
  const owner = safeName(url.searchParams.get("owner"));
  const repo = safeName(url.searchParams.get("repo"));
  const ref = url.searchParams.get("ref") || "HEAD";
  if (!owner || !repo || ref.length > 255) return json({ error: "Invalid repository." }, 400, request, env);
  const response = await githubFetch(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, token);
  if (!response.ok) return githubError(response, request, env);
  const body = await response.json();
  if (body.truncated) return json({ error: "This repository is too large for the browser workspace." }, 413, request, env);
  return json({ tree: body.tree.map(({ path, mode, type, sha, size = 0 }) => ({ path, mode, type, sha, size })) }, 200, request, env);
}

async function getFiles(request, env, token) {
  const body = await request.json().catch(() => ({}));
  const owner = safeName(body.owner);
  const repo = safeName(body.repo);
  if (!owner || !repo || !Array.isArray(body.files)) return json({ error: "Invalid file request." }, 400, request, env);
  if (body.files.length > MAX_FILES) return json({ error: `Choose ${MAX_FILES} files or fewer.` }, 413, request, env);
  const total = body.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  if (total > MAX_BYTES) return json({ error: "The selection is larger than 10 MB." }, 413, request, env);
  if (body.files.some((file) => !/^[0-9a-f]{40}$/.test(file.sha || "") || typeof file.path !== "string")) return json({ error: "Invalid file selection." }, 400, request, env);

  const files = [];
  for (let index = 0; index < body.files.length; index += 12) {
    const batch = body.files.slice(index, index + 12);
    const results = await Promise.all(batch.map(async (file) => {
      const response = await githubFetch(`/repos/${owner}/${repo}/git/blobs/${file.sha}`, token);
      if (!response.ok) throw new Error(`Could not download ${file.path}.`);
      const blob = await response.json();
      return { path: file.path, content: blob.content.replace(/\n/g, ""), encoding: blob.encoding };
    }));
    files.push(...results);
  }
  return json({ files }, 200, request, env);
}

async function githubJson(path, token, request, env, map) {
  const response = await githubFetch(path, token);
  if (!response.ok) return githubError(response, request, env);
  return json(map(await response.json()), 200, request, env);
}

function githubFetch(path, token) {
  return fetch(`https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "RepoLab", "X-GitHub-Api-Version": "2022-11-28" } });
}

async function githubError(response, request, env) {
  const detail = await response.json().catch(() => ({}));
  return json({ error: detail.message ? `GitHub: ${detail.message}` : "GitHub request failed." }, response.status, request, env);
}

function pickUser(user) { return { login: user.login, avatar_url: user.avatar_url, name: user.name }; }
function safeName(value) { return typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value) ? value : ""; }
function expiresAt() { return Date.now() + SESSION_HOURS * 60 * 60_000; }

async function requireSession(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const session = await unseal(header.slice(7), env.SESSION_SECRET);
  return session?.access && session.exp > Date.now() ? session : null;
}

async function verifyPassword(password, stored) {
  const [scheme, iterationsText, saltText, expectedText] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterationsText || !saltText || !expectedText) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(saltText), iterations }, key, 256));
  const expected = fromBase64Url(expectedText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}

async function seal(payload, secret) {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return `${toBase64Url(iv)}.${toBase64Url(encrypted)}`;
}

async function unseal(value, secret) {
  try {
    const [ivText, encryptedText] = value.split(".");
    if (!ivText || !encryptedText) return null;
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(ivText) }, await aesKey(secret), fromBase64Url(encryptedText));
    return JSON.parse(decoder.decode(plaintext));
  } catch { return null; }
}

async function aesKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64Url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function fromBase64Url(value) { const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4); return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)); }
function allowedOrigins(env) { return (env.ALLOWED_ORIGINS || "http://localhost:5173").split(",").map((value) => value.trim()).filter(Boolean); }
function requestOrigin(request) { return request.headers.get("Origin") || ""; }
function corsHeaders(request, env) { const origin = requestOrigin(request); return allowedOrigins(env).includes(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}; }
function corsResponse(request, env) { return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400" } }); }
function json(body, status, request, env) { return Response.json(body, { status, headers: { ...corsHeaders(request, env), "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'", "X-Content-Type-Options": "nosniff" } }); }
