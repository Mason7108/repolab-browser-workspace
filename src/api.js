const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8787").replace(/\/$/, "");
const SESSION_KEY = "repolab_session";
const OAUTH_CHANNEL = "repolab_oauth";

export function getSession() {
  return sessionStorage.getItem(SESSION_KEY) || "";
}

export function setSession(value) {
  if (value) sessionStorage.setItem(SESSION_KEY, value);
  else sessionStorage.removeItem(SESSION_KEY);
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  if (getSession()) headers.set("Authorization", `Bearer ${getSession()}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) setSession("");
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function login(password) {
  const data = await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
  setSession(data.session);
  return data;
}

export async function connectGitHub() {
  // Open synchronously from the click so strict popup blockers permit it.
  const popup = window.open("about:blank", "repolab-github", "popup,width=720,height=760");
  if (!popup) throw new Error("Allow pop-ups to connect GitHub.");
  let url;
  try {
    ({ url } = await api("/api/oauth/start", { method: "POST" }));
  } catch (error) {
    popup.close();
    throw error;
  }

  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    const timer = window.setTimeout(() => finish(new Error("GitHub sign-in timed out.")), 180000);
    function finish(error, session) {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      channel.removeEventListener("message", onBroadcast);
      channel.close();
      if (error) reject(error);
      else {
        setSession(session);
        resolve();
      }
    }
    function onMessage(event) {
      if (event.origin !== window.location.origin || event.data?.type !== "repolab-oauth") return;
      accept(event.data);
    }
    function onBroadcast(event) { if (event.data?.type === "repolab-oauth") accept(event.data); }
    function accept(payload) { finish(payload.error ? new Error(payload.error) : null, payload.session); }
    window.addEventListener("message", onMessage);
    channel.addEventListener("message", onBroadcast);
    popup.location.href = url;
  });
}

export function consumeOAuthRedirect() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const session = params.get("oauth_session");
  const error = params.get("oauth_error");
  if (!session && !error) return false;

  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  const payload = { type: "repolab-oauth", ...(session ? { session } : { error }) };
  if (session) setSession(session);
  const channel = new BroadcastChannel(OAUTH_CHANNEL);
  channel.postMessage(payload);
  if (window.opener) window.opener.postMessage(payload, window.location.origin);
  window.setTimeout(() => { channel.close(); window.close(); }, 150);
  return true;
}
