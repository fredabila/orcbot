# NVIDIA Provider Integration Guide

This document provides instructions for using the newly added NVIDIA LLM provider in OrcBot.

## Overview

The NVIDIA provider integration allows OrcBot to use NVIDIA's AI models through their API at `https://integrate.api.nvidia.com/v1/chat/completions`. This follows the same patterns as existing providers (OpenAI, Google, Bedrock, and OpenRouter).

## Configuration

### Option 1: Environment Variable

Set the `NVIDIA_API_KEY` environment variable:

```bash
export NVIDIA_API_KEY="your-nvidia-api-key-here"
```

Or add it to your `.env` file in `~/.orcbot/`:

```
NVIDIA_API_KEY=your-nvidia-api-key-here
```

### Option 2: Configuration File

Add the key to your `orcbot.config.yaml`:

```yaml
nvidiaApiKey: your-nvidia-api-key-here
llmProvider: nvidia  # Optional: Set NVIDIA as default provider
modelName: nvidia:moonshotai/kimi-k2.5  # Optional: Set default model
```

### Option 3: Setup Wizard

Run the setup wizard and enter your NVIDIA API key when prompted:

```bash
npm run dev -- setup
```

## Usage

### Using Model Name Prefixes

You can specify NVIDIA models using prefixes:

```yaml
# In config file
modelName: nvidia:moonshotai/kimi-k2.5
# or
modelName: nv:moonshotai/kimi-k2.5
```

### Setting Default Provider

Set NVIDIA as your default provider in the config:

```yaml
llmProvider: nvidia
modelName: moonshotai/kimi-k2.5
```

### Available Models

The default NVIDIA model is `moonshotai/kimi-k2.5`, but you can use any NVIDIA-supported model by specifying it with the `nvidia:` or `nv:` prefix.

## API Details

- **Endpoint**: `https://integrate.api.nvidia.com/v1/chat/completions`
- **Authentication**: Bearer token via Authorization header
- **Message Format**: OpenAI-compatible (same format as OpenAI provider)
- **Max Tokens**: 16384
- **Temperature**: 0.7 (default, consistent with other providers)
- **Top P**: 1.00

## Features

### Automatic Fallback

If the NVIDIA provider fails, OrcBot will automatically fall back to other configured providers in this order:
1. OpenAI
2. Google
3. NVIDIA
4. OpenRouter
5. Bedrock

### Token Tracking

Token usage is automatically tracked for NVIDIA API calls, using the same format as OpenAI (prompt_tokens, completion_tokens, total_tokens).

### Model Name Normalization

The provider automatically strips `nvidia:` and `nv:` prefixes before sending requests to the API, ensuring compatibility with NVIDIA's API expectations.

## Examples

### Basic Usage with NVIDIA Model

```typescript
import { MultiLLM } from './src/core/MultiLLM';

const llm = new MultiLLM({
    nvidiaApiKey: 'your-api-key',
    modelName: 'nvidia:moonshotai/kimi-k2.5'
});

const response = await llm.call('What is artificial intelligence?');
console.log(response);
```

### Using with Agent

```typescript
import { Agent } from './src/core/Agent';
import { ConfigManager } from './src/config/ConfigManager';

const config = new ConfigManager();
config.set('nvidiaApiKey', 'your-api-key');
config.set('llmProvider', 'nvidia');
config.set('modelName', 'moonshotai/kimi-k2.5');

const agent = new Agent(config);
// Agent will now use NVIDIA provider by default
```

## Testing

Run the NVIDIA provider tests:

```bash
npm test -- nvidia-provider.test.ts
```

All tests should pass, verifying:
- ✓ NVIDIA model recognition
- ✓ `nv:` prefix recognition
- ✓ Model name normalization
- ✓ Default model configuration
- ✓ API key validation

## Troubleshooting

### "NVIDIA API key not configured"

Make sure you've set the `NVIDIA_API_KEY` environment variable or configured `nvidiaApiKey` in your config file.

### "NVIDIA API Error: 401"

Your API key is invalid or expired. Check that you've copied it correctly from NVIDIA's console.

### Model not found

Verify that the model name is correct and supported by NVIDIA. Remove any prefixes (`nvidia:` or `nv:`) when checking NVIDIA's documentation.

## Migration Notes

If you were using NVIDIA models through OpenRouter or another provider, you can now use them directly:

**Before:**
```yaml
modelName: openrouter:nvidia/some-model
```

**After:**
```yaml
modelName: nvidia:some-model
```

This provides better error handling, token tracking, and automatic fallback support.
