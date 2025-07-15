from flask import Flask, render_template, request, jsonify, send_file
from ollama import chat
from ollama import ChatResponse
from google import genai
from jinja2 import Template
from dotenv import load_dotenv
import os
import json
import datetime
from pathlib import Path

load_dotenv()

app = Flask(__name__)

# Load HED vocabulary
def load_hed_vocab():
    vocab_path = Path(__file__).parent.parent / 'HED_vocab_reformatted.xml'
    with open(vocab_path, 'r') as file:
        return file.read()

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
(Foreground-view, (Item-count, High), Ingestible-object), (Background-view, (Human, Body, Outdoors, Furnishing, Natural-feature, Urban, Man-made-object)
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
    gemini_models = ['gemini-1.5-flash', 'gemini-1.5-pro']
    
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
                    experiments.append({
                        'filename': file_path.name,
                        'model': data.get('model', 'Unknown'),
                        'timestamp': data.get('timestamp', 'Unknown'),
                        'description': data.get('description', '')[:100] + '...' if len(data.get('description', '')) > 100 else data.get('description', '')
                    })
            except Exception as e:
                print(f"Error loading experiment {file_path}: {e}")
    
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
    
    if not description:
        return jsonify({'error': 'Description is required'}), 400
    
    try:
        # Load HED vocabulary
        hed_vocab = load_hed_vocab()
        
        # Render the template
        template = Template(prompt_template)
        prompt = template.render(hed_vocab=hed_vocab, description=description)
        
        # Choose the appropriate API based on model
        if model.startswith('gemini'):
            # Use Gemini API
            client = genai.Client()
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
        
        return jsonify({
            'success': True,
            'response': model_response,
            'prompt': prompt
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/save_experiment', methods=['POST'])
def save_experiment():
    """Save an experiment to a file"""
    data = request.json
    
    model = data.get('model')
    prompt_template = data.get('prompt_template')
    description = data.get('description')
    model_response = data.get('model_response')
    
    if not all([model, prompt_template, description, model_response]):
        return jsonify({'error': 'All fields are required'}), 400
    
    try:
        # Create experiments directory if it doesn't exist
        experiments_dir = Path(__file__).parent.parent / 'prompt_experiments'
        experiments_dir.mkdir(exist_ok=True)
        
        # Find next available filename
        i = 0
        while (experiments_dir / f'experiment_{i}.json').exists():
            i += 1
        
        filename = f'experiment_{i}.json'
        
        # Save experiment
        experiment_data = {
            'model': model,
            'prompt_template': prompt_template,
            'description': description,
            'model_response': model_response,
            'timestamp': datetime.datetime.now().isoformat()
        }
        
        with open(experiments_dir / filename, 'w') as f:
            json.dump(experiment_data, f, indent=2)
        
        return jsonify({
            'success': True,
            'filename': filename
        })
        
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

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
