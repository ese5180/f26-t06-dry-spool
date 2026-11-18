import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { dashboardUrl, request } from "./account";
import {
  SETUP_SERVICE, configureWifi, connect, readyManager, scanNetworks,
  sendClaim, sleep, waitForButton,
} from "./bluetooth";
import { networkNeedsPassword } from "./wifi-protocol";
import { Action, styles } from "./ui";

export default function Setup({email,signOut,accountError}) {
  const [stage,setStage] = useState("home");
  const [candidates,setCandidates] = useState([]);
  const [networks,setNetworks] = useState([]);
  const [network,setNetwork] = useState(null);
  const [password,setPassword] = useState("");
  const [error,setError] = useState("");
  const [boxes,setBoxes] = useState([]);
  const [changedWifi,setChangedWifi] = useState(false);
  const manager = useRef(null);
  const flow = useRef(null);
  const activeBox = useRef(null);
  const targetSerial = useRef(null);
  const candidateCount = useRef(0);

  async function resetTransport() {
    flow.current?.abort();
    flow.current = null;
    const previous = manager.current;
    manager.current = null;
    activeBox.current = null;
    if (previous) await previous.destroy().catch(() => {});
  }

  useEffect(() => () => { void resetTransport(); },[]);

  useEffect(() => {
    if (stage !== "home") return;
    const controller = new AbortController();
    request("/api/devices",{signal:controller.signal}).then(setBoxes).catch(err => {
      if (!controller.signal.aborted) setError(err.message || "Could not load your boxes.");
    });
    return () => controller.abort();
  },[stage]);

  async function startScan(serial = null) {
    setStage("scan");
    setPassword("");
    setCandidates([]);
    setNetworks([]);
    setNetwork(null);
    setError("");
    const previous = resetTransport();
    const controller = new AbortController();
    flow.current = controller;
    targetSerial.current = serial;
    candidateCount.current = 0;
    try {
      await previous;
      if (controller.signal.aborted) return;
      const radio = await readyManager();
      if (controller.signal.aborted) {
        await radio.destroy();
        return;
      }
      manager.current = radio;
      await radio.startDeviceScan([SETUP_SERVICE],{allowDuplicates:false},(failure,device) => {
        if (controller.signal.aborted) return;
        if (failure) {
          setError("Could not scan for boxes. Check Bluetooth permissions and try again.");
          return;
        }
        if (device) {
          candidateCount.current++;
          setCandidates(list => list.some(item=>item.id === device.id) ? list : [...list,device]);
        }
      });
      await sleep(14_000,controller.signal);
      await radio.stopDeviceScan();
      if (!candidateCount.current) setError("No boxes found. Power the box, press Setup once and scan again.");
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message || "Could not scan. Try again.");
    }
  }

  async function choose(candidate) {
    const radio = manager.current;
    if (!radio) return;
    flow.current?.abort();
    const controller = new AbortController();
    flow.current = controller;
    setStage("connect-ble");
    setError("");
    try {
      await radio.stopDeviceScan();
      const box = await connect(radio,candidate);
      if (controller.signal.aborted) return;
      if (targetSerial.current && box.serial !== targetSerial.current) {
        throw new Error("That is a different box. Press Setup on the box you want to update.");
      }
      activeBox.current = box;
      setStage("confirm");
      await waitForButton(box.device,controller.signal);
      const ownBox = await request("/api/devices/" + encodeURIComponent(box.serial),
        {signal:controller.signal}).catch(err => {
        if (err.status === 404) return null;
        throw err;
      });
      box.owned = Boolean(ownBox);
      if (!box.owned) {
        box.claim = await request("/api/claims",{body:{serial:box.serial},signal:controller.signal});
      }
      await findNetworks(box,controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setStage("scan");
        setError(err.message || "Could not connect. Scan again.");
        await radio.cancelDeviceConnection(candidate.id).catch(() => {});
        activeBox.current = null;
      }
    }
  }

  async function findNetworks(box = activeBox.current, signal = flow.current?.signal) {
    if (!box || !signal) return;
    setStage("network-scan");
    setError("");
    try {
      const list = await scanNetworks(box.device,signal);
      if (signal.aborted) return;
      setNetworks(list);
      setNetwork(null);
      if (!list.length) setError("No supported Wi-Fi networks found. Move the box nearer your router and try again.");
      setStage("networks");
    } catch (err) {
      if (!signal.aborted) {
        setError(err.message || "Could not scan for Wi-Fi.");
        setStage("networks");
      }
    }
  }

  async function finishClaim(box, signal) {
    const expiry = Date.parse(box.claim.expiresAt);
    const until = Math.min(expiry, Date.now() + 90_000);
    while (Date.now() < until) {
      let result;
      try {
        result = await request("/api/claims/" + box.claim.id,{body:{},signal});
      } catch (err) {
        if (signal.aborted || (err.status && err.status < 500)) throw err;
      }
      if (result?.status === "added") return;
      if (result?.status === "claimed") throw new Error("This box was linked to another account.");
      if (result?.status === "expired") break;
      await sleep(3000,signal);
    }
    if (Date.now() >= expiry) throw new Error("The setup attempt expired. Start setup again.");
    throw new Error("The box has not reported yet. Keep it powered, check its internet connection, then check again.");
  }

  async function waitUntilOnline(box, signal) {
    const ends = Date.now() + 90_000;
    while (Date.now() < ends) {
      try {
        const record = await request("/api/devices/" + encodeURIComponent(box.serial),{signal});
        if (record.online && record.ts >= box.wifiStarted - 5000) return;
      } catch (err) {
        if (signal.aborted || (err.status && err.status < 500)) throw err;
      }
      await sleep(3000,signal);
    }
    throw new Error("The Wi-Fi settings were sent, but the box has not reported to DrySpool yet.");
  }

  async function verifyOnline(box, signal) {
    if (!box || !signal || signal.aborted) return;
    setStage("waiting");
    setError("");
    try {
      if (!box.owned && !box.proofSent) {
        await sendClaim(box.device,box.claim.token);
        box.claim.token = null;
        box.proofSent = true;
      }
      if (!box.owned) await finishClaim(box,signal);
      else await waitUntilOnline(box,signal);
      if (!signal.aborted) {
        setChangedWifi(box.owned);
        setStage("done");
        await resetTransport();
      }
    } catch (err) {
      if (!signal.aborted) {
        setError(err.message || "Could not verify that the box came online.");
        setStage("interrupted");
      }
    }
  }

  async function applyWifi() {
    const box = activeBox.current;
    const signal = flow.current?.signal;
    if (!box || !signal || !network) return;
    setStage("connecting");
    setError("");
    try {
      box.wifiStarted = Date.now();
      await configureWifi(box.device,network,password,signal);
    } catch (err) {
      if (!signal.aborted) {
        setError(err.message || "Check the Wi-Fi password and try again.");
        setStage("networks");
      }
      return;
    }
    if (signal.aborted) return;
    setPassword("");
    await verifyOnline(box,signal);
  }

  async function goHome() {
    setPassword("");
    setError("");
    setStage("home");
    await resetTransport();
  }

  function openDashboard() {
    Linking.openURL(dashboardUrl).catch(() => setError("Open DrySpool Dashboard in your browser."));
  }

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.section}>
    {stage === "home" && <>
      <Text accessibilityRole="header" style={styles.heading}>Your boxes</Text>
      <Text style={styles.copy}>{email}</Text>
      {boxes.map(box => <View key={box.serial} style={styles.choice}>
        <Text style={styles.subheading}>{box.label}</Text>
        <Text style={styles.copy}>{box.online ? "Online" : box.ts ? "Offline" : "Waiting for first reading"}</Text>
        <Action secondary onPress={() => startScan(box.serial)}>Change Wi-Fi</Action>
      </View>)}
      <Action onPress={() => startScan()}>Add device</Action>
      <Action secondary onPress={openDashboard}>Open Dashboard</Action>
      <Action secondary onPress={signOut}>Sign out</Action>
    </>}
    {stage === "scan" && <>
      <Text accessibilityRole="header" style={styles.heading}>Find your box</Text>
      <Text style={styles.copy}>Turn on the box and stay nearby. Press Setup once if it isn't listed.</Text>
      {candidates.map((candidate,index) => <Action key={candidate.id} secondary
        onPress={() => choose(candidate)}>{candidate.localName || candidate.name || "DrySpool"} · Nearby box {index+1}</Action>)}
      <Action secondary onPress={() => startScan(targetSerial.current)}>Scan again</Action>
    </>}
    {stage === "connect-ble" && <Text accessibilityLiveRegion="polite" style={styles.heading}>Connecting to the box…</Text>}
    {stage === "confirm" && <>
      <Text accessibilityRole="header" style={styles.heading}>Confirm on the box</Text>
      <Text style={styles.copy}>Press Setup on the box in front of you. Accept a Bluetooth prompt if your phone shows one.</Text>
    </>}
    {stage === "network-scan" && <Text accessibilityLiveRegion="polite" style={styles.heading}>Finding Wi-Fi networks…</Text>}
    {stage === "networks" && <>
      <Text accessibilityRole="header" style={styles.heading}>Choose your Wi-Fi</Text>
      {networks.map(item => <Pressable key={item.key}
        accessibilityRole="button" accessibilityState={{selected:item.key === network?.key}}
        style={[styles.choice,item.key === network?.key && styles.selected]}
        onPress={() => {setNetwork(item);setPassword("");}}>
        <Text style={styles.subheading}>{item.label}</Text>
      </Pressable>)}
      {network && networkNeedsPassword(network) && <>
        <Text style={styles.label}>Wi-Fi password for {network.label}</Text>
        <TextInput secureTextEntry value={password} onChangeText={setPassword} autoCapitalize="none"
          autoCorrect={false} accessibilityLabel="Wi-Fi password" style={styles.input} />
      </>}
      <Action disabled={!network || networkNeedsPassword(network) && password.length < 8} onPress={applyWifi}>Connect box</Action>
      <Action secondary onPress={() => findNetworks()}>Scan for Wi-Fi again</Action>
    </>}
    {stage === "connecting" && <Text accessibilityLiveRegion="polite" style={styles.heading}>Connecting to Wi-Fi…</Text>}
    {stage === "waiting" && <>
      <Text accessibilityLiveRegion="polite" style={styles.heading}>Waiting for the box to report…</Text>
      <Text style={styles.copy}>Keep the box powered. This can take a minute.</Text>
    </>}
    {stage === "interrupted" && <>
      <Text accessibilityRole="header" style={styles.heading}>Setup needs another step</Text>
      {(activeBox.current?.owned || Date.parse(activeBox.current?.claim?.expiresAt) > Date.now()) &&
        <Action onPress={() => verifyOnline(activeBox.current,flow.current?.signal)}>Check again</Action>}
    </>}
    {stage === "done" && <>
      <Text accessibilityRole="header" style={styles.heading}>{changedWifi ? "Wi-Fi updated" : "Box added"}</Text>
      <Text style={styles.copy}>{changedWifi ? "Your box is online and linked to the same account." : "This box is linked to your account. Readings appear when the box reports."}</Text>
      <Action onPress={openDashboard}>Open Dashboard</Action>
      <Action secondary onPress={goHome}>Back to your boxes</Action>
    </>}
    {!["home","done"].includes(stage) && <Action secondary onPress={goHome}>{stage === "interrupted" ? "Back to your boxes" : "Cancel setup"}</Action>}
    {(error || accountError) && <Text accessibilityRole="alert" style={styles.error}>{error || accountError}</Text>}
  </ScrollView>;
}
