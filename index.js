#!/usr/bin/env node
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import figlet from "figlet";
import { exiftool } from "exiftool-vendored";
import sharp from "sharp";
import fsExtra from "fs-extra";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Configuration file path
const configFilePath = path.join(process.cwd(), "image-metadata-config.json");

// Default configuration
const defaultConfig = {
  inputDir: '',
  outputDir: '',
  maxTitleChars: 200,
  maxTags: 45,
  gptApiKey: '',
  geminiApiKey: '',
  aiModel: 'gemini', // default AI model
  geminiModel: 'gemini-1.5-flash', // default Gemini model
  gptModel: 'gpt-4-vision-preview', // default GPT model
  showTokens: true, // default to showing token usage
};

// Load or create configuration
let config = defaultConfig;
try {
  if (fs.existsSync(configFilePath)) {
    const configFile = fs.readFileSync(configFilePath, "utf8");
    config = { ...defaultConfig, ...JSON.parse(configFile) };
  }
} catch (error) {
  console.error(
    chalk.yellow(`Warning: Could not load config file: ${error.message}`),
  );
  console.log(chalk.yellow("Using default configuration"));
}

// Function to save configuration
function saveConfig() {
  try {
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error(chalk.red(`Error saving configuration: ${error.message}`));
  }
}

// Display welcome message
console.log(
  chalk.cyan(
    figlet.textSync("Image Metadata CLI", {
      font: "Standard",
      horizontalLayout: "default",
      verticalLayout: "default",
    }),
  ),
);
console.log(chalk.yellow("Generate metadata for your stock images using AI\n"));

// Utility function to check if directory exists
const directoryExists = (dirPath) => {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch (err) {
    return false;
  }
};

// Validate directory exists
const validateDirectory = (dirPath) => {
  if (!dirPath) return "Directory path cannot be empty";
  if (!directoryExists(dirPath)) return "Directory does not exist";
  return true;
};

// Function to compress image
async function compressImage(imagePath) {
  try {
    const tempFilePath = path.join(
      path.dirname(imagePath),
      `temp_${path.basename(imagePath)}`,
    );

    await sharp(imagePath)
      .resize(300) // Resize to max 300px on longest side
      .jpeg({ quality: 80 }) // Compress quality
      .toFile(tempFilePath);

    return tempFilePath;
  } catch (error) {
    console.error(chalk.red(`Error compressing image: ${error.message}`));
    return imagePath; // Return original if compression fails
  }
}

// Function to convert image to base64
async function imageToBase64(imagePath) {
  try {
    const imageBuffer = await fs.promises.readFile(imagePath);
    return imageBuffer.toString("base64");
  } catch (error) {
    console.error(
      chalk.red(`Error converting image to base64: ${error.message}`),
    );
    throw error;
  }
}

// Function to generate metadata using GPT
async function generateMetadataWithGPT(
  imagePath,
  apiKey,
  maxTitleChars,
  maxTags,
) {
  const spinner = ora("Generating metadata with GPT...").start();

  try {
    const compressedImagePath = await compressImage(imagePath);
    const base64Image = await imageToBase64(compressedImagePath);

    // Delete temp file if it was created
    if (compressedImagePath !== imagePath) {
      await fs.promises.unlink(compressedImagePath);
    }

    // Initialize OpenAI client with API key
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    const response = await openai.chat.completions.create({
      model: config.gptModel,
      messages: [
        {
          role: "system",
          content: `You are an expert at generating stock photo metadata.
          Analyze the provided image and create a JSON response with a title (max ${maxTitleChars} characters)
          and tags (max ${maxTags} tags) that would be appropriate for microstock platforms like Adobe Stock and Shutterstock.
          Format the response as valid JSON with "title" and "tags" fields. Tags should be an array of strings.`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
            {
              type: "text",
              text: "Generate stock photo metadata for this image.",
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    const metadataText = response.choices[0].message.content;
    const tokensUsed = {
      prompt: response.usage.prompt_tokens,
      completion: response.usage.completion_tokens,
      total: response.usage.total_tokens
    };

    // Extract JSON from the response
    const jsonMatch =
      metadataText.match(/```json\n([\s\S]*?)\n```/) ||
      metadataText.match(/{[\s\S]*}/);

    let metadata;
    if (jsonMatch) {
      metadata = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      try {
        metadata = JSON.parse(metadataText);
      } catch (e) {
        throw new Error("Could not parse GPT response as JSON");
      }
    }

    // Add token usage information to metadata
    metadata.tokenInfo = tokensUsed;
    
    spinner.succeed("Metadata generated successfully with GPT");
    return metadata;
  } catch (error) {
    spinner.fail(`Failed to generate metadata with GPT: ${error.message}`);
    throw error;
  }
}

// Function to generate metadata using Gemini
async function generateMetadataWithGemini(
  imagePath,
  apiKey,
  maxTitleChars,
  maxTags,
) {
  const spinner = ora("Generating metadata with Gemini...").start();

  try {
    const compressedImagePath = await compressImage(imagePath);
    const base64Image = await imageToBase64(compressedImagePath);

    // Delete temp file if it was created
    if (compressedImagePath !== imagePath) {
      await fs.promises.unlink(compressedImagePath);
    }

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: config.geminiModel });

    const prompt = `You are an expert at generating stock photo metadata.
                   Analyze the provided image and create a JSON response with a title (max ${maxTitleChars} characters)
                   and tags (max ${maxTags} tags) that would be appropriate for microstock platforms like Adobe Stock and Shutterstock.
                   Format the response as valid JSON with "title" and "tags" fields. Tags should be an array of strings.`;

    const imageBuffer = Buffer.from(base64Image, "base64");

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/jpeg",
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const metadataText = response.text();
    
    // Get token usage if available
    let tokensUsed = null;
    try {
      if (response.usageMetadata) {
        tokensUsed = {
          prompt: response.usageMetadata.promptTokenCount || 0,
          total: response.usageMetadata.totalTokenCount || 0
        };
      }
    } catch (e) {
      console.log(chalk.yellow('Could not retrieve token usage information'));
    }

    // Extract JSON from the response
    const jsonMatch =
      metadataText.match(/```json\n([\s\S]*?)\n```/) ||
      metadataText.match(/{[\s\S]*}/);

    let metadata;
    if (jsonMatch) {
      metadata = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } else {
      try {
        metadata = JSON.parse(metadataText);
      } catch (e) {
        throw new Error("Could not parse Gemini response as JSON");
      }
    }
    
    // Add token usage information to metadata if available
    if (tokensUsed) {
      metadata.tokenInfo = tokensUsed;
    }

    spinner.succeed("Metadata generated successfully with Gemini");
    return metadata;
  } catch (error) {
    spinner.fail(`Failed to generate metadata with Gemini: ${error.message}`);
    throw error;
  }
}

// Function to write metadata to image
async function writeMetadataToImage(imagePath, outputPath, metadata) {
  const spinner = ora('Writing metadata to image...').start();
  
  try {
    // Create output directory if it doesn't exist
    await fsExtra.ensureDir(path.dirname(outputPath));
    
    // Copy image to output directory
    await fsExtra.copy(imagePath, outputPath);
    
    // Write metadata to image
    await exiftool.write(outputPath, {
      Title: metadata.title,
      Description: metadata.title, // Use title as description
      Keywords: metadata.tags,
    }, ['-overwrite_original']); // Add flag to avoid creating backup files
    
    spinner.succeed('Metadata written successfully');
    return true;
  } catch (error) {
    spinner.fail(`Failed to write metadata: ${error.message}`);
    throw error;
  }
}

// Process all images in the input directory
async function processAllImages(
  inputDir,
  outputDir,
  aiModel,
  apiKey,
  maxTitleChars,
  maxTags,
) {
  try {
    const files = await fs.promises.readdir(inputDir);
    const imageFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
    });

    if (imageFiles.length === 0) {
      console.log(chalk.yellow("No image files found in the input directory."));
      return;
    }

    console.log(
      chalk.blue(`Found ${imageFiles.length} image files to process.`),
    );

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const imagePath = path.join(inputDir, file);
      const outputPath = path.join(outputDir, file);

      console.log(
        chalk.cyan(`\nProcessing image ${i + 1}/${imageFiles.length}: ${file}`),
      );

      try {
        // Generate metadata using selected AI model
        let metadata;
        if (aiModel === "gpt") {
          metadata = await generateMetadataWithGPT(
            imagePath,
            apiKey,
            maxTitleChars,
            maxTags,
          );
        } else {
          metadata = await generateMetadataWithGemini(
            imagePath,
            apiKey,
            maxTitleChars,
            maxTags,
          );
        }

        // Write metadata to image
        await writeMetadataToImage(imagePath, outputPath, metadata);

        console.log(chalk.green(`✓ Processed: ${file}`));
        console.log(chalk.green(`  Title: ${metadata.title} (${metadata.title.length} chars)`));
        console.log(chalk.green(`  Tags: ${metadata.tags.length} keywords`));
        console.log(chalk.green(`  Tags: ${metadata.tags.join(", ")}`));
        
        // Display token usage if available
        if (config.showTokens && metadata.tokenInfo) {
          console.log(chalk.blue(`  Token usage:`));
          Object.entries(metadata.tokenInfo).forEach(([key, value]) => {
            console.log(chalk.blue(`    ${key}: ${value}`));
          });
        }
        
        successCount++;
      } catch (error) {
        console.error(
          chalk.red(`✗ Failed to process ${file}: ${error.message}`),
        );
        failCount++;
      }
    }

    console.log(
      chalk.blue(
        `\nProcessing completed: ${successCount} succeeded, ${failCount} failed.`,
      ),
    );
  } catch (error) {
    console.error(chalk.red(`Error processing images: ${error.message}`));
  }
}

// Main menu function
async function showMainMenu() {
  try {
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "📁 Set input directory", value: "setInputDir" },
          { name: "📁 Set output directory", value: "setOutputDir" },
          { name: "📏 Set max title characters", value: "setMaxTitleChars" },
          { name: "🏷️ Set max tags", value: "setMaxTags" },
          { name: '🔑 Set API keys', value: 'setApiKeys' },
          { name: '🤖 Select AI to Use', value: 'selectAiModel' },
          { name: '📊 Select Model to Use', value: 'selectSpecificModel' },
          { name: '🔢 Toggle token usage display', value: 'toggleTokenDisplay' },
          { name: '▶️ Process images', value: 'processImages' },
          { name: "❌ Exit", value: "exit" },
        ],
      },
    ]);

    switch (answers.action) {
      case "setInputDir":
        await setInputDirectory();
        break;
      case "setOutputDir":
        await setOutputDirectory();
        break;
      case "setMaxTitleChars":
        await setMaxTitleChars();
        break;
      case "setMaxTags":
        await setMaxTags();
        break;
      case "setApiKeys":
        await setApiKeys();
        break;
      case 'selectAiModel':
        await selectAiModel();
        break;
      case 'selectSpecificModel':
        await selectSpecificModel();
        break;
      case 'toggleTokenDisplay':
        await toggleTokenDisplay();
        break;
      case 'processImages':
        await processImages();
        break;
      case "exit":
        console.log(
          chalk.cyan("Thank you for using Image Metadata CLI. Goodbye!"),
        );
        await exiftool.end();
        process.exit(0);
    }

    // Show the main menu again
    await showMainMenu();
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    await showMainMenu();
  }
}

// Set input directory
async function setInputDirectory() {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "inputDir",
      message: "Enter the path to your input directory:",
      default: config.inputDir,
      validate: validateDirectory,
    },
  ]);

  config.inputDir = answers.inputDir;
  saveConfig();
  console.log(chalk.green(`Input directory set to: ${answers.inputDir}`));
}

// Set output directory
async function setOutputDirectory() {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "outputDir",
      message: "Enter the path to your output directory:",
      default: config.outputDir,
      validate: (dirPath) => {
        if (!dirPath) return "Directory path cannot be empty";
        // Create directory if it doesn't exist
        if (!directoryExists(dirPath)) {
          try {
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(chalk.yellow(`Created directory: ${dirPath}`));
          } catch (error) {
            return `Could not create directory: ${error.message}`;
          }
        }
        return true;
      },
    },
  ]);

  config.outputDir = answers.outputDir;
  saveConfig();
  console.log(chalk.green(`Output directory set to: ${answers.outputDir}`));
}

// Set max title characters
async function setMaxTitleChars() {
  const answers = await inquirer.prompt([
    {
      type: "number",
      name: "maxTitleChars",
      message: "Enter the maximum number of characters for the title:",
      default: config.maxTitleChars,
      validate: (value) => {
        if (isNaN(value) || value <= 0) {
          return "Please enter a positive number";
        }
        return true;
      },
    },
  ]);

  config.maxTitleChars = answers.maxTitleChars;
  saveConfig();
  console.log(
    chalk.green(`Maximum title characters set to: ${answers.maxTitleChars}`),
  );
}

// Set max tags
async function setMaxTags() {
  const answers = await inquirer.prompt([
    {
      type: "number",
      name: "maxTags",
      message: "Enter the maximum number of tags:",
      default: config.maxTags,
      validate: (value) => {
        if (isNaN(value) || value <= 0) {
          return "Please enter a positive number";
        }
        return true;
      },
    },
  ]);

  config.maxTags = answers.maxTags;
  saveConfig();
  console.log(chalk.green(`Maximum tags set to: ${answers.maxTags}`));
}

// Set API keys
async function setApiKeys() {
  const answers = await inquirer.prompt([
    {
      type: "password",
      name: "gptApiKey",
      message: "Enter your OpenAI GPT API key:",
      default: config.gptApiKey,
      mask: "*",
    },
    {
      type: "password",
      name: "geminiApiKey",
      message: "Enter your Google Gemini API key:",
      default: config.geminiApiKey,
      mask: "*",
    },
  ]);

  config.gptApiKey = answers.gptApiKey;
  config.geminiApiKey = answers.geminiApiKey;
  saveConfig();
  console.log(chalk.green("API keys saved successfully"));
}

// Select AI model
async function selectAiModel() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'aiModel',
      message: 'Select the AI to use:',
      choices: [
        { name: 'OpenAI GPT', value: 'gpt' },
        { name: 'Google Gemini', value: 'gemini' }
      ],
      default: config.aiModel
    }
  ]);
  
  config.aiModel = answers.aiModel;
  saveConfig();
  console.log(chalk.green(`AI set to: ${answers.aiModel === 'gpt' ? 'OpenAI GPT' : 'Google Gemini'}`));
}

// Select specific model based on AI provider
async function selectSpecificModel() {
  if (config.aiModel === 'gemini') {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'geminiModel',
        message: 'Select the Gemini model to use:',
        choices: [
          { name: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash' },
          { name: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' }
        ],
        default: config.geminiModel
      }
    ]);
    
    config.geminiModel = answers.geminiModel;
    saveConfig();
    console.log(chalk.green(`Gemini model set to: ${answers.geminiModel}`));
  } else {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'gptModel',
        message: 'Select the GPT model to use:',
        choices: [
          { name: 'GPT-4 Vision', value: 'gpt-4-vision-preview' },
          { name: 'GPT-4.1-mini', value: 'gpt-4.1-mini' },
          { name: 'GPT-4.1-nano', value: 'gpt-4.1-nano' },
          { name: 'o4-mini', value: 'o4-mini' }
        ],
        default: config.gptModel
      }
    ]);
    
    config.gptModel = answers.gptModel;
    saveConfig();
    console.log(chalk.green(`GPT model set to: ${answers.gptModel}`));
  }
}

// Toggle token display
async function toggleTokenDisplay() {
  config.showTokens = !config.showTokens;
  saveConfig();
  console.log(chalk.green(`Token usage display: ${config.showTokens ? 'Enabled' : 'Disabled'}`));
}

// Process images
async function processImages() {
  const inputDir = config.inputDir;
  const outputDir = config.outputDir;
  const aiModel = config.aiModel;
  const maxTitleChars = config.maxTitleChars;
  const maxTags = config.maxTags;

  // Validate configuration
  if (!inputDir || !outputDir) {
    console.log(
      chalk.red(
        "Please set both input and output directories before processing.",
      ),
    );
    return;
  }

  const apiKey = aiModel === "gpt" ? config.gptApiKey : config.geminiApiKey;
  if (!apiKey) {
    console.log(
      chalk.red(
        `Please set the ${aiModel === "gpt" ? "GPT" : "Gemini"} API key before processing.`,
      ),
    );
    return;
  }

  // Confirm processing
  const confirmAnswers = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: `Ready to process all images from ${inputDir} to ${outputDir}?`,
      default: true,
    },
  ]);

  if (confirmAnswers.proceed) {
    await processAllImages(
      inputDir,
      outputDir,
      aiModel,
      apiKey,
      maxTitleChars,
      maxTags,
    );
  }
}

// Start the application
showMainMenu();
