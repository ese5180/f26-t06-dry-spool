"""Plot the saved one-second current averages; no hardware access."""
from pathlib import Path
import csv
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(__file__).resolve().parent
fig,ax=plt.subplots(figsize=(10,4.6))
for mode,color in [('normal','#d16b24'),('forced','#2166ac')]:
    with (root/f'{mode}-300s'/'current-1s.csv').open() as stream:rows=list(csv.DictReader(stream))
    ax.plot([float(r['start_s']) for r in rows],[float(r['average_current_ma']) for r in rows],label=mode.capitalize(),color=color,linewidth=1.1)
ax.axvline(30,color='0.45',linestyle='--',linewidth=.9,label='30 s exclusion boundary')
ax.set(xlabel='Seconds from ADC capture start',ylabel='Current (mA, 1 s average)',xlim=(0,300),ylim=(0,None))
ax.set_title('Five-minute P21 input captures, 3.6 V\nSeparate runs; whole DK including BME; application stability unverified',fontsize=11)
ax.grid(alpha=.2);ax.legend();fig.tight_layout()
fig.savefig(root/'long-power-current.png',dpi=160)
print(root/'long-power-current.png')
