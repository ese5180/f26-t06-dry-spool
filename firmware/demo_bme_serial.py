"""Show repeated BME280 readings on the DK UART for a short live demo.

Run with DK debugger USB connected, then press RESET on the DK.
"""

import argparse
import re
import sys
import time

try:
    import serial
except ImportError:
    print("pyserial is missing. Install it with: py -m pip install pyserial", file=sys.stderr)
    raise SystemExit(2)


PROBE = re.compile(r"BME probe: address 0x([0-9a-fA-F]+), chip ID 0x([0-9a-fA-F]+)")
READING = re.compile(r"BME280 startup: ([-+]?\d+(?:\.\d+)?) C, ([-+]?\d+(?:\.\d+)?) %RH")
SAMPLE = re.compile(r"BME280 sample: ([-+]?\d+(?:\.\d+)?) C, ([-+]?\d+(?:\.\d+)?) %RH")
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="COM7", help="DK UART port (default: COM7)")
    parser.add_argument("--timeout", type=float, default=45, help="Seconds to wait after opening the port")
    parser.add_argument("--samples", type=int, default=4, help="Live readings after startup (default: 4)")
    parser.add_argument("--interval", type=float, default=2, help="Seconds between reading requests (default: 2)")
    args = parser.parse_args()

    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.samples < 1 or args.interval <= 0:
        parser.error("--samples and --interval must be positive")

    # Windows terminals may use cp1252; serial noise during reset can decode
    # to replacement characters that that encoding cannot print.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    print(f"Opening {args.port} at 115200 baud. Press RESET on the DK now.", flush=True)
    try:
        with serial.Serial(args.port, 115200, timeout=0.5) as uart:
            deadline = time.monotonic() + args.timeout
            probe_ok = False
            startup_ok = False
            sample_count = 0
            requests_sent = 0
            next_request = 0.0
            while time.monotonic() < deadline:
                if probe_ok and startup_ok and requests_sent < args.samples and time.monotonic() >= next_request:
                    uart.write(b"bme_read\r\n")
                    requests_sent += 1
                    next_request = time.monotonic() + args.interval
                raw = uart.readline()
                if not raw:
                    continue
                line = ANSI.sub("", raw.decode("utf-8", errors="replace").rstrip("\r\n"))
                probe = PROBE.search(line)
                reading = READING.search(line)
                sample = SAMPLE.search(line)
                if probe or reading or sample:
                    print(line.strip(), flush=True)
                if probe:
                    probe_ok = int(probe.group(1), 16) == 0x77 and int(probe.group(2), 16) == 0x60
                if reading:
                    startup_ok = True
                if sample:
                    sample_count += 1
                if probe_ok and startup_ok and sample_count >= args.samples:
                    print(f"\nPASS: BME280 identified at 0x77; {sample_count} live readings shown above.")
                    return 0
    except serial.SerialException as exc:
        print(f"Cannot open {args.port}: {exc}", file=sys.stderr)
        print("Connect the DK debugger USB, close other serial monitors, or set --port to its UART COM port.", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped.")
        return 130

    print(f"\nSaw {sample_count} of {args.samples} requested readings. Check firmware, port, and wiring.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
