#!/usr/bin/env node

const { program } = require("commander");
const { OpenAI } = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
require("dotenv").config();

// Configuration file path
const CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".cli-ai"
);
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Default configuration
const DEFAULT_CONFIG = {
  defaultModel: "claude",
  systemPrompt: "You are a helpful AI assistant.",
  enabledModels: {
    claude: true,
    chatgpt: true,
  },
};

// Ensure config directory exists and load config
function loadConfig() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
}

// Save configuration
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Promisify readline question
function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

// Cost per milli tokens
const COSTS = {
  openai: {
    "gpt-3.5-turbo": {
      input: 0.0005, // $0.0005 per 1K tokens
      output: 0.0015, // $0.0015 per 1K tokens
    },
  },
  anthropic: {
    "claude-3-7-sonnet-20250219": {
      input: 3,
      output: 15,
    },
    "claude-3-5-sonnet-20241022": {
      input: 3,
      output: 15,
    },
    "claude-3-5-haiku-20241022": {
      input: 0.8,
      output: 4,
    },
    "claude-3-haiku-20240307": {
      input: 0.25,
      output: 1.25,
    },
  },
};

function calculateCost(model, inputTokens, outputTokens) {
  const costs =
    COSTS[model === "chatgpt" ? "openai" : "anthropic"][
      model === "chatgpt" ? "gpt-3.5-turbo" : "claude-3-haiku-20240307"
    ];

  const inputCost = (inputTokens / 1000000) * costs.input;
  const outputCost = (outputTokens / 1000000) * costs.output;
  return inputCost + outputCost;
}

// Handle .env file
function loadEnv() {
  if (!fs.existsSync(".env")) {
    fs.writeFileSync(".env", "");
  }
  return fs.readFileSync(".env", "utf8");
}

function saveEnv(envVars) {
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  fs.writeFileSync(".env", envContent);
}

function parseEnv() {
  const envContent = loadEnv();
  const envVars = {};
  envContent.split("\n").forEach((line) => {
    const [key, value] = line.split("=");
    if (key && value) {
      envVars[key] = value;
    }
  });
  return envVars;
}

// Get available models
function getAvailableModels() {
  const models = [];
  Object.entries(COSTS).forEach(([provider, providerModels]) => {
    Object.keys(providerModels).forEach((model) => {
      models.push({
        provider: provider,
        name: model,
        displayName: `${model} (${
          provider === "openai" ? "OpenAI" : "Anthropic"
        })`,
      });
    });
  });
  return models;
}

program.name("ai").description("My awesome CLI tool").version("1.0.0");

program
  .command("greet <name>")
  .description("Greet someone")
  .action((name) => {
    console.log(`Hello, ${name}!`);
  });

program
  .command("setup")
  .description("Configure AI models, system prompt, and API keys")
  .action(async () => {
    const config = loadConfig();
    const envVars = parseEnv();
    const availableModels = getAvailableModels();

    console.log("\n=== AI CLI Setup ===\n");

    // Configure API keys
    console.log("API Key Configuration:");
    console.log(
      "(Press Enter to keep existing value or leave blank to remove)\n"
    );

    const openaiKey = await question("Enter OpenAI API Key: ");
    if (openaiKey !== "") {
      envVars.OPENAI_API_KEY = openaiKey;
    }

    const anthropicKey = await question("Enter Anthropic API Key: ");
    if (anthropicKey !== "") {
      envVars.ANTHROPIC_API_KEY = anthropicKey;
    }

    saveEnv(envVars);
    console.log("\nAPI keys saved successfully!");

    // Configure default model
    console.log("\nAvailable models:");
    availableModels.forEach((model, index) => {
      console.log(`${index + 1}. ${model.displayName}`);
    });

    const modelChoice = await question(
      `\nChoose default model (1-${availableModels.length}): `
    );
    const selectedModel = availableModels[parseInt(modelChoice) - 1];
    if (!selectedModel) {
      console.error("Invalid model choice");
      process.exit(1);
    }

    config.defaultModel =
      selectedModel.provider === "openai" ? "chatgpt" : "claude";
    config.defaultModelName = selectedModel.name;

    // Configure system prompt
    console.log("\nCurrent system prompt:", config.systemPrompt);
    const newPrompt = await question(
      "Enter new system prompt (press Enter to keep current): "
    );
    if (newPrompt.trim()) {
      config.systemPrompt = newPrompt;
    }

    saveConfig(config);
    console.log("\nConfiguration saved successfully!");
    rl.close();
  });

program
  .command("ask <question>")
  .description("Ask a question to an AI model")
  .option("-m, --model <model>", "Specify model to use (claude or chatgpt)")
  .action(async (question, options) => {
    const config = loadConfig();
    const model = options.model || config.defaultModel;

    if (!config.enabledModels[model]) {
      console.error(
        `Model ${model} is not enabled. Please run 'ai setup' to enable it.`
      );
      process.exit(1);
    }

    if (!process.env.ANTHROPIC_API_KEY && model === "claude") {
      console.error("Please set ANTHROPIC_API_KEY environment variable");
      process.exit(1);
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    try {
      if (model === "chatgpt") {
        const stream = await openai.chat.completions.create({
          model: config.defaultModelName || "gpt-3.5-turbo",
          messages: [
            { role: "system", content: config.systemPrompt },
            { role: "user", content: question },
          ],
          stream: true,
        });

        let outputTokens = 0;
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          process.stdout.write(content);
          if (content) outputTokens++;
        }

        // Estimate input tokens (rough approximation)
        const inputTokens = Math.ceil(
          (question.length + config.systemPrompt.length) / 4
        );
        const cost = calculateCost(model, inputTokens, outputTokens);
        console.log(
          `\n\nModel used: ${config.defaultModelName}\nCost: $${cost.toFixed(
            6
          )} (Input: ${inputTokens} tokens, Output: ${outputTokens} tokens)`
        );
        process.exit(1);
      } else if (model === "claude") {
        const stream = await anthropic.messages.create({
          model: config.defaultModelName || "claude-3-haiku-20240307",
          max_tokens: 1024,
          system: config.systemPrompt,
          messages: [{ role: "user", content: question }],
          stream: true,
        });

        let outputTokens = 0;
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta") {
            process.stdout.write(chunk.delta.text);
            outputTokens++;
          }
        }

        // Estimate input tokens (rough approximation)
        const inputTokens = Math.ceil(
          (question.length + config.systemPrompt.length) / 4
        );
        const cost = calculateCost(model, inputTokens, outputTokens);
        console.log(
          `\n\nModel used: ${config.defaultModelName}\nCost: $${cost.toFixed(
            6
          )} (Input: ${inputTokens} tokens, Output: ${outputTokens} tokens)`
        );
        process.exit(1);
      } else {
        console.error("Invalid model. Please use 'claude' or 'chatgpt'");
        process.exit(1);
      }
    } catch (error) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

program.parse();
