import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WardrobeItem } from "./types";

const KEY = "wardrobe:items";

export async function loadWardrobe(): Promise<WardrobeItem[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WardrobeItem[]) : [];
  } catch {
    return [];
  }
}

async function save(items: WardrobeItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function addItem(item: WardrobeItem): Promise<WardrobeItem[]> {
  const items = await loadWardrobe();
  const next = [item, ...items];
  await save(next);
  return next;
}

export async function removeItem(id: string): Promise<WardrobeItem[]> {
  const items = await loadWardrobe();
  const next = items.filter((i) => i.id !== id);
  await save(next);
  return next;
}
