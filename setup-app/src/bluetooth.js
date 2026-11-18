import { BleManager, State } from "react-native-ble-plx";
import { PermissionsAndroid, Platform } from "react-native";
import { Buffer } from "buffer";
import {
  CONNECTION_FAILED, CONNECTED, SCAN, SET_CONFIG, decodeInfo, decodeResponse,
  decodeResult, scanRequest, setupRequest,
} from "./wifi-protocol";

export const SETUP_SERVICE = "d7a61001-9df9-4b91-82bd-acf530acb853";
const ID = "d7a61002-9df9-4b91-82bd-acf530acb853";
const CONFIRM = "d7a61003-9df9-4b91-82bd-acf530acb853";
const CLAIM = "d7a61004-9df9-4b91-82bd-acf530acb853";
const WIFI_SERVICE = "14387800-130c-49e7-b877-2881c89cb258";
const INFO = "14387801-130c-49e7-b877-2881c89cb258";
const CONTROL = "14387802-130c-49e7-b877-2881c89cb258";
const RESULT = "14387803-130c-49e7-b877-2881c89cb258";

export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(new Error("Setup cancelled."));
  return new Promise((resolve,reject) => {
    const finish = () => { signal?.removeEventListener("abort",abort); resolve(); };
    const timer = setTimeout(finish,ms);
    function abort() { clearTimeout(timer); reject(new Error("Setup cancelled.")); }
    signal?.addEventListener("abort",abort,{once:true});
  });
}

export async function readyManager() {
  if (Platform.OS === "android") {
    const requests = Platform.Version >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const statuses = await PermissionsAndroid.requestMultiple(requests);
    if (requests.some(key => statuses[key] !== PermissionsAndroid.RESULTS.GRANTED)) {
      throw new Error("Allow Bluetooth access in Settings, then try again.");
    }
  }
  const manager = new BleManager();
  for (let i = 0; i <= 10; i++) {
    const state = await manager.state();
    if (state === State.PoweredOn) return manager;
    if ([State.PoweredOff,State.Unauthorized,State.Unsupported].includes(state)) break;
    await sleep(200);
  }
  await manager.destroy();
  throw new Error("Turn on Bluetooth and allow DrySpool to use it, then try again.");
}

export async function connect(manager, candidate) {
  const options = {timeout:12_000};
  if (Platform.OS === "android") options.requestMTU = 147;
  try {
    const transport = await manager.connectToDevice(candidate.id,options);
    const device = await transport.discoverAllServicesAndCharacteristics();
    const info = await device.readCharacteristicForService(WIFI_SERVICE,INFO);
    if (decodeInfo(info.value) !== 2) throw new Error("Update this box to compatible DrySpool firmware.");
    const id = await device.readCharacteristicForService(SETUP_SERVICE,ID);
    const serial = Buffer.from(id.value,"base64").toString("utf8");
    if (!/^[-a-zA-Z0-9_]{1,128}$/.test(serial)) throw new Error("The box could not identify itself.");
    return {device,serial};
  } catch (err) {
    await manager.cancelDeviceConnection(candidate.id).catch(() => {});
    throw err;
  }
}

export async function waitForButton(device, signal) {
  for (let i = 0; i < 45; i++) {
    if (signal.aborted) throw new Error("Setup cancelled.");
    const status = await device.readCharacteristicForService(SETUP_SERVICE,CONFIRM);
    if (Buffer.from(status.value,"base64")[0] === 1) return;
    await sleep(1000,signal);
  }
  throw new Error("The box did not confirm. Press Setup on the selected box and try again.");
}

function operation(device, op, payload, signal, {milliseconds,onResult,onElapsed}) {
  if (signal.aborted) return Promise.reject(new Error("Setup cancelled."));
  return new Promise((resolve,reject) => {
    const subscriptions = [];
    let settled = false;
    const end = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort",abort);
      subscriptions.forEach(subscription => subscription.remove());
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => end(signal.reason || new Error("Setup cancelled."));
    const receive = handle => (error, characteristic) => {
      if (error) return end(new Error("Lost the connection to the box. Try again nearby."));
      if (!characteristic?.value || settled) return;
      try { handle(characteristic.value); } catch (err) { end(err); }
    };
    const timeout = setTimeout(() => {
      if (onElapsed) end(null,onElapsed());
      else end(new Error("The box did not join Wi-Fi. Check the network and try again."));
    },milliseconds);
    signal.addEventListener("abort",abort,{once:true});
    subscriptions.push(device.monitorCharacteristicForService(WIFI_SERVICE,CONTROL,receive(value => {
      const response = decodeResponse(value);
      if (response.op === op && response.status !== 0) {
        end(new Error("The box could not apply this step. Try again."));
      }
    })));
    subscriptions.push(device.monitorCharacteristicForService(WIFI_SERVICE,RESULT,receive(value => {
      onResult(decodeResult(value),end);
    })));
    device.writeCharacteristicWithResponseForService(WIFI_SERVICE,CONTROL,payload)
      .catch(() => end(new Error("Could not send settings to the box. Try again nearby.")));
  });
}

export function scanNetworks(device, signal) {
  const networks = new Map();
  return operation(device,SCAN,scanRequest(),signal,{
    milliseconds:11_000,
    onResult({network}) {
      if (!network) return;
      const previous = networks.get(network.key);
      if (!previous || previous.rssi < network.rssi) networks.set(network.key,network);
    },
    onElapsed:() => [...networks.values()].sort((a,b)=>b.rssi-a.rssi),
  });
}

export async function configureWifi(device, network, password, signal) {
  await operation(device,SET_CONFIG,setupRequest(network,password),signal,{
    milliseconds:35_000,
    onResult({state,reason},end) {
      if (state === CONNECTED) end();
      if (state === CONNECTION_FAILED) {
        end(new Error(reason === 0 ? "Wi-Fi rejected the password. Check it and try again."
          : "The box could not join this network. Check the network and try again."));
      }
    },
  });
}

export async function sendClaim(device, token) {
  await device.writeCharacteristicWithResponseForService(SETUP_SERVICE,CLAIM,
    Buffer.from(token,"ascii").toString("base64"));
}
