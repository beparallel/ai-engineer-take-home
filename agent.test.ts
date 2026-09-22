import assert from "node:assert/strict";
import test from "node:test";

import { complete, DEFAULT_MAX_TOKENS, parseCodes, parseMaxTokens } from "./agent.js";

test("keeps final content separate from provider reasoning and metadata", async () => {
  const providerResponse = {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "test-model",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: '{"codes":["N20.1"]}',
          reasoning: 'Private analysis mentioning {"codes":["E43"]}.',
          reasoning_content: 'More analysis mentioning {"codes":["I10"]}.',
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 15,
      total_tokens: 35,
    },
  };
  const originalFetch = globalThis.fetch;
  const originalEffort = process.env.OPENAI_REASONING_EFFORT;
  const originalMaxTokens = process.env.OPENAI_MAX_TOKENS;
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify(providerResponse), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  process.env.OPENAI_REASONING_EFFORT = "medium";
  delete process.env.OPENAI_MAX_TOKENS;

  try {
    const completion = await complete("http://provider.test/v1", "test-model", "record");

    assert.equal(completion.content, '{"codes":["N20.1"]}');
    assert.match(completion.reasoning, /"codes":\["E43"\]/);
    assert.match(completion.reasoning, /"codes":\["I10"\]/);
    assert.deepEqual(completion.usage, providerResponse.usage);
    assert.deepEqual(completion.providerResponse, providerResponse);
    assert.deepEqual(parseCodes(completion.content).codes, ["N20.1"]);
    assert.deepEqual(parseCodes("").codes, []);
    assert.equal(requestBody?.max_tokens, DEFAULT_MAX_TOKENS);
    assert.equal(requestBody?.reasoning_effort, "medium");
    assert.equal(
      (requestBody?.response_format as { type?: unknown } | undefined)?.type,
      "json_schema",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEffort === undefined) {
      delete process.env.OPENAI_REASONING_EFFORT;
    } else {
      process.env.OPENAI_REASONING_EFFORT = originalEffort;
    }
    if (originalMaxTokens === undefined) {
      delete process.env.OPENAI_MAX_TOKENS;
    } else {
      process.env.OPENAI_MAX_TOKENS = originalMaxTokens;
    }
  }
});

test("parses default and configured max token budgets", () => {
  assert.equal(parseMaxTokens(undefined), 4096);
  assert.equal(parseMaxTokens(" 8192 "), 8192);
});

test("rejects invalid max token budgets with a useful error", () => {
  for (const value of ["", "0", "-1", "1.5", "many", "9007199254740992"]) {
    assert.throws(
      () => parseMaxTokens(value),
      (err) =>
        err instanceof Error &&
        err.message.includes("OPENAI_MAX_TOKENS must be a positive integer") &&
        err.message.includes(JSON.stringify(value)),
    );
  }
});

test("sends a configured max token budget", async () => {
  const originalFetch = globalThis.fetch;
  const originalMaxTokens = process.env.OPENAI_MAX_TOKENS;
  let requestBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: '{"codes":[]}' } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  process.env.OPENAI_MAX_TOKENS = "8192";

  try {
    await complete("http://provider.test/v1", "test-model", "record");
    assert.equal(requestBody?.max_tokens, 8192);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMaxTokens === undefined) {
      delete process.env.OPENAI_MAX_TOKENS;
    } else {
      process.env.OPENAI_MAX_TOKENS = originalMaxTokens;
    }
  }
});

test("does not treat reasoning-only output as final codes", () => {
  const reasoning = '{"codes":["E43"]}';
  const finalContent = "";

  assert.deepEqual(parseCodes(finalContent).codes, []);
  assert.deepEqual(parseCodes(reasoning).codes, ["E43"]);
});
