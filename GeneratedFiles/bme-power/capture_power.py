"""USB-disconnected P21 power-on window; preserve raw PPK packets and I2C.
Requires operator-confirmed polarity and DK-powered BME. Does not change mode/voltage.
"""
from pathlib import Path
import sys,time,json,struct,csv,statistics
import serial.tools.list_ports
from ppk2_api.ppk2_api import PPK2_API
from saleae import automation
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
out=Path(__file__).resolve().parent/sys.argv[1]
out.mkdir(exist_ok=False)
ports=list(serial.tools.list_ports.comports())
if any(p.device in ('COM6','COM7') for p in ports):raise RuntimeError('DK USB still connected; refusing output enable')
p=PPK2_API('COM16',timeout=.1)
p.ser.write(bytes([0x19]));time.sleep(.3)
meta=p.ser.read(p.ser.in_waiting).decode();(out/'metadata.txt').write_text(meta)
if 'mode: 2' not in meta or 'VDD: 3600' not in meta:raise RuntimeError('Unexpected PPK mode/voltage')
p._parse_metadata(meta);p.current_vdd=3600
raw=bytearray()
try:
    p.toggle_DUT_power('OFF');time.sleep(2)
    with automation.Manager.connect(port=10430) as m:
        ds=[d for d in m.get_devices() if not d.is_simulation]
        if len(ds)!=1:raise RuntimeError('Expected one real Logic device')
        with m.start_capture(device_id=ds[0].device_id,device_configuration=automation.LogicDeviceConfiguration(enabled_digital_channels=[0,1],digital_sample_rate=2_000_000),capture_configuration=automation.CaptureConfiguration(capture_mode=automation.TimedCaptureMode(duration_seconds=32))) as c:
            p.ser.reset_input_buffer();p.start_measuring();p.toggle_DUT_power('ON')
            start=time.monotonic()
            while time.monotonic()-start<30:
                raw.extend(p.ser.read(p.ser.in_waiting or 1))
            p.stop_measuring();time.sleep(.1);raw.extend(p.ser.read(p.ser.in_waiting))
            p.toggle_DUT_power('OFF')
            (out/'ppk-raw.bin').write_bytes(raw)
            c.wait();a=c.add_analyzer('I2C',label='BME280',settings={'SDA':0,'SCL':1})
            c.export_data_table(str(out/'i2c.csv'),analyzers=[automation.DataTableExportConfiguration(analyzer=a,radix=automation.RadixType.HEXADECIMAL)])
            c.save_capture(str(out/'i2c.sal'))
finally:
    p.stop_measuring();p.toggle_DUT_power('OFF')
if len(raw)%4:raise RuntimeError('Incomplete PPK packet')
words=[w[0] for w in struct.iter_unpack('<I',raw)]
ranges=[(w>>14)&7 for w in words]
if max(ranges)>4:raise RuntimeError('Invalid PPK range')
# Counter is the six bits above bit 17, modulo 64.
counters=[(w>>18)&63 for w in words]
bad=sum(b!=(a+1)%64 for a,b in zip(counters,counters[1:]))
values=[p.get_adc_result(r,(w&16383)*4) for w,r in zip(words,ranges)]
duration=len(values)/100000
result={'duration_s':duration,'samples':len(values),'counter_discontinuities':bad,'average_current_ma':statistics.mean(values)*1000,'min_current_ma':min(values)*1000,'max_current_ma':max(values)*1000,'energy_j':sum(values)*3.6/100000,'supply_v':3.6,'scope':'P21 whole DK input including DK-powered BME; USB disconnected; P22/P23 installed','window':'30 second power-on window including startup, output switched off afterward','conversion':'ppk2-api 0.9.2 factory coefficients and range-transition filter; 100 ksample/s'}
(out/'power.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
if bad:raise RuntimeError('PPK counter discontinuities: measurement not accepted')
