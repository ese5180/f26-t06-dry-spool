"""Three commanded DK startups; observe 30 s each, with Logic 2 on boot 2.

Run with Windows Python (pyserial and logic2-automation). This never controls
PPK2. The Wi-Fi RDSR2 issue is recorded separately from sensor/boot checks.
"""
from pathlib import Path
import json
import csv
import re
import subprocess
import sys
import time

import serial
from saleae import automation

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
OUT = Path(__file__).resolve().parent
ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
REPORT = {'observation_seconds_after_reset_command': 30, 'boots': [],
          'logic': {}, 'all_boots_passed': False, 'ppk_controlled': False}


def save_report():
    (OUT / 'bme-boot-results.json').write_text(
        json.dumps(REPORT, indent=2) + '\n', encoding='utf-8')


def verify_i2c_csv(path):
    """Check real Logic 2 analyzer rows for the acknowledged ID-register read."""
    with path.open(encoding='utf-8') as stream:
        rows = list(csv.DictReader(stream))
    addresses = [r for r in rows if r['type'] == 'address' and r['address'] == '0x77']
    if not addresses or any(r['ack'] != 'true' for r in addresses):
        raise RuntimeError('Missing ACK on a 0x77 address frame')
    reads = []
    for i in range(len(rows) - 5):
        r = rows[i:i + 6]
        if (r[0]['type'] == 'address' and r[0]['address'] == '0x77'
                and r[0]['read'] == 'false' and r[0]['ack'] == 'true'
                and r[1]['type'] == 'data' and r[1]['data'].lower() == '0xd0'
                and r[1]['ack'] == 'true' and r[2]['type'] == 'start'
                and r[3]['type'] == 'address' and r[3]['address'] == '0x77'
                and r[3]['read'] == 'true' and r[3]['ack'] == 'true'
                and r[4]['type'] == 'data' and r[4]['data'].lower() == '0x60'
                and r[4]['ack'] == 'false' and r[5]['type'] == 'stop'):
            reads.append({'start_seconds': float(r[0]['start_time']),
                          'stop_seconds': float(r[5]['start_time'])})
    if not reads:
        raise RuntimeError('No acknowledged D0 register selection followed by ID 60 read')
    return {'ack_verified': True, 'sensor_address': '0x77',
            'acknowledged_address_frames': len(addresses),
            'chip_id_register': '0xD0', 'chip_id_value': '0x60',
            'verified_chip_id_read_windows': reads,
            'final_read_byte_master_nack_expected': True,
            'unused_0x76_probe_nack_expected': True}


def main():
    try:
        with automation.Manager.connect(port=10430) as manager, serial.Serial(
                'COM7', 115200, timeout=0.05) as uart:
            devices = [d for d in manager.get_devices() if not d.is_simulation]
            if len(devices) != 1:
                raise RuntimeError(f'Expected one real Logic analyzer: {devices}')
            REPORT['logic'] = {'device_id': devices[0].device_id,
                               'is_simulation': False, 'sda_channel': 0,
                               'scl_channel': 1, 'sample_rate_hz': 2_000_000,
                               'capture_seconds': 8, 'captured': False}
            for number in range(1, 4):
                capture = None
                chunks = []
                if number == 2:
                    capture = manager.start_capture(device_id=devices[0].device_id,
                        device_configuration=automation.LogicDeviceConfiguration(
                            enabled_digital_channels=[0, 1],
                            digital_sample_rate=2_000_000),
                        capture_configuration=automation.CaptureConfiguration(
                            capture_mode=automation.TimedCaptureMode(duration_seconds=8)))
                try:
                    reset_kind = 'RESET_PIN' if number == 3 else 'RESET_SYSTEM'
                    proc = subprocess.Popen(['nrfutil', 'device', 'reset',
                        '--serial-number', '1050794921', '--reset-kind', reset_kind],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                    while proc.poll() is None:
                        chunks.append(uart.read(uart.in_waiting or 1))
                    reset_output = proc.stdout.read().decode('utf-8', errors='replace')
                    if proc.returncode:
                        raise RuntimeError(f'Reset failed: {reset_output}')
                    start = time.monotonic()
                    deadline = start + 30
                    queried = False
                    while time.monotonic() < deadline:
                        chunks.append(uart.read(uart.in_waiting or 1))
                        if not queried and time.monotonic() > start + 23:
                            uart.write(b'\r\napp version\r\nkernel uptime\r\n')
                            if number == 3:
                                uart.write(b'kernel thread stacks\r\n')
                            queried = True
                    raw = b''.join(chunks).decode('utf-8', errors='replace')
                    log = ANSI.sub('', raw).replace('\r', '')
                    (OUT / f'bme-boot-{number}-uart.txt').write_text(log, encoding='utf-8')
                    samples = re.findall(r'BME280 startup: ([-\d.]+) C, ([-\d.]+) %RH', log)
                    ids = re.findall(r'BME probe: address 0x([0-9a-f]+), chip ID 0x([0-9a-f]+)', log)
                    build_ids = re.findall(r'GNU Build ID: ([0-9a-f]{40})', log)
                    boot = {'boot': number, 'commanded_reset': reset_kind,
                            'observed_seconds': round(time.monotonic() - start, 3),
                            'bootloader_starts': log.count('I: Starting bootloader'),
                            'application_starts': log.count('DrySpool firmware started'),
                            'identities': ids, 'startup_samples': samples,
                            'build_ids': build_ids,
                            'wifi_rdsr2_error': 'RDSR2 failed' in log}
                    reasons = []
                    if boot['bootloader_starts'] != 1 or boot['application_starts'] != 1:
                        reasons.append('Expected exactly one bootloader/application startup')
                    if ids != [('77', '60')]:
                        reasons.append('Expected one BME280 identity at 0x77 with ID 0x60')
                    if len(samples) != 1:
                        reasons.append('Expected exactly one real startup sample')
                    else:
                        temperature, humidity = map(float, samples[0])
                        boot.update(temperature_c=temperature, humidity_pct=humidity)
                        if not (-10 <= temperature <= 60 and 0 <= humidity <= 100):
                            reasons.append('Sample outside demo plausibility limits')
                    if not re.search(r'\n0\.1\.7\n', log):
                        reasons.append('No successful version-shell response')
                    if re.search(r'Unexpected sensor identity|sensor initialization failed|ASSERTION|BUS FAULT|HARD FAULT|FATAL ERROR', log):
                        reasons.append('Sensor initialization or fatal error in UART log')
                    if len(build_ids) != 1:
                        reasons.append('Expected one firmware build ID')
                    if REPORT['boots'] and build_ids != REPORT['boots'][0]['build_ids']:
                        reasons.append('Firmware build ID changed between tests')
                    boot.update(passed=not reasons, failures=reasons)
                    REPORT['boots'].append(boot)
                    save_report()
                    print(json.dumps(boot), flush=True)
                    if reasons:
                        raise RuntimeError('; '.join(reasons))
                    if capture is not None:
                        capture.wait()
                        analyzer = capture.add_analyzer('I2C', label='BME280',
                                                       settings={'SDA': 0, 'SCL': 1})
                        capture.export_data_table(str(OUT / 'bme-i2c.csv'), analyzers=[
                            automation.DataTableExportConfiguration(
                                analyzer=analyzer, radix=automation.RadixType.HEXADECIMAL)])
                        capture.save_capture(str(OUT / 'bme-boot.sal'))
                        REPORT['logic'].update(verify_i2c_csv(OUT / 'bme-i2c.csv'))
                        REPORT['logic']['captured'] = True
                        save_report()
                finally:
                    if capture is not None:
                        capture.close()
            REPORT['all_boots_passed'] = True
            save_report()
    except Exception as exc:
        REPORT['error'] = str(exc)
        save_report()
        raise


if __name__ == "__main__":
    main()
