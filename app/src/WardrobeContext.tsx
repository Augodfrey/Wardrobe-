import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as storage from "./storage";
import type { WardrobeItem } from "./types";

interface WardrobeContextValue {
  items: WardrobeItem[];
  loading: boolean;
  add: (item: WardrobeItem) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const WardrobeContext = createContext<WardrobeContextValue | null>(null);

export function WardrobeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    storage
      .loadWardrobe()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  const add = useCallback(async (item: WardrobeItem) => {
    setItems(await storage.addItem(item));
  }, []);

  const remove = useCallback(async (id: string) => {
    setItems(await storage.removeItem(id));
  }, []);

  const value = useMemo(
    () => ({ items, loading, add, remove }),
    [items, loading, add, remove],
  );

  return (
    <WardrobeContext.Provider value={value}>{children}</WardrobeContext.Provider>
  );
}

export function useWardrobe(): WardrobeContextValue {
  const ctx = useContext(WardrobeContext);
  if (!ctx) throw new Error("useWardrobe must be used within WardrobeProvider");
  return ctx;
}
