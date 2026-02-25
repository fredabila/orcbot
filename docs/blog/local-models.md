# Running OrcBot with Local LLMs: Privacy, Cost, and Autonomy

**A guide to liberating your agent from the cloud using Ollama and OpenAI-compatible local endpoints.**

> **The Vision:** An agent that thinks, plans, and executes entirely on your own hardware. No per-token costs, no data leaving your network, and total control over your intelligence stack.

---

## Why Go Local?

While cloud-based models like GPT-4 and Claude are powerful, they come with trade-offs. Running OrcBot locally changes the game:

1.  **Privacy**: Your internal reasoning, terminal outputs, and sensitive files never leave your machine.
2.  **Cost**: Run autonomous loops for hours or days without worrying about your API bill.
3.  **Speed**: Zero network latency for reasoning steps (especially on powerful local GPUs).
4.  **Offline Capability**: Operate your agent in air-gapped or low-connectivity environments.

---

## 1. Setting Up Ollama

[Ollama](https://ollama.com) is the easiest way to run local models on macOS, Linux, and Windows.

### Installation
1.  Download and install from [ollama.com](https://ollama.com).
2.  Verify it's running by opening your terminal and typing:
    ```bash
    ollama --version
    ```

### Starting the Server
OrcBot expects the Ollama API to be available. On most systems, it starts automatically, but you can ensure it's running with:
```bash
ollama serve
```

---

## 2. Using the OrcBot TUI (Recommended)

OrcBot v2.1 includes a dedicated management interface for Ollama. You don't need to manually pull models or configure YAML if you use the TUI.

1.  Start OrcBot in UI mode:
    ```bash
    orcbot ui
    ```
2.  Navigate to **Manage AI Models**.
3.  Select **Ollama / Local Models**.
4.  If Ollama is offline, select **Start Ollama Server**.
5.  Select **Pull New Model** and enter `llama3` (or `mistral`, `phi3`).
6.  Once downloaded, select **Select Local Model** and choose your model.
7.  Finally, select **Set as Primary Provider**.

---

## 3. Manual Configuration

If you prefer to configure OrcBot via your `.env` or `orcbot.config.yaml` file, use these settings:

### Option A: Via YAML (`~/.orcbot/orcbot.config.yaml`)
```yaml
llmProvider: ollama
ollamaApiUrl: http://localhost:11434
modelName: llama3
```

### Option B: Via Environment Variables (`.env`)
```bash
ORCBOT_LLM_PROVIDER=ollama
ORCBOT_OLLAMA_API_URL=http://localhost:11434
ORCBOT_MODEL_NAME=llama3
```

---

## 4. Native Tool Calling

OrcBot's Ollama provider uses the OpenAI-compatible chat completions format. This means that local models can use **Native Tool Calling**.

When you ask a local model like `llama3` to "Check the weather" or "Read the docs," OrcBot passes structured tool definitions to the local API. The model then returns a structured JSON call, which OrcBot executes.

**Note**: For best results with tool calling, use models designed for it, such as:
*   `llama3`
*   `mistral`
*   `command-r`

---

## 5. Using Other Local Providers (LM Studio, vLLM, LocalAI)

Since OrcBot supports custom base URLs, you can connect to almost any OpenAI-compatible server.

### Example: LM Studio
1.  Open LM Studio and start the **Local Server**.
2.  In OrcBot, set:
    *   `llmProvider: ollama` (we use the ollama provider logic for all local endpoints)
    *   `ollamaApiUrl: http://localhost:1234/v1`
    *   `modelName: <your-loaded-model-name>`

---

## 6. Troubleshooting

| Issue | Potential Cause | Fix |
|-------|-----------------|-----|
| Connection Refused | Ollama server is not running | Run `ollama serve` or start via TUI. |
| Model not found | Model hasn't been pulled | Run `ollama pull <model>` or use the TUI "Pull" menu. |
| Very slow response | Running on CPU only | Ensure you have latest GPU drivers (NVIDIA/Metal) installed. |
| Hallucinations | Model is too small | Try a larger parameter model (e.g., move from 7B to 13B or 70B if VRAM allows). |

---

## Conclusion

Running OrcBot with local LLMs is the ultimate way to achieve **sovereign autonomy**. You get the same high-power reasoning and tool-using capabilities of OrcBot, but with the peace of mind that comes from owning your intelligence.

*Ready to start? Open OrcBot and head to the Models menu!*
