"""Compare the real matched five-minute captures, without hardware access.
Run after capture_long_power.py, analyze_long_power.py, decode_bme.py for both.
Reduction percent is 100*(normal-forced)/normal. No causal saving claim.
"""
import json
from pathlib import Path
root=Path(__file__).resolve().parent
runs={}
for mode,expected in [('normal',3),('forced',1)]:
    folder=root/f'{mode}-300s'
    power=json.loads((folder/'power.json').read_text())
    bme=json.loads((folder/'bme.json').read_text())
    capture=json.loads((folder/'capture.json').read_text())
    if power['counter_discontinuities'] or capture.get('error'):raise RuntimeError('Capture integrity failure')
    if power['supply_v']!=3.6 or not capture['dk_usb_absent']:raise RuntimeError('External conditions differ')
    if not bme['all_address_frames_acked'] or bme['chip_id']!='0x60' or bme['sample_count']<1:raise RuntimeError('BME validation failed')
    mode_writes=[t for t in bme['register_writes'] if t['data'][0]==0xf4]
    if not mode_writes or any((t['data'][1]&3)!=expected for t in mode_writes):raise RuntimeError('Incorrect sensor mode')
    reset_times=[t['time'] for t in bme['register_writes'] if t['data']==[0xe0,0xb6]]
    runs[mode]={'power':power,'sensor_soft_reset_times_s':reset_times,'delivered_sample_times_s':[s['time_s'] for s in bme['delivered_samples']],'sensor_sample_count':bme['sample_count'],'acked_address_frames':bme['address_frames']}
if abs(runs['normal']['power']['duration_s']-runs['forced']['power']['duration_s'])>.1:raise RuntimeError('Durations differ by >0.1s')
metadata_match=(root/'normal-300s'/'metadata.txt').read_bytes()==(root/'forced-300s'/'metadata.txt').read_bytes()
if not metadata_match:raise RuntimeError('PPK metadata changed')
def reduction(a,b):return 100*(a-b)/a
n=runs['normal']['power'];f=runs['forced']['power']
result={'runs':runs,'ppk_metadata_byte_identical':metadata_match,'full_window_current_reduction_percent':reduction(n['average_current_ma'],f['average_current_ma']),'excluding_first_30s_current_reduction_percent':reduction(n['post_startup_30s_excluded']['average_current_ma'],f['post_startup_30s_excluded']['average_current_ma']),'causal_sensor_power_improvement_verified':False,'limitations':['One run per mode; whole-DK P21 input includes regulators and all board loads.','Matching external setup does not establish matching internal application/network activity.','Forced run has two sensor initialization sequences. UART/reset cause was not captured; five-minute application stability is unverified.','Samples observed near startup are not proof of periodic reporting.','No Wi-Fi changes or diagnosis performed.','Factory PPK coefficients used; no independent physical voltage or calibration check.']}
(root/'long-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
