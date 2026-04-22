import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface AIPoint {
  x: number;
  y: number;
  label: string;
}

export async function inferIllustrationPoints(base64Image: string): Promise<AIPoint[]> {
  try {
    const prompt = `
      Analyze this illustration (likely a stippled or dotted artwork). 
      Identify 500-800 high-importance "anchor points" that are critical for preserving the detail. 
      Focus heavily on:
      - Every visible discrete dot in high-detail areas (helmet, suit seams).
      - Tiny highlight dots that define texture.
      - Sharp corners and joints.
      
      Return the coordinates as percentages (0-100) of image dimensions.
      
      Output JSON format:
      [
        { "x": 12.5, "y": 45.2, "label": "suit_detail" },
        ...
      ]
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "image/png", data: base64Image.split(',')[1] } },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              label: { type: Type.STRING }
            },
            required: ["x", "y", "label"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("AI Inference Error:", error);
    return [];
  }
}
