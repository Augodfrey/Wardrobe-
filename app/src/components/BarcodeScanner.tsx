import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, radius, spacing } from "../theme";

interface Props {
  visible: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
}

/** Full-screen camera modal that reports the first barcode it sees. */
export default function BarcodeScanner({ visible, onScanned, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);
  const [hint, setHint] = useState("Point the camera at the tag's barcode");

  function handleClose() {
    locked.current = false;
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        {!permission?.granted ? (
          <View style={styles.center}>
            <Text style={styles.permText}>
              Camera access is needed to scan tags.
            </Text>
            <Pressable style={styles.button} onPress={requestPermission}>
              <Text style={styles.buttonText}>Grant camera access</Text>
            </Pressable>
            <Pressable onPress={handleClose}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{
                barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "qr"],
              }}
              onBarcodeScanned={({ data }) => {
                if (locked.current) return;
                locked.current = true;
                setHint("Got it!");
                onScanned(data);
              }}
            />
            <View style={styles.overlay} pointerEvents="none">
              <View style={styles.reticle} />
              <Text style={styles.hint}>{hint}</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeText}>Cancel</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.bg,
  },
  permText: { fontSize: 16, color: colors.text, textAlign: "center" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: 240,
    height: 140,
    borderWidth: 3,
    borderColor: "#fff",
    borderRadius: radius.md,
    backgroundColor: "transparent",
  },
  hint: {
    marginTop: spacing.lg,
    color: "#fff",
    fontSize: 15,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  closeBtn: {
    position: "absolute",
    bottom: 48,
    alignSelf: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: radius.lg,
  },
  closeText: { fontSize: 16, fontWeight: "600", color: colors.text },
  button: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  cancel: { color: colors.muted, fontSize: 15 },
});
