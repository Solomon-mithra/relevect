const API_BASE = "http://127.0.0.1:8000";

const state = {
  folders: [],
  files: [],
  jobs: [],
  selectedFolderId: null,
  selectedFileId: null,
  searchResults: []
};

const byId = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    throw new Error(detail);
  }

  return body;
}

function renderJson(id, value) {
  byId(id).textContent = JSON.stringify(value, null, 2);
}

function activateTab(nextTab) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === nextTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${nextTab}`);
  });
}

function folderName(folder) {
  return folder.path.split("/").filter(Boolean).at(-1) ?? folder.path;
}

function selectedFolder() {
  return state.folders.find((folder) => folder.id === state.selectedFolderId) ?? null;
}

function selectedFile() {
  return state.files.find((file) => file.id === state.selectedFileId) ?? null;
}

function relativeTime(value) {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function fileStatusTone(status) {
  if (status === "failed") {
    return "danger";
  }
  if (status === "pending" || status === "discovered") {
    return "warn";
  }
  if (status === "indexed") {
    return "ok";
  }
  return "neutral";
}

function renderStatusCards(files) {
  const container = byId("status-cards");
  container.innerHTML = "";

  const entries = [
    ["Total", files.total],
    ["Discovered", files.discovered],
    ["Pending", files.pending],
    ["Indexed", files.indexed],
    ["Failed", files.failed],
    ["Deleted", files.deleted],
    ["Chunks", files.chunks]
  ];

  for (const [label, value] of entries) {
    const article = document.createElement("article");
    article.className = "status-card";
    article.innerHTML = `<span class="status-label">${label}</span><strong class="status-value">${value}</strong>`;
    container.append(article);
  }
}

function renderFolders() {
  const container = byId("folder-list");
  container.innerHTML = "";

  if (!state.folders.length) {
    container.className = "folder-list empty-state";
    container.textContent = "Add a trusted folder to begin.";
    return;
  }

  container.className = "folder-list";

  for (const folder of state.folders) {
    const folderFiles = state.files.filter((file) => file.folder_id === folder.id);
    const pending = folderFiles.filter((file) =>
      ["pending", "discovered", "failed"].includes(file.status)
    ).length;
    const indexed = folderFiles.filter((file) => file.status === "indexed").length;
    const button = document.createElement("button");
    const isActive = folder.id === state.selectedFolderId;
    button.className = `folder-item${isActive ? " is-selected" : ""}`;
    button.innerHTML = `
      <div class="folder-item-head">
        <span class="folder-title">${folderName(folder)}</span>
        <span class="mini-stat">${folderFiles.length} files</span>
      </div>
      <span class="folder-path">${folder.path}</span>
      <div class="folder-foot">
        <span class="mini-badge">${indexed} indexed</span>
        <span class="mini-badge ${pending ? "mini-badge-warn" : ""}">${pending} pending</span>
      </div>
    `;
    button.addEventListener("click", () => {
      state.selectedFolderId = folder.id;
      const visibleFiles = state.files.filter((file) => file.folder_id === folder.id);
      state.selectedFileId = visibleFiles[0]?.id ?? null;
      renderFolders();
      renderFiles();
      renderInspector();
    });
    container.append(button);
  }
}

function renderFiles() {
  const container = byId("file-list");
  const subtitle = byId("library-subtitle");
  const visibleFiles = state.selectedFolderId
    ? state.files.filter((file) => file.folder_id === state.selectedFolderId)
    : state.files;

  const folder = selectedFolder();
  subtitle.textContent = folder
    ? `Files inside ${folderName(folder)}.`
    : "Files across all trusted folders.";

  container.innerHTML = "";

  if (!visibleFiles.length) {
    container.className = "file-list empty-state";
    container.textContent = "Scan a folder to see discovered and indexed files.";
    return;
  }

  container.className = "file-list";

  for (const file of visibleFiles) {
    const article = document.createElement("article");
    const isSelected = file.id === state.selectedFileId;
    article.className = `file-row${isSelected ? " is-selected" : ""}`;
    article.innerHTML = `
      <div class="file-main">
        <span class="file-name">${file.file_name}</span>
        <span class="file-path">${file.path}</span>
      </div>
      <div class="file-meta">
        <span class="badge badge-${fileStatusTone(file.status)}">${file.status}</span>
        <span class="file-detail">${file.chunk_count} chunks</span>
        <span class="file-detail">${file.parser_type ?? "unparsed"}</span>
      </div>
    `;
    article.addEventListener("click", () => {
      state.selectedFileId = file.id;
      renderFiles();
      renderInspector();
    });
    container.append(article);
  }
}

function renderJobs() {
  const container = byId("jobs-list");
  container.innerHTML = "";

  if (!state.jobs.length) {
    container.className = "jobs-list empty-state";
    container.textContent = "No jobs yet.";
    return;
  }

  container.className = "jobs-list";

  for (const job of state.jobs.slice(0, 6)) {
    const article = document.createElement("article");
    article.className = "job-row";
    article.innerHTML = `
      <div class="job-main">
        <span class="job-type">${job.job_type}</span>
        <span class="job-time">${relativeTime(job.started_at)}</span>
      </div>
      <div class="job-meta">
        <span class="badge badge-${job.status === "failed" ? "danger" : "ok"}">${job.status}</span>
        <span class="job-error">${job.error ?? ""}</span>
      </div>
    `;
    container.append(article);
  }
}

function renderInspector() {
  const container = byId("inspector");
  const file = selectedFile();
  const folder = selectedFolder();

  if (file) {
    container.className = "inspector";
    container.innerHTML = `
      <div class="inspector-card">
        <p class="section-kicker">Selected file</p>
        <h3>${file.file_name}</h3>
        <p class="inspector-path">${file.path}</p>
        <dl class="inspector-grid">
          <div><dt>Status</dt><dd>${file.status}</dd></div>
          <div><dt>Parser</dt><dd>${file.parser_type ?? "Not parsed yet"}</dd></div>
          <div><dt>Chunks</dt><dd>${file.chunk_count}</dd></div>
          <div><dt>Embedding</dt><dd>${file.embedding_model ?? "Not embedded yet"}</dd></div>
          <div><dt>Size</dt><dd>${file.size_bytes ?? 0} bytes</dd></div>
          <div><dt>Indexed at</dt><dd>${relativeTime(file.last_indexed_at)}</dd></div>
        </dl>
        <p class="inspector-note">
          ${file.last_error ? `Last error: ${file.last_error}` : "This file is eligible for indexing and search under its trusted folder."}
        </p>
      </div>
    `;
    return;
  }

  if (folder) {
    const folderFiles = state.files.filter((entry) => entry.folder_id === folder.id);
    const indexedCount = folderFiles.filter((entry) => entry.status === "indexed").length;
    const pendingCount = folderFiles.filter((entry) =>
      ["pending", "discovered", "failed"].includes(entry.status)
    ).length;
    const failedCount = folderFiles.filter((entry) => entry.status === "failed").length;

    container.className = "inspector";
    container.innerHTML = `
      <div class="inspector-card">
        <p class="section-kicker">Selected folder</p>
        <h3>${folderName(folder)}</h3>
        <p class="inspector-path">${folder.path}</p>
        <dl class="inspector-grid">
          <div><dt>Total files</dt><dd>${folderFiles.length}</dd></div>
          <div><dt>Indexed</dt><dd>${indexedCount}</dd></div>
          <div><dt>Pending</dt><dd>${pendingCount}</dd></div>
          <div><dt>Failed</dt><dd>${failedCount}</dd></div>
          <div><dt>Added</dt><dd>${relativeTime(folder.created_at)}</dd></div>
          <div><dt>Last updated</dt><dd>${relativeTime(folder.updated_at)}</dd></div>
        </dl>
        <p class="inspector-note">
          The core product flow is still explicit: trust this folder, scan for changes, then run indexing.
        </p>
      </div>
    `;
    return;
  }

  container.className = "inspector empty-state";
  container.textContent = "Select a folder or file to inspect what Relevect knows about it.";
}

function renderSearchResults() {
  const container = byId("search-results");
  const summary = byId("search-summary");
  container.innerHTML = "";

  if (!state.searchResults.length) {
    container.className = "search-results empty-state";
    container.textContent = "Search results will appear here with source snippets and scores.";
    summary.textContent = "Results will surface the strongest passages from indexed files, with provenance.";
    return;
  }

  container.className = "search-results";
  const top = state.searchResults[0];
  summary.textContent = `Top match: ${top.file_name} with score ${top.score.toFixed(3)}.`;

  for (const result of state.searchResults) {
    const article = document.createElement("article");
    article.className = "search-card";
    article.innerHTML = `
      <div class="search-card-header">
        <div>
          <p class="result-label">${result.file_name}</p>
          <h3>${result.metadata?.heading ?? "Source passage"}</h3>
          <p>${result.path}</p>
        </div>
        <span class="score-pill">Score ${result.score.toFixed(3)}</span>
      </div>
      <p class="search-snippet">${result.snippet ?? ""}</p>
      <div class="search-breakdown">
        <span>Semantic ${Number(result.normalized_semantic_score ?? 0).toFixed(2)}</span>
        <span>BM25 ${Number(result.normalized_bm25_score ?? 0).toFixed(2)}</span>
        <span>Phrase ${Number(result.phrase_score ?? 0).toFixed(2)}</span>
      </div>
    `;
    container.append(article);
  }
}

async function refreshHealth() {
  try {
    const health = await api("/health", { method: "GET" });
    byId("engine-status").textContent = `Engine ${health.status}`;
    byId("engine-status").className = "signal signal-live";
  } catch {
    byId("engine-status").textContent = "Engine offline";
    byId("engine-status").className = "signal signal-error";
  }
}

async function refreshFolders() {
  const data = await api("/folders", { method: "GET" });
  state.folders = data.folders;
  if (!state.selectedFolderId && state.folders.length) {
    state.selectedFolderId = state.folders[0].id;
  }
  renderFolders();
  renderInspector();
  renderJson("folders-output", data);
}

async function refreshFiles() {
  const data = await api("/files", { method: "GET" });
  state.files = data.files;
  const visibleFiles = state.selectedFolderId
    ? state.files.filter((file) => file.folder_id === state.selectedFolderId)
    : state.files;
  const stillVisible = visibleFiles.some((file) => file.id === state.selectedFileId);
  if (!stillVisible) {
    state.selectedFileId = visibleFiles[0]?.id ?? null;
  }
  renderFiles();
  renderInspector();
  renderJson("files-output", data);
}

async function refreshStatus() {
  const data = await api("/index/status", { method: "GET" });
  state.jobs = data.recent_jobs;
  renderStatusCards(data.files);
  renderJobs();
  renderJson("jobs-output", data.recent_jobs);
}

async function registerFolder() {
  const path = byId("folder-path").value.trim();
  if (!path) {
    throw new Error("Enter a folder path before registering.");
  }
  await api("/folders", {
    method: "POST",
    body: JSON.stringify({ path })
  });
  byId("folder-path").value = "";
}

async function scanFolders() {
  await api("/index/scan", {
    method: "POST",
    body: JSON.stringify({})
  });
}

async function runIndexing() {
  const result = await api("/index/run", {
    method: "POST",
    body: JSON.stringify({})
  });
  renderJson("jobs-output", result);
}

async function runSearch() {
  const query = byId("search-query").value.trim();
  if (!query) {
    throw new Error("Enter a query before searching.");
  }
  const result = await api("/search", {
    method: "POST",
    body: JSON.stringify({ query, top_k: 5, include_text: true })
  });
  state.searchResults = result.results;
  renderSearchResults();
  renderJson("search-output", result);
}

async function withRefresh(action) {
  try {
    await action();
    await Promise.all([refreshFolders(), refreshFiles(), refreshStatus(), refreshHealth()]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderJson("jobs-output", { error: message });
    state.searchResults = [];
    renderSearchResults();
  }
}

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

byId("register-folder").addEventListener("click", () => withRefresh(registerFolder));
byId("scan-folders").addEventListener("click", () => withRefresh(scanFolders));
byId("run-indexing").addEventListener("click", () => withRefresh(runIndexing));
byId("refresh-all").addEventListener("click", () => withRefresh(async () => {}));
byId("refresh-status").addEventListener("click", () => withRefresh(refreshStatus));
byId("refresh-folders").addEventListener("click", () => withRefresh(refreshFolders));
byId("refresh-files").addEventListener("click", () => withRefresh(refreshFiles));
byId("run-search").addEventListener("click", () => withRefresh(runSearch));

await withRefresh(async () => {});
