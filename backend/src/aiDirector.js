const SYSTEM_PROMPT = `You are Equilibrium AI Game Master.
Goal: keep game balanced and force cooperation.
Return strict JSON: {"effectId":"drought|quake|techBoom|pests|richDeposit|energyCrisis","reason":"short"}
Rules:
- If food dominance is too high, prefer drought.
- If wood dominance is too high, prefer pests.
- If pollution > 80, prefer energyCrisis or quake.
- If structures are too low, prefer techBoom or richDeposit.
- Avoid repeating same event many rounds in a row.`;

const EFFECTS = ["drought", "quake", "techBoom", "pests", "richDeposit", "energyCrisis"];

const randomChoice = () => EFFECTS[Math.floor(Math.random() * EFFECTS.length)];

export class AIDirector {
  constructor({ ollamaUrl, ollamaModel }) {
    this.ollamaUrl = ollamaUrl;
    this.ollamaModel = ollamaModel;
    this.history = [];
  }

  fallback(state) {
    if (state.pollution > 85) return { effectId: "energyCrisis", reason: "high pollution fallback", source: "fallback" };
    if (state.resourceTotals.food > state.resourceTotals.wood * 1.4) return { effectId: "drought", reason: "food too high", source: "fallback" };
    if (state.resourceTotals.wood > state.resourceTotals.food * 1.4) return { effectId: "pests", reason: "wood too high", source: "fallback" };
    return { effectId: randomChoice(), reason: "random fallback", source: "fallback" };
  }

  async decideEvent(state) {
    const body = {
      model: this.ollamaModel,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Round state: ${JSON.stringify({ ...state, history: this.history.slice(-4) })}`
        }
      ]
    };

    try {
      const response = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Ollama status ${response.status}`);
      }

      const payload = await response.json();
      const content = payload?.message?.content || "{}";
      const parsed = JSON.parse(content);
      if (!EFFECTS.includes(parsed.effectId)) throw new Error("Invalid effectId");

      this.history.push(parsed.effectId);
      return { ...parsed, source: "ollama" };
    } catch (error) {
      const event = this.fallback(state);
      this.history.push(event.effectId);
      return event;
    }
  }
}
