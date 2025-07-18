// Global variables
let currentExperiment = null;
let currentExperimentData = null;
let currentVocabContent = null;

// Default prompt template
const DEFAULT_PROMPT_TEMPLATE = `
You are an expert in converting natural language descriptions of events into structured annotations using a predefined Hierarchical Event Descriptor (HED) vocabulary. Your task is to extract relevant concepts from the input description and represent them as a comma-separated list of HED tags, strictly adhering to the provided vocabulary.

**Crucial Constraints:**
* **Vocabulary Adherence:** You MUST ONLY use tags (single terms) found in the provided HED vocabulary schema. Do not introduce any new words, synonyms, or full hierarchical paths in the annotation. When a concept maps to a hierarchical tag, use only the **most specific (leaf) tag** from the hierarchy.
* **Output Format:** Your output must be a comma-separated list of HED tags. Each tag or nested group of tags should be enclosed in parentheses \`()\`. For tags that take a value (indicated by \`#\` in the schema), replace \`#\` with the appropriate value from the description.
* **Completeness:** Capture all relevant information from the input description using the vocabulary.
* **Conciseness:** Avoid redundant tags.
* **No Explanations:** Do not provide any conversational filler, explanations, or additional text beyond the annotations themselves, *except for the reasoning process requested below*.
* **Handling Unmappable Concepts:** If a concept in the description cannot be mapped to any tag in the vocabulary, omit it. Do not invent tags or try to approximate.

**Reasoning Process (Output this first, then the Annotation):**
Before providing the final annotation, detail your thought process in the following steps:
1.  **Breakdown:** Identify the key elements or phrases in the description that represent distinct concepts.
2.  **Mapping:** For each key element, find the most specific corresponding tag in the provided HED vocabulary schema. If a concept cannot be mapped, note it as unmappable.
3.  **Structuring:** Determine how the identified tags should be grouped or nested according to HED conventions (e.g., (Object, Action, Object) or (Main_Event, (Property, Value))).

**HED Vocabulary Schema:**
{{hed_vocab}}

**Examples:**

Description: The foreground view consists of a large number of ingestible objects, indicating a high quantity. The background view includes an adult human body, outdoors in a setting that includes furnishings, natural features such as the sky, and man-made objects in an urban environment

--- REASONING PROCESS START ---
1.  **Breakdown**: The description includes elements about visual perspective (foreground/background), quantity, types of objects, human characteristics, environmental setting, and urban features.
2.  **Mapping**:
    * "foreground view": \`Foreground-view\`
    * "large number": \`Item-count\`, \`High\`
    * "ingestible objects": \`Ingestible-object\`
    * "background view": \`Background-view\`
    * "adult human body": \`Human\`, \`Body\`
    * "outdoors": \`Outdoors\`
    * "furnishings": \`Furnishing\`
    * "natural features": \`Natural-feature\` (since "sky" isn't a leaf tag, use parent)
    * "man-made objects": \`Man-made-object\`
    * "urban environment": \`Urban\`
3.  **Structuring**: Group related visual elements, quantify, specify human attributes, and categorize environmental aspects.
--- REASONING PROCESS END ---

--- ANNOTATION START ---
(Foreground-view, (Item-count, High), Ingestible-object), (Background-view, (Human, Body, Outdoors, Furnishing, Natural-feature, Urban, Man-made-object)
--- ANNOTATION END ---

Description from user:
{{description}}

--- REASONING PROCESS START ---
--- REASONING PROCESS END ---

--- ANNOTATION START ---
--- ANNOTATION END ---
`;

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    loadModels();
    loadExperiments();
    loadDescriptions();
    setupEventListeners();
    resetForm();
});

function setupEventListeners() {
    // Form submission
    document.getElementById('experimentForm').addEventListener('submit', function(e) {
        e.preventDefault();
        runExperiment();
    });
    
    // Sample descriptions
    document.getElementById('descriptionInput').addEventListener('focus', function() {
        if (this.value === '') {
            this.placeholder = 'A participant is looking at a computer screen displaying an image of a red car.';
        }
    });
}

// Load available models
async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const models = await response.json();
        
        const modelSelect = document.getElementById('modelSelect');
        modelSelect.innerHTML = '<option value="">Select a model...</option>';
        
        // Add Ollama models
        if (models.ollama && models.ollama.length > 0) {
            const ollamaGroup = document.createElement('optgroup');
            ollamaGroup.label = 'Ollama Models';
            models.ollama.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                ollamaGroup.appendChild(option);
            });
            modelSelect.appendChild(ollamaGroup);
        }
        
        // Add Gemini models
        if (models.gemini && models.gemini.length > 0) {
            const geminiGroup = document.createElement('optgroup');
            geminiGroup.label = 'Gemini Models';
            models.gemini.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                geminiGroup.appendChild(option);
            });
            modelSelect.appendChild(geminiGroup);
        }
        
        // Select default model
        modelSelect.value = 'qwen3:8b';
        
    } catch (error) {
        console.error('Error loading models:', error);
        showAlert('Error loading models. Please check the console.', 'danger');
    }
}

// Load experiments list
async function loadExperiments() {
    try {
        const response = await fetch('/api/experiments');
        const experiments = await response.json();
        
        const container = document.getElementById('recentExperiments');
        
        if (experiments.length === 0) {
            container.innerHTML = '<p class="text-muted">No experiments found.</p>';
            return;
        }
        
        container.innerHTML = experiments.map(exp => `
            <div class="experiment-item" onclick="viewExperiment('${exp.filename}')">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <span class="badge bg-secondary me-2">#${exp.experiment_id}</span>
                            ${exp.experiment_name ? `<span class="experiment-name fw-bold">${exp.experiment_name}</span>` : ''}
                        </div>
                        <div class="experiment-model">
                            <i class="fas fa-robot"></i> ${exp.model}
                            ${exp.inference_time ? `<span class="badge bg-info ms-2">${formatInferenceTime(exp.inference_time)}</span>` : ''}
                            ${exp.validation_issues !== undefined ? `<span class="badge bg-secondary ms-2">${exp.validation_issues} issues</span>` : ''}
                            ${exp.quality_score !== undefined && exp.quality_score !== null ? `<span class="badge bg-secondary ms-2">${exp.quality_score}/10</span>` : ''}
                        </div>
                    </div>
                    <div class="experiment-timestamp">${formatTimestamp(exp.timestamp)}</div>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading experiments:', error);
        document.getElementById('recentExperiments').innerHTML = 
            '<p class="text-danger">Error loading experiments.</p>';
    }
}

// Load description history
async function loadDescriptions() {
    try {
        const response = await fetch('/api/descriptions');
        const descriptions = await response.json();
        
        const dropdown = document.getElementById('descriptionHistory');
        
        if (descriptions.length === 0) {
            dropdown.innerHTML = '<li><a class="dropdown-item text-muted">No previous descriptions</a></li>';
            return;
        }
        
        dropdown.innerHTML = descriptions.map(item => {
            const truncated = truncateText(item.description, 60);
            const countBadge = item.count > 1 ? `<span class="badge bg-secondary ms-1">${item.count}</span>` : '';
            return `<li><a class="dropdown-item" href="#" onclick="selectDescription('${escapeHtml(item.description)}')">${truncated}${countBadge}</a></li>`;
        }).join('');
        
    } catch (error) {
        console.error('Error loading descriptions:', error);
        document.getElementById('descriptionHistory').innerHTML = 
            '<li><a class="dropdown-item text-danger">Error loading descriptions</a></li>';
    }
}

// Select description from history
function selectDescription(description) {
    document.getElementById('descriptionInput').value = description;
    // Close dropdown
    const dropdown = bootstrap.Dropdown.getInstance(document.getElementById('descriptionDropdown'));
    if (dropdown) {
        dropdown.hide();
    }
}

// View experiment details
async function viewExperiment(filename) {
    try {
        const response = await fetch(`/api/experiment/${filename}`);
        const experiment = await response.json();
        
        if (experiment.error) {
            showAlert(experiment.error, 'danger');
            return;
        }
        
        currentExperiment = filename;
        currentExperimentData = experiment;
        
        const modalBody = document.getElementById('experimentDetails');
        modalBody.innerHTML = `
            <div class="experiment-details">
                <h6><i class="fas fa-hashtag"></i> Experiment ID</h6>
                <p><span class="badge bg-secondary">#${experiment.experiment_id || 'Unknown'}</span></p>
                
                ${experiment.experiment_name ? `
                <h6><i class="fas fa-tag"></i> Experiment Name</h6>
                <p class="fw-bold">${experiment.experiment_name}</p>
                ` : ''}
                
                <h6><i class="fas fa-robot"></i> Model</h6>
                <p><span class="badge bg-primary">${experiment.model}</span></p>
                
                <h6><i class="fas fa-clock"></i> Timestamp</h6>
                <p>${formatTimestamp(experiment.timestamp)}</p>
                
                ${experiment.inference_time ? `
                <h6><i class="fas fa-tachometer-alt"></i> Inference Time</h6>
                <p><span class="badge bg-info">${formatInferenceTime(experiment.inference_time)}</span></p>
                ` : ''}
                
                ${experiment.validation_issues !== undefined ? `
                <h6><i class="fas fa-check-circle"></i> Validation Results</h6>
                <p><span class="badge bg-secondary">${experiment.validation_issues} validation issues</span></p>
                ` : ''}
                
                ${experiment.quality_grade && experiment.quality_grade.score !== undefined && experiment.quality_grade.score !== null ? `
                <h6><i class="fas fa-star"></i> Quality Score</h6>
                <div class="p-2 bg-light rounded mb-3">
                    <div class="d-flex justify-content-between align-items-center">
                        <span class="badge bg-secondary">${experiment.quality_grade.score}/10</span>
                        <small class="text-muted">Graded by ${experiment.quality_grade.grader_model}</small>
                    </div>
                    <details class="mt-2">
                        <summary class="text-muted" style="cursor: pointer;">View grader response</summary>
                        <pre class="mt-2 text-dark" style="font-size: 0.8em;">${experiment.quality_grade.full_response}</pre>
                    </details>
                </div>
                ` : ''}
                
                <h6><i class="fas fa-comment"></i> Description</h6>
                <div class="p-2 bg-light rounded">
                    <p class="mb-0">${experiment.description}</p>
                </div>
                
                <h6><i class="fas fa-reply"></i> Model Response</h6>
                <pre>${experiment.model_response}</pre>
                
                ${experiment.annotation ? `
                <h6><i class="fas fa-tag"></i> Extracted Annotation</h6>
                <div class="bg-warning bg-opacity-10 p-3 rounded border border-warning">
                    <div class="annotation-item mb-2 p-2 bg-white rounded border">
                        <div class="fw-bold mb-1 d-flex justify-content-between align-items-center">
                            <span><i class="fas fa-tag"></i> HED Annotation:</span>
                            <div>
                                <span class="badge bg-secondary">${experiment.validation_issues || 0} issues</span>
                                ${experiment.quality_grade && experiment.quality_grade.score !== undefined && experiment.quality_grade.score !== null ? `
                                <span class="badge bg-secondary ms-1">${experiment.quality_grade.score}/10</span>
                                ` : ''}
                            </div>
                        </div>
                        <pre class="mb-0 text-dark" style="font-size: 0.9em;">${experiment.annotation}</pre>
                    </div>
                </div>
                ` : ''}
                
                <h6><i class="fas fa-file-code"></i> Prompt Template</h6>
                <pre>${experiment.prompt_template}</pre>
            </div>
        `;
        
        const modal = new bootstrap.Modal(document.getElementById('experimentModal'));
        modal.show();
        
    } catch (error) {
        console.error('Error viewing experiment:', error);
        showAlert('Error loading experiment details.', 'danger');
    }
}

// Load experiment data to form
function loadExperimentToForm() {
    if (!currentExperimentData) return;
    
    document.getElementById('modelSelect').value = currentExperimentData.model;
    document.getElementById('descriptionInput').value = currentExperimentData.description;
    document.getElementById('promptTemplate').value = currentExperimentData.prompt_template;
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('experimentModal'));
    modal.hide();
    
    showAlert('Experiment loaded to form!', 'success');
}

// Download experiment
function downloadExperiment() {
    if (!currentExperiment) return;
    
    window.open(`/api/download_experiment/${currentExperiment}`, '_blank');
}

// Run experiment
async function runExperiment() {
    const model = document.getElementById('modelSelect').value;
    const description = document.getElementById('descriptionInput').value;
    const promptTemplate = document.getElementById('promptTemplate').value;
    const experimentName = document.getElementById('experimentName').value;
    
    if (!model || !description || !promptTemplate) {
        showAlert('Please fill in all required fields.', 'warning');
        return;
    }
    
    // Check API key for Gemini models
    if (model.startsWith('gemini')) {
        try {
            const keyResponse = await fetch('/api/check_api_key');
            const keyResult = await keyResponse.json();
            
            if (!keyResult.has_api_key) {
                showAlert('Gemini API key is required for this model. Please configure it first.', 'warning');
                showEnvConfigModal();
                return;
            }
        } catch (error) {
            console.error('Error checking API key:', error);
            showAlert('Error checking API key. Please try again.', 'danger');
            return;
        }
    }
    
    // Show loading modal
    const loadingModal = new bootstrap.Modal(document.getElementById('loadingModal'));
    loadingModal.show();
    
    try {
        const response = await fetch('/api/run_experiment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                description: description,
                prompt_template: promptTemplate,
                experiment_name: experimentName
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        // Display results
        displayResults(result, experimentName);
        
        // Store current experiment data for potential manual operations
        currentExperimentData = {
            model: model,
            description: description,
            prompt_template: promptTemplate,
            experiment_name: experimentName,
            experiment_id: result.experiment_id,
            model_response: result.response,
            annotations: result.annotations,
            inference_time: result.inference_time,
            full_prompt: result.prompt,
            filename: result.filename
        };
        
        // Show success message with auto-save info
        if (result.auto_saved && result.filename) {
            showAlert(`Experiment completed and automatically saved as ${result.filename}!`, 'success');
            
            // Reload experiments list and descriptions to show the new experiment
            loadExperiments();
            loadDescriptions();
        } else {
            showAlert('Experiment completed successfully!', 'success');
        }
        
    } catch (error) {
        console.error('Error running experiment:', error);
        showAlert('Error running experiment. Please try again.', 'danger');
    } finally {
        loadingModal.hide();
    }
}

// Display results
function displayResults(result, experimentName = '') {
    document.getElementById('modelResponse').textContent = result.response;
    document.getElementById('fullPrompt').textContent = result.prompt;
    
    // Display single annotation (updated format)
    const annotationsSection = document.getElementById('annotationsSection');
    const annotationsList = document.getElementById('annotationsList');
    
    if (result.annotation && result.annotation.trim()) {
        // Clear previous annotations
        annotationsList.innerHTML = '';
        
        // Display the single annotation
        const annotationDiv = document.createElement('div');
        annotationDiv.className = 'annotation-item mb-2 p-2 bg-white rounded border';
        
        const header = document.createElement('div');
        header.className = 'fw-bold mb-1';
        header.innerHTML = `<i class="fas fa-tag"></i> Generated Annotation:`;
        
        const content = document.createElement('pre');
        content.className = 'mb-0 text-dark';
        content.style.fontSize = '0.9em';
        content.textContent = result.annotation;
        
        annotationDiv.appendChild(header);
        annotationDiv.appendChild(content);
        annotationsList.appendChild(annotationDiv);
        
        annotationsSection.style.display = 'block';
    } else {
        annotationsSection.style.display = 'none';
    }
    
    // Display experiment name in the editable field
    document.getElementById('resultExperimentName').value = experimentName || '';
    
    // Display experiment ID (static, not editable)
    document.getElementById('experimentId').textContent = result.experiment_id || '-';
    
    // Display validation issues
    const validationIssues = result.validation_issues || 0;
    const validationBadge = document.getElementById('validationIssues');
    validationBadge.textContent = validationIssues;
    
    // Set badge color to neutral (remove conditional coloring)
    validationBadge.className = 'badge bg-secondary ms-2';
    
    // Display quality score
    const qualityScore = result.quality_grade && result.quality_grade.score;
    const qualityBadge = document.getElementById('qualityScore');
    
    if (qualityScore !== null && qualityScore !== undefined) {
        qualityBadge.textContent = `${qualityScore}/10`;
        
        // Set badge color to neutral (remove conditional coloring)
        qualityBadge.className = 'badge bg-secondary ms-2';
    } else {
        qualityBadge.textContent = '-';
        qualityBadge.className = 'badge bg-secondary ms-2';
    }
    
    // Display inference time and model
    document.getElementById('inferenceTime').textContent = formatInferenceTime(result.inference_time);
    document.getElementById('resultModel').textContent = document.getElementById('modelSelect').value;
    
    // Display saved filename if auto-saved
    if (result.auto_saved && result.filename) {
        document.getElementById('savedFilename').textContent = result.filename;
    } else {
        document.getElementById('savedFilename').textContent = 'Not saved';
    }
    
    // Show results section
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.style.display = 'block';
    
    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// Hide results
function hideResults() {
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('annotationsSection').style.display = 'none';
}

// Legacy save experiment function (kept for compatibility but not used in UI)
async function saveExperiment() {
    if (!currentExperimentData) {
        showAlert('No experiment data to save.', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/save_experiment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(currentExperimentData)
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        showAlert(`Experiment manually saved as ${result.filename}`, 'success');
        
        // Reload experiments list and descriptions
        loadExperiments();
        loadDescriptions();
        
    } catch (error) {
        console.error('Error saving experiment:', error);
        showAlert('Error saving experiment. Please try again.', 'danger');
    }
}

// Update experiment name
async function updateExperimentName() {
    const newName = document.getElementById('resultExperimentName').value;
    
    if (!currentExperimentData || !currentExperimentData.filename) {
        showAlert('No experiment to update.', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/update_experiment_name', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                filename: currentExperimentData.filename,
                experiment_name: newName
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        // Update the stored experiment data
        currentExperimentData.experiment_name = newName;
        
        showAlert('Experiment name updated successfully!', 'success');
        
        // Reload experiments list to reflect the change
        loadExperiments();
        
    } catch (error) {
        console.error('Error updating experiment name:', error);
        showAlert('Error updating experiment name. Please try again.', 'danger');
    }
}

// Reset form
function resetForm() {
    document.getElementById('experimentForm').reset();
    document.getElementById('promptTemplate').value = DEFAULT_PROMPT_TEMPLATE.trim();
    document.getElementById('modelSelect').value = 'qwen3:8b';
    document.getElementById('descriptionInput').value = '';
    hideResults();
}

// Clear description field
function clearDescription() {
    document.getElementById('descriptionInput').value = '';
    document.getElementById('descriptionInput').focus();
}

// HED Vocabulary Editor Functions
async function showVocabEditor() {
    hideResults();
    
    const vocabSection = document.getElementById('vocabSection');
    vocabSection.style.display = 'block';
    
    // Update navigation
    updateNavigation('vocab');
    
    // Load vocabulary content
    await loadVocabContent();
    
    // Scroll to vocab section
    vocabSection.scrollIntoView({ behavior: 'smooth' });
}

async function loadVocabContent() {
    try {
        const response = await fetch('/api/hed_vocab');
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        currentVocabContent = result.vocab;
        document.getElementById('vocabEditor').value = result.vocab;
        
    } catch (error) {
        console.error('Error loading vocabulary:', error);
        showAlert('Error loading HED vocabulary. Please try again.', 'danger');
    }
}

async function saveVocab() {
    const vocabContent = document.getElementById('vocabEditor').value;
    
    if (!vocabContent.trim()) {
        showAlert('Vocabulary content cannot be empty.', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/hed_vocab', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                vocab: vocabContent
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        currentVocabContent = vocabContent;
        showAlert('HED vocabulary saved successfully!', 'success');
        
    } catch (error) {
        console.error('Error saving vocabulary:', error);
        showAlert('Error saving HED vocabulary. Please try again.', 'danger');
    }
}

async function downloadVocab() {
    try {
        window.open('/api/download_hed_vocab', '_blank');
    } catch (error) {
        console.error('Error downloading vocabulary:', error);
        showAlert('Error downloading HED vocabulary. Please try again.', 'danger');
    }
}

async function reloadVocab() {
    if (confirm('Are you sure you want to reload the vocabulary? Any unsaved changes will be lost.')) {
        await loadVocabContent();
        showAlert('HED vocabulary reloaded from file.', 'info');
    }
}

function hideVocabEditor() {
    document.getElementById('vocabSection').style.display = 'none';
}

// Check for unsaved vocabulary changes
function hasUnsavedVocabChanges() {
    const currentContent = document.getElementById('vocabEditor').value;
    return currentVocabContent !== null && currentContent !== currentVocabContent;
}

// Warn user about unsaved changes
window.addEventListener('beforeunload', function(e) {
    if (hasUnsavedVocabChanges()) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes to the HED vocabulary. Are you sure you want to leave?';
    }
});

// Navigation functions
function showExperimentForm() {
    hideResults();
    hideVocabEditor();
    
    // Update navigation
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    // Show experiment form (it's always visible)
    document.querySelector('.container .row').style.display = 'flex';
}

function updateNavigation(activeSection) {
    document.querySelectorAll('.navbar-nav .nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    if (activeSection === 'vocab') {
        document.querySelector('a[href="#vocab"]').classList.add('active');
    } else if (activeSection === 'experiments') {
        document.querySelector('a[href="#experiments"]').classList.add('active');
    }
}

// Navigation wrapper functions
function showExperiments() {
    hideResults();
    hideVocabEditor();
    updateNavigation('experiments');
    loadExperiments();
}

// Toggle Recent Experiments panel visibility
function toggleRecentExperiments() {
    const recentCol = document.getElementById('recentExperimentsCol');
    const formCol = document.getElementById('experimentFormCol');
    const toggleBtn = document.getElementById('toggleRecentBtn');
    
    if (recentCol.style.display === 'none') {
        // Show Recent Experiments
        recentCol.style.display = 'block';
        formCol.className = 'col-lg-8';
        toggleBtn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide';
    } else {
        // Hide Recent Experiments
        recentCol.style.display = 'none';
        formCol.className = 'col-lg-12';
        toggleBtn.innerHTML = '<i class="fas fa-eye"></i> Show';
    }
}

// Environment Configuration Functions
async function showEnvConfigModal() {
    const modal = new bootstrap.Modal(document.getElementById('envConfigModal'));
    
    // Load current environment variables
    await loadEnvConfig();
    
    modal.show();
}

async function loadEnvConfig() {
    try {
        const response = await fetch('/api/get_env_vars');
        const result = await response.json();
        
        const statusDiv = document.getElementById('envConfigStatus');
        const configuredApiKeysDiv = document.getElementById('configuredApiKeys');
        const newApiKeyTypeSelect = document.getElementById('newApiKeyType');
        
        if (result.env_vars && result.available_vars !== undefined) {
            // Clear existing content
            configuredApiKeysDiv.innerHTML = '';
            newApiKeyTypeSelect.innerHTML = '<option value="">Select API Provider...</option>';
            
            // API key information
            const apiKeyInfo = {
                'GEMINI_API_KEY': {
                    name: 'Gemini API Key',
                    icon: 'fas fa-key',
                    url: 'https://makersuite.google.com/app/apikey',
                    provider: 'Google AI Studio'
                },
                'OPENAI_API_KEY': {
                    name: 'OpenAI API Key',
                    icon: 'fas fa-key',
                    url: 'https://platform.openai.com/api-keys',
                    provider: 'OpenAI Platform'
                },
                'ANTHROPIC_API_KEY': {
                    name: 'Anthropic API Key',
                    icon: 'fas fa-key',
                    url: 'https://console.anthropic.com/',
                    provider: 'Anthropic Console'
                }
            };
            
            // Show configured API keys
            let configuredCount = 0;
            for (const [envVar, config] of Object.entries(result.env_vars)) {
                if (config.configured && apiKeyInfo[envVar]) {
                    configuredCount++;
                    const info = apiKeyInfo[envVar];
                    const fieldId = envVar.toLowerCase().replace('_', '');
                    
                    const fieldHtml = `
                        <div class="mb-3">
                            <label for="${fieldId}" class="form-label">
                                <i class="${info.icon}"></i> ${info.name}
                                <button type="button" class="btn btn-outline-danger btn-sm ms-2" 
                                        onclick="removeApiKey('${envVar}')" title="Remove this API key">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </label>
                            <div class="input-group">
                                <input type="password" class="form-control" id="${fieldId}" 
                                       placeholder="Current: ${config.value}" data-env-var="${envVar}">
                                <button class="btn btn-outline-secondary" type="button" 
                                        onclick="togglePasswordVisibility('${fieldId}')">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                            <div class="form-text">
                                Get your API key from 
                                <a href="${info.url}" target="_blank">${info.provider}</a>
                            </div>
                        </div>
                    `;
                    configuredApiKeysDiv.innerHTML += fieldHtml;
                }
            }
            
            // Populate dropdown with available (not configured) API keys
            result.available_vars.forEach(envVar => {
                if (apiKeyInfo[envVar]) {
                    const option = document.createElement('option');
                    option.value = envVar;
                    option.textContent = apiKeyInfo[envVar].name;
                    newApiKeyTypeSelect.appendChild(option);
                }
            });
            
            // Show status
            const totalPossible = Object.keys(apiKeyInfo).length;
            if (configuredCount > 0) {
                statusDiv.innerHTML = `
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle"></i>
                        <strong>Configuration Status:</strong> ${configuredCount} of ${totalPossible} API keys configured
                    </div>
                `;
            } else {
                statusDiv.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle"></i>
                        <strong>No API Keys Found:</strong> Please add your API keys below.
                    </div>
                `;
            }
            
            // Enable/disable add new API key controls
            const hasAvailable = result.available_vars.length > 0;
            document.getElementById('newApiKeyValue').disabled = !hasAvailable;
            document.getElementById('addApiKeyBtn').disabled = !hasAvailable;
            const toggleBtn = document.getElementById('newApiKeyValue').nextElementSibling;
            if (toggleBtn) toggleBtn.disabled = !hasAvailable;
            
        }
    } catch (error) {
        console.error('Error loading environment config:', error);
        const statusDiv = document.getElementById('envConfigStatus');
        statusDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-times-circle"></i>
                <strong>Error:</strong> Unable to load environment configuration.
            </div>
        `;
    }
}

async function saveEnvConfig() {
    // Collect all form values from dynamically generated fields
    const envVars = {};
    
    // Get all API key input fields
    const apiKeyFields = document.querySelectorAll('#configuredApiKeys input[data-env-var]');
    
    let hasValues = false;
    
    apiKeyFields.forEach(field => {
        const envVar = field.getAttribute('data-env-var');
        const value = field.value.trim();
        
        if (value) {
            envVars[envVar] = value;
            hasValues = true;
        }
    });
    
    if (!hasValues) {
        showAlert('Please enter at least one API key value.', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/save_env_var', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                env_vars: envVars
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        showAlert(`${result.message} (Updated: ${result.updated_vars.join(', ')})`, 'success');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('envConfigModal'));
        modal.hide();
        
        // Clear the form inputs
        apiKeyFields.forEach(field => field.value = '');
        
        // Refresh models list in case new APIs are now available
        loadModels();
        
    } catch (error) {
        console.error('Error saving environment config:', error);
        showAlert('Error saving environment configuration. Please try again.', 'danger');
    }
}

function togglePasswordVisibility(fieldId) {
    const field = document.getElementById(fieldId);
    const button = field.nextElementSibling;
    const icon = button.querySelector('i');
    
    if (field.type === 'password') {
        field.type = 'text';
        icon.className = 'fas fa-eye-slash';
    } else {
        field.type = 'password';
        icon.className = 'fas fa-eye';
    }
}

// Legacy function for backward compatibility
async function showApiKeyModal() {
    showEnvConfigModal();
}

// Legacy function for backward compatibility  
async function checkApiKeyStatus() {
    try {
        const response = await fetch('/api/check_api_key');
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Error checking API key status:', error);
        return { has_api_key: false };
    }
}

// Legacy function for backward compatibility
async function saveApiKey() {
    const apiKey = document.getElementById('apiKeyInput')?.value?.trim();
    
    if (!apiKey) {
        showAlert('Please enter an API key.', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/save_env_var', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                env_vars: {
                    'GEMINI_API_KEY': apiKey
                }
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        showAlert(result.message, 'success');
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('apiKeyModal'));
        if (modal) modal.hide();
        
        // Clear the input
        if (document.getElementById('apiKeyInput')) {
            document.getElementById('apiKeyInput').value = '';
        }
        
        // Refresh models list
        loadModels();
        
    } catch (error) {
        console.error('Error saving API key:', error);
        showAlert('Error saving API key. Please try again.', 'danger');
    }
}

async function addNewApiKey() {
    const typeSelect = document.getElementById('newApiKeyType');
    const valueInput = document.getElementById('newApiKeyValue');
    
    const apiKeyType = typeSelect.value;
    const apiKeyValue = valueInput.value.trim();
    
    if (!apiKeyType || !apiKeyValue) {
        showAlert('Please select an API provider and enter a key.', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/save_env_var', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                env_vars: {
                    [apiKeyType]: apiKeyValue
                }
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        showAlert(`${result.message}`, 'success');
        
        // Clear the add form
        typeSelect.value = '';
        valueInput.value = '';
        
        // Reload the configuration to show the new key
        await loadEnvConfig();
        
        // Refresh models list
        loadModels();
        
    } catch (error) {
        console.error('Error adding API key:', error);
        showAlert('Error adding API key. Please try again.', 'danger');
    }
}

async function removeApiKey(envVar) {
    if (!confirm(`Are you sure you want to remove ${envVar}?`)) {
        return;
    }
    
    try {
        // Read current .env file and remove the specified variable
        const response = await fetch('/api/get_env_vars');
        const result = await response.json();
        
        if (result.error) {
            showAlert('Error reading current configuration.', 'danger');
            return;
        }
        
        // Remove the variable by setting it to empty (the backend will handle removal)
        const saveResponse = await fetch('/api/save_env_var', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                env_vars: {
                    [envVar]: '' // Empty value will remove it
                }
            })
        });
        
        const saveResult = await saveResponse.json();
        
        if (saveResult.error) {
            showAlert(saveResult.error, 'danger');
            return;
        }
        
        showAlert(`${envVar} removed successfully.`, 'success');
        
        // Reload the configuration
        await loadEnvConfig();
        
        // Refresh models list
        loadModels();
        
    } catch (error) {
        console.error('Error removing API key:', error);
        showAlert('Error removing API key. Please try again.', 'danger');
    }
}

// Enable/disable add new API key controls when selection changes
document.addEventListener('DOMContentLoaded', function() {
    const typeSelect = document.getElementById('newApiKeyType');
    const valueInput = document.getElementById('newApiKeyValue');
    const addBtn = document.getElementById('addApiKeyBtn');
    const toggleBtn = valueInput?.nextElementSibling;
    
    if (typeSelect && valueInput && addBtn) {
        typeSelect.addEventListener('change', function() {
            const hasSelection = this.value !== '';
            valueInput.disabled = !hasSelection;
            addBtn.disabled = !hasSelection;
            if (toggleBtn) toggleBtn.disabled = !hasSelection;
            
            if (hasSelection) {
                valueInput.focus();
            } else {
                valueInput.value = '';
            }
        });
    }
});

// Utility functions
function formatTimestamp(timestamp) {
    if (!timestamp || timestamp === 'Unknown') return 'Unknown';
    
    try {
        const date = new Date(timestamp);
        return date.toLocaleString();
    } catch (error) {
        return timestamp;
    }
}

function formatInferenceTime(seconds) {
    if (!seconds && seconds !== 0) return 'Unknown';
    
    if (seconds < 1) {
        return `${Math.round(seconds * 1000)}ms`;
    } else if (seconds < 60) {
        return `${seconds.toFixed(2)}s`;
    } else {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function showAlert(message, type = 'info') {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.alert');
    existingAlerts.forEach(alert => alert.remove());
    
    // Create new alert
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show`;
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Insert at top of container
    const container = document.querySelector('.container');
    container.insertBefore(alert, container.firstChild);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        if (alert.parentNode) {
            alert.remove();
        }
    }, 5000);
}

// Handle page visibility changes
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        // Page became visible, refresh experiments and descriptions
        loadExperiments();
        loadDescriptions();
    }
});
