# Relevect Desktop

Tauri desktop shell for the local Relevect engine.

Current scope:

- static frontend that talks to the FastAPI engine on `http://127.0.0.1:8000`
- product workflow controls for:
  - folder registration
  - scan
  - bulk indexing
  - search
- status, files, and recent job inspection

## Prerequisites

- Node.js / npm
- Rust toolchain (`cargo`, `rustc`)
- Relevect engine running locally via `uvicorn api.main:app --reload`

## Commands

Install frontend dependencies:

```bash
cd desktop
npm install
```

Run the static UI only:

```bash
npm run dev
```

Build static UI assets:

```bash
npm run build
```

Run the Tauri desktop shell:

```bash
npm run tauri:dev
```

## Notes

- Rust is not yet installed in this workspace, so the Tauri shell cannot be compiled until the toolchain is added.
- The frontend is intentionally thin. The FastAPI engine remains the product core.
