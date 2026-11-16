"""Long USB-disconnected P21 capture, unchanged voltage/mode.
Raw 100 ksample/s PPK packets are split into 8 MB chunks; no decimation.
Usage: Windows Python capture_long_power.py forced-300s 300
Always sends output OFF on completion/error. Analyze separately offline.
"""
import sys,time,json,hashlib
from pathlib import Path
import serial.tools.list_ports
from ppk2_api.ppk2_api import PPK2_API
from saleae import automation
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
seconds=int(sys.argv[2]);out=Path(__file__).resolve().parent/sys.argv[1]
if not 60<=seconds<=600:raise ValueError('Duration must be 60..600 s')
ports=list(serial.tools.list_ports.comports())
if any(x.device in ('COM6','COM7') for x in ports):raise RuntimeError('DK USB attached')
out.mkdir(exist_ok=False)
p=PPK2_API('COM16',timeout=.05)
p.ser.write(bytes([0x19]));time.sleep(.3)
meta=p.ser.read(p.ser.in_waiting).decode();(out/'metadata.txt').write_text(meta)
if 'mode: 2' not in meta or 'VDD: 3600' not in meta:raise RuntimeError('Unexpected mode or voltage')
report={'requested_seconds':seconds,'supply_v':3.6,'dk_usb_absent':True,'output_off_command_completed':False,'raw_chunk_bytes':8_000_000,'sample_rate_hz':100000,'logic_sample_rate_hz':2000000,'chunks':[]}
stream=None;chunk_size=0;chunk_index=0;total=0;digest=None
try:
    p.toggle_DUT_power('OFF');time.sleep(2)
    with automation.Manager.connect(port=10430) as m:
        ds=[d for d in m.get_devices() if not d.is_simulation]
        if len(ds)!=1:raise RuntimeError('Expected one real Logic analyzer')
        report['logic_device_id']=ds[0].device_id
        with m.start_capture(device_id=ds[0].device_id,device_configuration=automation.LogicDeviceConfiguration(enabled_digital_channels=[0,1],digital_sample_rate=2_000_000),capture_configuration=automation.CaptureConfiguration(capture_mode=automation.TimedCaptureMode(duration_seconds=seconds+2))) as c:
            p.ser.reset_input_buffer();p.start_measuring();p.toggle_DUT_power('ON')
            start=time.monotonic();next_progress=30
            while True:
                elapsed=time.monotonic()-start
                if elapsed>=seconds:break
                data=p.ser.read(p.ser.in_waiting or 1)
                while data:
                    if stream is None:
                        name=f'ppk-raw-{chunk_index:03}.bin';stream=(out/name).open('wb');digest=hashlib.sha256();chunk_size=0
                    part=data[:8_000_000-chunk_size];data=data[len(part):]
                    stream.write(part);digest.update(part);chunk_size+=len(part);total+=len(part)
                    if chunk_size==8_000_000:
                        stream.close();stream=None
                        report['chunks'].append({'path':name,'bytes':chunk_size,'sha256':digest.hexdigest()});chunk_index+=1
                if elapsed>=next_progress:
                    print(f'{elapsed:.1f}s: {total} raw bytes saved',flush=True);next_progress+=30
            p.stop_measuring();time.sleep(.1)
            data=p.ser.read(p.ser.in_waiting)
            # Tail is normally much smaller than one chunk; preserve without dropping bytes.
            if stream is not None:
                stream.close();stream=None
                report['chunks'].append({'path':name,'bytes':chunk_size,'sha256':digest.hexdigest()})
            if data:
                name=f'ppk-raw-{len(report["chunks"]):03}.bin';(out/name).write_bytes(data);total+=len(data)
                report['chunks'].append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
            p.toggle_DUT_power('OFF');report['output_off_command_completed']=True
            report['host_acquisition_seconds']=time.monotonic()-start
            c.wait();a=c.add_analyzer('I2C',label='BME280',settings={'SDA':0,'SCL':1})
            c.export_data_table(str(out/'i2c.csv'),analyzers=[automation.DataTableExportConfiguration(analyzer=a,radix=automation.RadixType.HEXADECIMAL)])
            c.save_capture(str(out/'i2c.sal'))
except Exception as exc:
    report['error']=str(exc);raise
finally:
    if stream is not None:stream.close()
    p.stop_measuring();p.toggle_DUT_power('OFF');report['output_off_command_completed']=True
    report['raw_bytes']=total
    (out/'capture.json').write_text(json.dumps(report,indent=2)+'\n')
print('Capture saved; PPK output OFF. Offline analysis pending.',flush=True)
