import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useWardrobe } from "../WardrobeContext";
import type { RootStackParamList } from "../navigation";
import { colors, radius, spacing } from "../theme";
import type { WardrobeItem } from "../types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function WardrobeScreen() {
  const { items, loading, remove } = useWardrobe();
  const navigation = useNavigation<Nav>();

  function confirmRemove(item: WardrobeItem) {
    Alert.alert("Remove item", `Remove this ${item.subtype}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove(item.id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={
          items.length === 0 ? styles.emptyContainer : styles.list
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Your wardrobe is empty</Text>
              <Text style={styles.emptyBody}>
                Tap “Add item” to scan a tag and photograph a piece. The more you
                add, the better your outfit suggestions get.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onLongPress={() => confirmRemove(item)}
          >
            {item.imageUri ? (
              <Image source={{ uri: item.imageUri }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Text style={styles.thumbPlaceholderText}>
                  {item.category[0]?.toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.subtype}
              </Text>
              <Text style={styles.cardSub} numberOfLines={1}>
                {item.primaryColor} · {item.pattern} · {item.formality}
              </Text>
              <View style={styles.tagRow}>
                {item.seasons.map((s) => (
                  <View key={s} style={styles.tag}>
                    <Text style={styles.tagText}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Pressable>
        )}
      />

      <Pressable
        style={styles.fab}
        onPress={() => navigation.navigate("AddItem")}
      >
        <Text style={styles.fabText}>+ Add item</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 96 },
  emptyContainer: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  empty: { alignItems: "center", gap: spacing.sm },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  emptyBody: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 21,
  },
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  thumb: { width: 84, height: 84 },
  thumbPlaceholder: {
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbPlaceholderText: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.accent,
  },
  cardBody: { flex: 1, padding: spacing.md, gap: 4, justifyContent: "center" },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.text,
    textTransform: "capitalize",
  },
  cardSub: { fontSize: 13, color: colors.muted, textTransform: "capitalize" },
  tagRow: { flexDirection: "row", gap: spacing.xs, marginTop: 2 },
  tag: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagText: { fontSize: 11, color: colors.accent, textTransform: "capitalize" },
  fab: {
    position: "absolute",
    bottom: spacing.xl,
    alignSelf: "center",
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
