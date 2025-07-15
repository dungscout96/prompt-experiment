prompt_template = '''
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

from ollama import chat
from ollama import ChatResponse
from google import genai

from jinja2 import Template
from dotenv import load_dotenv
load_dotenv()
import os
# load the HED vocabulary from HED_vocab_reformatted.xml into a string
hed_vocab = ''
with open('HED_vocab_reformatted.xml', 'r') as file:
    hed_vocab = file.read()

# render the jinja template from prompt_template variable
template = Template(prompt_template)

query = 'A participant is looking at a computer screen displaying an image of a red car.'

prompt = template.render(hed_vocab=hed_vocab, description=query)

# The client gets the API key from the environment variable `GEMINI_API_KEY`.
client = genai.Client()

model = 'qwen3:8b'
# call the chat function with the model and the prompt
response: ChatResponse = chat(model=model, messages=[
  {
    'role': 'user',
    'content': prompt,
  },
])
print(response['message']['content'])

# save the prompt template and model response to a json file
import json
i = 0
filename = 'prompt_experiments/experiment_'
while os.path.exists(f'{filename}{i}.json'):
    i += 1

with open(f'{filename}{i}.json', 'w') as f:
    json.dump({
        'model': model,
        'prompt_template': prompt_template,
        'model_response': response['message']['content']
    }, f)
