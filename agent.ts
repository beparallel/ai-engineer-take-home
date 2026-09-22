import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = import.meta.dirname;
const DOCUMENTS = ["antecedents.md", "fiche-biologie.md", "lettre-de-liaison.md"] as const;
export const DEFAULT_MAX_TOKENS = 4096;

const SYSTEM = [
  "Tu codes les séjours hospitaliers en CIM-10 pour le PMSI.",
  "Sois exhaustif : retiens chaque code de la nomenclature qui peut correspondre au dossier.",
  'Réponds uniquement en JSON. Mets les codes CIM-10 retenus dans une liste sous la clé "codes", sans ajouter d’autre texte.',
].join("\n");

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "cim10_codes",
    strict: true,
    schema: {
      type: "object",
      properties: {
        codes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["codes"],
      additionalProperties: false,
    },
  },
};

type Stay = {
  id: string;
  sex: string;
  age: number;
  admissionDate: string;
  dischargeDate: string;
  documents: { filename: string; content: string }[];
};

type ChatMessage = {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
};

type ParsedCodes = {
  codes: string[];
  warning?: string;
};

export type CompletionResult = {
  content: string;
  reasoning: string;
  usage?: unknown;
  providerResponse: unknown;
};

export function parseMaxTokens(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MAX_TOKENS;

  const normalized = value.trim();
  const parsed = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `OPENAI_MAX_TOKENS must be a positive integer no greater than ${Number.MAX_SAFE_INTEGER}; ` +
        `received ${JSON.stringify(value)}.`,
    );
  }
  return parsed;
}

export function parseCodes(content: string): ParsedCodes {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced?.[1] ?? content;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return {
      codes: [],
      warning:
        'Final model content did not contain a JSON object with the expected shape {"codes":[...]}.',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      codes: [],
      warning: `Final model content contained invalid JSON (${detail}); expected {"codes":[...]}.`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("codes" in parsed)) {
    return {
      codes: [],
      warning: 'Final model content JSON did not have the expected shape {"codes":[...]}.',
    };
  }

  const codes = (parsed as { codes: unknown }).codes;
  if (!Array.isArray(codes)) {
    return {
      codes: [],
      warning: 'Model message field "codes" was not an array.',
    };
  }

  const seen = new Set<string>();
  let invalidValues = 0;
  for (const code of codes) {
    if (typeof code !== "string") {
      invalidValues += 1;
      continue;
    }
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z]\d{2}(\.\d{1,2})?$/.test(normalized)) {
      invalidValues += 1;
      continue;
    }
    seen.add(normalized);
  }

  return {
    codes: [...seen],
    ...(invalidValues > 0
      ? { warning: `Ignored ${invalidValues} invalid value(s) in the model's "codes" array.` }
      : {}),
  };
}

function loadEnvFile(): void {
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function isStayMeta(value: unknown): value is Omit<Stay, "documents"> {
  if (!value || typeof value !== "object") return false;
  const stay = value as Record<string, unknown>;
  return (
    typeof stay.id === "string" &&
    typeof stay.sex === "string" &&
    typeof stay.age === "number" &&
    typeof stay.admissionDate === "string" &&
    typeof stay.dischargeDate === "string"
  );
}

async function loadStays(): Promise<Stay[]> {
  const staysDir = join(root, "data", "stays");
  const ids = (await readdir(staysDir)).filter((name) => name.startsWith("stay-")).sort();
  const stays: Stay[] = [];

  for (const id of ids) {
    const dir = join(staysDir, id);
    const meta: unknown = JSON.parse(await readFile(join(dir, "stay.json"), "utf8"));
    if (!isStayMeta(meta) || meta.id !== id) {
      throw new Error(`${id}/stay.json is invalid or its id does not match the directory name.`);
    }
    const documents = [];
    for (const filename of DOCUMENTS) {
      documents.push({
        filename,
        content: (await readFile(join(dir, filename), "utf8")).trim(),
      });
    }
    stays.push({ ...meta, documents });
  }

  return stays;
}

function buildUserMessage(rules: string, stay: Stay): string {
  const record = stay.documents.map((doc) => doc.content).join("\n\n");
  return [`# Coding rules`, rules.trim(), ``, `# Medical record`, record].join("\n");
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  return JSON.stringify(value) ?? String(value);
}

function messageText(message: ChatMessage): string {
  return valueText(message.content);
}

function messageReasoning(message: ChatMessage): string {
  const variants = [valueText(message.reasoning), valueText(message.reasoning_content)].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );
  return variants.join("\n\n");
}

function responsePreview(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "(empty body)";
  return compact.length > 500 ? `${compact.slice(0, 500)}…` : compact;
}

function providerError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (error !== undefined) return JSON.stringify(error);
  if (typeof record.message === "string") return record.message;
  return fallback;
}

export async function complete(
  baseUrl: string,
  model: string,
  user: string,
): Promise<CompletionResult> {
  const maxTokens = parseMaxTokens(process.env.OPENAI_MAX_TOKENS);
  const configuredEffort = process.env.OPENAI_REASONING_EFFORT;
  const reasoningEffort = configuredEffort === undefined ? "none" : configuredEffort.trim();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? "EMPTY"}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: RESPONSE_FORMAT,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach the model endpoint at ${baseUrl} (${detail}). ` +
        "Verify OPENAI_BASE_URL and that the configured provider is running and reachable.",
    );
  }

  const rawBody = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    const contentType = response.headers.get("content-type");
    const typeDetail = contentType ? ` (${contentType})` : "";
    throw new Error(
      `The model endpoint returned HTTP ${response.status} ${response.statusText} ` +
        `with a non-JSON response${typeDetail}. Body: ${responsePreview(rawBody)}`,
    );
  }

  if (!response.ok) {
    const message = providerError(body, responsePreview(rawBody));
    throw new Error(`The model returned HTTP ${response.status}: ${message}`);
  }

  const message =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { choices?: { message?: ChatMessage }[] }).choices?.[0]?.message
      : undefined;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error(
      `The model response does not contain choices[0].message. Response: ${responsePreview(rawBody)}`,
    );
  }
  const usage =
    body && typeof body === "object" && !Array.isArray(body) && "usage" in body
      ? (body as { usage?: unknown }).usage
      : undefined;
  return {
    content: messageText(message),
    reasoning: messageReasoning(message),
    ...(usage !== undefined ? { usage } : {}),
    providerResponse: body,
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "qwen3.5:2b";
  const rules = await readFile(join(root, "data", "coding-rules.md"), "utf8");
  const stays = await loadStays();

  const tracesDir = join(root, "traces");
  await mkdir(tracesDir, { recursive: true });

  const predictions: { id: string; codes: string[] }[] = [];
  for (const stay of stays) {
    const user = buildUserMessage(rules, stay);
    process.stdout.write(`${stay.id} … `);
    const completion = await complete(baseUrl, model, user);
    const { codes, warning } = parseCodes(completion.content);
    predictions.push({ id: stay.id, codes });
    const tracePath = join(tracesDir, `${stay.id}.json`);
    await writeFile(
      tracePath,
      JSON.stringify(
        {
          stayId: stay.id,
          model,
          baseUrl,
          system: SYSTEM,
          user,
          content: completion.content,
          reasoning: completion.reasoning,
          usage: completion.usage ?? null,
          providerResponse: completion.providerResponse,
          codes,
          ...(warning ? { warning } : {}),
        },
        null,
        2,
      ) + "\n",
    );
    process.stdout.write(`${codes.join(" ") || "(no codes)"}\n`);
    if (warning) {
      console.warn(
        `Warning for ${stay.id}: ${warning} See completion trace at traces/${stay.id}.json.`,
      );
    }
  }

  const outputDir = join(root, "output");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "predictions.json"),
    JSON.stringify({ model, baseUrl, stays: predictions }, null, 2) + "\n",
  );
  process.stdout.write(`\nWrote ${predictions.length} stays to output/predictions.json\n`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
