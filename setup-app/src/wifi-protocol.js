import protobuf from "protobufjs/light.js";
import { Buffer } from "buffer";

// Wire fields used by NCS 3.4.0 wifi_prov_core (version 2).
const field = (type,id) => ({type,id});
const root = protobuf.Root.fromJSON({nested:{
  WifiInfo:{fields:{ssid:field("bytes",1),bssid:field("bytes",2),band:field("uint32",3),
    channel:field("uint32",4),auth:field("uint32",5)}},
  WifiConfig:{fields:{wifi:field("WifiInfo",1),passphrase:field("bytes",2)}},
  Request:{fields:{op:field("uint32",1),config:field("WifiConfig",11)}},
  Response:{fields:{op:field("uint32",1),status:field("uint32",2)}},
  Result:{fields:{scan:field("ScanRecord",1),state:field("uint32",2),reason:field("uint32",3)}},
  ScanRecord:{fields:{wifi:field("WifiInfo",1),rssi:field("int32",2)}},
  Info:{fields:{version:field("uint32",1)}},
}});
const message = name => root.lookupType(name);
const request = data => Buffer.from(message("Request").encode(data).finish()).toString("base64");
const decode = (name, base64) => message(name).decode(Buffer.from(base64,"base64"));

export const SCAN = 2;
export const SET_CONFIG = 4;
export const CONNECTED = 4;
export const CONNECTION_FAILED = 5;

export function scanRequest() {
  return request({op:SCAN});
}

const supportedPersonal = new Set([3,4,6,8,9,10,13]);
export const networkNeedsPassword = network => supportedPersonal.has(network.auth);

export function setupRequest(network, password) {
  const bytes = Buffer.from(password,"utf8");
  if (networkNeedsPassword(network) && (bytes.length < 8 || bytes.length > 63)) {
    throw new Error("Enter a Wi-Fi password of 8–63 bytes.");
  }
  const wifi = {ssid:network.ssid,bssid:network.bssid,
    band:network.band,channel:network.channel,auth:network.auth};
  return request({op:SET_CONFIG,config:{wifi,passphrase:bytes}});
}

export const decodeInfo = value => decode("Info",value).version;
export const decodeResponse = value => decode("Response",value);

export function decodeResult(value) {
  const result = decode("Result",value);
  const wifi = result.scan?.wifi;
  if (wifi) {
    const label = Buffer.from(wifi.ssid).toString("utf8");
    if (!label || ![0,7].includes(wifi.auth) && !supportedPersonal.has(wifi.auth)) return {};
    return {network:{
      ...wifi, label, rssi:result.scan.rssi, key:Buffer.from(wifi.ssid).toString("base64"),
    }};
  }
  return {state:Object.hasOwn(result,"state") ? result.state : undefined,
    reason:Object.hasOwn(result,"reason") ? result.reason : undefined};
}
