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
import re

# HED validation imports
from hed import HedString, load_schema_version
from hed.errors import ErrorHandler, get_printable_issue_string
from hed.validator import HedValidator

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
    ollama_models = ['qwen3:8b', 'llama3.2:latest', 'mistral:latest']
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
                    
                    # Get quality grade information
                    quality_grade = data.get('quality_grade', {})
                    quality_score = quality_grade.get('score') if quality_grade else None
                    
                    experiments.append({
                        'filename': file_path.name,
                        'experiment_id': experiment_id,
                        'model': data.get('model', 'Unknown'),
                        'timestamp': data.get('timestamp', 'Unknown'),
                        'inference_time': data.get('inference_time'),
                        'experiment_name': data.get('experiment_name', ''),
                        'description': data.get('description', '')[:100] + '...' if len(data.get('description', '')) > 100 else data.get('description', ''),
                        'validation_issues': data.get('validation_issues', data.get('total_validation_issues', 0)),
                        'annotation': data.get('annotation', data.get('annotations', [''])[0] if data.get('annotations') else ''),
                        'quality_score': quality_score
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
        
        # Extract annotations from model response
        annotations = extract_annotations(model_response)
        
        # Get the first annotation only (there should be only one)
        annotation = annotations[0] if annotations else ""
        
        # Validate the single annotation
        validation_issues = validate_hed_string(annotation) if annotation else 0
        
        # Grade the annotation quality
        quality_grade = grade_annotation_quality(description, annotation) if annotation else {
            'score': None,
            'full_response': 'No annotation to grade',
            'grader_model': 'llama3.2:3b'
        }
        
        # Automatically save experiment to filesystem
        experiment_data = {
            'model': model,
            'prompt_template': prompt_template,
            'description': description,
            'experiment_name': experiment_name,
            'model_response': model_response,
            'annotation': annotation,
            'validation_issues': validation_issues,
            'quality_grade': quality_grade,
            'inference_time': inference_time,
            'timestamp': datetime.datetime.now().isoformat(),
            'prompt': prompt
        }
        
        # Save to filesystem automatically
        saved_filename, experiment_id = auto_save_experiment(experiment_data)
        
        return jsonify({
            'success': True,
            'response': model_response,
            'annotation': annotation,
            'validation_issues': validation_issues,
            'quality_grade': quality_grade,
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
    annotation = data.get('annotation', '')
    inference_time = data.get('inference_time')
    
    if not all([model, prompt_template, description, model_response]):
        return jsonify({'error': 'All fields are required'}), 400
    
    try:
        experiment_data = {
            'model': model,
            'prompt_template': prompt_template,
            'description': description,
            'model_response': model_response,
            'annotation': annotation,
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

@app.route('/api/save_env_var', methods=['POST'])
def save_env_var():
    """Save environment variables to .env file"""
    data = request.json
    env_vars = data.get('env_vars', {})
    
    if not env_vars:
        return jsonify({'error': 'No environment variables provided'}), 400
    
    try:
        # Path to .env file in parent directory
        env_path = Path(__file__).parent.parent / '.env'
        
        # Read existing .env content if it exists
        existing_content = {}
        if env_path.exists():
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        existing_content[key] = value
        
        # Update with new values
        updated_vars = []
        for key, value in env_vars.items():
            if value.strip():  # Only update if value is not empty
                existing_content[key] = value.strip()
                updated_vars.append(key)
            else:  # Remove the key if empty value is provided
                if key in existing_content:
                    del existing_content[key]
                    updated_vars.append(f"{key} (removed)")
        
        # Write back to .env file
        with open(env_path, 'w') as f:
            for key, value in existing_content.items():
                f.write(f'{key}={value}\n')
        
        # Reload environment variables
        load_dotenv(env_path)
        
        return jsonify({
            'success': True,
            'message': 'Environment variables updated successfully',
            'updated_vars': updated_vars
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/get_env_vars')
def get_env_vars():
    """Get current environment variables (with masked values for security)"""
    try:
        # Read existing .env file to see what's actually configured
        env_path = Path(__file__).parent.parent / '.env'
        configured_vars = {}
        
        if env_path.exists():
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        configured_vars[key] = value.strip()
        
        # Define potential environment variables that can be managed
        potential_vars = [
            'GEMINI_API_KEY',
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY'
        ]
        
        env_vars = {}
        
        # First, add variables that are actually in the .env file
        for var, value in configured_vars.items():
            if var in potential_vars:  # Only include managed variables
                if 'API_KEY' in var:
                    env_vars[var] = {
                        'value': value[:10] + '...' if len(value) > 10 else value,
                        'masked': True,
                        'configured': True
                    }
                else:
                    env_vars[var] = {
                        'value': value,
                        'masked': False,
                        'configured': True
                    }
        
        # Then, add potential variables that aren't configured yet (but only if requested)
        # This allows the UI to show "Add new API key" options
        available_vars = [var for var in potential_vars if var not in configured_vars]
        
        return jsonify({
            'env_vars': env_vars,
            'configured_vars': list(configured_vars.keys()),
            'available_vars': available_vars
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/check_api_key')
def check_api_key():
    """Check if GEMINI_API_KEY is set (legacy endpoint for backward compatibility)"""
    api_key = os.getenv('GEMINI_API_KEY')
    return jsonify({
        'has_api_key': bool(api_key),
        'key_preview': api_key[:10] + '...' if api_key else None
    })

def validate_hed_string(hed_string: str, schema_name='standard', schema_version='8.4.0') -> int:
    """
    Validate a HED string and return the number of validation issues.
    Returns 0 if no issues found, otherwise returns the count of issues.
    """
    try:
        if schema_name != 'standard':
            schema = load_schema_version(f'{schema_name}_{schema_version}')
        else:
            schema = load_schema_version(f'{schema_version}')
        
        check_for_warnings = True
        data = hed_string
        hedObj = HedString(data, schema)
        short_string = hedObj.get_as_form('short_tag')

        # Validate the string
        error_handler = ErrorHandler(check_for_warnings=check_for_warnings)
        validator = HedValidator(schema)
        issues = validator.validate(hedObj, allow_placeholders=False, error_handler=error_handler)
        
        if issues:
            return len(issues)
        else:
            return 0
    except Exception as e:
        print(f"HED validation error: {e}")
        return -1  # Return -1 to indicate validation couldn't be performed

def extract_annotations(text):
    """Extract text between --- ANNOTATION START --- and --- ANNOTATION END --- markers"""
    pattern = r'--- ANNOTATION START ---\s*(.*?)\s*--- ANNOTATION END ---'
    matches = re.findall(pattern, text, re.DOTALL)
    return [match.strip() for match in matches if match.strip()]

def grade_annotation_quality(description, annotation, grader_model='mistral:latest'):
    """
    Grade the quality of an annotation using an LLM grader.
    Returns a score from 0-10 based on clarity and how well the original description can be inferred.
    """
    try:
        # Quality grading prompt template
        grading_prompt = f"""Here's the requested description to be translated: 

{description}

Here's the generated annotation:

{annotation}

Evaluate the quality of the annotation on the scale of 0-10 based on clarity and how well the original description can be inferred from the annotation"""
        
        # Use Ollama API to grade the annotation
        response = chat(model=grader_model, messages=[
            {
                'role': 'user',
                'content': grading_prompt,
            },
        ])
        
        grader_response = response['message']['content']
        
        # Extract numeric score from response
        score = extract_quality_score(grader_response)
        
        return {
            'score': score,
            'full_response': grader_response,
            'grader_model': grader_model
        }
        
    except Exception as e:
        print(f"Quality grading error: {e}")
        return {
            'score': None,
            'full_response': f"Error: {str(e)}",
            'grader_model': grader_model
        }

def extract_quality_score(response_text):
    """Extract numeric score from grader response"""
    import re
    
    # Look for patterns like "8/10", "score: 7", "rating of 9", etc.
    patterns = [
        r'(\d+(?:\.\d+)?)/10',  # X/10 format
        r'(?:score|rating|grade)(?:\s*:?\s*|\s+(?:of|is)\s+)(\d+(?:\.\d+)?)',  # score: X, rating of X, etc.
        r'(\d+(?:\.\d+)?)\s*(?:out of 10|/10)',  # X out of 10
        r'(?:^|\s)(\d+(?:\.\d+)?)(?:\s*$|\s)',  # standalone number
    ]
    
    for pattern in patterns:
        matches = re.findall(pattern, response_text, re.IGNORECASE)
        if matches:
            try:
                score = float(matches[0])
                # Ensure score is within 0-10 range
                if 0 <= score <= 10:
                    return score
            except ValueError:
                continue
    
    return None

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=3000)
