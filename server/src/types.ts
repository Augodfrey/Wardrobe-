// Shared garment vocabulary. Kept in sync with app/src/types.ts.

export type GarmentCategory =
  | "top"
  | "bottom"
  | "outerwear"
  | "dress"
  | "footwear"
  | "accessory";

export type Formality = "casual" | "smart-casual" | "business" | "formal";

export type Season = "spring" | "summer" | "fall" | "winter";

/** Attributes inferred by the vision model from a garment photo. */
export interface GarmentAttributes {
  category: GarmentCategory;
  subtype: string; // e.g. "oxford shirt", "chino trousers"
  primaryColor: string; // e.g. "navy"
  colors: string[]; // all notable colors
  pattern: string; // e.g. "solid", "striped", "floral"
  material: string; // best guess, e.g. "cotton" — "unknown" if unclear
  formality: Formality;
  seasons: Season[];
  description: string; // one short human-readable line
}

/** A garment as stored in the user's wardrobe (sent to the recommender). */
export interface WardrobeItem extends GarmentAttributes {
  id: string;
  code?: string; // scanned barcode / outfit number
  brand?: string;
  notes?: string;
}

export interface Outfit {
  name: string;
  itemIds: string[];
  rationale: string;
  /** Pieces the wardrobe is missing that would complete/improve the look. */
  missing: string[];
}

export interface RecommendationResult {
  outfits: Outfit[];
  notes: string;
}
