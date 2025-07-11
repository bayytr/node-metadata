# Image Metadata CLI

A command-line tool for automatically generating and embedding metadata for stock images using AI (OpenAI GPT or Google Gemini).

## Features

- Interactive CLI menu with colorful interface
- Automatic title and tag generation using AI
- Support for both OpenAI GPT and Google Gemini
- Image compression before sending to AI APIs
- Persistent configuration saved in a JSON file
- Metadata embedding using exiftool
- Progress tracking with spinners

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/image-metadata-cli.git
   cd image-metadata-cli
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Make the CLI executable (optional):
   ```
   npm link
   ```

## Requirements

- Node.js v16.0.0 or higher
- API key for OpenAI GPT or Google Gemini (or both)
- Image files you want to process

## Usage

Run the CLI tool:

```
npm start
```

Or if you've used `npm link`:

```
image-metadata-cli
```

### Setup

1. Set the input directory containing your images
2. Set the output directory where processed images will be saved
3. Configure max title characters (default: 200) and max tags (default: 45)
4. Enter your API keys for OpenAI and/or Google Gemini
5. Select which AI model to use
6. Process your images

### How It Works

1. The tool reads images from your input directory
2. Each image is compressed to reduce size before sending to AI
3. The selected AI model generates a title and tags based on the image content
4. Metadata is embedded in the image using exiftool
5. The processed image is saved to the output directory

### Configuration

Your settings are saved in a `image-metadata-config.json` file in the directory where you run the application. This includes:

- Input and output directories
- API keys
- Maximum title characters and tags
- Selected AI model

## API Keys

- For OpenAI GPT: Get your API key at https://platform.openai.com/api-keys
- For Google Gemini: Get your API key at https://ai.google.dev/

## License

MIT