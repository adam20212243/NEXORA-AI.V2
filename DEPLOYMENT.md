# NEXORA AI — Public Standalone Deployment Guide (Abasthan & GitHub)

NEXORA AI is a self-contained full-stack Node.js + Express + React (Vite) application. It does **not** require Google AI Studio sessions or developer login for end users. All AI calls execute securely on the backend server.

---

## 1. Prerequisites
- **Node.js 22.18+** (uses built-in `node:sqlite` and native TypeScript stripping; `.nvmrc` is set to `22`)
- **GitHub Repository** containing this codebase (`main` / `master` branch)
- **At least one AI Provider API Key** (e.g. `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`)

---

## 2. Abasthan Deployment Settings (GitHub Integration)

1. Push this repository to GitHub (excluding `.env`, `data/*.db*`, `dist/`, `node_modules/`).
2. In **Abasthan**, create a new **Web Service / Node.js App** linked to your GitHub repository.
3. Configure the build and start commands:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start` *(runs `node server.ts`, listens on `0.0.0.0:$PORT`, and serves the built React app from `dist/` alongside `/api/*`)*
   - **Health Check Path:** `/health` (returns HTTP `200` JSON `{ ok: true }`)
4. *(Recommended)* Attach a persistent storage volume mounted to `./data` (or `/data` with `NEXORA_DB_PATH=/data/nexora.db`) so conversations, settings, and the Knowledge Base persist across redeploys.

---

## 3. Environment Variables (Set on Abasthan Dashboard Only)

> Never put API keys in client code, `VITE_*` variables, or the Android APK.

### Required
| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | Enables Express static production serving from `dist/` | `production` |
| `GEMINI_API_KEY` | Primary Google Gemini API key (used only on server) | `AIza...` |
| `NEXORA_ADMIN_PASSCODE` | Strong password protecting `/api/knowledge/*` and System Admin UI (does **not** block normal users) | `your-strong-admin-password` |

### Recommended for Production & Android
| Variable | Description | Example |
|---|---|---|
| `PUBLIC_APP_URL` | Public HTTPS domain of your Abasthan deployment | `https://nexora.your-domain.com` |
| `SESSION_SECRET` | Random 32+ char string for signing admin bearer tokens across restarts | *(random hex string)* |
| `NEXORA_DB_PATH` | SQLite database file path | `./data/nexora.db` |
| `CORS_ALLOWED_ORIGINS` | Optional extra comma-separated HTTPS origins allowed for cross-origin API calls | `https://app.your-domain.com` |

### Optional AI Providers & Android APK
| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | Optional OpenAI server key |
| `ANTHROPIC_API_KEY` | Optional Anthropic Claude server key |
| `OPENAI_COMPATIBLE_BASE_URL` / `OPENAI_COMPATIBLE_API_KEY` | Optional OpenAI-compatible endpoint |
| `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` | Optional self-hosted/Ollama model |
| `NEXORA_GITHUB_REPO` | Public GitHub slug (`owner/repo`) for auto-resolving APK releases |
| `NEXORA_APK_RELEASE_URL` | Direct HTTPS URL to a published `.apk` asset |

*(Abasthan injects `PORT` automatically; if omitted locally, the server defaults to `3000`.)*

---

## 4. Android WebView Wrapper (`bridges/android`)

To point the compiled Android APK at your public Abasthan domain instead of prompting on first launch:
1. In GitHub Repository **Settings → Secrets and variables → Actions → Variables**, set:
   - `NEXORA_WEB_URL` = `https://your-public-abasthan-url.com`
2. Tag and push a release (`git tag v1.0.0 && git push origin v1.0.0`) to build and publish the signed APK automatically.

---

## 5. Verification Checklist After Deploy
1. Open `https://your-public-abasthan-url.com` in a fresh Incognito/Private browser **with no Google account signed in**.
2. Confirm the main chat workspace loads immediately without any login gate.
3. Send a message, test Web Research / File Manager, and verify `/health` returns `200 OK`.
4. Confirm **System Admin** remains locked behind `NEXORA_ADMIN_PASSCODE`.
