# RepoLab

RepoLab is a password-gated, browser-only workspace for previewing static projects from GitHub. After unlocking the site, a user connects GitHub, chooses a repository and folder, selects files, and runs the result in an isolated preview with an editor and console.

## Security model

- The public GitHub Pages bundle contains **no password, password hash, OAuth client secret, or GitHub access token**.
- A Cloudflare Worker verifies a PBKDF2 password hash stored as an encrypted Worker secret.
- GitHub's OAuth client secret and access token remain inside the Worker. The browser receives an opaque AES-GCM-encrypted session token kept in `sessionStorage`.
- Imported code runs in CodeSandbox Sandpack's cross-origin preview, not in the RepoLab page or the Worker.
- OAuth asks only for `read:user`. This version browses public repositories and does not request private-repository or write-capable access.

Selected repository files are delivered to CodeSandbox's Sandpack preview origin so the browser can run them. Do not select private source that your policy forbids sharing with CodeSandbox; self-host the Sandpack bundler before using RepoLab for that material.

The browser can always inspect an opaque session token and the repository files it intentionally downloads. That is normal: a browser must receive code in order to display and run it. It cannot inspect the original password, OAuth client secret, or raw GitHub token.

## What it runs

This release can open any selection of text files for browsing and editing. Static browser projects with an `index.html` at the selected folder root also get a live webpage preview. When `index.html` is absent, RepoLab supplies a hidden informational preview page instead of blocking the workspace. CSS, JavaScript, JSON, images, fonts, audio, and video are supported, and binary asset references are converted to in-memory data URLs. Selection is capped at 200 files and 10 MB.

Reading private repositories without granting the broad classic OAuth `repo` scope requires converting the integration to a GitHub App with **Contents: read-only** permission. RepoLab intentionally does not request the broader OAuth scope.

It deliberately does **not** execute repository build scripts, shell commands, native programs, or arbitrary server code. Supporting those safely requires a disposable-container service with resource limits, egress controls, and abuse protection; GitHub Pages cannot provide that environment.

## Local setup

Requirements: Node.js 20+ and a free Cloudflare account.

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and keep `VITE_API_BASE=http://localhost:8787`.
3. Create `worker/.dev.vars` (it is gitignored):

   ```dotenv
   ACCESS_PASSWORD_HASH=pbkdf2$100000$YOUR_SALT$YOUR_HASH
   SESSION_SECRET=use-a-long-random-value
   GITHUB_CLIENT_ID=your-oauth-client-id
   GITHUB_CLIENT_SECRET=your-oauth-client-secret
   ```

4. Generate the password hash with `npm run secret:hash`.
5. Create a GitHub OAuth App with callback URL `http://localhost:8787/api/oauth/callback`.
6. Run `npm run worker:dev` and `npm run dev` in separate terminals.

## Production deployment

1. Deploy the Worker: `npx wrangler login`, then `npm run worker:deploy`.
2. Add all four values with `npx wrangler secret put NAME`. Do not put secret values in `wrangler.toml`, GitHub variables, or repository files.
3. Change `ALLOWED_ORIGINS` in `worker/wrangler.toml` to the exact Pages URL, for example `https://USERNAME.github.io`.
4. Set the OAuth App callback to `https://repolab-api.YOUR-SUBDOMAIN.workers.dev/api/oauth/callback`.
5. In the GitHub repository, add an Actions variable named `VITE_API_BASE` containing the Worker URL.
6. In **Settings → Pages → Build and deployment**, select **GitHub Actions**. Push `main`; the included workflow tests, builds, and deploys the site.

For a public launch, also configure Cloudflare rate limiting for `POST /api/login`, use an allowlist if only a few people should enter, and review the OAuth App's access regularly.
