> [!NOTE]
> This is the starter kit codebase for Parallel's Senior AI Engineer take-home.

# CIM-10 coding agent — V0 prototype

This TypeScript prototype reads four hospital stays, asks a model for CIM-10 codes, then compares its predictions with reference labels.

Requires Node.js **20.11 or newer**.

## Model

`agent.ts` calls an OpenAI-compatible endpoint (`POST /v1/chat/completions`). Model choice is interchangeable: use any compatible local endpoint or provider API.

Copy `.env.example` to `.env`, or export the variables yourself. A variable already present in the environment takes precedence over `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `http://127.0.0.1:11434/v1` | API root, without an endpoint path |
| `OPENAI_API_KEY` | `EMPTY` | Bearer token; set this when required by your provider |
| `OPENAI_MODEL` | `qwen3.5:2b` | Model name returned by `GET /v1/models` |
| `OPENAI_MAX_TOKENS` | `4096` | Maximum completion tokens, shared by provider reasoning and final content |
| `OPENAI_REASONING_EFFORT` | `none` | Standard reasoning control; set it empty to omit the field if a provider does not support it |

For an optional local setup on macOS, see [ollama/README.md](ollama/README.md). Ollama is not required. Any other OpenAI-compatible endpoint can use the same variables; LM Studio displays its local port in the application (often `1234`).

Requests use the standard `response_format` JSON Schema field to require an object containing a string array named `codes`. The default `reasoning_effort=none` prevents thinking models from spending the completion budget before producing that JSON. `OPENAI_MAX_TOKENS=4096` also leaves room for providers that emit reasoning; increase it if a model still ends with `finish_reason: "length"` before final content. No Ollama-native request fields or custom model definition are required.

## Run

```bash
npm ci
cp .env.example .env
npm run agent
npm run eval
```

`npm run agent` writes:

- `output/predictions.json` — selected codes for each stay
- `traces/<stay-id>.json` — the submitted prompt, final `content`, separate `reasoning`,
  token `usage`, and the complete parsed `providerResponse`

Only final `content` is parsed for CIM-10 codes. Provider reasoning is retained for diagnosis
but can never contribute codes to predictions.

`npm run eval` compares these codes with `data/ground-truth.json`. Each stay scores a set overlap, `|predicted ∩ reference| / |predicted ∪ reference|`, with codes compared as unordered sets and an empty union scoring 1. The reported score is the mean of the per-stay overlaps, each stay weighted equally.

## Data

- `data/stays/stay-00N/` — one stay: `stay.json` (patient details and dates), plus `antecedents.md`, `fiche-biologie.md`, and `lettre-de-liaison.md`
- `data/coding-rules.md` — PMSI principles, malnutrition guidance, and the CIM-10 nomenclature injected into the prompt
- `data/ground-truth.json` — reference labels used by `eval.ts`
