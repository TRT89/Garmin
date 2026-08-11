/**
 * The language-model abstraction.
 *
 * The coach works entirely without one — see `../render.ts`. A model, when
 * available, only rewrites already-computed results more fluently and helps pick
 * a tool for questions the deterministic router does not recognise. It never
 * calculates anything and never sees the database.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMStatus {
  available: boolean;
  /** Which model is configured. */
  model: string;
  /** Where the server is expected. */
  baseUrl: string;
  /** Plain-language explanation when unavailable, shown in the interface. */
  reason: string | null;
  /** True when the server answers but the configured model is not installed. */
  modelMissing?: boolean;
  /** Models the server does have, to help the athlete fix a mismatch. */
  availableModels?: string[];
}

export interface LLMProvider {
  readonly id: string;
  /** Probe the server. Never throws; reports unavailability instead. */
  status(): Promise<LLMStatus>;
  /** Generate a completion. Only called when `status().available` is true. */
  complete(messages: LLMMessage[], options?: { temperature?: number }): Promise<string>;
}

/**
 * The system prompt.
 *
 * Deliberately strict. The model is handed a JSON result computed by this
 * application's own tested functions, and its only job is to express it. The
 * rules below are what stop it inventing numbers, which is the single biggest
 * risk in putting a language model near training data.
 */
export const SYSTEM_PROMPT = `You are the AI Coach inside a personal endurance-training application. You explain training data to the athlete who owns it.

You will be given a question and a JSON result produced by the application's own analytics functions.

Absolute rules:
1. Use ONLY numbers that appear in the provided JSON. Never estimate, infer, recall or invent a figure. If a number is not in the JSON, it does not exist.
2. Never perform calculations yourself. The application has already done the arithmetic; if a figure you want is not present, say it is not available.
3. If the JSON says data is unavailable, say so plainly and explain what is missing. Do not fill the gap.
4. Name the activities or time periods your answer is based on.
5. Distinguish fact from interpretation. "Your average heart rate was 148 bpm" is a fact; "this suggests improving fitness" is an interpretation, and should be worded as one.
6. Never give medical advice or diagnose anything. You may describe what the data shows and note when a pattern is worth paying attention to.
7. Metrics calculated by this application (training load, aerobic efficiency) are its own, not Garmin's. Values Garmin's device supplied (Training Effect, Body Battery, sleep score) belong to the device. Do not confuse the two.
8. Be concise and concrete. Use short paragraphs, and Markdown tables when comparing figures.
9. Write in British English, in second person, addressing the athlete directly.`;
