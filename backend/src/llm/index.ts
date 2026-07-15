/**
 * LLM provider singleton factory.
 *
 * Returns the configured ExplanationProvider instance.
 * All consuming code imports from this module — never from a concrete
 * provider directly — preserving swappability.
 *
 * To swap providers: change the implementation class here. Zero changes
 * to any route or business logic needed.
 */
import type { ExplanationProvider } from "./ExplanationProvider";
import { GeminiExplanationProvider } from "./GeminiExplanationProvider";

let _provider: ExplanationProvider | null = null;

export function getExplanationProvider(): ExplanationProvider {
  if (!_provider) {
    const apiKey = process.env.GEMINI_API_KEY ?? "";

    if (!apiKey) {
      console.warn(
        "[llm] GEMINI_API_KEY is not set. LLM synthesis will always use fallback mode."
      );
    }

    // Swap this line to change the LLM provider:
    _provider = new GeminiExplanationProvider(apiKey || "MISSING_KEY");
  }
  return _provider;
}
