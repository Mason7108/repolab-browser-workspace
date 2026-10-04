import { useEffect, useMemo, useState } from "react";
import {
  SandpackCodeEditor,
  SandpackConsole,
  SandpackFileExplorer,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
} from "@codesandbox/sandpack-react";
import { Check, ChevronRight, Code2, Folder, Github, LoaderCircle, LockKeyhole, LogOut, Play, Search, ShieldCheck } from "lucide-react";
import { api, connectGitHub, getSession, login, setSession } from "./api";
import { prepareSandpackFiles } from "./runner";

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;

export default function App() {
  const [stage, setStage] = useState(getSession() ? "checking" : "locked");
  const [user, setUser] = useState(null);
  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState(null);
  const [tree, setTree] = useState([]);
  const [folder, setFolder] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (stage !== "checking") return;
    api("/api/me").then(({ user: nextUser }) => {
      setUser(nextUser || null);
      setStage(nextUser ? "repos" : "connect");
    }).catch(() => setStage("locked"));
  }, [stage]);

  useEffect(() => {
    if (stage !== "repos" || repos.length) return;
    runTask(async () => setRepos((await api("/api/repos")).repos));
  }, [stage]);

  async function runTask(task) {
    setBusy(true);
    setError("");
    try { await task(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function unlock(event) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    await runTask(async () => { await login(password); setStage("connect"); });
  }

  async function connect() {
    await runTask(async () => {
      await connectGitHub();
      const result = await api("/api/me");
      setUser(result.user);
      setStage("repos");
    });
  }

  async function chooseRepo(nextRepo) {
    await runTask(async () => {
      const result = await api(`/api/tree?owner=${encodeURIComponent(nextRepo.owner.login)}&repo=${encodeURIComponent(nextRepo.name)}&ref=${encodeURIComponent(nextRepo.default_branch)}`);
      setRepo(nextRepo);
      setTree(result.tree.filter((item) => item.type === "blob"));
      setFolder("");
      setSelected(new Set());
      setStage("files");
    });
  }

  const folders = useMemo(() => {
    const result = new Set([""]);
    for (const item of tree) {
      const parts = item.path.split("/");
      parts.pop();
      while (parts.length) { result.add(parts.join("/")); parts.pop(); }
    }
    return [...result].sort((a, b) => a.localeCompare(b));
  }, [tree]);

  const visibleFiles = useMemo(() => tree.filter((item) => !folder || item.path.startsWith(`${folder}/`)), [tree, folder]);

  function selectFolder(nextFolder) {
    setFolder(nextFolder);
    setSelected(new Set(tree.filter((item) => !nextFolder || item.path.startsWith(`${nextFolder}/`)).map((item) => item.path)));
  }

  function toggleFile(path) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  async function launch() {
    const chosen = tree.filter((item) => selected.has(item.path));
    const total = chosen.reduce((sum, item) => sum + item.size, 0);
    if (!chosen.length) return setError("Choose at least one file.");
    if (total > MAX_DOWNLOAD_BYTES) return setError("Selection is larger than the 10 MB browser-workspace limit.");
    await runTask(async () => {
      const result = await api("/api/files", {
        method: "POST",
        body: JSON.stringify({ owner: repo.owner.login, repo: repo.name, files: chosen.map(({ path, sha, size }) => ({ path, sha, size })) }),
      });
      const prepared = prepareSandpackFiles(result.files, folder);
      setFiles(prepared);
      setStage("workspace");
    });
  }

  function logout() {
    setSession("");
    setUser(null); setRepos([]); setRepo(null); setTree([]); setFiles(null); setStage("locked");
  }

  if (["locked", "checking"].includes(stage)) return <Shell error={error}><Unlock onSubmit={unlock} busy={busy || stage === "checking"} /></Shell>;
  if (stage === "connect") return <Shell error={error}><Connect onConnect={connect} busy={busy} /></Shell>;
  if (stage === "repos") return <Shell user={user} onLogout={logout} error={error}><RepositoryPicker repos={repos} onChoose={chooseRepo} busy={busy} /></Shell>;
  if (stage === "files") return <Shell user={user} onLogout={logout} error={error}><FilePicker repo={repo} folders={folders} folder={folder} onFolder={selectFolder} files={visibleFiles} selected={selected} onToggle={toggleFile} onLaunch={launch} busy={busy} onBack={() => setStage("repos")} /></Shell>;
  return <Workspace repo={repo} files={files} onBack={() => setStage("files")} />;
}

function Shell({ children, user, onLogout, error }) {
  return <main className="app-shell">
    <header><div className="brand"><span><Code2 size={20} /></span> RepoLab</div>{user && <div className="user"><img src={user.avatar_url} alt="" /><span>{user.login}</span><button className="icon-button" onClick={onLogout} title="Sign out"><LogOut size={18} /></button></div>}</header>
    <section className="center-stage">{children}{error && <div className="error" role="alert">{error}</div>}</section>
    <footer><ShieldCheck size={15} /> Secrets stay on the server. Repository code runs in an isolated preview. Copyright © 2026 by Mason7108 Apps. All Rights Reserved. This application is only to be accessed by authorized users from Mason7108 Apps. Any unathorized duplication, distribution, or exhibiton of this application are not allowed.</footer>
  </main>;
}

function Unlock({ onSubmit, busy }) {
  return <div className="card auth-card"><div className="hero-icon"><LockKeyhole /></div><p className="eyebrow">Private workspace</p><h1>Enter RepoLab</h1><p className="lede">Use the access password to unlock this workspace.</p><form onSubmit={onSubmit}><label htmlFor="password">Secure password</label><input id="password" name="password" type="password" autoComplete="current-password" required autoFocus placeholder="Enter your password" /><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <LockKeyhole size={18} />} Unlock workspace</button></form><p className="fine-print">Your password is sent over HTTPS for verification and is never stored in this site.</p></div>;
}

function Connect({ onConnect, busy }) {
  return <div className="card auth-card"><div className="step-done"><Check size={16} /> Access verified</div><div className="hero-icon github"><Github /></div><h1>Connect GitHub</h1><p className="lede">Authorize read-only repository access. RepoLab cannot change your code.</p><button className="primary" onClick={onConnect} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Github size={19} />} Continue with GitHub</button><p className="fine-print">You can revoke access at any time from GitHub settings.</p></div>;
}

function RepositoryPicker({ repos, onChoose, busy }) {
  const [query, setQuery] = useState("");
  const filtered = repos.filter((item) => item.full_name.toLowerCase().includes(query.toLowerCase()));
  return <div className="wide-card"><div className="section-heading"><div><p className="eyebrow">Step 2 of 3</p><h1>Choose a repository</h1><p>Select the project you want to inspect and run.</p></div><div className="search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a repository" /></div></div><div className="repo-list">{busy ? <Empty icon={<LoaderCircle className="spin" />} text="Loading repositories…" /> : filtered.map((item) => <button className="repo-row" key={item.id} onClick={() => onChoose(item)}><div className="repo-mark"><Github /></div><div><strong>{item.name}</strong><span>{item.owner.login} · {item.private ? "Private" : "Public"}</span></div><ChevronRight /></button>)}</div></div>;
}

function FilePicker({ repo, folders, folder, onFolder, files, selected, onToggle, onLaunch, busy, onBack }) {
  const total = files.filter((item) => selected.has(item.sha)).reduce((sum, item) => sum + item.size, 0);
  return <div className="wide-card file-card"><div className="section-heading"><div><button className="back" onClick={onBack}>← Repositories</button><p className="eyebrow">Step 3 of 3</p><h1>{repo.name}</h1><p>Choose a folder, refine its files, then open the workspace.</p></div><button className="primary launch" disabled={busy || !selected.size} onClick={onLaunch}>{busy ? <LoaderCircle className="spin" /> : <Play size={17} />} Run {selected.size} files</button></div><div className="browser"><aside><h3>Folders</h3>{folders.map((item) => <button className={folder === item ? "active" : ""} key={item || "root"} onClick={() => onFolder(item)}><Folder size={16} />{item || "Repository root"}</button>)}</aside><div className="file-list"><div className="file-summary"><span>{selected.size} of {files.length} selected</span><span>{formatBytes(total)}</span></div>{files.map((item) => <label className="file-row" key={item.sha}><input type="checkbox" checked={selected.has(item.path)} onChange={() => onToggle(item.path)} /><span>{folder ? item.path.slice(folder.length + 1) : item.path}</span><small>{formatBytes(item.size)}</small></label>)}</div></div></div>;
}

function Workspace({ repo, files, onBack }) {
  const entries = Object.entries(files);
  const activeFile = entries.find(([, file]) => file.active)?.[0] || "/index.html";
  const visibleFiles = entries.filter(([, file]) => !file.hidden).map(([path]) => path).slice(0, 12);

  return <main className="workspace"><div className="workspace-bar"><div><button className="back" onClick={onBack}>← Files</button><strong>{repo.full_name}</strong></div><span className="live"><i /> Live preview</span></div><SandpackProvider template="static" files={files} theme="dark" options={{ activeFile, visibleFiles, recompileMode: "delayed", recompileDelay: 350 }}><SandpackLayout className="sandpack-main"><div className="explorer-pane"><SandpackFileExplorer /></div><SandpackCodeEditor showTabs showLineNumbers wrapContent /><div className="output-pane"><SandpackPreview showOpenInCodeSandbox={false} showRefreshButton /><SandpackConsole showHeader standalone /></div></SandpackLayout></SandpackProvider></main>;
}

function Empty({ icon, text }) { return <div className="empty">{icon}<p>{text}</p></div>; }
function formatBytes(bytes) { if (!bytes) return "0 B"; const units = ["B", "KB", "MB"]; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 2); return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
