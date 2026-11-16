"""Compare measured summaries only; run after both captures and BME validation."""
import json
from pathlib import Path
root=Path(__file__).resolve().parent
b=json.loads((root/'baseline'/'power.json').read_text())
a=json.loads((root/'after'/'power.json').read_text())
for d in (b,a):
    if d['counter_discontinuities'] or d['delivered_sensor_samples']<1:
        raise RuntimeError('Invalid measurement or no completed sample')
    if d['supply_v']!=3.6:raise RuntimeError('Supply changed')
result={'baseline':b,'after':a,'average_current_reduction_percent':100*(b['average_current_ma']-a['average_current_ma'])/b['average_current_ma'],'window_energy_reduction_percent':100*(b['energy_j']-a['energy_j'])/b['energy_j'],'limitations':['Whole DK input, including BME, regulators and board loads; USB disconnected.','One startup window per firmware; no repeatability or BME-only attribution established.','Energy per delivered sample includes all window startup/background energy.','Nominal 30 s windows; actual ADC sample durations reported independently.','No Wi-Fi changes; uncontrolled network/runtime variability can dominate a small sensor saving.']}
(root/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
