"""Offline streaming replay of split raw PPK data. No serial hardware access.
Usage: Windows Python analyze_long_power.py forced-300s
Requires ppk2-api==0.9.2 for the same factory conversion/range filter.
"""
import csv,json,struct,sys,hashlib,math
from pathlib import Path
from ppk2_api.ppk2_api import PPK2_API
out=Path(__file__).resolve().parent/sys.argv[1]
manifest=json.loads((out/'capture.json').read_text())
if manifest.get('error'):raise RuntimeError(manifest['error'])
p=PPK2_API.__new__(PPK2_API);p.ser=None
p.modifiers={k:{str(i):0 for i in range(5)} for k in ('R','GS','GI','O','S','I','UG')}
if not p._parse_metadata((out/'metadata.txt').read_text()):raise RuntimeError('Metadata parse failed')
p.current_vdd=3600;p.adc_mult=1.8/163840
p.rolling_avg=p.rolling_avg4=p.prev_range=None
p.consecutive_range_samples=p.after_spike=0
p.spike_filter_alpha=.18;p.spike_filter_alpha5=.06;p.spike_filter_samples=3
last=None;gaps=0;count=0;partial=b'';lo=math.inf;hi=-math.inf
bins=[];bin_count=0;bin_sum=0;bin_lo=math.inf;bin_hi=-math.inf
for chunk in manifest['chunks']:
    raw=(out/chunk['path']).read_bytes()
    if len(raw)!=chunk['bytes'] or hashlib.sha256(raw).hexdigest()!=chunk['sha256']:raise RuntimeError('Raw checksum mismatch')
    raw=partial+raw;usable=len(raw)//4*4;partial=raw[usable:]
    for (word,) in struct.iter_unpack('<I',memoryview(raw)[:usable]):
        r=(word>>14)&7;c=(word>>18)&63
        if r>4:raise RuntimeError('Invalid PPK range')
        if last is not None and c!=(last+1)%64:gaps+=1
        last=c;v=p.get_adc_result(r,(word&16383)*4)
        if not math.isfinite(v):raise RuntimeError('Nonfinite current')
        count+=1;bin_count+=1;bin_sum+=v;bin_lo=min(bin_lo,v);bin_hi=max(bin_hi,v)
        lo=min(lo,v);hi=max(hi,v)
        if bin_count==100000:
            bins.append({'start_s':(count-bin_count)/100000,'duration_s':bin_count/100000,'average_current_ma':bin_sum/bin_count*1000,'energy_j':bin_sum*3.6/100000,'min_current_ma':bin_lo*1000,'max_current_ma':bin_hi*1000})
            bin_count=0;bin_sum=0;bin_lo=math.inf;bin_hi=-math.inf
if partial:raise RuntimeError('Partial final PPK packet')
if bin_count:
    bins.append({'start_s':(count-bin_count)/100000,'duration_s':bin_count/100000,'average_current_ma':bin_sum/bin_count*1000,'energy_j':bin_sum*3.6/100000,'min_current_ma':bin_lo*1000,'max_current_ma':bin_hi*1000})
if not count:raise RuntimeError('No samples')
with (out/'current-1s.csv').open('w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(bins[0]));w.writeheader();w.writerows(bins)
def summary(selected):
    duration=math.fsum(x['duration_s'] for x in selected);energy=math.fsum(x['energy_j'] for x in selected)
    return {'duration_s':duration,'average_current_ma':energy/3.6/duration*1000,'energy_j':energy}
result=summary(bins)
result.update(samples=count,counter_discontinuities=gaps,min_current_ma=lo*1000,max_current_ma=hi*1000,supply_v=3.6,scope='P21 whole DK input including DK-powered BME; USB disconnected; P22/P23 installed',window='Five-minute power-on window including startup; output off afterward',conversion='ppk2-api 0.9.2 factory coefficients and range-transition filter; 100 ksample/s',post_startup_30s_excluded=summary([x for x in bins if x['start_s']>=30]),minute_windows=[dict(start_s=t,**summary([x for x in bins if t<=x['start_s']<t+60])) for t in range(0,int(count/100000),60)])
(out/'power.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2),flush=True)
if gaps:raise RuntimeError('Counter discontinuities: measurement not accepted')
