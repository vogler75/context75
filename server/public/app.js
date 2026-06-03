document.addEventListener('DOMContentLoaded', () => {
  // Navigation elements
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('page-title');
  const refreshStatsBtn = document.getElementById('refresh-stats-btn');

  // Health & Server Stats elements
  const healthIndicator = document.getElementById('health-indicator');
  const healthText = document.getElementById('health-text');
  const envNode = document.getElementById('env-node');
  const envMemory = document.getElementById('env-memory');

  const statCollections = document.getElementById('stat-collections');
  const statDocuments = document.getElementById('stat-documents');
  const statChunks = document.getElementById('stat-chunks');
  const statStorage = document.getElementById('stat-storage');

  // Copy MCP Connection Button
  const copyMcpUriBtn = document.getElementById('copy-mcp-uri');

  // Collections Tab elements
  const collectionsList = document.getElementById('collections-list');
  const collectionsDetailView = document.getElementById('collection-details');
  const backToCollectionsBtn = document.getElementById('back-to-collections-btn');
  const detailDisplayName = document.getElementById('detail-display-name');
  const detailSlug = document.getElementById('detail-slug');
  const detailDescription = document.getElementById('detail-description');

  // Collection details internal tabs
  const detailTabBtns = document.querySelectorAll('.detail-tab-btn');
  const detailTabContents = document.querySelectorAll('.detail-tab-content');

  // Documents list elements
  const documentsTableBody = document.getElementById('documents-table-body');
  const docsEmptyState = document.getElementById('docs-empty-state');

  // Ingest/Upload elements
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const uploadForm = document.getElementById('upload-form');
  const uploadTitleInput = document.getElementById('upload-title');
  const selectedFileName = document.getElementById('selected-file-name');
  const selectedFileSize = document.getElementById('selected-file-size');
  const cancelUploadBtn = document.getElementById('cancel-upload-btn');
  const startIngestBtn = document.getElementById('start-ingest-btn');

  const ingestProgressBox = document.getElementById('ingest-progress-box');
  const ingestProgressFill = document.getElementById('ingest-progress-fill');
  const ingestStatusText = document.getElementById('ingest-status-text');
  const stepUpload = document.getElementById('step-upload');
  const stepParse = document.getElementById('step-parse');
  const stepVector = document.getElementById('step-vector');

  // Modals elements
  const createCollectionModal = document.getElementById('create-collection-modal');
  const openCreateModalBtn = document.getElementById('open-create-modal-btn');
  const closeCreateModalBtn = document.getElementById('close-create-modal-btn');
  const cancelCreateModalBtn = document.getElementById('cancel-create-modal-btn');
  const createCollectionForm = document.getElementById('create-collection-form');
  const createColError = document.getElementById('create-col-error');

  const chunksPreviewModal = document.getElementById('chunks-preview-modal');
  const closeChunksModalBtn = document.getElementById('close-chunks-modal-btn');
  const chunksModalTitle = document.getElementById('chunks-modal-title');
  const chunksLoading = document.getElementById('chunks-loading');
  const chunksList = document.getElementById('chunks-list');

  // Search Sandbox elements
  const searchCollectionSelect = document.getElementById('search-collection-select');
  const searchLimitInput = document.getElementById('search-limit');
  const searchSimilarityInput = document.getElementById('search-similarity');
  const searchQueryInput = document.getElementById('search-query-input');
  const searchPlaygroundForm = document.getElementById('search-playground-form');
  const searchResultsPanel = document.getElementById('search-results-panel');
  const resultsCount = document.getElementById('results-count');
  const resultsList = document.getElementById('results-list');

  // State Management
  let activeCollection = null; // Stores currently opened collection details
  let selectedFile = null;

  // Initialize lucide icons at load
  lucide.createIcons();

  /* ==========================================
     Tab Navigation Controller
     ========================================== */
  navButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;

      // Update Active Navigation Button
      navButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      // Update View Visibility
      tabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `tab-${targetTab}`) {
          content.classList.add('active');
        }
      });

      // Update Header Text
      pageTitle.innerText = button.querySelector('span').innerText;

      // Handle custom tab load logic
      if (targetTab === 'overview') {
        loadStats();
      } else if (targetTab === 'collections') {
        loadCollections();
      } else if (targetTab === 'search') {
        populateSearchSelect();
      }
    });
  });

  // Handle Inner Details Tabs
  detailTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      detailTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetDetailTab = btn.dataset.detailTab;
      detailTabContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `detail-tab-${targetDetailTab}`) {
          content.classList.add('active');
        }
      });

      if (targetDetailTab === 'docs' && activeCollection) {
        loadDocuments(activeCollection.id);
      }
    });
  });

  /* ==========================================
     Health Verification & System Stats API
     ========================================== */
  async function checkHealth() {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();

      if (data.status === 'healthy') {
        healthIndicator.className = 'status-indicator online';
        healthText.innerText = 'Connected to Database';
      } else {
        healthIndicator.className = 'status-indicator offline';
        healthText.innerText = 'Service Degraded';
      }
      
      envNode.innerText = data.services?.embeddingModel?.name ? 'v20 (ONNX Active)' : 'v20';
    } catch (err) {
      healthIndicator.className = 'status-indicator offline';
      healthText.innerText = 'Database Offline';
    }
  }

  async function loadStats() {
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();

      statCollections.innerText = data.collectionsCount;
      statDocuments.innerText = data.documentsCount;
      statChunks.innerText = data.chunksCount;
      
      // Format Storage KB vs MB
      const storageKB = (data.totalStorageBytes / 1024).toFixed(1);
      if (Number(storageKB) > 1024) {
        statStorage.innerText = `${(Number(storageKB) / 1024).toFixed(2)} MB`;
      } else {
        statStorage.innerText = `${storageKB} KB`;
      }

      // Memory usage
      const memoryMB = Math.round(data.memoryUsage.rss / 1024 / 1024);
      envMemory.innerText = `${memoryMB} MB`;
    } catch (err) {
      console.error("Failed to load statistics:", err);
    }
  }

  // Set Interval for Health Ping (every 10s)
  checkHealth();
  loadStats();
  setInterval(checkHealth, 10000);

  refreshStatsBtn.addEventListener('click', () => {
    checkHealth();
    loadStats();
  });

  // Copy MCP URI Box
  copyMcpUriBtn.addEventListener('click', () => {
    navigator.clipboard.writeText('http://localhost:8010/sse');
    
    // Change Icon to Checkmark
    copyMcpUriBtn.innerHTML = '<i data-lucide="check" style="color: var(--accent-green)"></i>';
    lucide.createIcons();

    setTimeout(() => {
      copyMcpUriBtn.innerHTML = '<i data-lucide="copy"></i>';
      lucide.createIcons();
    }, 2000);
  });

  /* ==========================================
     Collections CRUD Functions
     ========================================== */
  async function loadCollections() {
    // Hide details view, show grid list
    collectionsDetailView.classList.add('hidden');
    collectionsList.classList.remove('hidden');

    collectionsList.innerHTML = `
      <div class="loading-spinner">
        <i data-lucide="loader-2" class="spin"></i>
        <span>Loading collections...</span>
      </div>
    `;
    lucide.createIcons();

    try {
      const response = await fetch('/api/collections');
      const collections = await response.json();

      if (collections.length === 0) {
        collectionsList.innerHTML = `
          <div class="empty-state" style="grid-column: 1/-1">
            <i data-lucide="folder-warning"></i>
            <p>No document collections created yet.</p>
            <button class="btn btn-primary" onclick="document.getElementById('open-create-modal-btn').click()" style="margin-top: 14px">
              Create a Collection
            </button>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      collectionsList.innerHTML = '';
      collections.forEach(col => {
        const card = document.createElement('div');
        card.className = 'collection-card';
        card.innerHTML = `
          <div class="col-card-header">
            <h4 class="col-card-title">${col.displayName}</h4>
            <span class="col-card-slug">${col.name}</span>
          </div>
          <p class="col-card-desc">${col.description || 'No description provided.'}</p>
          <div class="col-card-footer">
            <div class="col-card-stats">
              <span class="col-stat" title="Total documents in collection">
                <i data-lucide="file-text"></i> ${col.documentCount}
              </span>
              <span class="col-stat" title="Total vectorized chunks">
                <i data-lucide="database"></i> ${col.chunkCount}
              </span>
            </div>
            <button class="col-btn-delete" title="Delete collection" data-id="${col.id}">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        `;

        // Card Click opens details
        card.addEventListener('click', (e) => {
          // If clicked the delete button, prevent opening card
          if (e.target.closest('.col-btn-delete')) {
            e.stopPropagation();
            const colId = e.target.closest('.col-btn-delete').dataset.id;
            deleteCollection(colId, col.displayName);
            return;
          }
          openCollectionDetails(col);
        });

        collectionsList.appendChild(card);
      });

      lucide.createIcons();
    } catch (err) {
      collectionsList.innerHTML = `<div class="form-error">Failed to connect to API endpoint to load collections.</div>`;
    }
  }

  // Create Collection logic
  openCreateModalBtn.addEventListener('click', () => {
    createCollectionModal.classList.remove('hidden');
    createColError.classList.add('hidden');
  });

  const closeModal = () => {
    createCollectionModal.classList.add('hidden');
    createCollectionForm.reset();
  };

  closeCreateModalBtn.addEventListener('click', closeModal);
  cancelCreateModalBtn.addEventListener('click', closeModal);

  createCollectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createColError.classList.add('hidden');

    const displayName = document.getElementById('new-col-display-name').value.trim();
    const name = document.getElementById('new-col-name').value.trim().toLowerCase();
    const description = document.getElementById('new-col-description').value.trim();

    try {
      const response = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, displayName, description })
      });

      const result = await response.json();

      if (response.ok) {
        closeModal();
        loadCollections();
      } else {
        createColError.innerText = result.error || "Failed to create collection.";
        createColError.classList.remove('hidden');
      }
    } catch (err) {
      createColError.innerText = "Network connection failed.";
      createColError.classList.remove('hidden');
    }
  });

  async function deleteCollection(id, displayName) {
    if (!confirm(`Are you absolutely sure you want to delete the collection "${displayName}"?\nThis will permanently delete all associated documents and vector chunks.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/collections/${id}`, { method: 'DELETE' });
      if (response.ok) {
        loadCollections();
      } else {
        alert("Failed to delete collection.");
      }
    } catch (err) {
      alert("Network error occurred.");
    }
  }

  /* ==========================================
     Collection Details & Document Explorer
     ========================================== */
  function openCollectionDetails(col) {
    activeCollection = col;
    
    // Switch views
    collectionsList.classList.add('hidden');
    collectionsDetailView.classList.remove('hidden');

    // Populate Details info
    detailDisplayName.innerText = col.displayName;
    detailSlug.innerText = col.name;
    detailDescription.innerText = col.description || 'No description provided.';

    // Default to Documents Tab
    detailTabBtns[0].click();
  }

  backToCollectionsBtn.addEventListener('click', () => {
    activeCollection = null;
    loadCollections();
  });

  async function loadDocuments(collectionId) {
    documentsTableBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center">
          <div class="loading-spinner">
            <i data-lucide="loader-2" class="spin"></i>
            <span>Loading documents...</span>
          </div>
        </td>
      </tr>
    `;
    lucide.createIcons();
    docsEmptyState.classList.add('hidden');

    try {
      const response = await fetch(`/api/collections/${collectionId}/documents`);
      const documents = await response.json();

      if (documents.length === 0) {
        documentsTableBody.innerHTML = '';
        docsEmptyState.classList.remove('hidden');
        return;
      }

      documentsTableBody.innerHTML = '';
      documents.forEach(doc => {
        const tr = document.createElement('tr');
        
        // Format size
        const sizeStr = doc.fileSizeBytes > 1024 * 1024 
          ? `${(doc.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` 
          : `${(doc.fileSizeBytes / 1024).toFixed(1)} KB`;

        const dateStr = new Date(doc.createdAt).toLocaleString();

        tr.innerHTML = `
          <td class="doc-title-cell">
            <i data-lucide="file"></i>
            <span>${doc.title}</span>
          </td>
          <td>
            <span class="badge-type ${doc.fileType}">${doc.fileType.toUpperCase()}</span>
          </td>
          <td>${sizeStr}</td>
          <td>${doc.chunkCount}</td>
          <td>${dateStr}</td>
          <td>
            <div class="doc-action-group">
              <button class="btn-table-action view-chunks" title="Explore vector chunks" data-id="${doc.id}" data-title="${doc.title}">
                <i data-lucide="eye"></i>
              </button>
              <button class="btn-table-action delete delete-doc" title="Delete document" data-id="${doc.id}" data-title="${doc.title}">
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </td>
        `;

        // Details handlers
        tr.querySelector('.view-chunks').addEventListener('click', () => {
          openChunksPreview(doc.id, doc.title);
        });

        tr.querySelector('.delete-doc').addEventListener('click', () => {
          deleteDocument(doc.id, doc.title);
        });

        documentsTableBody.appendChild(tr);
      });

      lucide.createIcons();
    } catch (err) {
      documentsTableBody.innerHTML = `<tr><td colspan="6" style="color: var(--accent-red); text-align: center">Failed to connect to API to fetch documents.</td></tr>`;
    }
  }

  async function deleteDocument(docId, title) {
    if (!confirm(`Are you sure you want to delete the document "${title}"?\nAll associated vector index segments will be removed.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
      if (response.ok) {
        loadDocuments(activeCollection.id);
      } else {
        alert("Failed to delete document.");
      }
    } catch (err) {
      alert("Network error.");
    }
  }

  /* ==========================================
     Drag and Drop File Upload
     ========================================== */
  // Drag & Drop event bindings
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleSelectedFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      handleSelectedFile(fileInput.files[0]);
    }
  });

  function handleSelectedFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension !== 'md' && extension !== 'mdx' && extension !== 'pdf') {
      alert("Unsupported file type! Please upload a PDF or Markdown (.md, .mdx) file.");
      return;
    }

    selectedFile = file;
    
    // Update uploader card visual
    selectedFileName.innerText = file.name;
    selectedFileSize.innerText = `${(file.size / 1024).toFixed(1)} KB`;
    uploadTitleInput.value = file.name.replace(/\.[^/.]+$/, ""); // prefill title without extension

    // Toggle views
    dropZone.classList.add('hidden');
    uploadForm.classList.remove('hidden');
    ingestProgressBox.classList.add('hidden');
    startIngestBtn.disabled = false;
  }

  cancelUploadBtn.addEventListener('click', () => {
    selectedFile = null;
    uploadForm.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileInput.value = '';
  });

  /* ==========================================
     Ingest Ingestion & Upload Progress
     ========================================== */
  startIngestBtn.addEventListener('click', () => {
    if (!selectedFile || !activeCollection) return;

    // Initialize progress indicators
    startIngestBtn.disabled = true;
    ingestProgressBox.classList.remove('hidden');
    ingestProgressFill.style.width = '0%';
    ingestStatusText.innerText = "Initializing file transfer...";

    // Configure steps
    resetSteps();
    setStepState(stepUpload, 'active');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('title', uploadTitleInput.value.trim());

    // Use XMLHttpRequest to track upload percentage
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/collections/${activeCollection.id}/upload`, true);

    // Track upload progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        
        // Progress caps at 50% for raw uploading, leaving the rest for parsing and vectorization steps
        const scaledProgress = Math.round(percentComplete * 0.5);
        ingestProgressFill.style.width = `${scaledProgress}%`;
        ingestStatusText.innerText = `Uploading document contents... (${percentComplete}%)`;

        if (percentComplete === 100) {
          setStepState(stepUpload, 'completed');
          setStepState(stepParse, 'active');
          ingestStatusText.innerText = "Parsing contents and extracting pages...";
          ingestProgressFill.style.width = '65%';
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status === 201) {
        // Completed Vectorization successfully
        setStepState(stepParse, 'completed');
        setStepState(stepVector, 'completed');
        ingestProgressFill.style.width = '100%';
        ingestStatusText.innerText = "Parsing, chunking, and embedding vectors saved successfully!";

        setTimeout(() => {
          // Reset file card and load documents
          alert("File successfully vectorized!");
          cancelUploadBtn.click();
          detailTabBtns[0].click(); // Back to docs view
        }, 1500);

      } else {
        const errorData = JSON.parse(xhr.responseText || '{}');
        handleIngestError(errorData.error || "Failed to process document.");
      }
    };

    xhr.onerror = () => {
      handleIngestError("Network transfer interrupted.");
    };

    // Trigger mock states for parser/vectorizer since backend processes it synchronously
    setTimeout(() => {
      if (xhr.readyState > 0 && xhr.readyState < 4) {
        ingestProgressFill.style.width = '80%';
        setStepState(stepParse, 'completed');
        setStepState(stepVector, 'active');
        ingestStatusText.innerText = "Generating local ONNX text embeddings and saving vectors...";
      }
    }, 3000);

    xhr.send(formData);
  });

  function resetSteps() {
    [stepUpload, stepParse, stepVector].forEach(step => {
      const dot = step.querySelector('.step-dot');
      dot.className = 'step-dot';
    });
  }

  function setStepState(stepElement, state) {
    const dot = stepElement.querySelector('.step-dot');
    dot.className = `step-dot ${state}`;
  }

  function handleIngestError(msg) {
    alert(`Ingestion Error: ${msg}`);
    startIngestBtn.disabled = false;
    ingestProgressBox.classList.add('hidden');
    resetSteps();
  }

  /* ==========================================
     Explore Chunks Modal
     ========================================== */
  async function openChunksPreview(docId, title) {
    chunksModalTitle.innerText = `Chunks Explorer — ${title}`;
    chunksPreviewModal.classList.remove('hidden');
    chunksLoading.classList.remove('hidden');
    chunksList.classList.add('hidden');
    chunksList.innerHTML = '';

    try {
      const response = await fetch(`/api/documents/${docId}/chunks`);
      const data = await response.json();

      chunksLoading.classList.add('hidden');
      chunksList.classList.remove('hidden');

      if (data.chunks.length === 0) {
        chunksList.innerHTML = '<div class="empty-state">No chunks generated for this file.</div>';
        return;
      }

      data.chunks.forEach(chunk => {
        const item = document.createElement('div');
        item.className = 'chunk-row';

        const breadcrumbs = chunk.metadata?.headerPath?.length > 0 
          ? ` > ${chunk.metadata.headerPath.join(' > ')}` 
          : '';
        const pageText = chunk.metadata?.pageNumber ? `Page ${chunk.metadata.pageNumber}` : 'General';

        item.innerHTML = `
          <div class="chunk-row-header">
            <span>Index: #${chunk.chunkIndex}</span>
            <div class="chunk-row-meta">
              <span>${pageText}</span>
              <span>${breadcrumbs}</span>
            </div>
          </div>
          <p class="chunk-row-body">${chunk.content}</p>
          <div class="chunk-vector-box">
            <h5>Vector Embedding Snippet (all-MiniLM-L6-v2)</h5>
            <code>${chunk.embeddingSnippet}</code>
          </div>
        `;
        chunksList.appendChild(item);
      });
    } catch (err) {
      chunksLoading.classList.add('hidden');
      chunksList.classList.remove('hidden');
      chunksList.innerHTML = '<div class="form-error">Failed to connect to API to fetch vector chunks.</div>';
    }
  }

  closeChunksModalBtn.addEventListener('click', () => {
    chunksPreviewModal.classList.add('hidden');
  });

  /* ==========================================
     Semantic Search Playground
     ========================================== */
  async function populateSearchSelect() {
    searchCollectionSelect.innerHTML = '<option value="" disabled selected>Loading collections...</option>';
    searchResultsPanel.classList.add('hidden');
    
    try {
      const response = await fetch('/api/collections');
      const collections = await response.json();

      if (collections.length === 0) {
        searchCollectionSelect.innerHTML = '<option value="" disabled>No collections available. Create one first.</option>';
        return;
      }

      searchCollectionSelect.innerHTML = '';
      collections.forEach(col => {
        const option = document.createElement('option');
        option.value = col.id;
        option.innerText = `${col.displayName} (${col.name})`;
        searchCollectionSelect.appendChild(option);
      });
    } catch (err) {
      searchCollectionSelect.innerHTML = '<option value="" disabled>Error loading options</option>';
    }
  }

  searchPlaygroundForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const collectionId = searchCollectionSelect.value;
    const query = searchQueryInput.value.trim();
    const limit = parseInt(searchLimitInput.value);
    const minSimilarity = parseFloat(searchSimilarityInput.value);

    if (!collectionId || !query) return;

    searchResultsPanel.classList.remove('hidden');
    resultsList.innerHTML = `
      <div class="loading-spinner">
        <i data-lucide="loader-2" class="spin"></i>
        <span>Calculating embedding vector and running similarity matrix search in PostgreSQL...</span>
      </div>
    `;
    lucide.createIcons();

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId, query, limit, minSimilarity })
      });

      const data = await response.json();

      if (data.resultsCount === 0) {
        resultsCount.innerText = "0 matches found";
        resultsList.innerHTML = `
          <div class="empty-state">
            <i data-lucide="frown"></i>
            <p>No document chunks matched your query "${query}" with similarity >= ${minSimilarity}.</p>
          </div>
        `;
        lucide.createIcons();
        return;
      }

      resultsCount.innerText = `${data.resultsCount} matches found`;
      resultsList.innerHTML = '';

      data.results.forEach(res => {
        const card = document.createElement('div');
        card.className = 'search-result-card';

        const pageText = res.metadata?.pageNumber ? `(Page ${res.metadata.pageNumber})` : '';
        const breadcrumbs = res.metadata?.headerPath?.length > 0 
          ? ` > ${res.metadata.headerPath.join(' > ')}` 
          : '';

        card.innerHTML = `
          <div class="res-card-header">
            <div class="res-source-details">
              <i data-lucide="file-text"></i>
              <span class="res-doc-title">${res.documentTitle} ${pageText}</span>
              <span class="res-breadcrumbs">${breadcrumbs}</span>
            </div>
            <span class="badge score-badge">Score: ${res.similarity.toFixed(4)}</span>
          </div>
          <p class="res-content">${res.content}</p>
        `;
        resultsList.appendChild(card);
      });

      lucide.createIcons();

    } catch (err) {
      resultsList.innerHTML = '<div class="form-error">Network request to search endpoint failed.</div>';
    }
  });

});
