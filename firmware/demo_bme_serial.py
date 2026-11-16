"""Show the BME280 startup reading on the DK UART for a short live demo.

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="COM7", help="DK UART port (default: COM7)")
    parser.add_argument("--timeout", type=float, default=45, help="Seconds to wait after opening the port")
    args = parser.parse_args()

    if args.timeout <= 0:
        parser.error("--timeout must be positive")

    print(f"Opening {args.port} at 115200 baud. Press RESET on the DK now.", flush=True)
    try:
        with serial.Serial(args.port, 115200, timeout=0.5) as uart:
            deadline = time.monotonic() + args.timeout
            probe_ok = False
            reading_ok = False
            while time.monotonic() < deadline:
                raw = uart.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                print(line, flush=True)
                probe = PROBE.search(line)
                if probe:
                    probe_ok = int(probe.group(1), 16) == 0x77 and int(probe.group(2), 16) == 0x60
                reading = READING.search(line)
                if reading:
                    reading_ok = True
                if probe_ok and reading_ok:
                    print("\nPASS: BME280 identified at 0x77; live temperature and humidity shown above.")
                    return 0
    except serial.SerialException as exc:
        print(f"Cannot open {args.port}: {exc}", file=sys.stderr)
        print("Connect the DK debugger USB, close other serial monitors, or set --port to its UART COM port.", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nStopped.")
        return 130

    print("\nNo complete BME280 startup reading seen. Press RESET and check wiring, port, and firmware.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
