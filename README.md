# AI Chat → Doc Generator

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow)

Convert any AI chat conversation into structured notes or a PDF — in one click.

## Supported Platforms

- ChatGPT
- Claude
- Gemini
- Grok
- Perplexity
- Copilot

## How It Works

1. Navigate to any supported AI chat with an existing conversation.
2. Click the **Generate Doc** button that appears on the page.
3. A modal opens. Type what you want, such as `structured notes`, `study guide`, or `resume format`.
4. The extension scrapes the conversation and sends it to GPT-4o-mini for formatting.
5. The generated output appears in the modal. Click **Download PDF** to export it.

## Features

- Manifest V3 Chrome extension
- Cross-platform DOM scrapers for supported AI chat sites
- GPT-4o-mini powered document reformatting
- Client-side PDF export with jsPDF
- Long conversation handling with 50-message chunked processing
- Local API key configuration through `config.js`
- Git-safe API key setup using `config.example.js` and `.gitignore`

## Technical Details

The extension injects a vanilla JavaScript content script into supported AI chat pages. The content script adds a floating **Generate Doc** button, opens a modal for user instructions, scrapes visible chat messages from the active page, and sends the conversation chunks to the OpenAI Chat Completions API using `gpt-4o-mini`.

PDF generation is handled locally in the browser with `jsPDF`. Long conversations are processed in chunks of 50 messages to reduce request size and preserve conversation order.

The OpenAI API key is read from `config.js`, which is intentionally excluded from Git. A tracked `config.example.js` file documents the required format.

## Project Structure

```text
.
├── .gitignore
├── README.md
├── config.example.js
├── config.js              # local only, not committed
├── content.js             # injected content script and main extension logic
├── jspdf.min.js           # PDF generation library
├── manifest.json          # Chrome extension manifest
├── popup.html             # extension popup UI
├── popup.js               # popup script
└── styles.css             # legacy stylesheet, not required by popup.html
```

## Setup

1. Clone the repository.

   ```bash
   git clone https://github.com/saitarun3012/ai-chat-doc-generator.git
   cd ai-chat-doc-generator
   ```

2. Copy `config.example.js` to `config.js`.

   ```bash
   cp config.example.js config.js
   ```

3. Add your OpenAI API key to `config.js`.

   ```js
   const CONFIG = {
     OPENAI_API_KEY: "your_openai_api_key_here"
   };
   ```

4. Open Chrome and go to:

   ```text
   chrome://extensions
   ```

5. Enable **Developer Mode**.

6. Click **Load unpacked** and select the project folder.

## Usage

1. Open an existing conversation on ChatGPT, Claude, Gemini, Grok, Perplexity, or Copilot.
2. Click the floating **Generate Doc** button.
3. Enter the desired output format.
4. Click **Generate**.
5. Review the generated document in the modal.
6. Click **Download PDF** to export.

## API Key Security

Do not commit `config.js`.

The repository includes `.gitignore` rules for:

```text
.env
config.js
node_modules/
```

Use `config.example.js` as the template for local setup.

## License

MIT
