import assert from "node:assert/strict";
import test from "node:test";
import { decodeResult, setupRequest } from "../src/wifi-protocol.js";

const fromHex = hex => Buffer.from(hex,"hex").toString("base64");
// Generated with request_pb2/result_pb2 shipped in the Nordic NCS 3.4.0 SDK.
const scanned = fromHex("0a250a180a08576f726b73686f70120600112233445518012006280310d7ffffffffffffffff01");
const configure = fromHex("08045a2b0a180a08576f726b73686f701206001122334455180120062803120f746573742d70617373706872617365");

test("scan and setup agree with the Nordic protobuf wire format", () => {
  const {network} = decodeResult(scanned);
  assert.equal(network.label,"Workshop");
  assert.equal(network.rssi,-41);
  assert.equal(setupRequest(network,"test-passphrase"),configure);
});

test("a connection failure without an auth reason is not shown as a bad password", () => {
  assert.deepEqual(decodeResult(fromHex("1005")),{state:5,reason:undefined});
});
