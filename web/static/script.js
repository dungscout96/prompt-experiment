// Global variables
let currentExperiment = null;
let currentExperimentData = null;

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
                        <div class="experiment-model">
                            <i class="fas fa-robot"></i> ${exp.model}
                        </div>
                        <div class="experiment-description text-truncate">${exp.description}</div>
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
                <h6><i class="fas fa-robot"></i> Model</h6>
                <p><span class="badge bg-primary">${experiment.model}</span></p>
                
                <h6><i class="fas fa-clock"></i> Timestamp</h6>
                <p>${formatTimestamp(experiment.timestamp)}</p>
                
                <h6><i class="fas fa-comment"></i> Description</h6>
                <p>${experiment.description}</p>
                
                <h6><i class="fas fa-reply"></i> Model Response</h6>
                <pre>${experiment.model_response}</pre>
                
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
    
    if (!model || !description || !promptTemplate) {
        showAlert('Please fill in all required fields.', 'warning');
        return;
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
                prompt_template: promptTemplate
            })
        });
        
        const result = await response.json();
        
        if (result.error) {
            showAlert(result.error, 'danger');
            return;
        }
        
        // Display results
        displayResults(result);
        
        // Store current experiment data for saving
        currentExperimentData = {
            model: model,
            description: description,
            prompt_template: promptTemplate,
            model_response: result.response,
            full_prompt: result.prompt
        };
        
        showAlert('Experiment completed successfully!', 'success');
        
    } catch (error) {
        console.error('Error running experiment:', error);
        showAlert('Error running experiment. Please try again.', 'danger');
    } finally {
        loadingModal.hide();
    }
}

// Display results
function displayResults(result) {
    document.getElementById('modelResponse').textContent = result.response;
    document.getElementById('fullPrompt').textContent = result.prompt;
    
    // Show results section
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.style.display = 'block';
    
    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// Hide results
function hideResults() {
    document.getElementById('resultsSection').style.display = 'none';
}

// Save experiment
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
        
        showAlert(`Experiment saved as ${result.filename}`, 'success');
        
        // Reload experiments list
        loadExperiments();
        
    } catch (error) {
        console.error('Error saving experiment:', error);
        showAlert('Error saving experiment. Please try again.', 'danger');
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
        // Page became visible, refresh experiments
        loadExperiments();
    }
});
