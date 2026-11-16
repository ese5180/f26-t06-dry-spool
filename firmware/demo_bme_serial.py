"""Continuously show real BME280 readings from the DK UART shell.

Run with the DK debugger USB connected. Stop with Ctrl+C.
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
    parser.add_argument("--timeout", type=float, default=15, help="Seconds to wait for the first reading")
    parser.add_argument("--samples", type=int, default=0, help="Stop after N readings (default: 0, continuous)")
    parser.add_argument("--interval", type=float, default=2, help="Seconds between reading requests (default: 2)")
    args = parser.parse_args()

    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.samples < 0 or args.interval <= 0:
        parser.error("--samples cannot be negative and --interval must be positive")

    # Windows terminals may use cp1252; serial noise during reset can decode
    # to replacement characters that that encoding cannot print.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    print(f"Opening {args.port} at 115200 baud. Reading every {args.interval:g} s; Ctrl+C to stop.", flush=True)
    try:
        with serial.Serial(args.port, 115200, timeout=0.5) as uart:
            first_reading_deadline = time.monotonic() + args.timeout
            sample_count = 0
            next_request = 0.0
            while True:
                if sample_count == 0 and time.monotonic() >= first_reading_deadline:
                    print("No BME reading received. Check that this branch's firmware is flashed and COM7 is the DK UART.", file=sys.stderr)
                    return 1
                if time.monotonic() >= next_request:
                    uart.write(b"bme_read\r\n")
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
                if sample:
                    sample_count += 1
                if args.samples and sample_count >= args.samples:
                    print(f"\nPASS: {sample_count} live BME280 readings shown above.")
                    return 0
    except serial.SerialException as exc:
        print(f"Cannot open {args.port}: {exc}", file=sys.stderr)
        print("Connect the DK debugger USB, close other serial monitors, or set --port to its UART COM port.", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped by user.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
