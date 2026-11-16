"""Reconstruct real BME reads and compensation from captured I2C, no hardware writes."""
import csv,json,sys,struct
from pathlib import Path
folder=Path(sys.argv[1]); rows=list(csv.DictReader((folder/'i2c.csv').open()))
transactions=[];current=None;reg=None;regs={};samples=[]
for row in rows:
    if row['type']=='address':
        current={'read':row['read']=='true','ack':row['ack']=='true','address':row['address'],'data':[],'time':float(row['start_time'])}
        transactions.append(current)
    elif row['type']=='data' and current is not None:current['data'].append(int(row['data'],16))
for t in transactions:
    if t['address']!='0x77' or not t['ack']:continue
    data=t['data']
    if not t['read']:
        if data:reg=data[0]
    elif reg is not None:
        for i,b in enumerate(data):regs[reg+i]=b
        if reg==0xf7 and len(data)==8:samples.append({'time_s':t['time'],'raw':data})
        reg=None
signed=lambda x,b:x-(1<<b) if x&(1<<(b-1)) else x
u16=lambda r:regs[r]|regs[r+1]<<8
if samples:
    t1=u16(0x88);t2=signed(u16(0x8a),16);t3=signed(u16(0x8c),16)
    h1=regs[0xa1];h2=signed(u16(0xe1),16);h3=regs[0xe3]
    h4=signed((regs[0xe4]<<4)|(regs[0xe5]&15),12)
    h5=signed((regs[0xe5]>>4)|(regs[0xe6]<<4),12);h6=signed(regs[0xe7],8)
    for s in samples:
        b=s['raw'];at=(b[3]<<12)|(b[4]<<4)|(b[5]>>4);ah=(b[6]<<8)|b[7]
        fine=(((at>>3)-(t1<<1))*t2>>11)+(((((at>>4)-t1)**2>>12)*t3)>>14)
        temp=((fine*5+128)>>8)/100
        h=fine-76800
        h=(((ah<<14)-(h4<<20)-h5*h+16384)>>15)*((((((h*h6)>>10)*(((h*h3)>>11)+32768))>>10)+2097152)*h2+8192>>14)
        h-=((((h>>15)*(h>>15))>>7)*h1)>>4
        rh=(max(0,min(419430400,h))>>12)/1024
        s.update(temperature_c=temp,humidity_pct=rh,plausible=-10<temp<60 and 0<rh<100)
acks=[t for t in transactions if t['address']=='0x77']
result={'chip_id':hex(regs.get(0xd0,0)),'address':'0x77','address_frames':len(acks),'all_address_frames_acked':bool(acks) and all(t['ack'] for t in acks),'delivered_samples':samples,'sample_count':len(samples),'register_writes':[t for t in transactions if t['address']=='0x77' and not t['read'] and len(t['data'])>1],'limitation':'I2C proves sensor initialization and completed application sample fetch; no USB UART during P21 measurement, so later application stability is not observable from an idle I2C bus.'}
(folder/'bme.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
if not samples or result['chip_id']!='0x60' or not result['all_address_frames_acked'] or not all(s['plausible'] for s in samples):raise RuntimeError('BME validation failed')
power=json.loads((folder/'power.json').read_text());power['delivered_sensor_samples']=len(samples);power['window_energy_per_delivered_sample_j']=power['energy_j']/len(samples);power['energy_scope']='Whole DK power-on window per delivered BME sample, not isolated sensor conversion energy'
(folder/'power.json').write_text(json.dumps(power,indent=2)+'\n')
