#!/usr/bin/env node

const { program } = require("commander");
const { OpenAI } = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const fsPromises = require("fs").promises;
const readline = require("readline");
const path = require("path");
const chalk = require("chalk");

const CONFIG_FILE = path.join(__dirname, "./config.json");

// Default configuration
const DEFAULT_CONFIG = {
  defaultModel: "gpt-4.1-nano-2025-04-14",
  systemPrompt: "You are a helpful AI assistant.",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  defaultProvider: "anthropic",
};

// Ensure config file exists and load config
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (error) {
    return DEFAULT_CONFIG;
  }
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

async function calculateCost(model, modelProvider, inputTokens, outputTokens) {
  const models = JSON.parse(
    await fsPromises.readFile(path.join(__dirname, "./models.json"), "utf8")
  );

  const costs = models[modelProvider][model];

  const inputCost = (inputTokens / 1000000) * costs.input;
  const outputCost = (outputTokens / 1000000) * costs.output;
  return inputCost + outputCost;
}

// Get available models
async function getAvailableModels() {
  const models = [];
  const data = JSON.parse(
    await fsPromises.readFile(path.join(__dirname, "./models.json"), "utf8")
  );

  Object.entries(data).forEach(([provider, providerModels]) => {
    Object.keys(providerModels).forEach((model) => {
      models.push({
        provider: provider,
        name: model,
        displayName: `${model} (${
          provider === "openai"
            ? chalk.hex("#74AA9C")("OpenAI")
            : chalk.hex("#da7756")("Anthropic")
        })`,
      });
    });
  });

  return models;
}

program
  .name("ai")
  .description("AI code copilot right in your terminal")
  .version("1.0.0");

program
  .command("helloworld")
  .description("Test the installation")
  .action(() => {
    console.log(`Hello world :)`);
    process.exit(0);
  });

program
  .command("setup")
  .description("Configure AI models, system prompt, and API keys")
  .action(async () => {
    const config = loadConfig();
    const availableModels = await getAvailableModels();

    // console.log("\n=== AI CLI Setup ===\n");

    console.log(chalk.blue("┌" + "─".repeat(30) + "┐"));
    console.log(chalk.blue("│") + " ".repeat(30) + chalk.blue("│"));
    console.log(
      chalk.blue("│") + "         AI CLI Setup         " + chalk.blue("│")
    );
    console.log(chalk.blue("│") + " ".repeat(30) + chalk.blue("│"));
    console.log(chalk.blue("└" + "─".repeat(30) + "┘"));

    // Configure API keys
    console.log(
      "API Key Configuration " +
        chalk.red(
          "(warning: API keys will be stored in config.json file inside project's directory):"
        )
    );
    console.log(
      chalk.gray(
        "(Press Enter to keep existing value or leave blank to remove)\n"
      )
    );

    const openaiKey = await question(
      "Enter" + chalk.hex("#74AA9C")(" OpenAI ") + "API Key: "
    );
    if (openaiKey !== "") {
      config.OPENAI_API_KEY = openaiKey;
    }

    const anthropicKey = await question(
      "Enter" + chalk.hex("#da7756")(" Anthropic ") + "API Key: "
    );
    if (anthropicKey !== "") {
      config.ANTHROPIC_API_KEY = anthropicKey;
    }

    saveConfig(config);

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

    config.defaultProvider =
      selectedModel.provider === "openai" ? "openai" : "anthropic";
    config.defaultModel = selectedModel.name;

    // Configure system prompt
    console.log(
      "\nCurrent system prompt:",
      chalk.gray('"' + config.systemPrompt + '"')
    );
    const newPrompt = await question(
      `Enter new system prompt: \n${chalk.gray("(press Enter to keep current)")}\n`
    );
    if (newPrompt.trim()) {
      config.systemPrompt = newPrompt;
    }

    saveConfig(config);
    console.log(chalk.greenBright("\nConfiguration saved successfully!"));
    rl.close();
  });

function formatAndOutputCodeBlock(output, codeFormattingFlag) {
  const codeBlockRegex = /```/g;

  const match = codeBlockRegex.exec(output);

  if (match && !codeFormattingFlag) {
    codeFormattingFlag = true;
    const beforeMatchStart = output.slice(0, match.index);
    const afterMatchStart = output.slice(match.index + match[0].length);
    if (beforeMatchStart) {
      process.stdout.write(beforeMatchStart);
    }

    if (afterMatchStart) {
      process.stdout.write(chalk.green(afterMatchStart));
    }
  } else if (match && codeFormattingFlag) {
    codeFormattingFlag = false;
    const beforeMatchEnd = output.slice(0, match.index);
    const afterMatchEnd = output.slice(match.index + match[0].length);
    if (beforeMatchEnd) {
      process.stdout.write(chalk.green(beforeMatchEnd));
    }

    if (afterMatchEnd) {
      process.stdout.write(afterMatchEnd);
    }
  }

  if (!match) {
    if (codeFormattingFlag) {
      process.stdout.write(chalk.green(output));
    } else {
      process.stdout.write(output);
    }
  }

  return codeFormattingFlag;
}

program
  .command("ask <question>")
  .description("Ask a question to an AI model")
  .option(
    "-m, --model <model>",
    "Specify a model from the list of available models (models.json)"
  )
  .action(async (question, options) => {
    const config = loadConfig();
    const modelName = options.model || config.defaultModel;
    let modelProvider = config.defaultProvider;

    // check if the specified model is available + set the provider (only if the user has specified a model)
    if (options.model) {
      const availableModels = await getAvailableModels();
      const availableModelNames = availableModels.map((model) => model.name);

      // check if the specified model is available
      if (!availableModelNames.find((m) => m === modelName)) {
        console.error(
          `Model ${modelName} not found. Please run 'ai setup' to enable it.`
        );
        process.exit(1);
      }

      modelProvider = availableModels.find(
        (model) => model.name === modelName
      )?.provider;
    }

    // check if the user has set the API keys
    if (!config.ANTHROPIC_API_KEY && modelProvider === "anthropic") {
      console.error("Please set ANTHROPIC_API_KEY environment variable");
      process.exit(1);
    }
    if (!config.OPENAI_API_KEY && modelProvider === "openai") {
      console.error("Please set OPENAI_API_KEY environment variable");
      process.exit(1);
    }

    try {
      let outputTokens = 0;
      let codeFormattingFlag = false;

      if (modelProvider === "openai") {
        const openai = new OpenAI({
          apiKey: config.OPENAI_API_KEY,
        });

        const stream = await openai.chat.completions.create({
          model: config.defaultModelName || "gpt-4.1-nano-2025-04-14",
          messages: [
            { role: "system", content: config.systemPrompt },
            { role: "user", content: question },
          ],
          stream: true,
        });

        for await (const chunk of stream) {
          const output = chunk.choices[0]?.delta?.content || "";

          if (output) {
            codeFormattingFlag = formatAndOutputCodeBlock(
              output,
              codeFormattingFlag
            );
            outputTokens++;
          }
        }
      } else if (modelProvider === "anthropic") {
        const anthropic = new Anthropic({
          apiKey: config.ANTHROPIC_API_KEY,
        });

        const stream = await anthropic.messages.create({
          model: config.defaultModelName || "claude-3-haiku-20240307",
          max_tokens: 1024,
          system: config.systemPrompt,
          messages: [{ role: "user", content: question }],
          stream: true,
        });

        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta") {
            const output = chunk.delta.text;

            if (output) {
              codeFormattingFlag = formatAndOutputCodeBlock(
                output,
                codeFormattingFlag
              );

              outputTokens++;
            }
          }
        }
      } else {
        console.error(
          "Invalid model provider. Please use 'anthropic' or 'openai'"
        );
        process.exit(1);
      }

      // calculating and outputting the costs
      const inputTokens = Math.ceil(
        (question.length + config.systemPrompt.length) / 4
      );

      const cost = await calculateCost(
        modelName,
        modelProvider,
        inputTokens,
        outputTokens
      );

      console.log(
        chalk.gray(
          `\n\nModel used: ${modelName}\nCost: $${cost.toFixed(
            6
          )} (Input: ${inputTokens} tokens, Output: ${outputTokens} tokens)`
        )
      );
      process.exit(0);
    } catch (error) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

program.parse();
