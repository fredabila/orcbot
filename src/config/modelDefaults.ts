/**
 * Default model ids used when neither the user's config nor an explicit argument supplies one.
 *
 * These live in one place on purpose. They were previously duplicated across eight files, which
 * is exactly how several of them ended up pointing at retired models — `claude-3-5-haiku-latest`
 * and `google/gemini-2.0-flash-exp:free` were both gone from the provider catalogues while still
 * being handed out as fallbacks.
 *
 * Sources, checked 2026-10-09:
 *   - Anthropic: https://platform.claude.com/docs/en/models/overview (API and Bedrock ids)
 *   - Google:    https://ai.google.dev/gemini-api/docs/models
 *   - OpenAI:    https://platform.openai.com/docs/models
 *   - OpenRouter (free tier + hosted ids): https://openrouter.ai/api/v1/models
 * When refreshing, check that each id still resolves before changing it.
 */
export const DEFAULT_MODEL_IDS = {
    /**
     * Main reasoning model when nothing is configured. OpenAI's own guidance is to start with
     * `gpt-6-astra` (flagship) and offers `gpt-6.1-sol` as the intelligence/cost balance and
     * `gpt-6-luna` for cost-sensitive volume. This sits on the balanced tier rather than the
     * flagship so the default does not silently raise the cost of every call.
     */
    openaiMain: 'gpt-6.1-sol',
    /** Cheap/fast model for classification, JSON repair and probe calls. */
    openaiFast: 'gpt-6-luna',
    /** Anthropic's cheap/fast tier. Note the id uses dashes, not dots. */
    anthropicFast: 'claude-haiku-5-5',
    /** Google's cheap/fast tier; stable id rather than an unverified `-latest` alias. */
    googleFast: 'gemini-3.5-flash-lite',
    /** Multimodal default for audio transcription and image analysis. */
    googleMedia: 'gemini-3.8-flash',
    /**
     * Computer use no longer has a dedicated model: Google's docs now drive it with the
     * current Flash model plus the `computer_use` tool. The previous value,
     * `gemini-2.5-computer-use-preview-10-2025`, is on Google's shut-down list.
     */
    googleComputerUse: 'gemini-3.8-flash',
    /** OpenRouter default when no model is set; free tier. */
    openRouter: 'google/gemma-4-31b-it:free',
    /** Bedrock, mirroring the Anthropic fast pick. `anthropic.` prefix per Anthropic's docs. */
    bedrock: 'bedrock:anthropic.claude-haiku-5-5',
    nvidia: 'nvidia:moonshotai/kimi-k2.5',
    /**
     * Local default. `llama3` was two years old and is not tool-capable, which the whole
     * action loop depends on - MultiLLM warns about exactly this when a local model cannot
     * call tools. Qwen is the family that warning names, at its current release.
     */
    ollama: 'ollama:qwen3.8',
} as const;
