// Shared garment vocabulary. Kept in sync with server/src/types.ts.

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
  subtype: string;
  primaryColor: string;
  colors: string[];
  pattern: string;
  material: string;
  formality: Formality;
  seasons: Season[];
  description: string;
}

/** A garment as stored in the user's wardrobe. */
export interface WardrobeItem extends GarmentAttributes {
  id: string;
  code?: string; // scanned barcode / outfit number
  imageUri?: string; // local file URI of the photo
  brand?: string;
  notes?: string;
  createdAt: string; // ISO timestamp
}

export interface Outfit {
  name: string;
  itemIds: string[];
  rationale: string;
  missing: string[];
}

export interface RecommendationResult {
  outfits: Outfit[];
  notes: string;
}
