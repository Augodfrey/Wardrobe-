import Anthropic from "@anthropic-ai/sdk";
import type {
  GarmentAttributes,
  RecommendationResult,
  WardrobeItem,
} from "./types.js";

// Resolves ANTHROPIC_API_KEY from the environment.
const client = new Anthropic();

const MODEL = "claude-opus-4-8";

const CATEGORIES = ["top", "bottom", "outerwear", "dress", "footwear", "accessory"];
const FORMALITIES = ["casual", "smart-casual", "business", "formal"];
const SEASONS = ["spring", "summer", "fall", "winter"];

// JSON schema constrains the vision model to a clean, parseable garment record.
const GARMENT_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: CATEGORIES },
    subtype: { type: "string" },
    primaryColor: { type: "string" },
    colors: { type: "array", items: { type: "string" } },
    pattern: { type: "string" },
    material: { type: "string" },
    formality: { type: "string", enum: FORMALITIES },
    seasons: { type: "array", items: { type: "string", enum: SEASONS } },
    description: { type: "string" },
  },
  required: [
    "category",
    "subtype",
    "primaryColor",
    "colors",
    "pattern",
    "material",
    "formality",
    "seasons",
    "description",
  ],
  additionalProperties: false,
} as const;

type SupportedMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export interface TagInput {
  imageBase64: string;
  mediaType: SupportedMediaType;
  code?: string;
}

/** Analyze a garment photo and return structured wardrobe attributes. */
export async function tagGarment({
  imageBase64,
  mediaType,
  code,
}: TagInput): Promise<GarmentAttributes> {
  const codeHint = code
    ? `\n\nThe item's store tag / product code is "${code}" — include it in your reasoning only if it helps, but do not invent details you cannot see.`
    : "";

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You are a fashion cataloguer. You are given a photo of a single clothing item or accessory. " +
      "Identify it precisely and return its attributes. Judge formality and seasonality from the " +
      "fabric, cut, and styling. If a detail is genuinely unclear (e.g. material), use \"unknown\" " +
      "rather than guessing. Keep the description to one short line.",
    output_config: {
      format: { type: "json_schema", schema: GARMENT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: `Catalogue this garment.${codeHint}`,
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Model returned no text content");
  }
  return JSON.parse(text.text) as GarmentAttributes;
}

const RECOMMENDATION_SCHEMA = {
  type: "object",
  properties: {
    outfits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          itemIds: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
          missing: { type: "array", items: { type: "string" } },
        },
        required: ["name", "itemIds", "rationale", "missing"],
        additionalProperties: false,
      },
    },
    notes: { type: "string" },
  },
  required: ["outfits", "notes"],
  additionalProperties: false,
} as const;

export interface RecommendInput {
  event: string;
  wardrobe: WardrobeItem[];
}

/** Given the wardrobe and an event, propose 2-4 outfits the user can actually wear. */
export async function recommendOutfits({
  event,
  wardrobe,
}: RecommendInput): Promise<RecommendationResult> {
  if (wardrobe.length === 0) {
    return {
      outfits: [],
      notes:
        "Your wardrobe is empty — add a few items first and I'll put outfits together for you.",
    };
  }

  // Only send the model the fields it needs to reason about matches.
  const compactWardrobe = wardrobe.map((i) => ({
    id: i.id,
    category: i.category,
    subtype: i.subtype,
    primaryColor: i.primaryColor,
    colors: i.colors,
    pattern: i.pattern,
    material: i.material,
    formality: i.formality,
    seasons: i.seasons,
    brand: i.brand,
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system:
      "You are a personal stylist. You are given the user's wardrobe (a JSON array, each item with " +
      "a stable `id`) and a description of an event or occasion. Propose 2-4 complete outfits built " +
      "ONLY from items in their wardrobe — reference items by their exact `id`. Consider color harmony, " +
      "formality fit for the occasion, season/weather, and pattern balance. For each outfit, give it a " +
      "short name, list the item ids, explain in one or two sentences why it works, and note any pieces " +
      "they're missing that would complete or elevate the look (empty array if none). Never invent items " +
      "that aren't in the wardrobe. If nothing suits the event, say so honestly in `notes`.",
    output_config: {
      format: { type: "json_schema", schema: RECOMMENDATION_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content:
          `Event: ${event}\n\n` +
          `Wardrobe:\n${JSON.stringify(compactWardrobe, null, 2)}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Model returned no text content");
  }
  return JSON.parse(text.text) as RecommendationResult;
}
