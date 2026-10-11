import assert from "node:assert/strict";
import test from "node:test";
import { prepareCompatibleChatPayload, prepareGeminiPayload } from "../src/lib/ai/gemini-config.ts";
import { GEMINI_ROUTER_MODEL_PATH, normalizeChatModelSelection, resolveGeminiRestModelPath } from "../src/lib/ai/models.ts";

const contents = [{ role: "user", parts: [{ text: "Cotiza 100 piezas" }, { inline_data: { mime_type: "image/jpeg", data: "test-image" } }] }];
const deprecated = ["temperature", "topP", "top_p", "topK", "top_k", "candidateCount", "candidate_count", "thinkingBudget", "thinking_budget"];
function googleAccepts(config: Record<string, unknown>) {
    for (const key of deprecated) assert.equal(key in config, false, `Google would reject ${key}`);
    const thinking = config.thinkingConfig as Record<string, unknown> | undefined;
    if (thinking) {
        assert.equal("thinkingBudget" in thinking, false);
        assert.equal("thinking_budget" in thinking, false);
    }
}

test("deprecated fields are removed without changing media, output limits, or JSON schema properties", () => {
    const schema = { type: "OBJECT", properties: { temperature: { type: "NUMBER" }, top_k: { type: "STRING" } } };
    const input = { contents, safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }], generationConfig: {
        temperature: 0.1, top_p: 0.9, topP: 0.9, top_k: 20, topK: 20, candidateCount: 1, candidate_count: 1,
        maxOutputTokens: 200, responseMimeType: "application/json", responseSchema: schema,
        thinkingConfig: { thinkingBudget: 500, includeThoughts: false },
    } };
    const original = JSON.stringify(input);
    const result = prepareGeminiPayload(GEMINI_ROUTER_MODEL_PATH, input);
    googleAccepts(result.generationConfig!);
    assert.equal(result.contents, contents);
    assert.equal(result.safetySettings, input.safetySettings);
    assert.equal(result.generationConfig!.responseSchema, schema);
    assert.equal(result.generationConfig!.maxOutputTokens, 200);
    assert.equal(result.generationConfig!.responseMimeType, "application/json");
    assert.deepEqual(result.generationConfig!.thinkingConfig, { includeThoughts: false, thinkingLevel: "minimal" });
    assert.equal(JSON.stringify(input), original);
});

test("legacy snake-case thinking budgets are converted to a supported level", () => {
    const result = prepareGeminiPayload("models/gemini-3.6-flash", {
        contents, generation_config: { temperature: 0.2, thinking_config: { thinking_budget: 0 } },
    });
    assert.equal("generation_config" in result, false);
    googleAccepts(result.generationConfig!);
    assert.deepEqual(result.generationConfig!.thinkingConfig, { thinkingLevel: "low" });
});

test("3.8 never receives unsupported minimal thinking and explicit supported levels remain valid", () => {
    for (const level of ["minimal", "unsupported", "low", "medium", "high"]) {
        const result = prepareGeminiPayload("models/gemini-3.8-flash", { contents, generationConfig: { thinkingConfig: { thinkingLevel: level } } });
        assert.deepEqual(result.generationConfig!.thinkingConfig, { thinkingLevel: ["low", "medium", "high"].includes(level) ? level : "low" });
    }
});

test("unknown future models use Google defaults and never inherit deprecated budgets or unsupported levels", () => {
    const result = prepareGeminiPayload("models/gemini-future-flash", { contents, generationConfig: {
        temperature: 0, thinkingConfig: { thinkingBudget: 500, thinkingLevel: "minimal" },
    } });
    assert.equal("generationConfig" in result, false);
    assert.equal(result.contents, contents);
    assert.equal("generationConfig" in prepareGeminiPayload("models/gemini-2.5-pro", { contents }), false);
});

test("compatible Gemini and Google endpoints omit sampling but Groq and other providers keep their settings", () => {
    const input = { model: "gemini-3.6-flash", messages: [{ role: "user", content: "Hola" }], temperature: 0.3, top_p: 0.8, stream: false };
    const gemini = prepareCompatibleChatPayload("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", input);
    googleAccepts(gemini);
    assert.equal(gemini.messages, input.messages);
    assert.equal(gemini.model, input.model);
    assert.equal(gemini.stream, false);
    googleAccepts(prepareCompatibleChatPayload("https://proxy.example/v1", input));
    googleAccepts(prepareCompatibleChatPayload("https://generativelanguage.googleapis.com/v1beta/openai", { ...input, model: "future-alias" }));
    const groq = { ...input, model: "llama-3.3-70b-versatile" };
    assert.equal(prepareCompatibleChatPayload("https://api.groq.com/openai/v1", groq), groq);
    assert.equal(prepareCompatibleChatPayload("https://api.openai.com/v1", { ...groq, model: "gpt-4o-mini" }).temperature, 0.3);
});

test("old Gemini 2.5 Flash selections cannot make an outgoing request even through a custom provider", () => {
    for (const model of ["gemini-2.5-flash", "models/gemini-2.5-flash", "gemini:models/gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash-preview"]) {
        assert.equal(resolveGeminiRestModelPath(model), GEMINI_ROUTER_MODEL_PATH);
        assert.match(normalizeChatModelSelection(model), /gemini-3\.1-flash-lite$/);
        assert.throws(() => prepareGeminiPayload(model, { contents }), /deshabilitado/);
        assert.throws(() => prepareCompatibleChatPayload("https://proxy.example/v1", { model }), /deshabilitado/);
    }
});
