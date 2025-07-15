from flask import Flask, render_template, request, jsonify, send_file
from ollama import chat
from ollama import ChatResponse
from google import genai
from jinja2 import Template
from dotenv import load_dotenv
import os
import json
import datetime
import time
from pathlib import Path

# Load environment variables from parent directory
load_dotenv(Path(__file__).parent.parent / '.env')

app = Flask(__name__)

# Load HED vocabulary
def load_hed_vocab():
    vocab_path = Path(__file__).parent.parent / 'HED_vocab_reformatted.xml'
    with open(vocab_path, 'r') as file:
        return file.read()

# Save HED vocabulary
def save_hed_vocab(vocab_content):
    vocab_path = Path(__file__).parent.parent / 'HED_vocab_reformatted.xml'
    with open(vocab_path, 'w') as file:
        file.write(vocab_content)

# Auto-save experiment to filesystem
def auto_save_experiment(experiment_data):
    try:
        # Create experiments directory if it doesn't exist
        experiments_dir = Path(__file__).parent.parent / 'prompt_experiments'
        experiments_dir.mkdir(exist_ok=True)
        
        # Find next available experiment ID
        experiment_id = 0
        while (experiments_dir / f'experiment_{experiment_id}.json').exists():
            experiment_id += 1
        
        # Add experiment ID to the data
        experiment_data['experiment_id'] = experiment_id
        
        filename = f'experiment_{experiment_id}.json'
        
        # Save experiment
        with open(experiments_dir / filename, 'w') as f:
            json.dump(experiment_data, f, indent=2)
        
        return filename, experiment_id
    except Exception as e:
        print(f"Error auto-saving experiment: {e}")
        return None, None

# Default prompt template
DEFAULT_PROMPT_TEMPLATE = '''
You are an expert in converting natural language descriptions of events into structured annotations using a predefined Hierarchical Event Descriptor (HED) vocabulary. Your task is to extract relevant concepts from the input description and represent them as a comma-separated list of HED tags, strictly adhering to the provided vocabulary.

**Crucial Constraints:**
* **Vocabulary Adherence:** You MUST ONLY use tags (single terms) found in the provided HED vocabulary schema. Do not introduce any new words, synonyms, or full hierarchical paths in the annotation. When a concept maps to a hierarchical tag, use only the **most specific (leaf) tag** from the hierarchy.
* **Output Format:** Your output must be a comma-separated list of HED tags. Each tag or nested group of tags should be enclosed in parentheses `()`. For tags that take a value (indicated by `#` in the schema), replace `#` with the appropriate value from the description.
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
    * "foreground view": `Foreground-view`
    * "large number": `Item-count`, `High`
    * "ingestible objects": `Ingestible-object`
    * "background view": `Background-view`
    * "adult human body": `Human`, `Body`
    * "outdoors": `Outdoors`
    * "furnishings": `Furnishing`
    * "natural features": `Natural-feature` (since "sky" isn't a leaf tag, use parent)
    * "man-made objects": `Man-made-object`
    * "urban environment": `Urban`
3.  **Structuring**: Group related visual elements, quantify, specify human attributes, and categorize environmental aspects.
--- REASONING PROCESS END ---

--- ANNOTATION START ---
(Foreground-view, (Item-count, High), Ingestible-object), (Background-view, (Human, Body, Outdoors, Furnishing, Natural-feature, Urban, Man-made-object))
--- ANNOTATION END ---

Description from user:
{{description}}

--- REASONING PROCESS START ---
--- REASONING PROCESS END ---

--- ANNOTATION START ---
--- ANNOTATION END ---
'''

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/models')
def get_models():
    """Get available models"""
    # For now, return common models. In a real app, you might query Ollama for available models
    ollama_models = ['qwen3:8b', 'llama3:8b', 'mistral:7b', 'codellama:7b', 'gemma:7b']
    gemini_models = ['gemini-2.5-flash']
    
    return jsonify({
        'ollama': ollama_models,
        'gemini': gemini_models
    })

@app.route('/api/experiments')
def get_experiments():
    """Get list of saved experiments"""
    experiments_dir = Path(__file__).parent.parent / 'prompt_experiments'
    experiments = []
    
    if experiments_dir.exists():
        for file_path in experiments_dir.glob('*.json'):
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    # Extract experiment ID from filename if not in data
                    experiment_id = data.get('experiment_id')
                    if experiment_id is None:
                        # Extract from filename for backward compatibility
                        try:
                            experiment_id = int(file_path.stem.split('_')[1])
                        except (ValueError, IndexError):
                            experiment_id = 0
                    
                    experiments.append({
                        'filename': file_path.name,
                        'experiment_id': experiment_id,
                        'model': data.get('model', 'Unknown'),
                        'timestamp': data.get('timestamp', 'Unknown'),
                        'inference_time': data.get('inference_time'),
                        'experiment_name': data.get('experiment_name', ''),
                        'description': data.get('description', '')[:100] + '...' if len(data.get('description', '')) > 100 else data.get('description', '')
                    })
            except Exception as e:
                print(f"Error loading experiment {file_path}: {e}")
    
    # Sort by experiment ID (descending - most recent first)
    experiments.sort(key=lambda x: x['experiment_id'], reverse=True)
    
    return jsonify(experiments)

@app.route('/api/experiment/<filename>')
def get_experiment(filename):
    """Get a specific experiment"""
    experiments_dir = Path(__file__).parent.parent / 'prompt_experiments'
    file_path = experiments_dir / filename
    
    if not file_path.exists():
        return jsonify({'error': 'Experiment not found'}), 404
    
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/run_experiment', methods=['POST'])
def run_experiment():
    """Run an experiment with the given parameters"""
    data = request.json
    
    model = data.get('model', 'qwen3:8b')
    prompt_template = data.get('prompt_template', DEFAULT_PROMPT_TEMPLATE)
    description = data.get('description', '')
    experiment_name = data.get('experiment_name', '')
    
    if not description:
        return jsonify({'error': 'Description is required'}), 400
    
    try:
        # Load HED vocabulary
        hed_vocab = load_hed_vocab()
        
        # Render the template
        template = Template(prompt_template)
        prompt = template.render(hed_vocab=hed_vocab, description=description)
        
        # Start timing
        start_time = time.time()
        
        # Choose the appropriate API based on model
        if model.startswith('gemini'):
            # Use Gemini API
            api_key = os.getenv('GEMINI_API_KEY')
            if not api_key:
                raise ValueError("GEMINI_API_KEY environment variable is not set")
            
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=model,
                contents=prompt
            )
            model_response = response.text
        else:
            # Use Ollama API
            response = chat(model=model, messages=[
                {
                    'role': 'user',
                    'content': prompt,
                },
            ])
            model_response = response['message']['content']
        
        # Calculate inference time
        inference_time = time.time() - start_time
        
        # Automatically save experiment to filesystem
        experiment_data = {
            'model': model,
            'prompt_template': prompt_template,
            'description': description,
            'experiment_name': experiment_name,
            'model_response': model_response,
            'inference_time': inference_time,
            'timestamp': datetime.datetime.now().isoformat(),
            'prompt': prompt
        }
        
        # Save to filesystem automatically
        saved_filename, experiment_id = auto_save_experiment(experiment_data)
        
        return jsonify({
            'success': True,
            'response': model_response,
            'prompt': prompt,
            'inference_time': inference_time,
            'auto_saved': True,
            'filename': saved_filename,
            'experiment_id': experiment_id
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/save_experiment', methods=['POST'])
def save_experiment():
    """Save an experiment to a file (legacy endpoint - now mainly for manual saves)"""
    data = request.json
    
    model = data.get('model')
    prompt_template = data.get('prompt_template')
    description = data.get('description')
    model_response = data.get('model_response')
    inference_time = data.get('inference_time')
    
    if not all([model, prompt_template, description, model_response]):
        return jsonify({'error': 'All fields are required'}), 400
    
    try:
        experiment_data = {
            'model': model,
            'prompt_template': prompt_template,
            'description': description,
            'model_response': model_response,
            'inference_time': inference_time,
            'timestamp': datetime.datetime.now().isoformat()
        }
        
        filename, experiment_id = auto_save_experiment(experiment_data)
        
        if filename:
            return jsonify({
                'success': True,
                'filename': filename,
                'experiment_id': experiment_id
            })
        else:
            return jsonify({'error': 'Failed to save experiment'}), 500
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download_experiment/<filename>')
def download_experiment(filename):
    """Download an experiment file"""
    experiments_dir = Path(__file__).parent.parent / 'prompt_experiments'
    file_path = experiments_dir / filename
    
    if not file_path.exists():
        return jsonify({'error': 'Experiment not found'}), 404
    
    return send_file(file_path, as_attachment=True)

@app.route('/api/descriptions')
def get_descriptions():
    """Get list of unique descriptions from saved experiments with usage counts"""
    experiments_dir = Path(__file__).parent.parent / 'prompt_experiments'
    description_counts = {}
    
    if experiments_dir.exists():
        for file_path in experiments_dir.glob('*.json'):
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    description = data.get('description', '').strip()
                    if description:
                        description_counts[description] = description_counts.get(description, 0) + 1
            except Exception as e:
                print(f"Error loading experiment {file_path}: {e}")
    
    # Sort by usage count (descending) then alphabetically
    sorted_descriptions = sorted(description_counts.items(), key=lambda x: (-x[1], x[0]))
    
    return jsonify([{
        'description': desc,
        'count': count
    } for desc, count in sorted_descriptions])

@app.route('/api/hed_vocab')
def get_hed_vocab():
    """Get the HED vocabulary content"""
    try:
        vocab_content = load_hed_vocab()
        return jsonify({
            'success': True,
            'vocab': vocab_content
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/hed_vocab', methods=['POST'])
def save_hed_vocab_endpoint():
    """Save updated HED vocabulary content"""
    data = request.json
    vocab_content = data.get('vocab')
    
    if not vocab_content:
        return jsonify({'error': 'Vocabulary content is required'}), 400
    
    try:
        save_hed_vocab(vocab_content)
        return jsonify({
            'success': True,
            'message': 'HED vocabulary saved successfully'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download_hed_vocab')
def download_hed_vocab():
    """Download the HED vocabulary file"""
    vocab_path = Path(__file__).parent.parent / 'HED_vocab_reformatted.xml'
    
    if not vocab_path.exists():
        return jsonify({'error': 'HED vocabulary file not found'}), 404
    
    return send_file(vocab_path, as_attachment=True, download_name='HED_vocab_reformatted.xml')

@app.route('/api/update_experiment_name', methods=['POST'])
def update_experiment_name():
    """Update the name of an existing experiment"""
    data = request.json
    
    filename = data.get('filename')
    new_name = data.get('experiment_name', '')
    
    if not filename:
        return jsonify({'error': 'Filename is required'}), 400
    
    try:
        experiments_dir = Path(__file__).parent.parent / 'prompt_experiments'
        file_path = experiments_dir / filename
        
        if not file_path.exists():
            return jsonify({'error': 'Experiment not found'}), 404
        
        # Load existing experiment data
        with open(file_path, 'r') as f:
            experiment_data = json.load(f)
        
        # Update the experiment name
        experiment_data['experiment_name'] = new_name
        
        # Save updated data
        with open(file_path, 'w') as f:
            json.dump(experiment_data, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Experiment name updated successfully'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=3000)
