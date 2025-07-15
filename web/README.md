# HED Experiment Lab Web Application

A web interface for experimenting with different prompts and models for HED (Hierarchical Event Descriptor) annotation tasks.

## Features

- **Model Selection**: Choose from Ollama models (qwen3:8b, llama3:8b, etc.) or Gemini models
- **Prompt Experimentation**: Edit and test different prompt templates
- **Real-time Results**: See model responses and full prompts side by side
- **Experiment Management**: Save, load, and download experiments
- **Beautiful UI**: Modern, responsive interface with Bootstrap and custom styling

## Setup

1. Install dependencies:
```bash
uv sync
```

2. Make sure you have the required services running:
   - **Ollama**: Install and run Ollama with your preferred models
   - **Gemini API**: Set up `GEMINI_API_KEY` in your `.env` file

3. Start the web application:
```bash
python run_web_app.py
```

4. Open your browser to `http://localhost:5000`

## Usage

### Running Experiments

1. Select a model from the dropdown
2. Enter a description to annotate
3. Modify the prompt template if needed
4. Click "Run Experiment"
5. View results and save the experiment

### Managing Experiments

- **Recent Experiments**: View recent experiments in the sidebar
- **Experiment Details**: Click on any experiment to view full details
- **Load to Form**: Load a previous experiment's settings to modify and re-run
- **Download**: Download experiment files as JSON

### Prompt Templates

The default prompt template uses Jinja2 templating with these variables:
- `{{hed_vocab}}`: The HED vocabulary schema
- `{{description}}`: The user's input description

You can modify the prompt template to experiment with different approaches.

## File Structure

```
web/
├── app.py              # Flask application
├── static/
│   ├── style.css       # Custom styles
│   └── script.js       # JavaScript functionality
└── templates/
    └── index.html      # Main web interface
```

## API Endpoints

- `GET /`: Main web interface
- `GET /api/models`: Get available models
- `GET /api/experiments`: Get list of saved experiments
- `GET /api/experiment/<filename>`: Get specific experiment details
- `POST /api/run_experiment`: Run a new experiment
- `POST /api/save_experiment`: Save an experiment
- `GET /api/download_experiment/<filename>`: Download experiment file

## Environment Variables

Make sure to set up your `.env` file with:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

## Dependencies

- Flask: Web framework
- Ollama: For running local models
- Google GenAI: For Gemini models
- Jinja2: Template rendering
- Bootstrap: UI framework
- Font Awesome: Icons
