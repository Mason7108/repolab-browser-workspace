const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8787").replace(/\/$/, "");
const SESSION_KEY = "repolab_session";

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
  const { url } = await api("/api/oauth/start", { method: "POST" });
  const popup = window.open(url, "repolab-github", "popup,width=720,height=760");
  if (!popup) throw new Error("Allow pop-ups to connect GitHub.");

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("GitHub sign-in timed out.")), 180000);
    function finish(error, session) {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (error) reject(error);
      else {
        setSession(session);
        resolve();
      }
    }
    function onMessage(event) {
      if (event.origin !== new URL(API_BASE).origin || event.data?.type !== "repolab-oauth") return;
      finish(event.data.error ? new Error(event.data.error) : null, event.data.session);
    }
    window.addEventListener("message", onMessage);
  });
}
