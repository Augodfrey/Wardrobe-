import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import BarcodeScanner from "../components/BarcodeScanner";
import type { AddItemProps } from "../navigation";
import { colors, radius, spacing } from "../theme";
import type {
  Formality,
  GarmentAttributes,
  GarmentCategory,
  Season,
} from "../types";

const CATEGORIES: GarmentCategory[] = [
  "top",
  "bottom",
  "outerwear",
  "dress",
  "footwear",
  "accessory",
];
const FORMALITIES: Formality[] = [
  "casual",
  "smart-casual",
  "business",
  "formal",
];
const SEASONS: Season[] = ["spring", "summer", "fall", "winter"];

function mediaTypeFor(asset: ImagePicker.ImagePickerAsset): api.MediaType {
  const m = asset.mimeType ?? "";
  if (m.includes("png")) return "image/png";
  if (m.includes("webp")) return "image/webp";
  return "image/jpeg";
}

export default function AddItemScreen({ navigation }: AddItemProps) {
  const { add } = useWardrobe();

  const [code, setCode] = useState<string>("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [imageUri, setImageUri] = useState<string | undefined>();
  const [tagging, setTagging] = useState(false);
  const [attrs, setAttrs] = useState<GarmentAttributes | null>(null);
  const [brand, setBrand] = useState("");
  const [notes, setNotes] = useState("");

  async function pickFrom(source: "camera" | "library") {
    const perm =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow access to add a photo.");
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = {
      base64: true,
      quality: 0.5,
      mediaTypes: ["images"],
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setImageUri(asset.uri);
    if (asset.base64) {
      await runTagging(asset.base64, mediaTypeFor(asset));
    }
  }

  async function runTagging(base64: string, mediaType: api.MediaType) {
    setTagging(true);
    try {
      const result = await api.tagGarment({
        imageBase64: base64,
        mediaType,
        code: code || undefined,
      });
      setAttrs(result);
    } catch (err) {
      Alert.alert(
        "Couldn't tag the item",
        err instanceof Error ? err.message : "Please try again.",
      );
    } finally {
      setTagging(false);
    }
  }

  function updateAttr<K extends keyof GarmentAttributes>(
    key: K,
    value: GarmentAttributes[K],
  ) {
    setAttrs((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function toggleSeason(season: Season) {
    if (!attrs) return;
    const has = attrs.seasons.includes(season);
    updateAttr(
      "seasons",
      has
        ? attrs.seasons.filter((s) => s !== season)
        : [...attrs.seasons, season],
    );
  }

  async function handleSave() {
    if (!attrs) return;
    await add({
      ...attrs,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      code: code || undefined,
      imageUri,
      brand: brand || undefined,
      notes: notes || undefined,
      createdAt: new Date().toISOString(),
    });
    navigation.goBack();
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Step 1 — tag code (optional) */}
      <Text style={styles.stepLabel}>1 · Store tag / code (optional)</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Scan or type the tag number"
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
        />
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => setScannerOpen(true)}
        >
          <Text style={styles.secondaryBtnText}>Scan</Text>
        </Pressable>
      </View>

      {/* Step 2 — photo */}
      <Text style={styles.stepLabel}>2 · Photo</Text>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.preview} />
      ) : (
        <View style={[styles.preview, styles.previewPlaceholder]}>
          <Text style={styles.muted}>No photo yet</Text>
        </View>
      )}
      <View style={styles.row}>
        <Pressable
          style={[styles.secondaryBtn, styles.grow]}
          onPress={() => pickFrom("camera")}
        >
          <Text style={styles.secondaryBtnText}>Take photo</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryBtn, styles.grow]}
          onPress={() => pickFrom("library")}
        >
          <Text style={styles.secondaryBtnText}>Choose photo</Text>
        </Pressable>
      </View>

      {/* Step 3 — AI tagging result */}
      {tagging && (
        <View style={styles.taggingBox}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.muted}>Identifying the garment…</Text>
        </View>
      )}

      {attrs && !tagging && (
        <>
          <Text style={styles.stepLabel}>3 · Review &amp; adjust</Text>
          <Text style={styles.aiNote}>
            AI guess — tap to correct anything.
          </Text>

          <Field label="Type">
            <TextInput
              style={styles.input}
              value={attrs.subtype}
              onChangeText={(t) => updateAttr("subtype", t)}
            />
          </Field>

          <Field label="Category">
            <Chips
              options={CATEGORIES}
              selected={[attrs.category]}
              onToggle={(c) => updateAttr("category", c as GarmentCategory)}
            />
          </Field>

          <Field label="Primary color">
            <TextInput
              style={styles.input}
              value={attrs.primaryColor}
              onChangeText={(t) => updateAttr("primaryColor", t)}
            />
          </Field>

          <Field label="Pattern">
            <TextInput
              style={styles.input}
              value={attrs.pattern}
              onChangeText={(t) => updateAttr("pattern", t)}
            />
          </Field>

          <Field label="Material">
            <TextInput
              style={styles.input}
              value={attrs.material}
              onChangeText={(t) => updateAttr("material", t)}
            />
          </Field>

          <Field label="Formality">
            <Chips
              options={FORMALITIES}
              selected={[attrs.formality]}
              onToggle={(f) => updateAttr("formality", f as Formality)}
            />
          </Field>

          <Field label="Seasons">
            <Chips
              options={SEASONS}
              selected={attrs.seasons}
              onToggle={(s) => toggleSeason(s as Season)}
            />
          </Field>

          <Field label="Brand (optional)">
            <TextInput
              style={styles.input}
              value={brand}
              onChangeText={setBrand}
              placeholder="e.g. Uniqlo"
            />
          </Field>

          <Field label="Notes (optional)">
            <TextInput
              style={[styles.input, styles.multiline]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything worth remembering"
              multiline
            />
          </Field>

          <Pressable style={styles.primaryBtn} onPress={handleSave}>
            <Text style={styles.primaryBtnText}>Save to wardrobe</Text>
          </Pressable>
        </>
      )}

      <BarcodeScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(value) => {
          setCode(value);
          setScannerOpen(false);
        }}
      />
    </ScrollView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <Pressable
            key={opt}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onToggle(opt)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xl },
  stepLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.md,
  },
  aiNote: { fontSize: 13, color: colors.accent, marginBottom: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  grow: { flex: 1 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  preview: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  previewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  muted: { color: colors.muted, fontSize: 14 },
  taggingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  field: { gap: spacing.xs, marginTop: spacing.sm },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 14, color: colors.text, textTransform: "capitalize" },
  chipTextActive: { color: "#fff" },
  secondaryBtn: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.accent, fontSize: 15, fontWeight: "600" },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
