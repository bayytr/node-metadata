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
  inputDir: "images/input", // default input directory
  outputDir: "images/output", // default output directory 
  maxTitleChars: 200,
  maxTags: 45,
  gptApiKey: "",
  geminiApiKey: "",
  aiModel: "gemini", // default AI model
  geminiModel: "gemini-1.5-flash", // default Gemini model
  gptModel: "gpt-4.1-nano", // default GPT model
//   gptModel: "gpt-4-vision-preview", // default GPT model
  showTokens: true, // default to showing token usage
  delay: 10, // default delay between requests
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

// Function to display current configuration
function displayCurrentConfig() {
  const inputStatus = config.inputDir
    ? chalk.green(config.inputDir)
    : chalk.yellow("Not set");
  const outputStatus = config.outputDir
    ? chalk.green(config.outputDir)
    : chalk.yellow("Not set");

  console.log(
    chalk.cyan.bold("─────────────── CURRENT CONFIGURATION ───────────────"),
  );
  console.log(chalk.cyan(`Input Directory:   ${inputStatus}`));
  console.log(chalk.cyan(`Output Directory:  ${outputStatus}`));
  console.log(
    chalk.cyan(`Max Title Chars:   ${chalk.green(config.maxTitleChars)}`),
  );
  console.log(chalk.cyan(`Max Tags:          ${chalk.green(config.maxTags)}`));
  console.log(
    chalk.cyan(
      `AI Provider:       ${config.aiModel === "gpt" ? chalk.blue("OpenAI GPT") : chalk.green("Google Gemini")}`,
    ),
  );
  const modelName =
    config.aiModel === "gpt" ? config.gptModel : config.geminiModel;
  console.log(chalk.cyan(`AI Model:          ${chalk.magenta(modelName)}`));
  console.log(
    chalk.cyan(
      `Show Token Usage:  ${config.showTokens ? chalk.green("Enabled") : chalk.yellow("Disabled")}`,
    ),
  );
  console.log(
    chalk.cyan(
      `Request Delay:     ${config.delay > 0 ? chalk.green(`${config.delay} seconds`) : chalk.yellow("Disabled")}`,
    ),
  );
  console.log(
    chalk.cyan.bold("─────────────────────────────────────────────────────"),
  );
  console.log("");
}

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
          content: `Generate stock image metadata. Return in this exact format:
{"title": "EXACTLY IN RANGE OF 150 chars (no LESS than that since its CRITICAL) UNTIL ${maxTitleChars} chars (no MORE than that since its CRITICAL) commercial title",
"tags": [EXACTLY ${maxTags} unique commercial keywords]}

Important: Title MUST BE IN RANGE of 150 chars (no LESS than that since its CRITICAL) UNTIL ${maxTitleChars} chars (no MORE than that since its CRITICAL), Tags MUST BE EXACTLY ${maxTags} keywords (no more, no less), DONT USE SYMBOL OR PUNCTUATION MARKS`,
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
      temperature: 0.3, // Lower temperature for more consistent results
      top_p: 0.8, // Diverse but focused output
    });

    const metadataText = response.choices[0].message.content;
    const tokensUsed = {
      prompt: response.usage.prompt_tokens,
      completion: response.usage.completion_tokens,
      total: response.usage.total_tokens,
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
    const model = genAI.getGenerativeModel({
      model: config.geminiModel,
      generationConfig: {
        temperature: 0.8, // Lower temperature for more consistent results
        topP: 0.8, // Diverse but focused output
      },
    });

    const prompt = `You are a generator of stock image metadata. Follow these rules EXACTLY:

    1. Output format MUST be valid JSON:
    {
      "title": "Your generated title here",
      "tags": ["tag1", "tag2", ..., "tag${maxTags}"]
    }
    2. "title" MUST be EXACTLY ${maxTitleChars} characters long — including spaces. This is NON-NEGOTIABLE.
       - Write a commercial friendly title, fluent sentence that ends precisely at ${maxTitleChars} characters.
    3. "tags" MUST contain EXACTLY ${maxTags} individual, relevant commercial keywords.
       - No duplicates, no punctuation, no symbols, just clean lowercase words.
    4. DO NOT return anything except the JSON object. No explanation. No extra output.
    Repeat: This is a hard requirement. Output must be strictly ${maxTitleChars} characters in the title, and exactly ${maxTags} keywords.`;

    // const imageBuffer = Buffer.from(base64Image, "base64");

    const imagePart = {
      inlineData: {
        data: base64Image,
        mimeType: "image/jpeg",
      },
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const metadataText = response.text();

    // Get token usage if available
    let tokensUsed = null;
    try {
      if (response.usageMetadata) {
        tokensUsed = {
          prompt: response.usageMetadata.promptTokenCount || 0,
          total: response.usageMetadata.totalTokenCount || 0,
        };
      }
    } catch (e) {
      console.log(chalk.yellow("Could not retrieve token usage information"));
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

    // Validate metadata
    metadata = validateAndFixMetadata(metadata, maxTitleChars, maxTags);

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
  const spinner = ora("Writing metadata to image...").start();

  try {
    // Create output directory if it doesn't exist
    await fsExtra.ensureDir(path.dirname(outputPath));

    // Copy image to output directory
    await fsExtra.copy(imagePath, outputPath);

    // Write metadata to image
    await exiftool.write(
      outputPath,
      {
        Title: metadata.title,
        Description: metadata.title, // Use title as description
        Keywords: metadata.tags,
        Subject: metadata.tags.join(", "), // Use tags as subject
      },
      ["-overwrite_original"],
    ); // Add flag to avoid creating backup files

    // Delete original image if success write metadata to image
    // await fs.promises.unlink(imagePath);

    spinner.succeed("Metadata written successfully");
    return true;
  } catch (error) {
    spinner.fail(`Failed to write metadata: ${error.message}`);
    throw error;
    // return false; // Return false to indicate failure
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
  // Initialize statistics object
  const stats = {
    total: 0,
    success: 0,
    failed: 0,
  };

  try {
    const files = await fs.promises.readdir(inputDir);
    const imageFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext);
    });

    stats.total = imageFiles.length;

    if (imageFiles.length === 0) {
      console.log(
        chalk.yellow.bold(`\n─────────────── WARNING ────────────────`),
      );
      console.log(chalk.yellow(`No image files found in the input directory.`));
      console.log(
        chalk.yellow.bold(`────────────────────────────────────────\n`),
      );
      return;
    }

    console.log(
      chalk.blue.bold(`\n─────────────── PROCESSING IMAGES ─────────────────`),
    );
    console.log(
      chalk.blue(
        `Found ${chalk.green(imageFiles.length)} image files to process.`,
      ),
    );
    console.log(
      chalk.blue.bold(`───────────────────────────────────────────────────\n`),
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
        const success = await writeMetadataToImage(
          imagePath,
          outputPath,
          metadata,
        );

        if (success) {
          await fs.promises.unlink(imagePath); // Delete original image if metadata was written successfully
          console.log(chalk.redBright(`✓ Original image deleted successfully`));
        }

        console.log(chalk.green(`✓ Processed: ${file}`));
        console.log(
          chalk.green(
            `  Title: ${metadata.title} (${metadata.title.length} chars)`,
          ),
        );
        console.log(chalk.green(`  Tags: ${metadata.tags.length} keywords`));
        console.log(chalk.green(`  Tags: ${metadata.tags.join(", ")}`));

        // Display token usage if available
        if (config.showTokens && metadata.tokenInfo) {
          console.log(chalk.blue.bold(`  Token usage:`));
          Object.entries(metadata.tokenInfo).forEach(([key, value]) => {
            console.log(chalk.blue(`    ├─ ${key}: ${chalk.yellow(value)}`));
          });
        }

        // Provide feedback on title length
        if (metadata.title.length < 100) {
          console.log(
            chalk.yellow(
              `  ⚠️ Note: Title length (${metadata.title.length}) is shorter than recommended minimum (150 chars).`,
            ),
          );
        }

        successCount++;
        stats.success++;
      } catch (error) {
        console.error(
          chalk.red(`✗ Failed to process ${file}: ${error.message}`),
        );
        failCount++;
        stats.failed++;
      }

      // Add delay between requests (except for the last image)
      if (i < imageFiles.length - 1 && config.delay > 0) {
        console.log(chalk.yellow(`⏳ Waiting ${config.delay} seconds before next request...`));
        await new Promise(resolve => setTimeout(resolve, config.delay * 1000));
      }
    }
  } catch (error) {
    console.log(chalk.red.bold(`\n─────────────── ERROR ────────────────`));
    console.log(chalk.red(`Error processing images: ${error.message}`));
    console.log(chalk.red.bold(`───────────────────────────────────────\n`));
  }

  return stats;
}

// Main menu function
async function showMainMenu() {
  try {
    // Clear screen and display current configuration
    console.clear();
    displayCurrentConfig();

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "📂 Input/Output Settings", value: "inputOutputSettings" },
          { name: "⚙️ Metadata Settings", value: "metadataSettings" },
          { name: "🤖 AI Provider Settings", value: "aiSettings" },
          { name: "🙏🏻 Process Images", value: "processImages" },
          { name: "❌ Exit", value: "exit" },
        ],
      },
    ]);

    switch (answers.action) {
      case "inputOutputSettings":
        await showInputOutputMenu();
        break;
      case "metadataSettings":
        await showMetadataMenu();
        break;
      case "aiSettings":
        await showAiMenu();
        break;
      case "processImages":
        await processImages();
        break;
      case "exit":
        console.log(
          chalk.cyan.bold("\n┌─────────────────────────────────────────┐"),
        );
        console.log(
          chalk.cyan.bold("│  Thank you for using Image Metadata CLI │"),
        );
        console.log(
          chalk.cyan.bold("│              Goodbye!                   │"),
        );
        console.log(
          chalk.cyan.bold("└─────────────────────────────────────────┘\n"),
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
  console.log(
    chalk.cyan.bold(
      `\n─────────────── INPUT DIRECTORY UPDATED ────────────────`,
    ),
  );
  console.log(
    chalk.cyan(`Input directory set to: ${chalk.green(answers.inputDir)}`),
  );
  console.log(
    chalk.cyan.bold(
      `────────────────────────────────────────────────────────\n`,
    ),
  );
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
  console.log(
    chalk.cyan.bold(
      `\n─────────────── OUTPUT DIRECTORY UPDATED ────────────────`,
    ),
  );
  console.log(
    chalk.cyan(`│ Output directory set to: ${chalk.green(answers.outputDir)}`),
  );
  console.log(
    chalk.cyan.bold(
      `─────────────────────────────────────────────────────────\n`,
    ),
  );
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
    chalk.cyan.bold(`\n─────────────── TITLE LENGTH UPDATED ────────────────`),
  );
  console.log(
    chalk.cyan(
      `Maximum title characters set to: ${chalk.green(answers.maxTitleChars)}`,
    ),
  );
  console.log(
    chalk.cyan.bold(`─────────────────────────────────────────────────────\n`),
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
  console.log(
    chalk.cyan.bold(`\n─────────────── TAG COUNT UPDATED ────────────────`),
  );
  console.log(
    chalk.cyan(`Maximum tags set to: ${chalk.green(answers.maxTags)}`),
  );
  console.log(
    chalk.cyan.bold(`──────────────────────────────────────────────────\n`),
  );
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
  console.log(
    chalk.cyan.bold(`\n─────────────── API KEYS UPDATED ────────────────`),
  );
  console.log(chalk.cyan(`API keys saved successfully`));
  console.log(
    chalk.cyan.bold(`─────────────────────────────────────────────────\n`),
  );
}

// Select AI model
async function selectAiModel() {
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "aiModel",
      message: "Select the AI to use:",
      choices: [
        { name: "OpenAI GPT", value: "gpt" },
        { name: "Google Gemini", value: "gemini" },
      ],
      default: config.aiModel,
    },
  ]);

  config.aiModel = answers.aiModel;
  saveConfig();
  const aiName =
    answers.aiModel === "gpt"
      ? chalk.blue("OpenAI GPT")
      : chalk.green("Google Gemini");
  console.log(
    chalk.cyan.bold(`\n─────────────── AI PROVIDER UPDATED ────────────────`),
  );
  console.log(chalk.cyan(`AI Provider set to: ${aiName}`));
  console.log(
    chalk.cyan.bold(`────────────────────────────────────────────────────\n`),
  );
}

// Validate and fix metadata to ensure it meets requirements
function validateAndFixMetadata(metadata, maxTitleChars, maxTags) {
  // Make a copy to avoid modifying the original
  const validatedMetadata = { ...metadata };

  // Validate title
  if (!validatedMetadata.title || typeof validatedMetadata.title !== "string") {
    validatedMetadata.title = "Untitled Image";
    console.log(chalk.red("Error: AI did not return a valid title."));
  }

  // Validate tags
  if (!validatedMetadata.tags || !Array.isArray(validatedMetadata.tags)) {
    validatedMetadata.tags = [];
    console.log(chalk.red("Error: AI did not return any valid tags."));
  }

  // Ensure all tags are strings and remove duplicates
  const uniqueTags = new Set();
  validatedMetadata.tags.forEach((tag) => {
    if (typeof tag === "string" && tag.trim()) {
      uniqueTags.add(tag.trim().toLowerCase());
    }
  });

  // Convert set back to array
  validatedMetadata.tags = Array.from(uniqueTags);

  // Trim tags list if it exceeds max count
  if (validatedMetadata.tags.length > maxTags) {
    // If we have too many tags, trim to the exact count
    validatedMetadata.tags = validatedMetadata.tags.slice(0, maxTags);
  }

  // No category validation needed

  return validatedMetadata;
}

// Select specific model based on AI provider
async function selectSpecificModel() {
  if (config.aiModel === "gemini") {
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "geminiModel",
        message: "Select the Gemini model to use:",
        choices: [
          { name: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
          { name: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
          { name: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
          { name: "Gemini 1.5 Flash", value: "gemini-1.5-flash" },
          { name: "Gemini 1.5 Pro", value: "gemini-1.5-pro" },
        ],
        default: config.geminiModel,
      },
    ]);

    config.geminiModel = answers.geminiModel;
    saveConfig();
    console.log(
      chalk.cyan.bold(`\n─────────────── MODEL UPDATED ────────────────`),
    );
    console.log(
      chalk.cyan(`Gemini model set to: ${chalk.magenta(answers.geminiModel)}`),
    );
    console.log(
      chalk.cyan.bold(`───────────────────────────────────────────────\n`),
    );
  } else {
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "gptModel",
        message: "Select the GPT model to use:",
        choices: [
          { name: "GPT-4 Vision", value: "gpt-4-vision-preview" },
          { name: "GPT-4.1-mini", value: "gpt-4.1-mini" },
          { name: "GPT-4.1-nano", value: "gpt-4.1-nano" },
          { name: "o4-mini", value: "o4-mini" },
        ],
        default: config.gptModel,
      },
    ]);

    config.gptModel = answers.gptModel;
    saveConfig();
    console.log(
      chalk.cyan.bold(`\n─────────────── MODEL UPDATED ────────────────`),
    );
    console.log(
      chalk.cyan(`GPT model set to: ${chalk.magenta(answers.gptModel)}`),
    );
    console.log(
      chalk.cyan.bold(`───────────────────────────────────────────────\n`),
    );
  }
}

// Set delay between requests
async function setDelay() {
  const answers = await inquirer.prompt([
    {
      type: "number",
      name: "delay",
      message: "Enter the delay in seconds between requests (0 to disable):",
      default: config.delay,
      validate: (value) => {
        if (isNaN(value) || value < 0) {
          return "Please enter a non-negative number";
        }
        return true;
      },
    },
  ]);

  config.delay = answers.delay;
  saveConfig();
  console.log(
    chalk.cyan.bold(`\n─────────────── DELAY UPDATED ────────────────`),
  );
  console.log(
    chalk.cyan(
      `Delay between requests set to: ${chalk.green(answers.delay)} seconds`,
    ),
  );
  console.log(
    chalk.cyan.bold(`─────────────────────────────────────────────────\n`),
  );
}

// Toggle token display
async function toggleTokenDisplay() {
  config.showTokens = !config.showTokens;
  saveConfig();
  console.log(
    chalk.cyan.bold(`\n─────────────── TOKEN DISPLAY ────────────────`),
  );
  console.log(
    chalk.cyan(
      `Token usage display: ${config.showTokens ? chalk.green("Enabled") : chalk.yellow("Disabled")}`,
    ),
  );
  console.log(
    chalk.cyan.bold(`──────────────────────────────────────────────\n`),
  );
}

// Process images
async function processImages() {
  console.clear();
  const inputDir = config.inputDir;
  const outputDir = config.outputDir;
  const aiModel = config.aiModel;
  const maxTitleChars = parseInt(config.maxTitleChars);
  const maxTags = parseInt(config.maxTags);

  // Validate configuration
  if (!inputDir || !outputDir) {
    console.log(chalk.red.bold(`\n─────────────── ERROR ────────────────`));
    console.log(
      chalk.red(
        `Please set both input and output directories before processing.`,
      ),
    );
    console.log(chalk.red.bold(`───────────────────────────────────────\n`));
    return;
  }

  const apiKey = aiModel === "gpt" ? config.gptApiKey : config.geminiApiKey;
  if (!apiKey) {
    console.log(chalk.red.bold(`\n─────────────── ERROR ────────────────`));
    console.log(
      chalk.red(
        `Please set the ${aiModel === "gpt" ? "GPT" : "Gemini"} API key before processing.`,
      ),
    );
    console.log(chalk.red.bold(`───────────────────────────────────────\n`));
    return;
  }

  if (!fs.existsSync(inputDir)) {
    console.log(chalk.red.bold(`\n─────────────── ERROR ────────────────`));
    console.log(
      chalk.red(`Input directory does not exist: ${chalk.yellow(inputDir)}`),
    );
    console.log(chalk.red.bold(`───────────────────────────────────────\n`));

    const { tryAgain } = await inquirer.prompt([
      {
        type: "list",
        name: "tryAgain",
        message: "Input directory does not exist. What would you like to do?",
        choices: [
          { name: "📂 Set a new input directory", value: "change" },
          { name: "⬅️ Back to main menu", value: "back" },
          { name: "❌ Exit", value: "exit" },
        ],
      },
    ]);

    if (tryAgain === "change") {
      await setInputDirectory();
      await processImages(); // Retry after setting new folder
      return;
    } else if (tryAgain === "exit") {
      await exiftool.end();
      process.exit(0);
    } else {
      return; // back to main menu
    }
  }

  const imageExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  const files = fs.readdirSync(inputDir);

  const imageFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return imageExtensions.includes(ext);
  });

  if (imageFiles.length === 0) {
    console.log(chalk.red.bold(`\n─────────────── ERROR ────────────────`));
    console.log(
      chalk.red(`No image files found in: ${chalk.yellow(inputDir)}`),
    );
    console.log(chalk.red.bold(`───────────────────────────────────────\n`));

    const { tryAgain } = await inquirer.prompt([
      {
        type: "list",
        name: "tryAgain",
        message: "No images found. What would you like to do?",
        choices: [
          { name: "🔁 Choose a different input folder", value: "change" },
          { name: "⬅️ Back to main menu", value: "back" },
          { name: "❌ Exit", value: "exit" },
        ],
      },
    ]);

    if (tryAgain === "change") {
      await setInputDirectory();
      await processImages(); // Retry with new folder
      return;
    } else if (tryAgain === "exit") {
      await exiftool.end();
      process.exit(0);
    } else {
      return; // back to main menu
    }
  }

  // Confirm processing
  const confirmAnswers = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: `Ready to process all images from ${chalk.yellow(inputDir)} to ${chalk.green(outputDir)}?`,
      default: true,
    },
  ]);

  if (confirmAnswers.proceed) {
    console.clear();
    console.log(
      chalk.blue.bold(`\n─────────────── PROCESSING STARTED ────────────────`),
    );
    console.log(chalk.blue(`Processing images from: ${chalk.green(inputDir)}`));
    console.log(chalk.blue(`Output directory: ${chalk.green(outputDir)}`));
    console.log(
      chalk.blue(
        `Using AI: ${chalk.magenta(aiModel === "gpt" ? config.gptModel : config.geminiModel)}`,
      ),
    );
    console.log(
      chalk.blue.bold(`───────────────────────────────────────────────────\n`),
    );

    const startTime = new Date();

    const stats = await processAllImages(
      inputDir,
      outputDir,
      aiModel,
      apiKey,
      maxTitleChars,
      maxTags,
    );

    const endTime = new Date();
    const processingTime = (endTime - startTime) / 1000; // Convert to seconds

    // Clear screen for summary
    console.clear();

    console.log(
      chalk.cyan.bold(`\n─────────────── PROCESSING SUMMARY ────────────────`),
    );

    function formatTime(seconds) {
      const hrs = String(Math.floor(seconds / 3600)).padStart(2, "0");
      const mins = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
      const secs = String(Math.floor(seconds % 60)).padStart(2, "0");
      return `${hrs} hours, ${mins} mins, ${secs} secs`;
    }

    console.log(
      chalk.cyan(
        `Total processing time: ${chalk.yellow(formatTime(processingTime))}`,
      ),
    );
    console.log(
      chalk.cyan(
        `AI Model used: ${chalk.magenta(aiModel === "gpt" ? config.gptModel : config.geminiModel)}`,
      ),
    );
    console.log(chalk.cyan(`Total images: ${chalk.white(stats.total)}`));
    console.log(
      chalk.cyan(
        `Successfully processed: ${chalk.green(stats.success)} images`,
      ),
    );
    if (stats.failed > 0) {
      console.log(
        chalk.cyan(`Failed to process: ${chalk.red(stats.failed)} images`),
      );
    }

    console.log(
      chalk.cyan.bold(`───────────────────────────────────────────────────\n`),
    );

    // Pause before returning to main menu
    await inquirer.prompt([
      {
        type: "input",
        name: "continue",
        message: chalk.yellow("Press Enter to return to the main menu..."),
      },
    ]);
  }
}

// Input/Output Settings Menu
async function showInputOutputMenu() {
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Input/Output Settings:",
      choices: [
        { name: "📁 Set input directory", value: "setInputDir" },
        { name: "📁 Set output directory", value: "setOutputDir" },
        { name: "⬅️ Back to main menu", value: "back" },
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
    case "back":
      return; // Return to main menu
  }

  // Show this menu again
  await showInputOutputMenu();
}

// Metadata Settings Menu
async function showMetadataMenu() {
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Metadata Settings:",
      choices: [
        { name: "📏 Set max title characters", value: "setMaxTitleChars" },
        { name: "🏷️ Set max tags", value: "setMaxTags" },
        { name: "⏱️ Set delay between requests", value: "setDelay" },
        { name: "🔢 Toggle token usage display", value: "toggleTokenDisplay" },
        { name: "⬅️ Back to main menu", value: "back" },
      ],
    },
  ]);

  switch (answers.action) {
    case "setMaxTitleChars":
      await setMaxTitleChars();
      break;
    case "setMaxTags":
      await setMaxTags();
      break;
    case "setDelay":
      await setDelay();
      break;
    case "toggleTokenDisplay":
      await toggleTokenDisplay();
      break;
    case "back":
      return; // Return to main menu
  }

  // Show this menu again
  await showMetadataMenu();
}

// AI Settings Menu
async function showAiMenu() {
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "AI Provider Settings:",
      choices: [
        { name: "🔑 Set API keys", value: "setApiKeys" },
        { name: "🤖 Select AI to Use", value: "selectAiModel" },
        { name: "📊 Select Model to Use", value: "selectSpecificModel" },
        { name: "⬅️ Back to main menu", value: "back" },
      ],
    },
  ]);

  switch (answers.action) {
    case "setApiKeys":
      await setApiKeys();
      break;
    case "selectAiModel":
      await selectAiModel();
      break;
    case "selectSpecificModel":
      await selectSpecificModel();
      break;
    case "back":
      return; // Return to main menu
  }

  // Show this menu again
  await showAiMenu();
}

// Start the application
showMainMenu();
