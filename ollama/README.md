# Optional local model with Ollama

Ollama is one optional way to run [qwen3.5:4b](https://ollama.com/library/qwen3.5:4b) locally on macOS through an OpenAI-compatible API. You may skip Ollama entirely if you already have another OpenAI-compatible endpoint or prefer to use a provider API.

No GPU is required. The quantized model is about 5 GB and runs directly on the Mac.

## Install and run (optional)

Install the [Homebrew formula](https://formulae.brew.sh/formula/ollama):

```bash
brew install ollama
```

Start Ollama in the foreground:

```bash
ollama serve
```

Keep that terminal open. In a second terminal, download the model:

```bash
ollama pull qwen3.5:2b
```

This command downloads the model weights the first time. The model is then available through the API.

The server listens on `http://127.0.0.1:11434`. The routes used by this prototype are under `/v1` ([OpenAI compatibility](https://ollama.com/blog/openai-compatibility)), and the defaults in `.env.example` point to it.

Ollama's native `POST /api/chat` uses `think: false` and `format` for thinking control and structured output. This prototype instead calls the OpenAI-compatible `POST /v1/chat/completions`, where the documented equivalents are `reasoning_effort: "none"` and `response_format`. They are already configured by the application; no custom Modelfile is needed.

## Verify the port

```bash
curl -s http://127.0.0.1:11434/v1/models
```

The response should list `qwen3.5:2b`. This is the value of `OPENAI_MODEL`.

```bash
curl -s http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5:2b",
    "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
    "max_tokens": 16,
    "temperature": 0,
    "reasoning_effort": "none"
  }'
```

The generated text is in `choices[0].message.content`.

Then run `npm run agent` followed by `npm run eval` from the prototype root.

## Change the port

```bash
OLLAMA_HOST=127.0.0.1:11435 ollama serve
```

In the second terminal, use the same host when downloading the model:

```bash
OLLAMA_HOST=127.0.0.1:11435 ollama pull qwen3.5:2b
```

Use the same port in the prototype's `.env`:

```bash
OPENAI_BASE_URL=http://127.0.0.1:11435/v1
```
