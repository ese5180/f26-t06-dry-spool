const paths = {
  monitor: ["M3 15a9 9 0 0 1 18 0", "M5 15v3h14v-3", "m12 13 4-5", "M6.5 10 5 9", "m9 7-.5-2", "m15 7 .5-2", "m18 10 1-1"],
  devices: ["m12 3 9 5v9l-9 5-9-5V8Z", "m3 8 9 5 9-5", "M12 13v9"],
  settings: ["m9.5 3-.7 2.4-2 .9-2.3-.6L2 10l1.8 1.7v2.2L2 15.6l2.5 3.3 2.3-.6 2 .9.7 2.3h5l.7-2.3 2-.9 2.3.6 2.5-3.3-1.8-1.7v-2.2L22 10l-2.5-3.3-2.3.6-2-.9-.7-2.4Z", "M15.5 12.3a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"],
  humidity: ["M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z"],
  temperature: ["M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0Z", "M12 8v10"],
  filament: ["M20 5c0 2-16 2-16 0s16-2 16 0Z", "M4 5v4c0 2 16 2 16 0V5", "M4 10v4c0 2 16 2 16 0v-4", "M4 15v4c0 2 16 2 16 0v-4"],
  plus: ["M12 5v14", "M5 12h14"],
  chevron: ["m7 10 5 5 5-5"],
};

export function Icon({name, className = ""}) {
  return <svg className={"icon " + className} viewBox="0 0 24 24" width="24" height="24" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[name].map((d, i) => <path key={i} d={d} />)}
  </svg>;
}

export function Brand() {
  return <div className="brand"><span className="brand-symbol" aria-hidden="true">//</span><span>DrySpool</span></div>;
}
