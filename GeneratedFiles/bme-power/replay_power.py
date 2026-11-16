"""Offline replay only: no serial ports opened, no hardware commands.
Run using Windows Python with ppk2-api 0.9.2 installed.
"""
import json,struct,sys,statistics
from pathlib import Path
from ppk2_api.ppk2_api import PPK2_API
folder=Path(sys.argv[1])
p=PPK2_API.__new__(PPK2_API);p.ser=None
p.modifiers={k:{str(i):0 for i in range(5)} for k in ('R','GS','GI','O','S','I','UG')}
p._parse_metadata((folder/'metadata.txt').read_text())
p.current_vdd=3600;p.adc_mult=1.8/163840
p.rolling_avg=p.rolling_avg4=p.prev_range=None
p.consecutive_range_samples=p.after_spike=0
p.spike_filter_alpha=.18;p.spike_filter_alpha5=.06;p.spike_filter_samples=3
raw=(folder/'ppk-raw.bin').read_bytes()
if len(raw)%4:raise RuntimeError('Partial packet')
values=[];last=None;gaps=0
for (word,) in struct.iter_unpack('<I',raw):
    r=(word>>14)&7;c=(word>>18)&63
    if r>4:raise RuntimeError('Invalid range')
    if last is not None and c!=(last+1)%64:gaps+=1
    last=c;values.append(p.get_adc_result(r,(word&16383)*4))
result={'samples':len(values),'duration_s':len(values)/100000,'counter_discontinuities':gaps,'average_current_ma':statistics.mean(values)*1000,'energy_j':sum(values)*3.6/100000,'last_20s_current_ma':statistics.mean(values[-2000000:])*1000}
(folder/'replay.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if gaps:raise RuntimeError('Counter gap')
