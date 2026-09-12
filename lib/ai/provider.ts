import { anthropic } from "@ai-sdk/anthropic";

// Provider configuration - swap here to use different LLM providers
// Examples:
// - import { openai } from "@ai-sdk/openai"; export const model = openai("gpt-4");
// - import { google } from "@ai-sdk/google"; export const model = google("gemini-pro");

export const model = anthropic("claude-3-5-sonnet-20241022");
