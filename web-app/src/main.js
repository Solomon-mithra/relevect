const API_BASE = "http://127.0.0.1:8000";

const state = {
  folders: [],
  files: [],
  jobs: [],
  selectedFolderId: null,
  selectedFileId: null,
  selectedFileIds: [],
  searchResults: [],
  confirmAction: null,
  indexing: {
    active: false,
    total: 0,
    completed: 0,
    currentFileName: null,
    currentJobId: null,
    currentStage: null,
    detail: null,
    progressPercent: 0,
  },
};

const byId = (id) => document.getElementById(id);
const tauriInvoke = globalThis.window?.__TAURI__?.core?.invoke;
const isNativeDesktop = typeof tauriInvoke === "function";

function setHomeFeedback(message, tone = "neutral") {
  const element = byId("home-feedback");
  if (!element) {
    return;
  }
  element.textContent = message;
  element.className = `home-feedback home-feedback-${tone}`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail =
      typeof body === "string" ? body : JSON.stringify(body, null, 2);
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
  return (
    state.folders.find((folder) => folder.id === state.selectedFolderId) ?? null
  );
}

function selectedFile() {
  return state.files.find((file) => file.id === state.selectedFileId) ?? null;
}

function visibleFiles() {
  return state.selectedFolderId
    ? state.files.filter((file) => file.folder_id === state.selectedFolderId)
    : state.files;
}

function reviewableStatuses() {
  return new Set(["discovered", "pending", "failed"]);
}

function isReviewableFile(file) {
  return reviewableStatuses().has(file.status);
}

function syncSelectedFiles() {
  const visibleIds = new Set(visibleFiles().map((file) => file.id));
  state.selectedFileIds = state.selectedFileIds.filter((fileId) =>
    visibleIds.has(fileId),
  );
}

function filesNeedingReview() {
  return visibleFiles().filter((file) => isReviewableFile(file));
}

function filesNeedingReviewForFolder(folderId) {
  return state.files.filter(
    (file) => file.folder_id === folderId && isReviewableFile(file),
  );
}

function filesForReviewModal(folderId) {
  return state.files.filter((file) => {
    if (folderId && file.folder_id !== folderId) {
      return false;
    }
    return isReviewableFile(file) || file.status === "duplicate";
  });
}

function folderFileStats(folderId) {
  const files = state.files.filter((file) => file.folder_id === folderId);
  const reviewable = files.filter((file) => isReviewableFile(file)).length;
  const indexed = files.filter((file) => file.status === "indexed").length;
  const failed = files.filter((file) => file.status === "failed").length;
  return {
    total: files.length,
    reviewable,
    indexed,
    failed,
  };
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
  if (status === "failed" || status === "duplicate") {
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

function deriveFolderPathFromSelection(input) {
  const firstFile = input.files?.[0];
  if (!firstFile) {
    return null;
  }

  const relativePath = firstFile.webkitRelativePath || "";
  const absoluteFilePath =
    typeof firstFile.path === "string"
      ? firstFile.path
      : typeof firstFile.webkitRelativePath === "string" && firstFile.name
        ? ""
        : "";

  if (
    absoluteFilePath &&
    relativePath &&
    absoluteFilePath.endsWith(relativePath)
  ) {
    return absoluteFilePath.slice(
      0,
      absoluteFilePath.length - relativePath.length - 1,
    );
  }

  if (absoluteFilePath) {
    const segments = absoluteFilePath.split("/");
    segments.pop();
    return segments.join("/");
  }

  return null;
}

async function openNativeFolderPicker() {
  if (isNativeDesktop) {
    const path = await tauriInvoke("pick_folder");
    return typeof path === "string" && path.trim() ? path.trim() : null;
  }
  return null;
}

async function openBrowserFolderPicker() {
  return new Promise((resolve) => {
    const input = byId("folder-picker");
    input.value = "";
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      resolve(files);
    };
    input.click();
  });
}

async function importBrowserFolder(files) {
  if (!files.length) {
    throw new Error("No folder was selected.");
  }

  const first = files[0];
  const relative = first.webkitRelativePath || "";
  const folderName = relative.split("/")[0] || "Imported Folder";
  const supportedFiles = files.filter((file) => {
    const relativePath = file.webkitRelativePath || file.name;
    return [".pdf", ".md", ".txt"].some((ext) =>
      relativePath.toLowerCase().endsWith(ext),
    );
  });

  if (!supportedFiles.length) {
    throw new Error("The selected folder does not contain supported files (.pdf, .md, .txt).");
  }

  const formData = new FormData();
  formData.append("folder_name", folderName);
  for (const file of supportedFiles) {
    formData.append("files", file, file.name);
    formData.append("relative_paths", file.webkitRelativePath || file.name);
  }

  const response = await fetch(`${API_BASE}/folders/import-browser`, {
    method: "POST",
    body: formData,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail =
      typeof body === "string" ? body : JSON.stringify(body, null, 2);
    throw new Error(detail);
  }

  return body;
}

function renderStatusCards(files) {
  const container = byId("status-cards");
  container.innerHTML = "";

  const entries = [
    ["Tracked", files.total],
    ["Ready", files.ready],
    ["Indexed", files.indexed],
    ["Failed", files.failed],
    ["Removed", files.deleted],
    ["Chunks", files.chunks],
  ];

  for (const [label, value] of entries) {
    const article = document.createElement("article");
    article.className = "status-card";
    article.innerHTML = `
      <span class="status-label">${label}</span>
      <strong class="status-value">${value}</strong>
      <span class="status-caption">${statusCaption(label, value, files)}</span>
    `;
    container.append(article);
  }
}

function statusCaption(label, value, files) {
  switch (label) {
    case "Indexed":
      return files.total ? `${Math.round((value / files.total) * 100)}% of tracked files` : "No files tracked yet";
    case "Ready":
      return value ? "Waiting for indexing" : "Nothing queued";
    case "Failed":
      return value ? "Needs attention" : "No failed jobs";
    case "Chunks":
      return "Searchable passages";
    case "Removed":
      return "Removed from index";
    case "Tracked":
      return "Active in Relevect";
    default:
      return "Current state";
  }
}

function renderFolders() {
  const containers = [byId("folder-list"), byId("folder-list-insights")].filter(Boolean);

  for (const container of containers) {
    container.innerHTML = "";

    if (!state.folders.length) {
      container.className = "folder-list empty-state";
      container.textContent = "Add a trusted folder to begin.";
      continue;
    }

    container.className = "folder-list";

    for (const folder of state.folders) {
      const folderFiles = state.files.filter(
        (file) => file.folder_id === folder.id,
      );
      const pending = folderFiles.filter((file) =>
        ["pending", "discovered", "failed"].includes(file.status),
      ).length;
      const indexed = folderFiles.filter(
        (file) => file.status === "indexed",
      ).length;
      const button = document.createElement("article");
      const isActive = folder.id === state.selectedFolderId;
      button.className = `folder-item${isActive ? " is-selected" : ""}`;
      button.tabIndex = 0;
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
        ${
          isActive
            ? `
        <div class="card-action-row">
          <button class="card-delete-icon" title="Remove source from Relevect" aria-label="Remove source from Relevect">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"></path>
              <path d="M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
        </div>`
            : ""
        }
      `;
      const deleteButton = button.querySelector(".card-delete-icon");
      deleteButton?.addEventListener("click", async (event) => {
        event.stopPropagation();
        await withRefresh(async () => {
          await removeFolder(folder.id, folder.path);
        });
      });
      button.addEventListener("click", () => {
        state.selectedFolderId = folder.id;
        const visibleFiles = state.files.filter(
          (file) => file.folder_id === folder.id,
        );
        state.selectedFileId = visibleFiles[0]?.id ?? null;
        syncSelectedFiles();
        renderFolders();
        renderFiles();
        renderInspector();
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          button.click();
        }
      });
      container.append(button);
    }
  }
}

function renderFiles() {
  const container = byId("file-list");
  const subtitle = byId("library-subtitle");
  const filesForView = visibleFiles();

  const folder = selectedFolder();
  subtitle.textContent = folder
    ? `Files inside ${folderName(folder)}.`
    : "Files across all trusted folders.";

  container.innerHTML = "";

  if (!filesForView.length) {
    container.className = "file-list empty-state";
    container.textContent =
      "Scan a folder to see discovered and indexed files.";
    return;
  }

  container.className = "file-list";

  for (const file of filesForView) {
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
      ${
        isSelected
          ? `
      <div class="file-expanded">
        <div class="file-expanded-grid">
          <div><span class="file-expanded-label">Model</span><strong>${file.embedding_model ?? "-"}</strong></div>
          <div><span class="file-expanded-label">Size</span><strong>${file.size_bytes ?? 0}b</strong></div>
        <div><span class="file-expanded-label">Indexed</span><strong>${relativeTime(file.last_indexed_at)}</strong></div>
        <div><span class="file-expanded-label">Path</span><strong>${file.path}</strong></div>
      </div>
        <div class="card-action-row">
          <button class="card-delete-icon" title="Remove file from Relevect" aria-label="Remove file from Relevect">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"></path>
              <path d="M19 6l-1 14a1 1 0 01-1 1H7a1 1 0 01-1-1L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
            </svg>
          </button>
        </div>
        ${
          file.last_error
            ? `<div class="file-expanded-error">Error: ${file.last_error}</div>`
            : ""
        }
      </div>`
          : ""
      }
    `;
    const deleteButton = article.querySelector(".card-delete-icon");
    deleteButton?.addEventListener("click", async (event) => {
      event.stopPropagation();
      await withRefresh(async () => {
        await removeFile(file.id, file.file_name);
      });
    });
    article.addEventListener("click", () => {
      state.selectedFileId = file.id;
      renderFiles();
      renderInspector();
    });
    container.append(article);
  }
}

function closeIndexReviewModal() {
  const modal = byId("index-review-modal");
  if (!modal) {
    return;
  }
  if (state.indexing.active) {
    return;
  }
  modal.hidden = true;
}

function closeConfirmModal() {
  byId("confirm-modal").hidden = true;
  state.confirmAction = null;
}

function openConfirmModal(message, onConfirm) {
  state.confirmAction = onConfirm;
  byId("confirm-message").textContent = message;
  byId("confirm-modal").hidden = false;
}

function updateIndexReviewCount() {
  const count = state.selectedFileIds.length;
  byId("index-review-count").textContent = `${count} file${count === 1 ? "" : "s"} selected`;
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function renderIndexingProgress() {
  const container = byId("index-progress");
  const fill = byId("index-progress-fill");
  const label = byId("index-progress-label");
  const percent = byId("index-progress-percent");
  const submit = byId("submit-index-review");
  const cancel = byId("cancel-index-review");
  const selectAll = byId("select-all-review");
  const clearAll = byId("clear-all-review");
  const closeButton = byId("close-index-review");

  const active = state.indexing.active;
  const total = state.indexing.total || 0;
  const completed = state.indexing.completed || 0;
  const currentFileProgress = Number(state.indexing.progressPercent || 0);
  const ratio = total > 0
    ? Math.min(
        ((completed + (currentFileProgress / 100)) / total),
        1,
      )
    : 0;
  const percentage = Math.max(0, Math.min(100, Math.round(ratio * 100)));

  container.hidden = !active;
  fill.style.width = `${percentage}%`;
  fill.classList.toggle(
    "is-indeterminate",
    active && currentFileProgress > 0 && currentFileProgress < 100,
  );
  percent.textContent = `${percentage}%`;
  label.textContent = active
    ? `Indexing ${completed}/${total}${state.indexing.currentFileName ? ` • ${state.indexing.currentFileName}` : ""}${state.indexing.currentStage ? ` • ${state.indexing.currentStage}` : ""}`
    : "Preparing indexing…";

  submit.disabled = active;
  cancel.disabled = active;
  selectAll.disabled = active;
  clearAll.disabled = active;
  closeButton.disabled = active;
}

async function pollIndexJob(jobId) {
  while (state.indexing.active && state.indexing.currentJobId === jobId) {
    const job = await api(`/index/jobs/${jobId}`, { method: "GET" });
    state.indexing.currentStage = job.current_stage ?? null;
    state.indexing.detail = job.detail ?? null;
    state.indexing.progressPercent = Number(job.progress_percent ?? 0);
    renderIndexingProgress();
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return null;
}

function renderIndexReviewModal() {
  const folder = selectedFolder();
  const files = filesForReviewModal(folder?.id ?? null);
  const list = byId("index-review-list");
  const subtitle = byId("index-review-subtitle");
  subtitle.textContent = folder
    ? `Review the scanned files from ${folderName(folder)} before they enter your private index.`
    : "Review the scanned files before they enter your private index.";

  list.innerHTML = "";
  if (!files.length) {
    list.className = "modal-list empty-state";
    list.textContent = "This source is already up to date. No files are waiting for indexing.";
    updateIndexReviewCount();
    renderIndexingProgress();
    return;
  }

  list.className = "modal-list";
  for (const file of files) {
    const isDuplicate = file.status === "duplicate";
    const row = document.createElement("label");
    row.className = `modal-file-row${isDuplicate ? " is-disabled" : ""}`;
    row.innerHTML = `
      <input type="checkbox" ${state.selectedFileIds.includes(file.id) ? "checked" : ""} />
      <div class="modal-file-copy">
        <span class="modal-file-name">${file.file_name}</span>
        <span class="modal-file-path">${file.path}</span>
        ${isDuplicate ? `<span class="modal-file-note">${file.last_error ?? "Already indexed elsewhere"}</span>` : ""}
      </div>
      <div class="modal-file-meta">
        <span class="badge badge-${fileStatusTone(file.status)}">${file.status}</span>
        <span class="file-detail">${isDuplicate ? "Not selectable" : (file.parser_type ?? "unparsed")}</span>
      </div>
    `;
    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox?.addEventListener("change", (event) => {
      if (isDuplicate) {
        event.preventDefault();
        return;
      }
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      if (target.checked) {
        state.selectedFileIds = [...new Set([...state.selectedFileIds, file.id])];
      } else {
        state.selectedFileIds = state.selectedFileIds.filter((id) => id !== file.id);
      }
      updateIndexReviewCount();
    });
    if (state.indexing.active || isDuplicate) {
      checkbox.disabled = true;
    }
    list.append(row);
  }
  updateIndexReviewCount();
  renderIndexingProgress();
}

function openIndexReviewModal() {
  renderIndexReviewModal();
  byId("index-review-modal").hidden = false;
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
  if (!container) {
    return;
  }
  const file = selectedFile();
  const folder = selectedFolder();

  if (file) {
    container.className = "inspector";
    container.innerHTML = `
      <div style="margin-bottom: 12px;">
        <h3 style="margin:0; font-family: var(--serif); font-size: 22px; font-weight: 400;">${file.file_name}</h3>
        <span class="micro-text" style="font-family: var(--mono); word-break: break-all; display:block; margin-top:4px;">${file.path}</span>
      </div>
      <dl class="inspector-grid">
        <div><dt>Status</dt><dd>${file.status}</dd></div>
        <div><dt>Parser</dt><dd>${file.parser_type ?? "Unparsed"}</dd></div>
        <div><dt>Chunks</dt><dd>${file.chunk_count}</dd></div>
        <div><dt>Model</dt><dd>${file.embedding_model ?? "-"}</dd></div>
        <div><dt>Size</dt><dd>${file.size_bytes ?? 0}b</dd></div>
        <div><dt>Indexed</dt><dd>${relativeTime(file.last_indexed_at) || "Never"}</dd></div>
      </dl>
      ${file.last_error ? `<div class="badge badge-danger" style="margin-top: 12px; display: block; white-space: normal;">Error: ${file.last_error}</div>` : ""}
    `;
    return;
  }

  if (folder) {
    const folderFiles = state.files.filter(
      (entry) => entry.folder_id === folder.id,
    );
    const indexedCount = folderFiles.filter(
      (entry) => entry.status === "indexed",
    ).length;
    const pendingCount = folderFiles.filter((entry) =>
      ["pending", "discovered", "failed"].includes(entry.status),
    ).length;
    const failedCount = folderFiles.filter(
      (entry) => entry.status === "failed",
    ).length;
    const selectedCount = state.selectedFileIds.filter((id) =>
      folderFiles.some((entry) => entry.id === id),
    ).length;

    container.className = "inspector";
    container.innerHTML = `
      <div style="margin-bottom: 12px;">
        <h3 style="margin:0; font-family: var(--serif); font-size: 22px; font-weight: 400;">${folderName(folder)}</h3>
        <span class="micro-text" style="font-family: var(--mono); word-break: break-all; display:block; margin-top:4px;">${folder.path}</span>
      </div>
      <dl class="inspector-grid">
        <div><dt>Total Files</dt><dd>${folderFiles.length}</dd></div>
        <div><dt>Indexed</dt><dd>${indexedCount}</dd></div>
        <div><dt>Pending</dt><dd>${pendingCount}</dd></div>
        <div><dt>Failed</dt><dd>${failedCount}</dd></div>
        <div><dt>Selected</dt><dd>${selectedCount}</dd></div>
        <div><dt>Added</dt><dd>${relativeTime(folder.created_at)}</dd></div>
      </dl>
    `;
    return;
  }

  container.className = "inspector empty-state mini";
  container.textContent = "Select a folder or file to inspect.";
}

function renderSearchResults() {
  const container = byId("search-results");
  const summary = byId("search-summary");
  container.innerHTML = "";

  if (!state.searchResults.length) {
    container.className = "search-results empty-state";
    container.textContent =
      "Search results will appear here with source snippets and scores.";
    summary.textContent =
      "Results will surface the strongest passages from indexed files, with provenance.";
    return;
  }

  container.className = "search-results";
  const top = state.searchResults[0];
  summary.textContent = `Top match: ${top.file_name} with score ${top.score.toFixed(3)}.`;

  for (const result of state.searchResults) {
    const article = document.createElement("article");
    const metadata = result.metadata ?? {};
    const pathParts = String(result.path ?? "").split("/").filter(Boolean);
    const folder = pathParts.length > 1 ? pathParts.at(-2) : "-";
    const pageLabel = metadata.page ?? "-";
    article.className = "search-card";
    article.innerHTML = `
      <div class="search-card-header">
        <div>
          <p class="result-label">${result.file_name}</p>
          <h3>${result.metadata?.heading ?? "Source passage"}</h3>
          <p class="search-path">${result.path}</p>
        </div>
        <span class="score-pill">Score ${result.score.toFixed(3)}</span>
      </div>
      <div class="search-meta-grid">
        <div><span class="search-meta-label">File</span><strong>${result.file_name ?? "-"}</strong></div>
        <div><span class="search-meta-label">Folder</span><strong>${folder}</strong></div>
        <div><span class="search-meta-label">Page</span><strong>${pageLabel}</strong></div>
        <div><span class="search-meta-label">Chunk</span><strong>${metadata.chunk_index ?? "-"}</strong></div>
      </div>
      <div class="search-snippet-shell">
        <div class="search-snippet">${result.text ?? result.snippet ?? ""}</div>
      </div>
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
  if (
    state.selectedFolderId &&
    !state.folders.some((folder) => folder.id === state.selectedFolderId)
  ) {
    state.selectedFolderId = null;
  }
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
  const filesForView = visibleFiles();
  syncSelectedFiles();
  const stillVisible = filesForView.some(
    (file) => file.id === state.selectedFileId,
  );
  if (!stillVisible) {
    state.selectedFileId = filesForView[0]?.id ?? null;
  }
  renderFiles();
  renderInspector();
  renderJson("files-output", data);
}

async function removeFolder(folderId, folderPath) {
  openConfirmModal(
    `Remove ${folderPath} from Relevect? This deletes its local index metadata only, not the folder on your Mac.`,
    async () => {
      await api(`/folders/${folderId}`, { method: "DELETE" });
      state.selectedFileIds = [];
      state.searchResults = [];
      setHomeFeedback("Folder removed from Relevect.", "success");
    },
  );
}

async function removeFile(fileId, fileName) {
  openConfirmModal(
    `Remove ${fileName} from Relevect? This deletes its indexed chunks only, not the file on your Mac.`,
    async () => {
      await api(`/files/${fileId}`, { method: "DELETE" });
      state.selectedFileIds = state.selectedFileIds.filter((id) => id !== fileId);
      if (state.selectedFileId === fileId) {
        state.selectedFileId = null;
      }
      setHomeFeedback("File removed from Relevect.", "success");
    },
  );
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
    throw new Error("Choose a folder before adding it to Relevect.");
  }
  try {
    await api("/folders", {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    setHomeFeedback("Folder added to the trust boundary.", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Folder already registered")) {
      setHomeFeedback("Folder already trusted. Refreshing its library now.", "success");
      return;
    }
    throw error;
  }
}

async function scanFolders() {
  await api("/index/scan", {
    method: "POST",
    body: JSON.stringify({}),
  });
  setHomeFeedback("Scan complete. Review discovered files, then index them.", "success");
}

async function scanSelectedFolder() {
  if (!state.selectedFolderId) {
    throw new Error("Choose a folder before scanning.");
  }
  const result = await api("/index/scan", {
    method: "POST",
    body: JSON.stringify({ folder_id: state.selectedFolderId }),
  });
  setHomeFeedback("Folder scanned. Review the files below.", "success");
  return result;
}

async function runIndexing() {
  const result = await api("/index/run", {
    method: "POST",
    body: JSON.stringify({}),
  });
  state.selectedFileIds = [];
  setHomeFeedback(`Indexed ${result.processed} files.`, "success");
  renderJson("jobs-output", result);
}

async function runSelectedIndexing() {
  if (!state.selectedFileIds.length) {
    throw new Error("Select at least one discovered or pending file.");
  }

  const selectedIds = [...state.selectedFileIds];
  const selectedFiles = selectedIds
    .map((id) => state.files.find((file) => file.id === id))
    .filter(Boolean);

  state.indexing = {
    active: true,
    total: selectedIds.length,
    completed: 0,
    currentFileName: selectedFiles[0]?.file_name ?? null,
    currentJobId: null,
    currentStage: "queued",
    detail: null,
    progressPercent: 0,
  };
  renderIndexReviewModal();
  await waitForNextPaint();

  const results = [];
  try {
    for (const [index, fileId] of selectedIds.entries()) {
      const current = selectedFiles[index];
      state.indexing.currentFileName = current?.file_name ?? null;
      state.indexing.currentStage = "queued";
      state.indexing.progressPercent = 0;
      renderIndexingProgress();
      await waitForNextPaint();
      const started = await api("/index/file/start", {
        method: "POST",
        body: JSON.stringify({ file_id: fileId }),
      });
      state.indexing.currentJobId = started.job_id;
      const job = await pollIndexJob(started.job_id);
      if (!job || job.status !== "completed") {
        throw new Error(
          job?.error || `Indexing failed for ${current?.file_name ?? "file"}.`,
        );
      }
      results.push({
        job_id: started.job_id,
        file_id: started.file_id,
        path: started.path,
        status: "indexed",
      });
      state.indexing.completed = index + 1;
      state.indexing.currentJobId = null;
      state.indexing.progressPercent = 0;
      state.indexing.currentStage = "completed";
      renderIndexingProgress();
      await waitForNextPaint();
    }

    await Promise.all([
      refreshFolders(),
      refreshFiles(),
      refreshStatus(),
      refreshHealth(),
    ]);
    state.selectedFileIds = [];
    closeIndexReviewModal();
    setHomeFeedback(`Indexed ${results.length} selected files.`, "success");
    renderJson("jobs-output", { processed: results.length, results });
  } finally {
    state.indexing.active = false;
    state.indexing.currentFileName = null;
    state.indexing.currentJobId = null;
    state.indexing.currentStage = null;
    state.indexing.detail = null;
    state.indexing.progressPercent = 0;
    renderIndexReviewModal();
  }
}

async function resetLocalData() {
  openConfirmModal(
    "Reset Relevect local data? This clears folders, files, chunks, and index jobs from Relevect only.",
    async () => {
      const result = await api("/admin/reset", { method: "POST" });
      state.selectedFolderId = null;
      state.selectedFileId = null;
      state.selectedFileIds = [];
      state.searchResults = [];
      setHomeFeedback("Local Relevect data reset.", "success");
      renderJson("jobs-output", result);
      renderSearchResults();
    },
  );
}

async function runSearch() {
  const query = byId("search-query").value.trim();
  if (!query) {
    throw new Error("Enter a query before searching.");
  }
  const result = await api("/search", {
    method: "POST",
    body: JSON.stringify({ query, top_k: 5, include_text: true }),
  });
  state.searchResults = result.results;
  renderSearchResults();
  renderJson("search-output", result);
}

async function withRefresh(action) {
  try {
    await action();
    await Promise.all([
      refreshFolders(),
      refreshFiles(),
      refreshStatus(),
      refreshHealth(),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderJson("jobs-output", { error: message });
    state.searchResults = [];
    renderSearchResults();
    setHomeFeedback(message, "error");
  }
}

async function pickFolder() {
  try {
    if (isNativeDesktop) {
      setHomeFeedback("Waiting for folder selection...", "neutral");
      const path = await openNativeFolderPicker();
      if (!path) {
        setHomeFeedback("Folder selection cancelled.", "neutral");
        return;
      }
      byId("folder-path").value = path;
      await registerFolder();
      await Promise.all([refreshFolders(), refreshFiles(), refreshStatus(), refreshHealth()]);
      const folder = state.folders.find((entry) => entry.path === path);
      if (folder) {
        state.selectedFolderId = folder.id;
      }
      const scanResult = await scanSelectedFolder();
      await Promise.all([refreshFolders(), refreshFiles(), refreshStatus()]);
      const reviewableFiles = folder
        ? filesNeedingReviewForFolder(folder.id)
        : filesNeedingReview();
      const modalFiles = folder ? filesForReviewModal(folder.id) : filesForReviewModal(null);
      state.selectedFileIds = reviewableFiles.map((file) => file.id);
      const discovered = state.selectedFileIds.length;
      const stats = folder ? folderFileStats(folder.id) : null;
      setHomeFeedback(
        discovered
          ? `Folder scanned. ${discovered} files are ready for review and indexing.`
          : stats && stats.indexed > 0
            ? `Folder is already indexed. ${stats.indexed} file${stats.indexed === 1 ? "" : "s"} already in Relevect and no new indexing is needed.`
            : scanResult?.discovered_files
              ? "Folder scanned, but no files currently need indexing."
              : "Folder scanned. No supported files were found that need indexing.",
        "success",
      );
      if (modalFiles.length) {
        openIndexReviewModal();
      }
      return;
    }

    setHomeFeedback("Choose a folder to import into Relevect.", "neutral");
    const files = await openBrowserFolderPicker();
    if (!files.length) {
      setHomeFeedback("Folder selection cancelled.", "neutral");
      return;
    }

    const result = await importBrowserFolder(files);
    const folder = result.folder;
    byId("folder-path").value = folder.path;
    await Promise.all([refreshFolders(), refreshFiles(), refreshStatus(), refreshHealth()]);
    if (folder) {
      state.selectedFolderId = folder.id;
    }
    const reviewableFiles = folder
      ? filesNeedingReviewForFolder(folder.id)
      : filesNeedingReview();
    const modalFiles = folder ? filesForReviewModal(folder.id) : filesForReviewModal(null);
    state.selectedFileIds = reviewableFiles.map((file) => file.id);
    const discovered = state.selectedFileIds.length;
    const stats = folder ? folderFileStats(folder.id) : null;
    setHomeFeedback(
      discovered
        ? `Folder imported. ${discovered} files are ready for review and indexing.`
        : result.duplicate_files
          ? `Folder imported. ${result.duplicate_files} file${result.duplicate_files === 1 ? "" : "s"} already exist in Relevect and were marked duplicate.`
        : stats && stats.indexed > 0
          ? `This folder is already in Relevect. ${stats.indexed} file${stats.indexed === 1 ? "" : "s"} are already indexed and no re-indexing is needed.`
          : "Folder imported. No files currently need indexing.",
      "success",
    );
    if (modalFiles.length) {
      openIndexReviewModal();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setHomeFeedback(message, "error");
  }
}

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

byId("pick-folder").addEventListener("click", pickFolder);
byId("refresh-status").addEventListener("click", () =>
  withRefresh(refreshStatus),
);
byId("refresh-folders").addEventListener("click", () =>
  withRefresh(refreshFolders),
);
byId("refresh-folders-insights").addEventListener("click", () =>
  withRefresh(refreshFolders),
);
byId("refresh-files").addEventListener("click", () =>
  withRefresh(refreshFiles),
);
byId("run-search").addEventListener("click", () => withRefresh(runSearch));
byId("search-query").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    withRefresh(runSearch);
  }
});
byId("reset-local-data").addEventListener("click", () =>
  withRefresh(resetLocalData),
);
byId("close-index-review").addEventListener("click", closeIndexReviewModal);
byId("cancel-index-review").addEventListener("click", closeIndexReviewModal);
byId("submit-index-review").addEventListener("click", () =>
  withRefresh(runSelectedIndexing),
);
byId("select-all-review").addEventListener("click", () => {
  state.selectedFileIds = filesNeedingReview().map((file) => file.id);
  renderIndexReviewModal();
});
byId("clear-all-review").addEventListener("click", () => {
  state.selectedFileIds = [];
  renderIndexReviewModal();
});
byId("confirm-cancel").addEventListener("click", closeConfirmModal);
byId("confirm-submit").addEventListener("click", async () => {
  const action = state.confirmAction;
  if (!action) {
    closeConfirmModal();
    return;
  }
  closeConfirmModal();
  await withRefresh(action);
});

await withRefresh(async () => {});

if (!isNativeDesktop) {
  byId("folder-path").readOnly = true;
  byId("pick-folder").textContent = "Choose Folder";
  setHomeFeedback(
    "Browser mode imports a selected folder into Relevect-managed local storage before indexing.",
    "neutral",
  );
}
