# Relevect - Local Context Engine for Claude

<div align="center">
  <img src="./logo-transparent.svg" alt="Relevect Logo" width="450" />
  <h3 style="color:grey;margin-top: -20px;">Relevect helps Claude search your local files.</h3>
</div>

<br>

## Fastest Start

### Option 1: one command with Docker

```bash
docker compose up --build
```

Then open:

- API: `http://127.0.0.1:8000`
- UI: `http://127.0.0.1:1420`

### Option 2: run it locally in 3 steps

#### 1. Install Python dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

#### 2. Start FastAPI

```bash
.venv/bin/uvicorn api.main:app --reload
```

#### 3. Start the UI

```bash
cd web-app
npm install
npm run dev
```

Then open `http://127.0.0.1:1420`.

## How To Use

1. Start the API and UI.
2. Add a local folder in the UI.
3. Scan and index files.
4. Search your files.

## Connect To Claude Desktop

Relevect's MCP server is configured manually today.

Edit:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add or merge:

```json
{
  "mcpServers": {
    "relevect": {
      "command": "/ABSOLUTE/PATH/TO/RELEVECT/.venv/bin/python",
      "args": ["/ABSOLUTE/PATH/TO/RELEVECT/mcp_server/server.py"],
      "cwd": "/ABSOLUTE/PATH/TO/RELEVECT"
    }
  }
}
```

Then:

1. Fully quit Claude Desktop with `Cmd+Q`.
2. Reopen Claude Desktop.
3. Check Claude's connectors/tools menu for `relevect`.

Note:

- Relevect's MCP server currently exposes search.
- Your local Relevect index must already exist before Claude can search it.
- The current `web-app/` does not install this config automatically.

## Supported Files

- `.md`
- `.txt`
- `.pdf`

## Project Structure

- `api/` FastAPI app
- `core/` indexing and search logic
- `web-app/` local UI
- `mcp_server/` MCP server for Claude-style clients
- `tests/` test suite

## Useful Commands

Run tests:

```bash
.venv/bin/pytest -q
```

Run the MCP server:

```bash
.venv/bin/python mcp_server/server.py
```

## Notes

- The default database is `./data/relevect.db`.
- The UI talks to FastAPI at `http://127.0.0.1:8000`.
- Embeddings use a local `sentence-transformers` model. If the model is not already available locally, indexing and search can fail.

