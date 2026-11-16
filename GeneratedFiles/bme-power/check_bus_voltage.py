"""Passive Logic 2 voltage capture only; no target reset or PPK2 control."""
from pathlib import Path
import sys
from saleae import automation
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
out=Path(__file__).resolve().parent
with automation.Manager.connect(port=10430) as manager:
    devices=[d for d in manager.get_devices() if not d.is_simulation]
    if len(devices)!=1:raise RuntimeError(f'Expected one real analyzer: {devices}')
    with manager.start_capture(device_id=devices[0].device_id,
        device_configuration=automation.LogicDeviceConfiguration(
            enabled_digital_channels=[0,1],digital_sample_rate=20_000_000,
            enabled_analog_channels=[0,1],analog_sample_rate=625_000),
        capture_configuration=automation.CaptureConfiguration(
            capture_mode=automation.TimedCaptureMode(duration_seconds=0.1))) as capture:
        capture.wait()
        capture.export_raw_data_csv(str(out),analog_channels=[0,1],
                                   analog_downsample_ratio=625)
        capture.save_capture(str(out/'direct-i2c-idle-voltage.sal'))
print('Passive idle-voltage capture saved; no output enable or target reset.')
