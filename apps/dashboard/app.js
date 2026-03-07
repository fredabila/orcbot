(function () {
    const state = {
        apiBase: '/api',
        wsUrl: buildWebSocketUrl(),
        ws: null,
        wsConnected: false,
        activeView: 'overview',
        overview: null,
        services: [],
        skills: [],
        serviceSnapshots: new Map(),
        selectedSkill: null,
        dataHomeSummary: null,
        dataHomeTree: null,
        dataHomeFile: null,
        dataHomePreviewUrl: '',
        selectedDataHomePath: '',
        selectedDataHomeType: 'directory',
        selectedDataHomeEntry: null,
        dataHomeBrowsePath: '',
        tasks: [],
        chatMessages: [],
        memoryItems: [],
        capabilities: null,
        config: {},
        security: null,
        logs: [],
        logInfo: null,
        events: [],
        inspector: null,
        compactCanvas: false,
        apiKey: loadApiKey(),
        lastRefreshAt: null
    };

    const viewMeta = {
        overview: { eyebrow: 'Operations', title: 'Overview' },
        canvas: { eyebrow: 'Workspace', title: 'Canvas' },
        chat: { eyebrow: 'Conversation', title: 'Gateway Chat' },
        tasks: { eyebrow: 'Operations', title: 'Queue' },
        skills: { eyebrow: 'Capabilities', title: 'Skills' },
        services: { eyebrow: 'Runtime', title: 'Services' },
        'data-home': { eyebrow: 'Administration', title: 'Data Home' },
        memory: { eyebrow: 'Context', title: 'Memory' },
        logs: { eyebrow: 'Observability', title: 'Logs' },
        api: { eyebrow: 'Diagnostics', title: 'API Lab' },
        security: { eyebrow: 'Administration', title: 'Security' },
        config: { eyebrow: 'Administration', title: 'Config' }
    };

    const elements = {};

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        bindElements();
        bindNavigation();
        bindActions();
        updateTopbar();
        updateBridgePreview();
        connectWebSocket();
        refreshAll();
        window.a2uiGatewayBridge = createBridge();
    }

    function bindElements() {
        [
            'wsDot', 'wsState', 'modeLabel', 'viewEyebrow', 'viewTitle', 'restBase', 'wsBase',
            'activeModel', 'activeProvider', 'modeDescription', 'metricGrid', 'eventFeed',
            'quickTaskText', 'quickTaskPriority', 'quickTaskSource', 'serviceStrip', 'opsCanvas',
            'bridgePreview', 'canvasServices', 'canvasEvents', 'canvasQueue', 'canvasChat',
            'canvasInspector', 'chatThread', 'chatInput', 'chatClientId', 'chatSummary',
            'taskComposerText', 'taskComposerPriority', 'taskComposerLane', 'taskComposerSource',
            'taskComposerMeta', 'taskListView', 'servicesGrid', 'serviceDetailTitle', 'serviceDetail',
            'dataHomeSummary', 'dataHomeBreadcrumbs', 'dataHomePathInput', 'dataHomeTree', 'dataHomeEditorTitle', 'dataHomeFilePath',
            'dataHomeEditor', 'dataHomeMeta', 'dataHomePreview',
            'skillSearchInput', 'refreshSkillsBtn', 'skillsGrid', 'skillDetailTitle', 'skillDetail',
            'configSearchInput',
            'memorySearchInput', 'memorySearchType', 'memorySearchLimit', 'memoryTimeline',
            'logLevel', 'logSearch', 'logSummary', 'logSurface', 'apiMethod', 'apiEndpointInput', 'apiPayload',
            'apiResponse', 'endpointCatalog', 'securitySummary', 'securityGuidance', 'configGrid', 'toastStack',
            'refreshBtn', 'newTaskBtn', 'quickTaskSend', 'canvasCompactBtn', 'canvasResetBtn',
            'canvasEventClear', 'chatSendBtn', 'clearChatBtn', 'taskComposerSubmit', 'refreshTasksBtn',
            'memorySearchBtn', 'refreshMemoryBtn', 'refreshLogsBtn', 'runApiBtn', 'loadCapabilitiesBtn',
            'refreshConfigBtn', 'refreshSecurityBtn', 'rotateGatewayTokenBtn', 'clearEventsBtn', 'refreshDataHomeBtn', 'dataHomeUpBtn', 'dataHomeRootBtn', 'dataHomeBrowseBtn',
            'dataHomeCreateDirBtn', 'dataHomeNewFileBtn', 'dataHomeRenameBtn', 'dataHomeDeleteBtn',
            'dataHomeSaveBtn', 'dataHomeInspectBtn'
        ].forEach((id) => {
            elements[id] = document.getElementById(id);
        });
    }

    function bindNavigation() {
        document.querySelectorAll('[data-view]').forEach((button) => {
            button.addEventListener('click', () => switchView(button.dataset.view));
        });

        document.querySelectorAll('[data-jump]').forEach((button) => {
            button.addEventListener('click', () => switchView(button.dataset.jump));
        });

        document.querySelectorAll('[data-canvas-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.canvasAction;
                if (action === 'focus-chat') {
                    switchView('chat');
                    elements.chatInput?.focus();
                }
            });
        });
    }

    function bindActions() {
        elements.refreshBtn?.addEventListener('click', refreshAll);
        elements.newTaskBtn?.addEventListener('click', () => {
            switchView('tasks');
            elements.taskComposerText?.focus();
        });
        elements.quickTaskSend?.addEventListener('click', submitQuickTask);
        elements.taskComposerSubmit?.addEventListener('click', submitDetailedTask);
        elements.refreshTasksBtn?.addEventListener('click', loadTasks);
        elements.chatSendBtn?.addEventListener('click', sendChatMessage);
        elements.clearChatBtn?.addEventListener('click', clearChatView);
        elements.memorySearchBtn?.addEventListener('click', runMemorySearch);
        elements.refreshMemoryBtn?.addEventListener('click', loadMemory);
        elements.refreshLogsBtn?.addEventListener('click', loadLogs);
        elements.runApiBtn?.addEventListener('click', runApiRequest);
        elements.loadCapabilitiesBtn?.addEventListener('click', loadCapabilities);
        elements.refreshConfigBtn?.addEventListener('click', loadConfig);
        elements.refreshSecurityBtn?.addEventListener('click', loadSecurity);
        elements.rotateGatewayTokenBtn?.addEventListener('click', rotateGatewayToken);
        elements.clearEventsBtn?.addEventListener('click', clearEvents);
        elements.canvasEventClear?.addEventListener('click', clearEvents);
        elements.canvasCompactBtn?.addEventListener('click', toggleCanvasCompact);
        elements.canvasResetBtn?.addEventListener('click', resetCanvas);
        elements.refreshSkillsBtn?.addEventListener('click', loadSkills);
        elements.skillSearchInput?.addEventListener('input', renderSkills);
        elements.configSearchInput?.addEventListener('input', renderConfig);
        elements.refreshDataHomeBtn?.addEventListener('click', () => loadDataHome(elements.dataHomePathInput?.value || state.dataHomeBrowsePath || ''));
        elements.dataHomeUpBtn?.addEventListener('click', () => loadDataHome(parentRelativePath(state.dataHomeBrowsePath || '')));
        elements.dataHomeRootBtn?.addEventListener('click', () => loadDataHome(''));
        elements.dataHomeBrowseBtn?.addEventListener('click', browseDataHomePath);
        elements.dataHomeCreateDirBtn?.addEventListener('click', createDataHomeDirectory);
        elements.dataHomeNewFileBtn?.addEventListener('click', createDataHomeFile);
        elements.dataHomeRenameBtn?.addEventListener('click', renameDataHomeSelection);
        elements.dataHomeDeleteBtn?.addEventListener('click', deleteDataHomeSelection);
        elements.dataHomeSaveBtn?.addEventListener('click', saveDataHomeFile);
        elements.dataHomeInspectBtn?.addEventListener('click', inspectDataHomeSelection);
        elements.dataHomePathInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') browseDataHomePath();
        });

        elements.logLevel?.addEventListener('change', loadLogs);
        elements.logSearch?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') loadLogs();
        });
        elements.chatInput?.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                sendChatMessage();
            }
        });
    }

    async function refreshAll() {
        await Promise.all([
            loadOverview(),
            loadServices(),
            loadTasks(),
            loadSkills(),
            loadDataHome(state.dataHomeBrowsePath || ''),
            loadChatHistory(),
            loadMemory(),
            loadLogs(),
            loadCapabilities(),
            loadConfig(),
            loadSecurity()
        ]);
        state.lastRefreshAt = new Date().toISOString();
        updateBridgePreview();
    }

    async function loadOverview() {
        const overview = await apiFetch('/dashboard/overview');
        state.overview = overview;
        renderOverview();
        updateHeaderStatus();
        updateBridgePreview();
        return overview;
    }

    async function loadServices() {
        const response = await apiFetch('/services');
        state.services = response.services || [];
        renderServices();
        return state.services;
    }

    async function loadServiceDetail(serviceId) {
        if (!serviceId) return null;
        if (state.serviceSnapshots.has(serviceId)) {
            renderServiceDetail(state.serviceSnapshots.get(serviceId));
            return state.serviceSnapshots.get(serviceId);
        }

        const snapshot = await apiFetch(`/services/${encodeURIComponent(serviceId)}`);
        state.serviceSnapshots.set(serviceId, snapshot);
        renderServiceDetail(snapshot);
        inspectPayload(snapshot, `service:${serviceId}`);
        return snapshot;
    }

    async function loadSkills() {
        const response = await apiFetch('/skills');
        state.skills = response.skills || [];
        if (!state.selectedSkill && state.skills[0]) {
            state.selectedSkill = state.skills[0].name;
        }
        renderSkills();
        return state.skills;
    }

    async function loadDataHome(requestedPath = '') {
        const normalizedPath = normalizeRelativePath(requestedPath);
        const params = new URLSearchParams({ depth: '1' });
        if (normalizedPath) params.set('path', normalizedPath);

        const [summary, treeResponse] = await Promise.all([
            apiFetch('/data-home/summary'),
            apiFetch(`/data-home/tree?${params.toString()}`)
        ]);

        if (treeResponse.entry?.type === 'file') {
            const filePath = normalizeRelativePath(treeResponse.entry.path || normalizedPath);
            await loadDataHome(parentRelativePath(filePath));
            await loadDataHomeFile(filePath);
            return treeResponse;
        }

        state.dataHomeSummary = summary;
        state.dataHomeTree = treeResponse.entry || null;
        state.dataHomeBrowsePath = treeResponse.requestedPath || '';
        if (elements.dataHomePathInput) {
            elements.dataHomePathInput.value = state.dataHomeBrowsePath;
        }

        const selectedEntry = state.selectedDataHomePath
            ? findDataHomeEntry(state.dataHomeTree, state.selectedDataHomePath)
            : null;

        if (selectedEntry) {
            state.selectedDataHomeEntry = selectedEntry;
            state.selectedDataHomeType = selectedEntry.type || state.selectedDataHomeType;
        } else if (state.dataHomeTree) {
            state.selectedDataHomePath = state.dataHomeTree.path || '';
            state.selectedDataHomeType = state.dataHomeTree.type || 'directory';
            state.selectedDataHomeEntry = state.dataHomeTree;
            state.dataHomeFile = null;
            state.dataHomePreviewUrl = '';
        }

        renderDataHome();
        return treeResponse;
    }

    async function loadDataHomeFile(filePath) {
        const normalizedPath = normalizeRelativePath(filePath);
        if (!normalizedPath) {
            toast('A file path is required', 'warn');
            return null;
        }

        const response = await apiFetch(`/data-home/file?path=${encodeURIComponent(normalizedPath)}`);
        state.dataHomeFile = response;
        state.dataHomePreviewUrl = buildDataHomeAssetUrl(response.path);
        state.selectedDataHomePath = response.path;
        state.selectedDataHomeType = 'file';
        state.selectedDataHomeEntry = {
            path: response.path,
            name: basename(response.path),
            type: 'file',
            size: response.size,
            modifiedAt: response.modifiedAt,
            mimeType: response.mimeType,
            protected: false
        };

        renderDataHome();
        inspectPayload(response, `data-home:file:${response.path}`);
        return response;
    }

    async function loadTasks() {
        const [tasksResponse, queueResponse] = await Promise.all([
            apiFetch('/tasks'),
            apiFetch('/queue/stats')
        ]);
        state.tasks = tasksResponse.tasks || [];
        if (state.overview) {
            state.overview.queue = {
                ...(state.overview.queue || {}),
                ...(queueResponse || {})
            };
        }
        renderTasks();
        renderOverview();
        return state.tasks;
    }

    async function loadChatHistory() {
        const response = await apiFetch('/chat/history');
        state.chatMessages = normalizeChatMessages(response.messages || []);
        renderChat();
        return state.chatMessages;
    }

    async function loadMemory() {
        const response = await apiFetch('/memory');
        state.memoryItems = response.memories || [];
        renderMemoryTimeline(state.memoryItems);
        return state.memoryItems;
    }

    async function runMemorySearch() {
        const type = elements.memorySearchType?.value || 'short';
        const limit = elements.memorySearchLimit?.value || '25';
        const query = encodeURIComponent(elements.memorySearchInput?.value || '');
        const response = await apiFetch(`/memory/search?type=${encodeURIComponent(type)}&limit=${encodeURIComponent(limit)}&query=${query}`);
        renderMemoryTimeline(response.memories || []);
        toast(`Loaded ${response.count || 0} memory items`);
    }

    async function loadLogs() {
        const level = elements.logLevel?.value || 'all';
        const search = elements.logSearch?.value || '';
        const params = new URLSearchParams({ lines: '200' });
        if (level && level !== 'all') params.set('level', level);
        if (search) params.set('search', search);
        const response = await apiFetch(`/logs?${params.toString()}`);
        state.logs = response.logs || [];
        state.logInfo = {
            total: response.total || 0,
            filtered: !!response.filtered,
            source: response.source || null,
            sources: Array.isArray(response.sources) ? response.sources : []
        };
        renderLogs();
        return state.logs;
    }

    async function loadCapabilities() {
        const capabilities = await apiFetch('/gateway/capabilities');
        state.capabilities = capabilities;
        renderCapabilities();
        updateHeaderStatus();
        updateBridgePreview();
        return capabilities;
    }

    async function loadConfig() {
        const response = await apiFetch('/config');
        state.config = response.config || {};
        renderConfig();
        return state.config;
    }

    async function loadSecurity() {
        const [security, tokenStatus] = await Promise.all([
            apiFetch('/security'),
            apiFetch('/gateway/token/status')
        ]);
        state.security = { ...security, token: tokenStatus };
        renderSecurity();
        return state.security;
    }

    function renderOverview() {
        const overview = state.overview;
        if (!overview) return;

        elements.modeDescription.textContent = overview.status?.modeDescription || 'Gateway status unavailable';

        const metrics = [
            { label: 'Mode', value: overview.status?.mode || '-', sub: overview.status?.running ? 'agent loop available' : 'gateway transport only' },
            { label: 'Queue Pending', value: overview.queue?.counts?.pending ?? 0, sub: `active ${overview.queue?.activeCount ?? 0}` },
            { label: 'Messages', value: overview.chat?.messageCount ?? 0, sub: overview.chat?.lastMessageAt ? formatTimestamp(overview.chat.lastMessageAt) : 'no chat yet' },
            { label: 'Memories', value: overview.memory?.totalMemories ?? 0, sub: formatBytes(overview.memory?.fileSize ?? 0) },
            { label: 'Skills', value: overview.status?.skillCount ?? 0, sub: `provider ${overview.models?.provider || '-'}` },
            { label: 'WS Clients', value: overview.health?.wsClients ?? 0, sub: `${Math.floor((overview.health?.uptimeSeconds || 0) / 60)}m uptime` }
        ];

        elements.metricGrid.innerHTML = metrics.map((metric) => `
            <article class="metric-card">
                <div class="label">${escapeHtml(metric.label)}</div>
                <div class="value">${escapeHtml(String(metric.value))}</div>
                <div class="sub">${escapeHtml(metric.sub)}</div>
            </article>
        `).join('');

        renderEvents();
        renderServiceStrip();
        renderCanvas();
        renderChatSummary();
    }

    function renderServices() {
        renderServiceStrip();

        if (!state.services.length) {
            elements.servicesGrid.innerHTML = emptyState('No services exposed by the gateway');
            elements.canvasServices.innerHTML = emptyState('Service graph is waiting for gateway data');
            return;
        }

        elements.servicesGrid.innerHTML = state.services.map((service) => `
            <article class="service-card" data-service-id="${escapeAttribute(service.id)}">
                <div class="item-meta">
                    <span>${escapeHtml(service.category || 'service')}</span>
                    <span>${escapeHtml(service.id)}</span>
                </div>
                <h4>${escapeHtml(service.title)}</h4>
                <span class="service-state ${serviceStateClass(service.status)}">${escapeHtml(service.status)}</span>
                <div>${escapeHtml(service.description || '')}</div>
                <div>${renderMetricPairs(service.metrics || {})}</div>
            </article>
        `).join('');

        elements.canvasServices.innerHTML = state.services.slice(0, 6).map((service) => `
            <article class="stack-card" data-service-id="${escapeAttribute(service.id)}">
                <div class="item-meta">
                    <span>${escapeHtml(service.title)}</span>
                    <span class="service-state ${serviceStateClass(service.status)}">${escapeHtml(service.status)}</span>
                </div>
                <div>${renderMetricPairs(service.metrics || {})}</div>
            </article>
        `).join('');

        document.querySelectorAll('[data-service-id]').forEach((node) => {
            node.addEventListener('click', () => loadServiceDetail(node.dataset.serviceId));
        });

        if (state.services[0] && !state.serviceSnapshots.size) {
            loadServiceDetail(state.services[0].id);
        }
    }

    function renderServiceStrip() {
        const services = state.overview?.services || state.services;
        if (!services || !services.length) {
            elements.serviceStrip.innerHTML = emptyState('Waiting for service registry');
            return;
        }

        elements.serviceStrip.innerHTML = services.slice(0, 5).map((service) => `
            <article class="service-pill" data-service-id="${escapeAttribute(service.id)}">
                <div class="item-meta">
                    <span>${escapeHtml(service.category || 'service')}</span>
                </div>
                <h4>${escapeHtml(service.title)}</h4>
                <span class="service-state ${serviceStateClass(service.status)}">${escapeHtml(service.status)}</span>
                <div>${renderMetricPairs(service.metrics || {})}</div>
            </article>
        `).join('');
    }

    function renderServiceDetail(snapshot) {
        if (!snapshot) {
            elements.serviceDetailTitle.textContent = 'Select a service';
            elements.serviceDetail.innerHTML = emptyState('Select a service to inspect metrics, endpoints, and live snapshot payloads');
            return;
        }

        elements.serviceDetailTitle.textContent = snapshot.title;
        elements.serviceDetail.innerHTML = `
            <article class="detail-card">
                <div class="item-meta">
                    <span>${escapeHtml(snapshot.category || 'service')}</span>
                    <span>${escapeHtml(snapshot.id)}</span>
                </div>
                <span class="service-state ${serviceStateClass(snapshot.status)}">${escapeHtml(snapshot.status)}</span>
                <div>${escapeHtml(snapshot.description || '')}</div>
                <div>${renderMetricPairs(snapshot.metrics || {})}</div>
            </article>
            <article class="detail-card">
                <div class="mini-label">Endpoints</div>
                ${Object.values(snapshot.endpoints || []).length ? (snapshot.endpoints || []).map((endpoint) => `<div class="tag">${escapeHtml(endpoint)}</div>`).join('') : '<div class="empty-state">No endpoints declared</div>'}
            </article>
            <article class="detail-card">
                <div class="mini-label">Snapshot</div>
                <pre class="code-surface">${escapeHtml(prettyJson(snapshot.snapshot))}</pre>
            </article>
        `;
    }

    function renderTasks() {
        if (!state.tasks.length) {
            elements.taskListView.innerHTML = emptyState('Task queue is empty');
            elements.canvasQueue.innerHTML = emptyState('No queued or active work');
            return;
        }

        const sorted = state.tasks.slice().sort((left, right) => {
            const leftTime = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
            const rightTime = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
            return leftTime - rightTime;
        });

        const html = sorted.slice(0, 40).map((task) => `
            <article class="queue-card">
                <div class="item-meta">
                    <span>${escapeHtml(task.status || 'pending')}</span>
                    <span>priority ${escapeHtml(String(task.priority ?? '-'))}</span>
                    <span>${escapeHtml(task.lane || task.metadata?.lane || 'user')}</span>
                </div>
                <div>${escapeHtml(task.payload?.task || task.task || task.description || task.payload?.description || task.id)}</div>
                <div class="mini-label mono">${escapeHtml(task.id || '')}</div>
                <div>${renderMetricPairs({ createdAt: formatTimestamp(task.createdAt), updatedAt: formatTimestamp(task.updatedAt) })}</div>
                <div class="inline-actions">
                    <button class="btn ghost small" data-inspect-task="${escapeAttribute(task.id || '')}">Inspect</button>
                    ${task.status === 'pending' || task.status === 'waiting' || task.status === 'in-progress' ? `<button class="btn ghost small" data-cancel-task="${escapeAttribute(task.id || '')}">Cancel</button>` : ''}
                </div>
            </article>
        `).join('');

        elements.taskListView.innerHTML = html;
        elements.canvasQueue.innerHTML = html;

        document.querySelectorAll('[data-cancel-task]').forEach((button) => {
            button.addEventListener('click', () => cancelTask(button.dataset.cancelTask));
        });
        document.querySelectorAll('[data-inspect-task]').forEach((button) => {
            button.addEventListener('click', async () => {
                const response = await apiFetch(`/tasks/${encodeURIComponent(button.dataset.inspectTask)}`);
                inspectPayload(response.task || response, `task:${button.dataset.inspectTask}`);
                switchView('canvas');
            });
        });
    }

    function renderSkills() {
        const query = (elements.skillSearchInput?.value || '').trim().toLowerCase();
        const skills = state.skills.filter((skill) => {
            if (!query) return true;
            return [skill.name, skill.description, skill.usage]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query));
        });

        if (!skills.length) {
            elements.skillsGrid.innerHTML = emptyState('No skills matched the current filter');
            if (!state.selectedSkill) {
                renderSkillDetail(null);
            }
            return;
        }

        if (!skills.some((skill) => skill.name === state.selectedSkill)) {
            state.selectedSkill = skills[0].name;
        }

        elements.skillsGrid.innerHTML = skills.map((skill) => `
            <article class="service-card skill-card ${skill.name === state.selectedSkill ? 'active' : ''}" data-skill-name="${escapeAttribute(skill.name)}">
                <div class="item-meta">
                    <span>${skill.isPlugin ? 'plugin' : 'built-in'}</span>
                    <span>${escapeHtml(skill.name)}</span>
                </div>
                <h4>${escapeHtml(skill.name)}</h4>
                <div>${escapeHtml(skill.description || 'No description')}</div>
                <div class="mini-label mono">${escapeHtml(skill.usage || '{}')}</div>
            </article>
        `).join('');

        document.querySelectorAll('[data-skill-name]').forEach((node) => {
            node.addEventListener('click', () => {
                state.selectedSkill = node.dataset.skillName;
                renderSkills();
            });
        });

        renderSkillDetail(state.skills.find((skill) => skill.name === state.selectedSkill) || null);
    }

    function renderDataHome() {
        renderDataHomeSummary();
        renderDataHomeBreadcrumbs();
        renderDataHomeTree();
        renderDataHomeEditor();
    }

    function renderDataHomeBreadcrumbs() {
        const currentPath = normalizeRelativePath(state.dataHomeBrowsePath || '');
        const segments = currentPath ? currentPath.split('/') : [];
        const crumbs = [{ label: 'root', path: '' }];
        let runningPath = '';

        segments.forEach((segment) => {
            runningPath = runningPath ? `${runningPath}/${segment}` : segment;
            crumbs.push({ label: segment, path: runningPath });
        });

        elements.dataHomeBreadcrumbs.innerHTML = crumbs.map((crumb, index) => `
            <button class="breadcrumb-chip ${crumb.path === currentPath ? 'active' : ''}" data-data-home-nav="${escapeAttribute(crumb.path)}">${escapeHtml(crumb.label)}</button>
            ${index < crumbs.length - 1 ? '<span class="breadcrumb-separator">/</span>' : ''}
        `).join('');

        document.querySelectorAll('[data-data-home-nav]').forEach((node) => {
            node.addEventListener('click', () => loadDataHome(node.dataset.dataHomeNav || ''));
        });
    }

    function renderDataHomeSummary() {
        const summary = state.dataHomeSummary;
        if (!summary) {
            elements.dataHomeSummary.innerHTML = emptyState('Data home summary unavailable');
            return;
        }

        const rootChildren = summary.tree?.children || [];
        const fileCount = rootChildren.filter((entry) => entry.type === 'file').length;
        const directoryCount = rootChildren.filter((entry) => entry.type === 'directory').length;

        elements.dataHomeSummary.innerHTML = renderKeyValueRows([
            { label: 'Root', hint: 'managed workspace root', value: summary.root, mono: true },
            { label: 'Visible directories', hint: 'top-level directory count', value: String(directoryCount), mono: false },
            { label: 'Visible files', hint: 'top-level file count', value: String(fileCount), mono: false },
            { label: 'Protected patterns', hint: 'cannot be edited through gateway', value: (summary.protectedPatterns || []).join(', '), mono: true }
        ]);
    }

    function renderDataHomeTree() {
        if (!state.dataHomeTree) {
            elements.dataHomeTree.innerHTML = emptyState('No data-home tree available');
            return;
        }

        const currentDirectory = state.dataHomeTree;
        const parentPath = parentRelativePath(currentDirectory.path || '');
        const entries = Array.isArray(currentDirectory.children) ? currentDirectory.children : [];

        elements.dataHomeTree.innerHTML = `
            <div class="data-home-directory-head">
                <div>
                    <div class="mini-label">Current directory</div>
                    <div class="mono">${escapeHtml(currentDirectory.path || '(root)')}</div>
                </div>
                <div class="mini-label">${escapeHtml(String(entries.length))} items</div>
            </div>
            <div class="data-home-directory-list">
                <div class="data-home-list-header">
                    <span>Name</span>
                    <span>Type</span>
                    <span>Size</span>
                    <span>Modified</span>
                </div>
                ${currentDirectory.path ? `
                    <button class="data-home-row data-home-row-parent" data-data-home-path="${escapeAttribute(parentPath)}" data-data-home-type="directory">
                        <span class="data-home-row-name"><i class="fas fa-arrow-up"></i><strong>..</strong></span>
                        <span>directory</span>
                        <span>-</span>
                        <span>Parent directory</span>
                    </button>
                ` : ''}
                ${entries.length ? entries.map((entry) => renderDirectoryEntry(entry)).join('') : `<div class="data-home-list-empty">${emptyState('This directory is empty')}</div>`}
            </div>
        `;

        document.querySelectorAll('[data-data-home-path]').forEach((node) => {
            node.addEventListener('click', async () => {
                const entryPath = node.dataset.dataHomePath || '';
                const entryType = node.dataset.dataHomeType || 'file';
                if (entryType === 'directory') {
                    state.selectedDataHomePath = entryPath;
                    state.selectedDataHomeType = 'directory';
                    state.selectedDataHomeEntry = findDataHomeEntry(state.dataHomeTree, entryPath) || state.selectedDataHomeEntry;
                    await loadDataHome(entryPath);
                    return;
                }
                await loadDataHomeFile(entryPath);
            });
        });
    }

    function renderDataHomeEditor() {
        const selectedPath = state.selectedDataHomePath || '';
        const selectedEntry = state.selectedDataHomeEntry;
        const isFileSelection = state.selectedDataHomeType === 'file';
        const filePath = state.dataHomeFile?.path || (isFileSelection ? selectedPath : '');
        const fileContent = state.dataHomeFile?.path === filePath ? state.dataHomeFile.content || '' : '';
        const isTextFile = !!state.dataHomeFile?.isText;
        const directoryOverview = selectedEntry && selectedEntry.type === 'directory'
            ? describeDirectorySelection(selectedEntry)
            : 'Select a text file to edit its contents.';

        elements.dataHomeEditorTitle.textContent = isFileSelection
            ? (filePath || 'File editor')
            : `Directory ${selectedPath || '(root)'}`;
        elements.dataHomeFilePath.value = filePath;
        elements.dataHomeEditor.value = isFileSelection ? (isTextFile ? fileContent : describeBinarySelection(state.dataHomeFile)) : directoryOverview;
        elements.dataHomeEditor.readOnly = !isFileSelection || !isTextFile;
        elements.dataHomeSaveBtn.disabled = !isFileSelection || !isTextFile;
        renderDataHomePreview(isFileSelection ? state.dataHomeFile : null);

        const rows = selectedEntry ? [
            { label: 'Path', hint: 'relative to data home', value: selectedEntry.path || '(root)', mono: true },
            { label: 'Type', hint: 'entry kind', value: selectedEntry.type || '-', mono: false },
            { label: 'Modified', hint: 'last write timestamp', value: selectedEntry.modifiedAt || state.dataHomeFile?.modifiedAt || '-', mono: false },
            { label: 'Size', hint: 'file payload size', value: selectedEntry.type === 'file' ? formatBytes(selectedEntry.size || 0) : '-', mono: false },
            { label: 'Media type', hint: 'detected mime type', value: state.dataHomeFile?.mimeType || selectedEntry.mimeType || '-', mono: true },
            { label: 'Protected', hint: 'gateway protection boundary', value: String(!!selectedEntry.protected), mono: false }
        ] : [
            { label: 'Selection', hint: 'current data-home focus', value: 'None', mono: false }
        ];

        elements.dataHomeMeta.innerHTML = renderKeyValueRows(rows);
    }

    function renderSkillDetail(skill) {
        if (!skill) {
            elements.skillDetailTitle.textContent = 'Select a skill';
            elements.skillDetail.innerHTML = emptyState('Choose a skill to inspect its usage or run it with JSON arguments');
            return;
        }

        elements.skillDetailTitle.textContent = skill.name;
        elements.skillDetail.innerHTML = `
            <article class="detail-card">
                <div class="item-meta">
                    <span>${skill.isPlugin ? 'plugin' : 'built-in'}</span>
                    <span>${escapeHtml(skill.name)}</span>
                </div>
                <div>${escapeHtml(skill.description || 'No description')}</div>
            </article>
            <article class="detail-card">
                <div class="mini-label">Usage</div>
                <pre class="code-surface">${escapeHtml(skill.usage || '{}')}</pre>
            </article>
            <article class="detail-card">
                <label>
                    <span class="mini-label">Arguments JSON</span>
                    <textarea id="skillArgsInput" class="text-area code-input" rows="7">{}</textarea>
                </label>
                <div class="skill-actions">
                    <button class="btn primary" id="runSkillBtn">Run skill</button>
                    <button class="btn ghost" id="inspectSkillBtn">Inspect metadata</button>
                    ${skill.isPlugin ? '<button class="btn ghost" id="removeSkillBtn">Remove plugin</button>' : ''}
                </div>
                <pre class="code-surface" id="skillRunResult">Run a skill to inspect the result here.</pre>
            </article>
        `;

        document.getElementById('runSkillBtn')?.addEventListener('click', () => executeSkill(skill));
        document.getElementById('inspectSkillBtn')?.addEventListener('click', () => inspectPayload(skill, `skill:${skill.name}`));
        document.getElementById('removeSkillBtn')?.addEventListener('click', () => uninstallSkill(skill));
    }

    function renderChat() {
        if (!state.chatMessages.length) {
            elements.chatThread.innerHTML = emptyState('No gateway conversation yet');
            elements.canvasChat.innerHTML = emptyState('Conversation window is empty');
            renderChatSummary();
            return;
        }

        const html = state.chatMessages.slice(-60).map((message) => `
            <article class="chat-bubble ${escapeAttribute(message.role)}">
                <div class="item-meta">
                    <span>${escapeHtml(message.role)}</span>
                    <span>${escapeHtml(formatTimestamp(message.timestamp))}</span>
                    <span>${escapeHtml(message.metadata?.sourceId || message.metadata?.clientId || 'gateway')}</span>
                </div>
                <div>${formatMultiline(message.content || '')}</div>
            </article>
        `).join('');

        elements.chatThread.innerHTML = html;
        elements.canvasChat.innerHTML = html;
        renderChatSummary();
        scrollToBottom(elements.chatThread);
        scrollToBottom(elements.canvasChat);
    }

    function renderChatSummary() {
        const overviewChat = state.overview?.chat || {};
        const items = [
            { label: 'Messages', value: state.chatMessages.length || overviewChat.messageCount || 0 },
            { label: 'Last message', value: overviewChat.lastMessageAt ? formatTimestamp(overviewChat.lastMessageAt) : (state.chatMessages[0]?.timestamp ? formatTimestamp(state.chatMessages[0].timestamp) : '-') },
            { label: 'Latest speaker', value: state.chatMessages[state.chatMessages.length - 1]?.role || '-' },
            { label: 'WebSocket', value: state.wsConnected ? 'connected' : 'offline' }
        ];

        elements.chatSummary.innerHTML = items.map((item) => `
            <article class="stack-card">
                <div class="mini-label">${escapeHtml(item.label)}</div>
                <div>${escapeHtml(String(item.value))}</div>
            </article>
        `).join('');
    }

    function renderMemoryTimeline(items) {
        if (!items.length) {
            elements.memoryTimeline.innerHTML = emptyState('No memory items available');
            return;
        }

        elements.memoryTimeline.innerHTML = items.map((item) => `
            <article class="timeline-item">
                <div class="item-meta">
                    <span>${escapeHtml(item.type || item.metadata?.type || 'memory')}</span>
                    <span>${escapeHtml(formatTimestamp(item.timestamp))}</span>
                    <span>${escapeHtml(item.metadata?.source || item.metadata?.skill || 'runtime')}</span>
                </div>
                <div>${formatMultiline(item.content || '')}</div>
                <div class="mini-label mono">${escapeHtml(item.id || '')}</div>
            </article>
        `).join('');
    }

    function renderLogs() {
        const lines = state.logs;
        const info = state.logInfo || { total: 0, filtered: false, source: null, sources: [] };
        const rows = [
            { label: 'Lines shown', value: String(lines.length), hint: info.filtered ? `filtered from ${info.total}` : `${info.total} available` },
            { label: 'Source', value: info.source || 'No log file found', hint: 'active log file' },
            { label: 'Other sources', value: info.sources.length ? info.sources.join('\n') : 'None detected', hint: 'discovered log files' }
        ];

        if (elements.logSummary) {
            elements.logSummary.innerHTML = renderKeyValueRows(rows.map((row) => ({
                label: row.label,
                hint: row.hint,
                value: row.value,
                mono: true
            })));
        }

        elements.logSurface.textContent = lines.length
            ? lines.join('\n')
            : (info.source ? 'No matching logs for the current filters.' : 'No log file was found. The gateway now checks workspace logs and the data-home foreground log.');
    }

    function renderCapabilities() {
        if (!state.capabilities?.api) {
            elements.endpointCatalog.innerHTML = emptyState('Capabilities not available');
            return;
        }

        elements.endpointCatalog.innerHTML = Object.entries(state.capabilities.api).map(([group, endpoints]) => `
            <article class="endpoint-card">
                <div class="mini-label">${escapeHtml(group)}</div>
                <div>${Array.isArray(endpoints) ? endpoints.map((endpoint) => `<div class="tag mono">${escapeHtml(endpoint)}</div>`).join('') : escapeHtml(String(endpoints))}</div>
            </article>
        `).join('');
    }

    function renderConfig() {
        const query = (elements.configSearchInput?.value || '').trim().toLowerCase();
        const entries = Object.entries(state.config || {})
            .sort(([left], [right]) => left.localeCompare(right))
            .filter(([key, value]) => {
                if (!query) return true;
                return key.toLowerCase().includes(query) || formatValue(value).toLowerCase().includes(query);
            });

        elements.configGrid.innerHTML = entries.length
            ? renderKeyValueRows(entries.map(([key, value]) => ({
                label: key,
                hint: configHintForKey(key),
                value: formatValue(value),
                mono: true
            })))
            : emptyState(query ? 'No config entries matched the current filter' : 'No safe config exposed');
    }

    function renderSecurity() {
        const security = state.security;
        if (!security) {
            elements.securitySummary.innerHTML = emptyState('Security details unavailable');
            elements.securityGuidance.innerHTML = emptyState('Security guidance unavailable');
            return;
        }

        const blocks = [
            { label: 'Gateway auth', value: security.token?.authEnabled ? 'enabled' : 'disabled' },
            { label: 'Token hint', value: security.token?.tokenPartial || security.token?.hint || 'not set' },
            { label: 'Safe mode', value: String(security.safeMode) },
            { label: 'Auto execute commands', value: String(security.autoExecuteCommands) },
            { label: 'Plugin allow list', value: Array.isArray(security.pluginAllowList) && security.pluginAllowList.length ? security.pluginAllowList.join(', ') : 'empty' },
            { label: 'Plugin deny list', value: Array.isArray(security.pluginDenyList) && security.pluginDenyList.length ? security.pluginDenyList.join(', ') : 'empty' }
        ];

        elements.securitySummary.innerHTML = renderKeyValueRows(blocks.map((block) => ({
            label: block.label,
            hint: securityHintForLabel(block.label),
            value: block.value,
            mono: false
        })));

        const securityEndpoints = state.capabilities?.api?.security || [];
        const hardeningCards = [
            {
                label: 'Gateway token',
                body: security.token?.authEnabled
                    ? 'Authentication is active. Rotating the token here updates the dashboard key and reconnects the WebSocket automatically.'
                    : 'Gateway auth is disabled. Use Rotate Token to generate and enable a gateway API key.'
            },
            {
                label: 'Execution policy',
                body: `Safe mode is ${security.safeMode ? 'enabled' : 'disabled'} and auto-execute commands is ${security.autoExecuteCommands ? 'enabled' : 'disabled'}. Review these before exposing the gateway beyond trusted networks.`
            },
            {
                label: 'Security endpoints',
                body: Array.isArray(securityEndpoints) && securityEndpoints.length
                    ? securityEndpoints.join('\n')
                    : 'No security endpoints advertised by the gateway capabilities response.'
            }
        ];

        elements.securityGuidance.innerHTML = hardeningCards.map((card) => `
            <article class="detail-card">
                <div class="mini-label">${escapeHtml(card.label)}</div>
                <div>${formatMultiline(card.body)}</div>
            </article>
        `).join('');
    }

    async function rotateGatewayToken() {
        const confirmed = window.confirm('Rotate the gateway API token? Existing clients using the old token will lose access until updated.');
        if (!confirmed) return;

        const response = await apiFetch('/gateway/token/rotate', {
            method: 'POST',
            body: JSON.stringify({})
        });

        if (response?.token) {
            setApiKey(response.token);
            connectWebSocket();
        }

        await loadSecurity();
        await loadCapabilities();
        toast('Gateway token rotated and dashboard credentials updated');
    }

    function renderEvents() {
        if (!state.events.length) {
            elements.eventFeed.innerHTML = emptyState('Waiting for runtime events');
            elements.canvasEvents.innerHTML = emptyState('Event lane is clear');
            return;
        }

        const html = state.events.slice(0, 60).map((event) => `
            <article class="event-card ${escapeAttribute(event.kind || 'system')}">
                <div class="event-meta">
                    <span>${escapeHtml(event.label)}</span>
                    <span>${escapeHtml(formatTimestamp(event.timestamp))}</span>
                </div>
                <div>${escapeHtml(event.message)}</div>
            </article>
        `).join('');

        elements.eventFeed.innerHTML = html;
        elements.canvasEvents.innerHTML = html;
    }

    function renderCanvas() {
        elements.opsCanvas?.classList.toggle('compact', state.compactCanvas);
        if (!elements.canvasInspector.textContent || elements.canvasInspector.textContent.includes('Select a service')) {
            updateInspectorSurface();
        }
    }

    function updateInspectorSurface() {
        elements.canvasInspector.textContent = state.inspector
            ? prettyJson(state.inspector.payload)
            : 'Select a service or run an API call to inspect payloads here.';
    }

    function switchView(viewId) {
        state.activeView = viewId;
        document.querySelectorAll('.nav-item').forEach((item) => {
            item.classList.toggle('active', item.dataset.view === viewId);
        });
        document.querySelectorAll('.view').forEach((view) => {
            view.classList.toggle('active', view.id === `view-${viewId}`);
        });
        updateTopbar();
    }

    function updateTopbar() {
        const meta = viewMeta[state.activeView] || viewMeta.overview;
        elements.viewEyebrow.textContent = meta.eyebrow;
        elements.viewTitle.textContent = meta.title;
    }

    function updateHeaderStatus() {
        const overview = state.overview;
        const capabilities = state.capabilities;
        elements.modeLabel.textContent = overview?.status?.mode || '-';
        elements.restBase.textContent = capabilities?.transport?.restBase || state.apiBase;
        elements.wsBase.textContent = capabilities?.transport?.websocket || '/';
        elements.activeModel.textContent = overview?.models?.currentModel || overview?.status?.model || '-';
        elements.activeProvider.textContent = overview?.models?.provider || overview?.status?.provider || '-';
    }

    async function submitQuickTask() {
        const task = elements.quickTaskText?.value?.trim();
        if (!task) {
            toast('Task description is required', 'warn');
            return;
        }

        await createTask({
            task,
            priority: Number(elements.quickTaskPriority?.value || 5),
            metadata: {
                source: elements.quickTaskSource?.value || 'gateway-chat',
                sourceId: 'gateway-web',
                lane: 'user'
            }
        });
        elements.quickTaskText.value = '';
    }

    async function submitDetailedTask() {
        const task = elements.taskComposerText?.value?.trim();
        if (!task) {
            toast('Task description is required', 'warn');
            return;
        }

        let metadata = {};
        const rawMeta = elements.taskComposerMeta?.value?.trim();
        if (rawMeta) {
            try {
                metadata = JSON.parse(rawMeta);
            } catch (error) {
                toast(`Metadata JSON is invalid: ${error.message}`, 'error');
                return;
            }
        }

        await createTask({
            task,
            priority: Number(elements.taskComposerPriority?.value || 5),
            metadata: {
                ...metadata,
                lane: elements.taskComposerLane?.value || 'user',
                source: elements.taskComposerSource?.value || 'gateway-chat',
                sourceId: metadata.sourceId || 'gateway-web'
            }
        });
    }

    async function createTask(payload) {
        await apiFetch('/tasks', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        toast('Task pushed to queue');
        pushEvent({ label: 'task', message: payload.task, timestamp: new Date().toISOString(), kind: 'action' });
        await loadTasks();
        await loadOverview();
    }

    async function cancelTask(taskId) {
        await apiFetch(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'Cancelled from gateway dashboard' })
        });
        toast(`Cancelled ${taskId}`);
        await loadTasks();
    }

    async function sendChatMessage() {
        const message = elements.chatInput?.value?.trim();
        if (!message) {
            toast('Message is required', 'warn');
            return;
        }

        const metadata = {
            clientId: elements.chatClientId?.value || 'gateway-web',
            sourceId: elements.chatClientId?.value || 'gateway-web'
        };

        state.chatMessages.push({
            id: `local-${Date.now()}`,
            role: 'user',
            content: message,
            timestamp: new Date().toISOString(),
            metadata
        });
        renderChat();
        elements.chatInput.value = '';

        try {
            if (state.wsConnected) {
                sendWebSocket('sendChatMessage', { message, metadata });
            } else {
                await apiFetch('/chat/send', {
                    method: 'POST',
                    body: JSON.stringify({ message, metadata })
                });
            }
            toast('Message sent');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function clearChatView() {
        state.chatMessages = [];
        renderChat();
        apiFetch('/chat/clear', { method: 'POST' }).catch(() => {});
    }

    function clearEvents() {
        state.events = [];
        renderEvents();
        toast('Event lane cleared');
    }

    function toggleCanvasCompact() {
        state.compactCanvas = !state.compactCanvas;
        renderCanvas();
    }

    function resetCanvas() {
        state.compactCanvas = false;
        renderCanvas();
        toast('Canvas layout reset');
    }

    async function runApiRequest() {
        const method = elements.apiMethod?.value || 'GET';
        const endpoint = elements.apiEndpointInput?.value || '/dashboard/overview';
        let body;
        if (method !== 'GET' && method !== 'DELETE') {
            const payload = elements.apiPayload?.value?.trim();
            if (payload) {
                try {
                    body = JSON.stringify(JSON.parse(payload));
                } catch (error) {
                    toast(`API payload is invalid JSON: ${error.message}`, 'error');
                    return;
                }
            }
        }

        try {
            const response = await apiFetch(endpoint.startsWith('/api') ? endpoint.replace('/api', '') : endpoint, { method, body });
            elements.apiResponse.textContent = prettyJson(response);
            inspectPayload(response, `api:${method} ${endpoint}`);
        } catch (error) {
            elements.apiResponse.textContent = error.message;
            toast(error.message, 'error');
        }
    }

    function inspectPayload(payload, label) {
        state.inspector = { label, payload, timestamp: new Date().toISOString() };
        updateInspectorSurface();
        elements.apiResponse.textContent = prettyJson(payload);
    }

    async function executeSkill(skill) {
        const argsInput = document.getElementById('skillArgsInput');
        const resultNode = document.getElementById('skillRunResult');
        let args = {};

        try {
            args = JSON.parse(argsInput?.value || '{}');
        } catch (error) {
            toast(`Skill args are invalid JSON: ${error.message}`, 'error');
            return;
        }

        const response = await apiFetch(`/skills/${encodeURIComponent(skill.name)}/execute`, {
            method: 'POST',
            body: JSON.stringify(args)
        });

        resultNode.textContent = prettyJson(response.result ?? response);
        inspectPayload(response.result ?? response, `skill-run:${skill.name}`);
        toast(`Executed ${skill.name}`);
    }

    async function uninstallSkill(skill) {
        await apiFetch(`/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' });
        toast(`Removed ${skill.name}`);
        state.selectedSkill = null;
        await loadSkills();
    }

    async function browseDataHomePath() {
        await loadDataHome(elements.dataHomePathInput?.value || '');
    }

    async function createDataHomeDirectory() {
        const basePath = getDataHomeDirectoryContext();
        const suggested = joinRelativePath(basePath, 'new-folder');
        const targetPath = window.prompt('New folder path', suggested);
        if (!targetPath) return;

        await apiFetch('/data-home/directory', {
            method: 'POST',
            body: JSON.stringify({ path: targetPath })
        });
        toast(`Created folder ${normalizeRelativePath(targetPath)}`);
        await loadDataHome(parentRelativePath(normalizeRelativePath(targetPath)));
    }

    function createDataHomeFile() {
        const basePath = getDataHomeDirectoryContext();
        const targetPath = window.prompt('New file path', joinRelativePath(basePath, 'notes.txt'));
        if (!targetPath) return;

        const normalizedPath = normalizeRelativePath(targetPath);
        state.selectedDataHomePath = normalizedPath;
        state.selectedDataHomeType = 'file';
        state.selectedDataHomeEntry = {
            path: normalizedPath,
            name: basename(normalizedPath),
            type: 'file',
            size: 0,
            modifiedAt: null,
            mimeType: 'text/plain; charset=utf-8',
            protected: false
        };
        state.dataHomeFile = { path: normalizedPath, content: '', size: 0, modifiedAt: null, mimeType: 'text/plain; charset=utf-8', isText: true, previewKind: 'text' };
        state.dataHomePreviewUrl = '';
        renderDataHome();
        elements.dataHomeEditor?.focus();
    }

    async function saveDataHomeFile() {
        const filePath = normalizeRelativePath(elements.dataHomeFilePath?.value || '');
        if (!filePath) {
            toast('A file path is required before saving', 'warn');
            return;
        }

        const content = elements.dataHomeEditor?.value || '';
        const response = await apiFetch('/data-home/file', {
            method: 'PUT',
            body: JSON.stringify({ path: filePath, content })
        });

        toast(`Saved ${response.path}`);
        await loadDataHome(parentRelativePath(filePath));
        await loadDataHomeFile(filePath);
    }

    async function renameDataHomeSelection() {
        const currentPath = getDataHomeSelectedPath();
        if (!currentPath) {
            toast('Select a file or folder first', 'warn');
            return;
        }

        const nextPath = window.prompt('Rename or move to', currentPath);
        if (!nextPath || normalizeRelativePath(nextPath) === currentPath) return;

        const response = await apiFetch('/data-home/rename', {
            method: 'POST',
            body: JSON.stringify({ fromPath: currentPath, toPath: nextPath })
        });

        toast(`Renamed ${response.fromPath} to ${response.toPath}`);
        state.selectedDataHomePath = response.toPath;
        state.selectedDataHomeType = response.type;
        state.dataHomeFile = response.type === 'file' ? { ...(state.dataHomeFile || {}), path: response.toPath, content: elements.dataHomeEditor?.value || '' } : null;
        state.dataHomePreviewUrl = response.type === 'file' ? buildDataHomeAssetUrl(response.toPath) : '';
        await loadDataHome(parentRelativePath(response.toPath));
        if (response.type === 'file') {
            await loadDataHomeFile(response.toPath);
        } else {
            state.selectedDataHomeEntry = findDataHomeEntry(state.dataHomeTree, response.toPath) || null;
            renderDataHome();
        }
    }

    async function deleteDataHomeSelection() {
        const currentPath = getDataHomeSelectedPath();
        if (!currentPath) {
            toast('Select a file or folder first', 'warn');
            return;
        }
        if (!window.confirm(`Delete ${currentPath}?`)) return;

        const response = await apiFetch(`/data-home/entry?path=${encodeURIComponent(currentPath)}`, {
            method: 'DELETE'
        });

        toast(`Deleted ${response.path}`);
        const parentPath = parentRelativePath(currentPath);
        state.selectedDataHomePath = parentPath;
        state.selectedDataHomeType = 'directory';
        state.selectedDataHomeEntry = null;
        state.dataHomeFile = null;
        state.dataHomePreviewUrl = '';
        await loadDataHome(parentPath);
    }

    function inspectDataHomeSelection() {
        if (state.dataHomeFile) {
            inspectPayload(state.dataHomeFile, `data-home:file:${state.dataHomeFile.path}`);
            return;
        }
        if (state.selectedDataHomeEntry) {
            inspectPayload(state.selectedDataHomeEntry, `data-home:entry:${state.selectedDataHomeEntry.path || '(root)'}`);
            return;
        }
        toast('No data-home selection to inspect', 'warn');
    }

    function connectWebSocket() {
        if (state.ws) {
            state.ws.close();
        }

        try {
            state.ws = new WebSocket(`${state.wsUrl}${state.apiKey ? `${state.wsUrl.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(state.apiKey)}` : ''}`);
        } catch (error) {
            handleWsClose(error.message || 'WebSocket failed to initialize');
            return;
        }

        state.ws.addEventListener('open', () => {
            state.wsConnected = true;
            elements.wsDot.classList.add('connected');
            elements.wsState.textContent = 'Connected';
            sendWebSocket('subscribe', { events: ['all'] });
            sendWebSocket('getStatus', {});
            toast('WebSocket connected');
        });

        state.ws.addEventListener('message', (event) => {
            try {
                handleWsMessage(JSON.parse(event.data));
            } catch (error) {
                pushEvent({ label: 'ws', message: `Invalid gateway payload: ${error.message}`, timestamp: new Date().toISOString(), kind: 'error' });
            }
        });

        state.ws.addEventListener('close', () => {
            handleWsClose('Disconnected');
            window.setTimeout(connectWebSocket, 2500);
        });

        state.ws.addEventListener('error', () => {
            handleWsClose('Connection error');
        });
    }

    function handleWsClose(label) {
        state.wsConnected = false;
        elements.wsDot.classList.remove('connected');
        elements.wsState.textContent = label;
        renderChatSummary();
    }

    function sendWebSocket(action, payload) {
        if (!state.wsConnected || !state.ws) {
            throw new Error('WebSocket is not connected');
        }
        state.ws.send(JSON.stringify({ action, payload }));
    }

    function handleWsMessage(message) {
        if (message.type === 'status') {
            if (!state.overview) state.overview = {};
            state.overview.status = message.data;
            updateHeaderStatus();
            renderOverview();
            return;
        }

        if (message.type === 'event') {
            pushEvent(normalizeEvent(message));
            if (message.event === 'action:push' || message.event === 'action:queued') {
                loadTasks().catch(() => {});
            }
            return;
        }

        if (message.type === 'chat' || message.type === 'chat:message') {
            state.chatMessages.push(normalizeChatMessage(message));
            renderChat();
            return;
        }

        if (message.type === 'chat:file') {
            state.chatMessages.push({
                id: message.messageId || `chat-file-${Date.now()}`,
                role: 'assistant',
                content: `[File] ${message.filename || message.name || message.path || 'attachment'}`,
                timestamp: message.timestamp || new Date().toISOString(),
                metadata: message.metadata || { kind: 'file', path: message.path }
            });
            renderChat();
            return;
        }

        if (message.type === 'chat:cleared') {
            state.chatMessages = [];
            renderChat();
            return;
        }

        if (message.type === 'taskPushed') {
            loadTasks().catch(() => {});
            return;
        }

        if (message.type === 'error') {
            toast(message.error || 'Gateway error', 'error');
            pushEvent({ label: 'gateway-error', message: message.error || 'Gateway error', timestamp: new Date().toISOString(), kind: 'error' });
            return;
        }

        pushEvent({
            label: message.type || 'gateway',
            message: typeof message === 'string' ? message : prettyJson(message),
            timestamp: message.timestamp || new Date().toISOString(),
            kind: 'system'
        });
    }

    async function apiFetch(endpoint, options = {}) {
        const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (state.apiKey) {
            headers['x-api-key'] = state.apiKey;
        }

        const response = await fetch(`${state.apiBase}${path}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            const apiKey = window.prompt('Gateway API key required', state.apiKey || '');
            if (apiKey) {
                setApiKey(apiKey);
                return apiFetch(endpoint, options);
            }
        }

        const text = await response.text();
        const payload = text ? safeJsonParse(text) : null;

        if (!response.ok) {
            throw new Error(payload?.error || `Request failed: ${response.status}`);
        }

        return payload;
    }

    function pushEvent(event) {
        state.events.unshift(event);
        state.events = state.events.slice(0, 80);
        renderEvents();
    }

    function normalizeEvent(message) {
        return {
            label: message.event || message.type || 'event',
            message: summarizeEventPayload(message.data),
            timestamp: message.timestamp || new Date().toISOString(),
            kind: eventKind(message.event)
        };
    }

    function normalizeChatMessages(messages) {
        return messages.slice().sort((left, right) => new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime()).map(normalizeChatMessage);
    }

    function normalizeChatMessage(message) {
        return {
            id: message.id || message.messageId || `chat-${Date.now()}`,
            role: message.role || inferRoleFromMessage(message),
            content: message.content || message.text || '',
            timestamp: message.timestamp || new Date().toISOString(),
            metadata: message.metadata || {}
        };
    }

    function inferRoleFromMessage(message) {
        if (message.metadata?.role) return message.metadata.role;
        if (message.type === 'chat' && message.sender === 'user') return 'user';
        return 'assistant';
    }

    function summarizeEventPayload(data) {
        if (!data) return 'No payload';
        if (typeof data === 'string') return data;
        if (data.payload?.task) return data.payload.task;
        if (data.task) return data.task;
        if (data.reason) return data.reason;
        if (data.content) return data.content;
        if (data.id) return `id ${data.id}`;
        return prettyJson(data).slice(0, 220);
    }

    function eventKind(eventName) {
        if (!eventName) return 'system';
        if (eventName.includes('error')) return 'error';
        if (eventName.includes('action')) return 'action';
        if (eventName.includes('memory')) return 'warn';
        return 'system';
    }

    function createBridge() {
        return {
            ready: true,
            state,
            navigate: switchView,
            refresh: refreshAll,
            fetch: apiFetch,
            inspect: inspectPayload,
            appendEvent(event) {
                pushEvent({
                    label: event.label || 'external',
                    message: event.message || summarizeEventPayload(event.payload),
                    timestamp: event.timestamp || new Date().toISOString(),
                    kind: event.kind || 'system'
                });
            },
            async pushTask(task, priority = 5, metadata = {}) {
                return createTask({ task, priority, metadata });
            },
            async sendChatMessage(message, metadata = {}) {
                if (state.wsConnected) {
                    sendWebSocket('sendChatMessage', { message, metadata });
                    return { success: true, via: 'ws' };
                }
                return apiFetch('/chat/send', {
                    method: 'POST',
                    body: JSON.stringify({ message, metadata })
                });
            },
            async getService(serviceId) {
                return loadServiceDetail(serviceId);
            },
            connectWebSocket,
            setApiKey(key) {
                setApiKey(key);
                connectWebSocket();
            },
            getApiKey() {
                return state.apiKey;
            }
        };
    }

    function toast(message, tone = 'info') {
        const node = document.createElement('div');
        node.className = 'toast';
        node.textContent = tone === 'error' ? `Error: ${message}` : message;
        elements.toastStack.appendChild(node);
        window.setTimeout(() => node.remove(), 3200);
    }

    function formatTimestamp(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString();
    }

    function formatBytes(value) {
        const size = Number(value || 0);
        if (!size) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let amount = size;
        let unitIndex = 0;
        while (amount >= 1024 && unitIndex < units.length - 1) {
            amount /= 1024;
            unitIndex += 1;
        }
        return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
    }

    function renderDirectoryEntry(entry) {
        const isActive = (entry.path || '') === (state.selectedDataHomePath || '');
        const isDirectory = entry.type === 'directory';
        const icon = isDirectory ? 'fa-folder' : 'fa-file-lines';
        const size = isDirectory ? '-' : formatBytes(entry.size || 0);
        const modified = entry.modifiedAt ? formatTimestamp(entry.modifiedAt) : '-';

        return `
            <button class="data-home-row ${isActive ? 'active' : ''}" data-data-home-path="${escapeAttribute(entry.path || '')}" data-data-home-type="${escapeAttribute(entry.type || 'file')}">
                <span class="data-home-row-name">
                    <i class="fas ${icon}"></i>
                    <strong>${escapeHtml(entry.name || '(root)')}</strong>
                    ${entry.protected ? '<span class="tag">protected</span>' : ''}
                </span>
                <span>${escapeHtml(entry.type || '-')}</span>
                <span>${escapeHtml(size)}</span>
                <span>${escapeHtml(modified)}</span>
            </button>
        `;
    }

    function findDataHomeEntry(entry, targetPath) {
        if (!entry) return null;
        if ((entry.path || '') === (targetPath || '')) return entry;
        if (!Array.isArray(entry.children)) return null;
        for (const child of entry.children) {
            const match = findDataHomeEntry(child, targetPath);
            if (match) return match;
        }
        return null;
    }

    function describeDirectorySelection(entry) {
        const children = Array.isArray(entry.children) ? entry.children : [];
        const folders = children.filter((child) => child.type === 'directory');
        const files = children.filter((child) => child.type === 'file');
        const previewLines = children.slice(0, 12).map((child) => {
            const prefix = child.type === 'directory' ? '[dir]' : '[file]';
            const size = child.type === 'file' ? ` ${formatBytes(child.size || 0)}` : '';
            const protectedLabel = child.protected ? ' protected' : '';
            return `${prefix} ${child.name}${size}${protectedLabel}`;
        });

        return [
            `Directory: ${entry.path || '(root)'}`,
            `Folders: ${folders.length}`,
            `Files: ${files.length}`,
            '',
            children.length ? 'Visible entries:' : 'This directory is empty.',
            ...previewLines,
            children.length > 12 ? '' : '',
            children.length > 12 ? `...and ${children.length - 12} more entries` : '',
            '',
            'Select a file from the tree to edit it, or use New File / New Folder to create content here.'
        ].filter(Boolean).join('\n');
    }

    function describeBinarySelection(file) {
        return [
            `File: ${file?.path || '-'}`,
            `Type: ${file?.mimeType || 'application/octet-stream'}`,
            `Size: ${formatBytes(file?.size || 0)}`,
            '',
            'This asset is not editable as plain text in the dashboard.',
            'Use the preview below when supported, or open/download the file directly.'
        ].join('\n');
    }

    function renderDataHomePreview(file) {
        if (!elements.dataHomePreview) return;
        if (!file || !file.path) {
            elements.dataHomePreview.innerHTML = '';
            elements.dataHomePreview.classList.remove('active');
            return;
        }

        const assetUrl = state.dataHomePreviewUrl || buildDataHomeAssetUrl(file.path);
        const downloadUrl = buildDataHomeAssetUrl(file.path, true);
        let previewHtml = '';

        if (file.isText) {
            previewHtml = `
                <div class="data-home-preview-card">
                    <div class="mini-label">Text file</div>
                    <div>Inline text editing is enabled for this file.</div>
                </div>
            `;
        } else if (file.previewKind === 'image') {
            previewHtml = `<img class="data-home-preview-image" src="${escapeAttribute(assetUrl)}" alt="${escapeAttribute(file.path)}">`;
        } else if (file.previewKind === 'audio') {
            previewHtml = `<audio class="data-home-preview-media" controls src="${escapeAttribute(assetUrl)}"></audio>`;
        } else if (file.previewKind === 'video') {
            previewHtml = `<video class="data-home-preview-media" controls src="${escapeAttribute(assetUrl)}"></video>`;
        } else if (file.previewKind === 'pdf') {
            previewHtml = `<iframe class="data-home-preview-frame" src="${escapeAttribute(assetUrl)}" title="${escapeAttribute(file.path)}"></iframe>`;
        } else {
            previewHtml = `
                <div class="data-home-preview-card">
                    <div class="mini-label">Binary file</div>
                    <div>No inline preview is available for this format.</div>
                </div>
            `;
        }

        elements.dataHomePreview.innerHTML = `
            <div class="data-home-preview-head">
                <div class="mini-label">Asset preview</div>
                <div class="inline-actions">
                    <a class="btn ghost small" href="${escapeAttribute(assetUrl)}" target="_blank" rel="noreferrer">Open</a>
                    <a class="btn ghost small" href="${escapeAttribute(downloadUrl)}" target="_blank" rel="noreferrer">Download</a>
                </div>
            </div>
            ${previewHtml}
        `;
        elements.dataHomePreview.classList.add('active');
    }

    function renderMetricPairs(metrics) {
        const pairs = Object.entries(metrics || {});
        if (!pairs.length) return '<div class="mini-label">No metrics</div>';
        return pairs.map(([key, value]) => `<div><span class="mini-label">${escapeHtml(key)}</span> ${escapeHtml(formatValue(value))}</div>`).join('');
    }

    function renderKeyValueRows(rows) {
        return rows.map((row) => `
            <article class="kv-row">
                <div class="kv-key">
                    <div class="mini-label">${escapeHtml(row.label)}</div>
                    <div class="eyebrow">${escapeHtml(row.hint || 'runtime field')}</div>
                </div>
                <div class="kv-value ${row.mono ? 'mono' : ''}">${formatMultiline(row.value || '-')}</div>
            </article>
        `).join('');
    }

    function formatValue(value) {
        if (value === null || value === undefined || value === '') return '-';
        if (typeof value === 'object') return prettyJson(value);
        return String(value);
    }

    function configHintForKey(key) {
        const normalized = String(key || '').toLowerCase();
        if (normalized.includes('apikey') || normalized.includes('token') || normalized.includes('secret')) return 'credential placeholder';
        if (normalized.includes('model')) return 'llm selection';
        if (normalized.includes('provider')) return 'provider routing';
        if (normalized.includes('port') || normalized.includes('host')) return 'network setting';
        if (normalized.includes('path') || normalized.includes('dir')) return 'filesystem setting';
        if (normalized.includes('enabled')) return 'feature toggle';
        return 'runtime field';
    }

    function securityHintForLabel(label) {
        const normalized = String(label || '').toLowerCase();
        if (normalized.includes('auth')) return 'gateway access';
        if (normalized.includes('token')) return 'authentication status';
        if (normalized.includes('safe mode')) return 'execution safety';
        if (normalized.includes('auto execute')) return 'command policy';
        if (normalized.includes('allow')) return 'explicit allow policy';
        if (normalized.includes('deny')) return 'explicit block policy';
        return 'security field';
    }

    function prettyJson(value) {
        return JSON.stringify(value, null, 2);
    }

    function safeJsonParse(text) {
        try {
            return JSON.parse(text);
        } catch {
            return { raw: text };
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function formatMultiline(value) {
        return escapeHtml(value).replace(/\n/g, '<br>');
    }

    function emptyState(message) {
        return `<div class="empty-state">${escapeHtml(message)}</div>`;
    }

    function serviceStateClass(status) {
        const normalized = String(status || 'idle').toLowerCase();
        if (normalized === 'healthy') return 'state-healthy';
        if (normalized === 'warning') return 'state-warning';
        if (normalized === 'degraded') return 'state-degraded';
        return 'state-idle';
    }

    function normalizeRelativePath(value) {
        return String(value || '')
            .trim()
            .replace(/\\/g, '/')
            .replace(/^\/+/, '')
            .replace(/\/+/g, '/');
    }

    function basename(relativePath) {
        const normalized = normalizeRelativePath(relativePath);
        if (!normalized) return '';
        const segments = normalized.split('/');
        return segments[segments.length - 1];
    }

    function parentRelativePath(relativePath) {
        const normalized = normalizeRelativePath(relativePath);
        if (!normalized || !normalized.includes('/')) return '';
        return normalized.split('/').slice(0, -1).join('/');
    }

    function joinRelativePath(basePath, leaf) {
        const base = normalizeRelativePath(basePath);
        const next = normalizeRelativePath(leaf);
        if (!base) return next;
        if (!next) return base;
        return `${base}/${next}`;
    }

    function getDataHomeDirectoryContext() {
        if (state.selectedDataHomeType === 'directory') {
            return normalizeRelativePath(state.selectedDataHomePath || state.dataHomeBrowsePath || '');
        }
        const filePath = normalizeRelativePath(elements.dataHomeFilePath?.value || state.selectedDataHomePath || '');
        return parentRelativePath(filePath);
    }

    function getDataHomeSelectedPath() {
        const filePath = normalizeRelativePath(elements.dataHomeFilePath?.value || '');
        if (filePath) return filePath;
        return normalizeRelativePath(state.selectedDataHomePath || '');
    }

    function scrollToBottom(node) {
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }

    function buildWebSocketUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.host}/`;
    }

    function buildDataHomeAssetUrl(filePath, download = false) {
        const params = new URLSearchParams({ path: normalizeRelativePath(filePath) });
        if (download) params.set('download', 'true');
        if (state.apiKey) params.set('apiKey', state.apiKey);
        return `${state.apiBase}/data-home/asset?${params.toString()}`;
    }

    function loadApiKey() {
        try {
            return window.localStorage.getItem('orcbot.gateway.apiKey') || '';
        } catch {
            return '';
        }
    }

    function setApiKey(value) {
        state.apiKey = value || '';
        try {
            if (state.apiKey) {
                window.localStorage.setItem('orcbot.gateway.apiKey', state.apiKey);
            } else {
                window.localStorage.removeItem('orcbot.gateway.apiKey');
            }
        } catch {
            return;
        }
    }

    function updateBridgePreview() {
        const preview = {
            ready: true,
            apiBase: state.apiBase,
            wsConnected: state.wsConnected,
            activeView: state.activeView,
            services: state.services.length,
            skills: state.skills.length,
            lastRefreshAt: state.lastRefreshAt,
            authEnabled: !!state.security?.token?.authEnabled
        };
        elements.bridgePreview.textContent = `window.a2uiGatewayBridge = ${prettyJson(preview)}`;
    }
})();