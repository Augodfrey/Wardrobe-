import cors from "cors";
import express from "express";
import { recommendOutfits, tagGarment } from "./claude.js";
import type { WardrobeItem } from "./types.js";

// Load .env if present (Node 20.12+). No-op if the file is missing.
try {
  process.loadEnvFile();
} catch {
  // .env not found — rely on the ambient environment.
}

const app = express();

// Garment photos as base64 are large; lift the body limit well above the default.
app.use(express.json({ limit: "15mb" }));
app.use(cors());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const SUPPORTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

function isSupportedMediaType(value: unknown): value is SupportedMediaType {
  return (
    typeof value === "string" &&
    (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(value)
  );
}

/** Tag a garment from a photo. Body: { imageBase64, mediaType, code? } */
app.post("/api/tag", async (req, res) => {
  const { imageBase64, mediaType, code } = req.body ?? {};
  if (typeof imageBase64 !== "string" || !isSupportedMediaType(mediaType)) {
    return res.status(400).json({
      error: "imageBase64 (string) and a supported mediaType are required",
    });
  }
  try {
    const attributes = await tagGarment({ imageBase64, mediaType, code });
    res.json(attributes);
  } catch (err) {
    console.error("tag failed:", err);
    res.status(502).json({ error: "Failed to tag garment" });
  }
});

/** Recommend outfits. Body: { event, wardrobe: WardrobeItem[] } */
app.post("/api/recommend", async (req, res) => {
  const { event, wardrobe } = req.body ?? {};
  if (typeof event !== "string" || !Array.isArray(wardrobe)) {
    return res
      .status(400)
      .json({ error: "event (string) and wardrobe (array) are required" });
  }
  try {
    const result = await recommendOutfits({
      event,
      wardrobe: wardrobe as WardrobeItem[],
    });
    res.json(result);
  } catch (err) {
    console.error("recommend failed:", err);
    res.status(502).json({ error: "Failed to generate recommendations" });
  }
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`Wardrobe proxy listening on http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "⚠  ANTHROPIC_API_KEY is not set — requests to Claude will fail. " +
        "Copy .env.example to .env and add your key.",
    );
  }
});
