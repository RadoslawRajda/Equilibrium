import type { GameContext } from "./gameContextProvider.js";

type AssistantResponseInput = {
  prompt: string;
  context: GameContext;
  ollamaUrl: string;
  ollamaModel: string;
};
const SYSTEM_PROMPT =
  "You are a helpful CryptoCatan assistant focused on rules and practical strategy. " +
  "Always respond in English. " +
  "Response structure: (1) Briefly summarize the current game state in at most 3 sentences. " +
  "(2) Answer the player's prompt directly. " +
  "(3) If the prompt is general, provide 2-3 concrete suggestions based on the current state and explicitly mark them as suggestions, not guaranteed best moves. " +
  "(4) If the prompt asks about rules, explain rules in the context of the current game state and possible actions now. " +
  "Do not invent missing on-chain data.";

async function callOllama(input: AssistantResponseInput): Promise<string> {
  const url = input.ollamaUrl;

  const resp = await fetch(`${url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.ollamaModel || "llama3.2",
      stream: false,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content:
            `Player prompt: ${input.prompt}\n\n` +
            `Summary: ${input.context.summaryText}\n\n` +
            `Context JSON: ${JSON.stringify(input.context)}`
        }
      ]
    })
  });

  if (!resp.ok) {
    throw new Error(`Ollama request failed with ${resp.status}`);
  }

  const data = (await resp.json()) as {
    message?: { content?: string | null };
  };
  const text = data.message?.content?.trim();
  if (!text) throw new Error("Ollama returned empty answer");
  return text;
}

export async function getAssistantAnswer(input: AssistantResponseInput): Promise<string> {
  return await callOllama(input);
}
