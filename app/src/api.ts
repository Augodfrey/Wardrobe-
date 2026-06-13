import { Platform } from "react-native";
import type {
  GarmentAttributes,
  RecommendationResult,
  WardrobeItem,
} from "./types";

// Where the backend proxy lives. Android emulators reach the host machine via
// 10.0.2.2; iOS simulators and web can use localhost. On a physical device,
// set EXPO_PUBLIC_API_URL to your computer's LAN IP (e.g. http://192.168.1.20:4000).
const DEFAULT_HOST =
  Platform.OS === "android" ? "http://10.0.2.2:4000" : "http://localhost:4000";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_HOST;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error ?? "";
    } catch {
      // ignore
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export type MediaType = "image/jpeg" | "image/png" | "image/webp";

export function tagGarment(input: {
  imageBase64: string;
  mediaType: MediaType;
  code?: string;
}): Promise<GarmentAttributes> {
  return postJson<GarmentAttributes>("/api/tag", input);
}

export function recommendOutfits(input: {
  event: string;
  wardrobe: WardrobeItem[];
}): Promise<RecommendationResult> {
  return postJson<RecommendationResult>("/api/recommend", input);
}
