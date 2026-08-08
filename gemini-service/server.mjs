import { GoogleGenAI } from "@google/genai";
import { createApp } from "./app.mjs";

const project = process.env.GOOGLE_CLOUD_PROJECT || "samedaydesk";
const location = process.env.GOOGLE_CLOUD_LOCATION || "global";
const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const port = Number.parseInt(process.env.PORT || "8080", 10);

const ai = new GoogleGenAI({ vertexai: true, project, location });

async function generate({ prompt, schema }) {
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      temperature: 0.1,
      seed: 7,
      maxOutputTokens: 2048,
      labels: { application: "samedaydesk-evidence-miner", surface: "cloud-run-demo" },
    },
  });
  const text = response.text || "";
  try {
    return JSON.parse(text);
  } catch (cause) {
    const finishReason = response.candidates?.[0]?.finishReason || "unknown";
    throw new SyntaxError(
      `Gemini returned invalid JSON (finishReason=${finishReason}, chars=${text.length}).`,
      { cause },
    );
  }
}

const app = createApp({
  generate,
  model,
  project,
  accessKey: process.env.DEMO_ACCESS_KEY || "",
});

app.listen(port, "0.0.0.0", () => {
  console.log(`SameDayDesk Gemini Evidence Miner listening on ${port}`);
});
