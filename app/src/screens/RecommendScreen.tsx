import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useWardrobe } from "../WardrobeContext";
import * as api from "../api";
import { colors, radius, spacing } from "../theme";
import type { Outfit, RecommendationResult, WardrobeItem } from "../types";

const SUGGESTIONS = [
  "Job interview at a startup",
  "Dinner date, smart-casual",
  "Weekend brunch with friends",
  "Wedding guest, summer afternoon",
];

export default function RecommendScreen() {
  const { items } = useWardrobe();
  const [event, setEvent] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(items.map((i) => [i.id, i]));

  async function ask() {
    if (!event.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.recommendOutfits({ event: event.trim(), wardrobe: items }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>What's the occasion?</Text>
      <Text style={styles.subtitle}>
        Describe your event and I'll build outfits from your {items.length}
        {items.length === 1 ? " item" : " items"}.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="e.g. Friend's wedding, outdoors, warm evening"
        value={event}
        onChangeText={setEvent}
        multiline
      />

      <View style={styles.suggestRow}>
        {SUGGESTIONS.map((s) => (
          <Pressable key={s} style={styles.suggest} onPress={() => setEvent(s)}>
            <Text style={styles.suggestText}>{s}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.primaryBtn, (!event.trim() || loading) && styles.disabled]}
        onPress={ask}
        disabled={!event.trim() || loading}
      >
        <Text style={styles.primaryBtnText}>
          {loading ? "Thinking…" : "Suggest outfits"}
        </Text>
      </Pressable>

      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Putting looks together…</Text>
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {result?.notes ? <Text style={styles.notes}>{result.notes}</Text> : null}

      {result?.outfits.map((outfit, idx) => (
        <OutfitCard key={idx} outfit={outfit} byId={byId} />
      ))}
    </ScrollView>
  );
}

function OutfitCard({
  outfit,
  byId,
}: {
  outfit: Outfit;
  byId: Map<string, WardrobeItem>;
}) {
  const pieces = outfit.itemIds
    .map((id) => byId.get(id))
    .filter((i): i is WardrobeItem => Boolean(i));

  return (
    <View style={styles.outfitCard}>
      <Text style={styles.outfitName}>{outfit.name}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.pieceRow}>
          {pieces.map((p) => (
            <View key={p.id} style={styles.piece}>
              {p.imageUri ? (
                <Image source={{ uri: p.imageUri }} style={styles.pieceImg} />
              ) : (
                <View style={[styles.pieceImg, styles.piecePlaceholder]}>
                  <Text style={styles.piecePlaceholderText}>
                    {p.category[0]?.toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={styles.pieceLabel} numberOfLines={1}>
                {p.subtype}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <Text style={styles.rationale}>{outfit.rationale}</Text>

      {outfit.missing.length > 0 && (
        <View style={styles.missingBox}>
          <Text style={styles.missingLabel}>Would complete the look:</Text>
          <Text style={styles.missingText}>{outfit.missing.join(", ")}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  title: { fontSize: 24, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
    minHeight: 72,
    textAlignVertical: "top",
  },
  suggestRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  suggest: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestText: { color: colors.accent, fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
  notes: {
    fontSize: 15,
    color: colors.text,
    fontStyle: "italic",
    lineHeight: 21,
  },
  outfitCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  outfitName: { fontSize: 18, fontWeight: "700", color: colors.text },
  pieceRow: { flexDirection: "row", gap: spacing.md },
  piece: { width: 88, gap: spacing.xs },
  pieceImg: { width: 88, height: 88, borderRadius: radius.md },
  piecePlaceholder: {
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  piecePlaceholderText: { fontSize: 24, fontWeight: "700", color: colors.accent },
  pieceLabel: { fontSize: 12, color: colors.muted, textTransform: "capitalize" },
  rationale: { fontSize: 15, color: colors.text, lineHeight: 22 },
  missingBox: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  missingLabel: { fontSize: 13, fontWeight: "600", color: colors.muted },
  missingText: { fontSize: 14, color: colors.text },
});
