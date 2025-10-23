import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  deleteRobotPosition,
  getCurrentPosition,
  postRobotPosition,
  RobotPositionPayload,
  updateCurrentPosition,
} from "@/services/apiService";
import wsRobotService from "@/services/wsRobotService";
import { FontAwesome } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Picker } from "@react-native-picker/picker";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

// ---- configurable (UI-only) ----
const ACTION_CODES = {
  FORWARD: 1,
  BACKWARD: 2,
  LEFT: 3,
  RIGHT: 4,
  STOP: 0,
} as const;
const PLACES = [
  { key: "starting", label: "Start Point" },
  { key: "table1", label: "Table 1" },
  { key: "table2", label: "Table 2" },
  { key: "table3", label: "Table 3" },
];
const VALID_POS = new Set(["starting", "table1", "table2", "table3"]);

const STORAGE_KEY = "robot_seq_payload";
const REVERSE_MAP: Record<number, number> = {
  [ACTION_CODES.FORWARD]: ACTION_CODES.BACKWARD,
  [ACTION_CODES.BACKWARD]: ACTION_CODES.FORWARD,
  [ACTION_CODES.LEFT]: ACTION_CODES.RIGHT,
  [ACTION_CODES.RIGHT]: ACTION_CODES.LEFT,
  [ACTION_CODES.STOP]: ACTION_CODES.STOP,
};
// --------------------------------

type Step = { cmd: number; val: number };
type SavedPayload = { type: "sequence"; seq: string; from: string; to: string };

const routeKey = (from: string, to: string) => `${STORAGE_KEY}:${from}->${to}`;

export default function HomeScreen() {
  const [seqParts, setSeqParts] = useState<Step[]>([]);
  const [units, setUnits] = useState<string>("1");
  const [fromKey, setFromKey] = useState<string>(PLACES[0].key);
  const [toKey, setToKey] = useState<string>(PLACES[1].key);
  const [saving, setSaving] = useState<boolean>(false);

  const [wsOk, setWsOk] = useState<boolean>(false);
  const [espOk, setEspOk] = useState<boolean>(false);
  const overallOk = wsOk && espOk;
  const [lowbat, setLowbat] = useState<boolean | null>(false);

  // anti-spam window
  const [disabledUntil, setDisabledUntil] = useState<number>(0);
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const locked = nowTs < disabledUntil;

  const alertedRef = useRef(false);
  const sentHelloRef = useRef(false);

  const batIcon =
    lowbat === null
      ? "battery-quarter"
      : lowbat
      ? "battery-empty"
      : "battery-full";
  const batColor = lowbat === null ? "#f1c40f" : lowbat ? "#e74c3c" : "#2ecc71";

  const seqString = useMemo(
    () =>
      seqParts.length
        ? seqParts.map((p) => `${p.cmd},${p.val}`).join(":") + ":"
        : "",
    [seqParts]
  );

  const toSeqString = (parts: Step[]) =>
    parts.length ? parts.map((p) => `${p.cmd},${p.val}`).join(":") + ":" : "";

  const isValidPos = (v: string) => VALID_POS.has(v?.toLowerCase?.() || "");

  const parseSeq = (seq: string): Step[] =>
    seq
      .split(":")
      .filter(Boolean)
      .map((pair) => {
        const [c, v] = pair.split(",");
        return { cmd: Number(c), val: Number(v) } as Step;
      });

  const reverseSeq = (seq: string): string => {
    const steps = parseSeq(seq)
      .reverse()
      .map(({ cmd, val }) => ({ cmd: REVERSE_MAP[cmd] ?? cmd, val }));
    return toSeqString(steps);
  };

  useEffect(() => {
    (async () => {
      try {
        const cur = (await getCurrentPosition())?.toLowerCase?.();
        if (cur && VALID_POS.has(cur)) setFromKey(cur);
      } catch {}
    })();
  }, []);

  const compressConsecutive = (parts: Step[]): Step[] => {
    const out: Step[] = [];
    for (const p of parts) {
      if (p.cmd === ACTION_CODES.FORWARD || p.cmd === ACTION_CODES.BACKWARD) {
        const last = out[out.length - 1];
        if (last && last.cmd === p.cmd)
          last.val = Number(last.val) + Number(p.val);
        else out.push({ ...p });
      } else out.push({ ...p });
    }
    return out;
  };

  const singleActionSeconds = (cmd: number, val: number) => {
    if (cmd === ACTION_CODES.LEFT || cmd === ACTION_CODES.RIGHT) return 5;
    if (cmd === ACTION_CODES.STOP) return 0;
    return Math.max(0, Number.isFinite(val) ? +val : 0);
  };
  const partsSeconds = (parts: Step[]) =>
    parts.reduce((s, p) => s + singleActionSeconds(p.cmd, p.val), 0);

  const getWsStatus = (): boolean =>
    Boolean(wsRobotService.isConnected?.() ?? false);

  const promptRetry = () => {
    if (alertedRef.current) return;
    alertedRef.current = true;
    Alert.alert(
      "WebSocket not connected",
      "Retry connecting to the robot?",
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => (alertedRef.current = false),
        },
        {
          text: "Retry",
          onPress: () => {
            try {
              wsRobotService.connect((msg: any) => console.log("[WS]", msg));
            } catch {}
            setTimeout(() => {
              setWsOk(getWsStatus());
              alertedRef.current = false;
            }, 300);
          },
        },
      ],
      { cancelable: true }
    );
  };

  useEffect(() => {
    wsRobotService.connect((msg: any) => {
      try {
        console.log("[WS] Msg:", msg);
        if (msg?.type === "status") {
          if (msg.ws === "CONNECTED") {
            setWsOk(true);
            if (!sentHelloRef.current || !espOk) {
              wsRobotService.sendControllerConnected(); // ensure hello
              sentHelloRef.current = true;
            }
          }
          if (msg.ws === "DISCONNECTED") {
            setWsOk(false);
            sentHelloRef.current = false;
          }
          if (msg.esp32 === "CONNECTED") setEspOk(true);
          if (msg.esp32 === "DISCONNECTED") setEspOk(false);
          if (msg.mega === "READY") setEspOk(true);
        }

        if (typeof msg.lowbat === "boolean") {
          setLowbat(msg.lowbat);
        } else if (typeof msg.battery === "string") {
          setLowbat(msg.battery.toUpperCase() === "LOW");
        }
      } catch {}
    });

    const iv = setInterval(() => {
      const ok = getWsStatus();
      setWsOk(ok);
      if (ok && !sentHelloRef.current) {
        wsRobotService.sendControllerConnected(); // resend once post-connect
        sentHelloRef.current = true;
      }
      if (!ok) {
        sentHelloRef.current = false;
        promptRetry();
      }
    }, 1500);

    const tick = setInterval(() => setNowTs(Date.now()), 250);

    return () => {
      clearInterval(iv);
      clearInterval(tick);
      try {
        wsRobotService.close();
      } catch {}
    };
  }, []);

  const guardedSend = (seq: string) => {
    if (!getWsStatus()) {
      promptRetry();
      return false;
    }
    try {
      wsRobotService.sendSequence(seq);
      try {
        (wsRobotService as any)?.["sendRaw" as any]?.({
          type: "ack",
          event: "sequence",
          value: seq,
        });
      } catch {}
      return true;
    } catch {
      setWsOk(false);
      promptRetry();
      return false;
    }
  };

  // ---- NEW: Door sender ----
  const sendDoor = (index: 1 | 2 | 3, action: "open" | "close" = "open") => {
    if (!getWsStatus()) {
      promptRetry();
      return;
    }
    try {
      // primary JSON event
      (wsRobotService as any)?.["sendRaw" as any]?.({
        type: "door",
        index,
        action,
      });
      // fallback raw text understood by Mega path via ESP32
      try {
        (wsRobotService as any)?.["sendRaw" as any]?.(
          `DOOR${index} ${action.toUpperCase()}`
        );
      } catch {}
    } catch {
      setWsOk(false);
      promptRetry();
    }
  };

  const setDelayForSingle = (cmd: number, val: number) => {
    if (cmd === ACTION_CODES.STOP) return;
    const delayMs = (singleActionSeconds(cmd, val) + 2) * 1000;
    setDisabledUntil(Date.now() + delayMs);
  };
  const setDelayForSequenceParts = (parts: Step[]) => {
    const delayMs = (partsSeconds(parts) + 2) * 1000;
    setDisabledUntil(Date.now() + delayMs);
  };
  const setDelayForSequenceStr = (seq: string) =>
    setDelayForSequenceParts(parseSeq(seq));

  const maybeWarnLocked = () => {
    if (!locked) return false;
    const remain = Math.max(0, Math.ceil((disabledUntil - nowTs) / 1000));
    Alert.alert("Please wait", `Next input in ${remain}s.`);
    return true;
  };

  const [savedSeq, setSavedSeq] = useState<string | null>(null);
  const refreshSaved = async () => {
    try {
      const v1 = await AsyncStorage.getItem(routeKey(fromKey, toKey));
      if (v1) return setSavedSeq(JSON.parse(v1)?.seq ?? null);
      const legacy = await AsyncStorage.getItem(STORAGE_KEY);
      if (legacy) {
        const p = JSON.parse(legacy) as SavedPayload;
        if (p.from === fromKey && p.to === toKey)
          return setSavedSeq(p.seq || null);
      }
      setSavedSeq(null);
    } catch {
      setSavedSeq(null);
    }
  };
  useEffect(() => {
    refreshSaved();
  }, [fromKey, toKey]);

  const addStep = (cmd: number) => {
    if (cmd !== ACTION_CODES.STOP && maybeWarnLocked()) return;

    if (cmd === ACTION_CODES.STOP) {
      guardedSend(`${cmd},0`);
      return;
    }

    if (cmd === ACTION_CODES.LEFT || cmd === ACTION_CODES.RIGHT) {
      const val = 0;
      const next = [...seqParts, { cmd, val }];
      setSeqParts(next);
      setDelayForSingle(cmd, val);
      guardedSend(`${cmd},${val}`);
      return;
    }

    const n = Number(units);
    if (!Number.isFinite(n) || n < 0) {
      Alert.alert("Invalid units", "Enter a non-negative number.");
      return;
    }
    const next = [...seqParts, { cmd, val: n }];
    setSeqParts(next);
    setDelayForSingle(cmd, n);
    guardedSend(`${cmd},${n}`);
  };

  const resetAll = async () => {
    if (maybeWarnLocked()) return;

    if (seqParts.length) {
      const reversed: Step[] = [...seqParts]
        .reverse()
        .map(({ cmd, val }) => ({ cmd: REVERSE_MAP[cmd] ?? cmd, val }));
      const revSeq = toSeqString(reversed);
      setDelayForSequenceParts(reversed);
      guardedSend(revSeq);
    }

    setSeqParts([]);
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}
  };

  const buildCompressedPayload = (): RobotPositionPayload => {
    const compressedParts = compressConsecutive(seqParts);

    const steps = compressedParts.map((s) => ({
      action: s.cmd,
      seconds: singleActionSeconds(s.cmd, s.val),
    }));

    return {
      fromKey,
      toKey,
      movementJson: JSON.stringify({ steps }),
    };
  };

  const saveLocalFirst = async (_payloadToSave: RobotPositionPayload) => {
    if (!seqParts.length) {
      Alert.alert("Empty sequence", "Add at least one step.");
      return false;
    }
    try {
      const p = JSON.stringify({
        type: "sequence",
        seq: seqString,
        from: fromKey,
        to: toKey,
      });
      await AsyncStorage.setItem(STORAGE_KEY, p);
      await AsyncStorage.setItem(routeKey(fromKey, toKey), p);
      await refreshSaved();
      return true;
    } catch (e: any) {
      Alert.alert("Local save failed", String(e?.message || e));
      return false;
    }
  };

  const postToApi = async (payloadToSave: RobotPositionPayload) => {
    try {
      await postRobotPosition(payloadToSave);
      return true;
    } catch (e: any) {
      Alert.alert("API save failed", String(e?.message || e));
      return false;
    }
  };

  const handleSave = async () => {
    if (saving) return;

    if (fromKey === toKey) {
      Alert.alert("Invalid route", "From and To cannot be the same.");
      return;
    }
    if (!VALID_POS.has(fromKey) || !VALID_POS.has(toKey)) {
      Alert.alert("Invalid position", "Select valid From/To positions.");
      return;
    }

    const compressedPayload = buildCompressedPayload();
    setSaving(true);
    const okLocal = await saveLocalFirst(compressedPayload);
    let okApi = false;
    if (okLocal) okApi = await postToApi(compressedPayload);
    setSaving(false);

    if (okLocal && okApi) {
      setSeqParts([]);

      try {
        await updateCurrentPosition(toKey.toLowerCase());
      } catch {}

      try {
        (wsRobotService as any)?.["sendRaw" as any]?.({
          type: "current_position",
          value: toKey.toLowerCase(),
        });
      } catch {}

      setFromKey(toKey.toLowerCase());
    }
  };

  const moveSaved = () => {
    if (maybeWarnLocked()) return;
    if (!savedSeq) {
      Alert.alert("No saved route", "No saved sequence for this route.");
      return;
    }
    setDelayForSequenceStr(savedSeq);
    guardedSend(savedSeq);
  };

  const returnSaved = () => {
    if (maybeWarnLocked()) return;
    if (!savedSeq) {
      Alert.alert("No saved route", "No saved sequence for this route.");
      return;
    }
    const rev = reverseSeq(savedSeq);
    setDelayForSequenceStr(rev);
    guardedSend(rev);
  };

  // ---- NEW: delete saved (local + API) ----
  const clearLocalForRoute = async () => {
    try {
      await AsyncStorage.removeItem(routeKey(fromKey, toKey));
      const legacy = await AsyncStorage.getItem(STORAGE_KEY);
      if (legacy) {
        const p = JSON.parse(legacy) as SavedPayload;
        if (p?.from === fromKey && p?.to === toKey) {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {}
  };

  const deleteSaved = async () => {
    if (!savedSeq) {
      Alert.alert("No saved route", "Nothing to delete for this route.");
      return;
    }
    Alert.alert(
      "Delete saved route",
      `Delete "${fromKey}" → "${toKey}" from API and local storage?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteRobotPosition({ fromKey, toKey });
            } catch {}
            await clearLocalForRoute();
            setSavedSeq(null);
            Alert.alert("Deleted", "Saved route deleted on API and locally.");
          },
        },
      ]
    );
  };

  const handleFromChange = async (val: string) => {
    const v = val.toLowerCase();
    setFromKey(v);
    if (!VALID_POS.has(v)) return;
    try {
      await updateCurrentPosition(v);
    } catch {}
  };

  const Header = (
    <>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Robot Controller</ThemedText>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            marginLeft: 8,
            backgroundColor: overallOk ? "#2ecc71" : "#e74c3c",
          }}
        />
        <View
          style={{ flexDirection: "row", alignItems: "center", marginLeft: 8 }}
        >
          <FontAwesome name={batIcon} size={16} color={batColor} />
        </View>
      </ThemedView>

      {/* NEW: Doors */}
      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Doors</ThemedText>
        <View style={styles.row}>
          <TouchableOpacity
            style={styles.doorBtn}
            onPress={() => sendDoor(1, "open")}
          >
            <FontAwesome name="unlock-alt" size={16} color="#EAEAEA" />
            <ThemedText style={{ marginLeft: 8 }}>Open 1</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.doorBtn}
            onPress={() => sendDoor(2, "open")}
          >
            <FontAwesome name="unlock-alt" size={16} color="#EAEAEA" />
            <ThemedText style={{ marginLeft: 8 }}>Open 2</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.doorBtn}
            onPress={() => sendDoor(3, "open")}
          >
            <FontAwesome name="unlock-alt" size={16} color="#EAEAEA" />
            <ThemedText style={{ marginLeft: 8 }}>Open 3</ThemedText>
          </TouchableOpacity>
        </View>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Route</ThemedText>
        <View style={styles.row}>
          <View style={styles.pickerWrap}>
            <ThemedText>From</ThemedText>
            <Picker
              selectedValue={fromKey}
              onValueChange={handleFromChange}
              dropdownIconColor="#EAEAEA"
              style={styles.picker}
              itemStyle={styles.pickerItem}
            >
              {PLACES.map((p) => (
                <Picker.Item
                  key={p.key}
                  label={p.label}
                  value={p.key}
                  color="#1A1A1A"
                />
              ))}
            </Picker>
          </View>
          <View style={styles.pickerWrap}>
            <ThemedText>To</ThemedText>
            <Picker
              selectedValue={toKey}
              onValueChange={setToKey}
              dropdownIconColor="#EAEAEA"
              style={styles.picker}
              itemStyle={styles.pickerItem}
            >
              {PLACES.map((p) => (
                <Picker.Item
                  key={p.key}
                  label={p.label}
                  value={p.key}
                  color="#1A1A1A"
                />
              ))}
            </Picker>
          </View>
        </View>

        <View style={[styles.row, { marginTop: 8 }]}>
          <TouchableOpacity
            style={[styles.quickBtn, (!savedSeq || locked) && { opacity: 0.5 }]}
            disabled={!savedSeq || locked}
            onPress={moveSaved}
          >
            <ThemedText type="defaultSemiBold">Move</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.quickBtnAlt,
              (!savedSeq || locked) && { opacity: 0.5 },
            ]}
            disabled={!savedSeq || locked}
            onPress={returnSaved}
          >
            <ThemedText type="defaultSemiBold">Return</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickBtnDanger, !savedSeq && { opacity: 0.5 }]}
            disabled={!savedSeq}
            onPress={deleteSaved}
          >
            <ThemedText type="defaultSemiBold">Delete</ThemedText>
          </TouchableOpacity>
        </View>
        {savedSeq ? (
          <ThemedText style={{ marginTop: 6 }} selectable>
            Saved: {savedSeq}
          </ThemedText>
        ) : (
          <ThemedText style={{ marginTop: 6 }}>
            No saved sequence for this route
          </ThemedText>
        )}
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Units</ThemedText>
        <View style={styles.row}>
          <TextInput
            keyboardType="numeric"
            value={units}
            onChangeText={setUnits}
            style={styles.input}
            placeholder="e.g. 3"
          />
          <ThemedText>Distance or time per step</ThemedText>
        </View>
      </ThemedView>

      <ThemedView style={styles.card}>
        <ThemedText type="subtitle">Controls</ThemedText>

        <View style={styles.padRow}>
          <TouchableOpacity
            style={[styles.btn, locked && { opacity: 0.5 }]}
            disabled={locked}
            onPress={() => addStep(ACTION_CODES.FORWARD)}
            accessibilityLabel="Forward"
          >
            <FontAwesome name="arrow-up" size={28} color="#EAEAEA" />
          </TouchableOpacity>
        </View>

        <View style={styles.padRow}>
          <TouchableOpacity
            style={[styles.btn, locked && { opacity: 0.5 }]}
            disabled={locked}
            onPress={() => addStep(ACTION_CODES.LEFT)}
            accessibilityLabel="Left"
          >
            <FontAwesome name="arrow-left" size={28} color="#EAEAEA" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.stop]}
            onPress={() => addStep(ACTION_CODES.STOP)}
            accessibilityLabel="Stop"
          >
            <FontAwesome name="stop" size={26} color="#FF6B6B" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, locked && { opacity: 0.5 }]}
            disabled={locked}
            onPress={() => addStep(ACTION_CODES.RIGHT)}
            accessibilityLabel="Right"
          >
            <FontAwesome name="arrow-right" size={28} color="#EAEAEA" />
          </TouchableOpacity>
        </View>

        <View style={styles.padRow}>
          <TouchableOpacity
            style={[styles.btn, locked && { opacity: 0.5 }]}
            disabled={locked}
            onPress={() => addStep(ACTION_CODES.BACKWARD)}
            accessibilityLabel="Backward"
          >
            <FontAwesome name="arrow-down" size={28} color="#EAEAEA" />
          </TouchableOpacity>
        </View>

        {locked ? (
          <ThemedText style={{ textAlign: "center", marginTop: 6 }}>
            Next input in{" "}
            {Math.max(0, Math.ceil((disabledUntil - nowTs) / 1000))}s
          </ThemedText>
        ) : null}
      </ThemedView>

      <ThemedView style={styles.card}>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.save} onPress={handleSave}>
            <ThemedText type="defaultSemiBold">
              {saving ? "Saving..." : "Save (local → API)"}
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity style={styles.reset} onPress={resetAll}>
            <ThemedText type="defaultSemiBold">Reset</ThemedText>
          </TouchableOpacity>
        </View>

        <ThemedText type="subtitle">Sequence string</ThemedText>
        <ThemedText selectable style={styles.seqBox}>
          {seqString || "(empty)"}
        </ThemedText>

        <ThemedText type="subtitle">Steps</ThemedText>
      </ThemedView>
    </>
  );

  const renderStep = ({ item, index }: { item: Step; index: number }) => {
    const label =
      Object.entries(ACTION_CODES).find(([, v]) => v === item.cmd)?.[0] ||
      String(item.cmd);
    return (
      <View style={styles.stepRow}>
        <ThemedText>
          {index + 1}. {label} → {item.val}
        </ThemedText>
      </View>
    );
  };

  return (
    <FlatList
      data={seqParts}
      keyExtractor={(_, i) => String(i)}
      renderItem={renderStep}
      ListHeaderComponent={Header}
      ListEmptyComponent={
        <ThemedText style={{ marginHorizontal: 4 }}>No steps yet</ThemedText>
      }
      contentContainerStyle={styles.screen}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    padding: 16,
    paddingTop: 36,
    gap: 12,
    backgroundColor: "#0B0B0B",
  },
  titleContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
    backgroundColor: "white",
  },
  card: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#141414",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2B2B2B",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    gap: 10,
    marginBottom: 8,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  pickerWrap: {
    flex: 1,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#333",
    backgroundColor: "#1A1A1A",
    justifyContent: "center",
    padding: 4,
  },
  input: {
    flex: 0.5,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#333",
    backgroundColor: "#1C1C1C",
    color: "#EAEAEA",
  },
  btn: {
    minWidth: 90,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: "#222",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#333",
  },
  stop: { backgroundColor: "#3A1F1F", borderColor: "#663333" },
  padRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    marginTop: 4,
  },
  actions: { flexDirection: "row", gap: 12, marginTop: 4 },
  save: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#245C38",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#338a5a",
  },
  reset: {
    width: 120,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#2A2A2A",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#444",
  },
  quickBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#2b3d6b",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#3b4d7b",
  },
  quickBtnAlt: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#5b2d2d",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#7b3d3d",
  },
  quickBtnDanger: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#4a1f1f",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#7b2d2d",
  },
  // NEW: door button style
  doorBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#2a2f3f",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#3b4358",
  },
  seqBox: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#333",
    backgroundColor: "#1A1A1A",
  },
  stepRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2D2D2D",
  },
  picker: {
    color: "#EAEAEA",
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    width: "100%",
  },
  pickerItem: { color: "#EAEAEA", backgroundColor: "#1A1A1A", fontSize: 16 },
});
