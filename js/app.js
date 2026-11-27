/* AutoCare · Cálculos predictivos, tablero, gráficos y eventos */
(function () {
  'use strict';

  const AC=window.AC;
  /* i18n.js se carga antes, pero si no estuviera disponible no debe abortar el
     arranque: las claves siguen visibles en el HTML y la interfaz se renderiza. */
  const I18N=AC.i18n||{t:k=>k,tl:()=>[],apply(){},set(){return false},lang:'en',locale:'en-US'};
  const T=I18N.t, TLIST=I18N.tl, LOC=()=>I18N.locale;

  /* ---------- Lógica de cálculo (sin DOM) ---------- */
  function currentOdo(E){let m=null;E.forEach(e=>{if(AC.core.hasOdo(e)&&(m==null||e.odo>m))m=e.odo});return m}

  function fuelSegments(E){
    const f=E.filter(e=>e.type==='fuel'&&AC.core.hasOdo(e)&&e.vol>0).sort((a,b)=>a.odo-b.odo||(a.date<b.date?-1:a.date>b.date?1:0));
    const out=[];let prev=null,acc=0;
    f.forEach(e=>{
      if(prev)acc+=e.vol;
      if(e.full!==false){
        if(prev&&e.odo>prev.odo&&acc>0)out.push({id:e.id,date:e.date,odo:e.odo,dist:e.odo-prev.odo,vol:acc,kmL:(e.odo-prev.odo)/acc});
        prev=e;acc=0;
      }
    });
    return out;
  }

  /* rendimiento interno en km/L → unidades elegidas */
  function effDisp(kmL,S){const fd=AC.core.DIST[S.dist].f,fv=AC.core.VOL[S.vol].f;return S.eff==='dist'?kmL*fv/fd:(100/kmL)*fd/fv}
  function effLabel(S){const d=AC.core.DIST[S.dist].u,v=AC.core.VOL[S.vol].u+(S.vol==='galUK'?' UK':'');return S.eff==='dist'?d+'/'+v:v+'/100 '+d}

  function dailyRate(E){
    const pts=E.filter(AC.core.hasOdo).map(e=>({d:e.date,o:e.odo}));
    if(pts.length<2)return null;
    pts.sort((a,b)=>a.d<b.d?-1:a.d>b.d?1:a.o-b.o);
    const last=pts[pts.length-1],cut=AC.core.addDays(last.d,-120),first=pts.filter(p=>p.d>=cut)[0];
    const days=AC.core.daysBetween(first.d,last.d),dk=last.o-first.o;
    return(days<10||dk<=0)?null:dk/days;
  }

  function remStatus(r,odo,S,today,rate){
    if(r.lastOdo==null&&!r.lastDate)return{state:'unset'};
    let leftKm=null,pct=null,nextOdo=null;
    if(r.intervalKm>0&&r.lastOdo!=null&&odo!=null){leftKm=r.intervalKm-(odo-r.lastOdo);pct=(odo-r.lastOdo)/r.intervalKm;nextOdo=r.lastOdo+r.intervalKm}
    let dueDate=null,daysLeft=null;
    if(r.intervalMonths>0&&r.lastDate){dueDate=AC.core.addMonths(r.lastDate,r.intervalMonths);daysLeft=AC.core.daysBetween(today,dueDate);
      if(pct==null){const tot=AC.core.daysBetween(r.lastDate,dueDate);pct=tot>0?AC.core.daysBetween(r.lastDate,today)/tot:1}}
    const kS=leftKm==null?'ok':leftKm<=0?'over':leftKm<=S.warnKm?'soon':'ok';
    const dS=daysLeft==null?'ok':daysLeft<0?'over':daysLeft<=S.warnDays?'soon':'ok';
    const state=(kS==='over'||dS==='over')?'over':(kS==='soon'||dS==='soon')?'soon':'ok';
    const eta=(leftKm!=null&&leftKm>0&&rate>0)?Math.round(leftKm/rate):null;
    return{state,leftKm,pct:pct==null?0:Math.max(0,pct),nextOdo,dueDate,daysLeft,kS,dS,eta};
  }
  function docStatus(d,S,today){
    if(!d.due)return{state:'unset',days:null};
    const days=AC.core.daysBetween(today,d.due);
    return{state:days<0?'over':days<=S.warnDays?'soon':'ok',days};
  }

  /* Costo real por distancia: combustible + mantenimiento/reparaciones entre
     los kilómetros efectivamente registrados (max − min del odómetro). */
  function costPerDistance(E){
    let cost=0,min=null,max=null;
    E.forEach(e=>{
      const g=e.type==='fuel'?'fuel':(e.cat&&AC.core.CATS[e.cat]?AC.core.CATS[e.cat].g:'');
      if(g==='fuel'||g==='maint'||g==='repair')cost+=e.cost||0;
    });
    E.forEach(e=>{if(AC.core.hasOdo(e)){if(min==null||e.odo<min)min=e.odo;if(max==null||e.odo>max)max=e.odo}});
    let dist=(min!=null&&max>min)?max-min:0;
    if(!(dist>0))fuelSegments(E).forEach(s=>{dist+=s.dist});
    return{cost,dist,value:dist>0?cost/dist:null};
  }

  /* ---------- Etapa 2: neumáticos y valor del vehículo (sin DOM) ---------- */
  const TIRE_ROT_KM=AC.core.TIRE_ROT_KM||10000;
  function tireStatus(t,odo,S){
    if(!t||t.installOdo==null||!(t.lifeKm>0)||odo==null)return{state:'unset'};
    const used=Math.max(0,odo-t.installOdo),left=t.lifeKm-used;
    const pct=Math.max(0,Math.min(1,used/t.lifeKm));
    const state=left<=0?'over':(left<=S.warnKm||pct>=0.85)?'soon':'ok';
    let rot=null;
    if(t.rotOdo!=null){const since=Math.max(0,odo-t.rotOdo);rot={since,due:since>=TIRE_ROT_KM}}
    return{state,left,used,pct,rot};
  }
  function valueInfo(v,E){
    const p=Number(v&&v.purchase),c=Number(v&&v.current);
    const purchase=Number.isFinite(p)&&p>0?p:null,current=Number.isFinite(c)&&c>=0?c:null;
    if(purchase==null&&current==null)return null;
    const diff=(purchase!=null&&current!=null)?current-purchase:null;
    const pct=(diff!=null&&purchase>0)?diff/purchase*100:null;
    const spend=E.reduce((a,e)=>a+((e.type==='fuel'||(e.type==='exp'&&['service','tires','repair'].indexOf(e.cat)>=0))?(e.cost||0):0),0);
    const spendPct=purchase>0?spend/purchase*100:null;
    return{purchase,current,diff,pct,spend,spendPct,net:diff==null?null:diff-spend};
  }

  function summarize(st,today){
    const E=st.entries,odo=currentOdo(E),segs=fuelSegments(E);
    let dist=0,vol=0,best=null;segs.forEach(s=>{dist+=s.dist;vol+=s.vol;best=best==null?s.kmL:Math.max(best,s.kmL)});
    const avg=vol>0?dist/vol:null,last=segs.length?segs[segs.length-1].kmL:null;
    const sum=f=>E.reduce((a,e)=>a+(f(e)?(e.cost||0):0),0);
    const mk=today.slice(0,7),pk=AC.core.addMonths(mk+'-01',-1).slice(0,7);
    const total=sum(()=>true),monthCost=sum(e=>e.date.slice(0,7)===mk),prevCost=sum(e=>e.date.slice(0,7)===pk);
    const fuels=E.filter(e=>e.type==='fuel'&&AC.core.hasOdo(e)).sort((a,b)=>a.odo-b.odo||(a.date<b.date?-1:1));
    let cpk=null;
    if(fuels.length>=2){const a=fuels[0],b=fuels[fuels.length-1],d=b.odo-a.odo;
      if(d>0){let c=0;E.forEach(e=>{if(e!==a&&e.date>=a.date&&e.date<=b.date)c+=e.cost||0});cpk=c/d}}
    let lastDate=null;E.forEach(e=>{if(AC.core.hasOdo(e)&&(lastDate==null||e.date>lastDate))lastDate=e.date});
    return{odo,segs,avg,last,best,total,monthCost,prevCost,cpk,cpd:costPerDistance(E),rate:dailyRate(E),lastDate,count:E.length};
  }

  function monthlySpend(E,today,n){
    const out=[];const base=today.slice(0,7)+'-01';
    for(let i=n-1;i>=0;i--){const k=AC.core.addMonths(base,-i).slice(0,7);out.push({key:k,g:{fuel:0,maint:0,repair:0,other:0},total:0})}
    E.forEach(e=>{const m=out.find(o=>o.key===e.date.slice(0,7));if(m&&e.cost){const g=AC.core.CATS[AC.core.catOf(e)].g;m.g[g]+=e.cost;m.total+=e.cost}});
    return out;
  }
  function catTotals(E){const t={};E.forEach(e=>{if(e.cost){const c=AC.core.catOf(e);t[c]=(t[c]||0)+e.cost}});return t}

  function niceTicks(lo,hi,n){
    if(!(hi>lo))hi=lo+1;
    const raw=(hi-lo)/n,p=Math.pow(10,Math.floor(Math.log10(raw))),m=raw/p;
    const step=(m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p;
    const a=Math.floor(lo/step+1e-9)*step,b=Math.ceil(hi/step-1e-9)*step,t=[];
    for(let v=a;v<=b+step/2;v+=step)t.push(+v.toFixed(6));
    return t;
  }

  /* Fachada única: mismas funciones que había en el index original */
  const TL=Object.assign({},AC.core,{TIRE_ROT_KM,currentOdo,fuelSegments,costPerDistance,effDisp,effLabel,dailyRate,remStatus,docStatus,tireStatus,valueInfo,summarize,monthlySpend,catTotals,niceTicks});

  /* ---------- Utilidades de interfaz ---------- */
  const $=s=>document.querySelector(s);
  const store=AC.storage;
  const cap=store.cap;
  let state=store.state;
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nf=(v,d)=>new Intl.NumberFormat(LOC(),{minimumFractionDigits:d||0,maximumFractionDigits:d||0}).format(v);
  const compact=v=>new Intl.NumberFormat(LOC(),{notation:'compact',maximumFractionDigits:1}).format(v);
  const uid=p=>p+Math.random().toString(36).slice(2,9);

  /* ---------- Ficha visual del vehículo · showroom premium ---------- */
  const BRANDS=AC.core.BRANDS, BODIES=AC.core.BODIES, COLORS=AC.core.COLORS;
  let svgSeq=0,vehicleDraft=null,demoPhotoJob=false,demoPhotoFailed=false;
  const DEMO_PHOTO=AC.core.DEMO_PHOTO||'./icons/demo-car.png';
  const EMPTY_VEHICLE=AC.core.EMPTY_VEHICLE||{brand:'',model:'',year:'',body:'hatch',color:'#F8FAFC',photoDataUrl:null,photoCut:false,usePhoto:false,empty:true};

  /* Nunca devolver el objeto compartido EMPTY_VEHICLE: si no hay vehículo se
     materializa una copia en el estado, para que guardar foto/nombre no mute la
     constante ni deje `state.vehicle` a null al persistir. */
  function veh(){
    if(!state.vehicle||typeof state.vehicle!=='object')state.vehicle=Object.assign({},EMPTY_VEHICLE);
    return state.vehicle;
  }
  /* Sólo se considera "configurado" un vehículo real, nunca el estado posterior a un reinicio. */
  const isConfigured=()=>{const v=state.vehicle;return !!(v&&!v.empty&&((v.brand&&v.brand.trim())||(v.model&&v.model.trim())||v.photoDataUrl))};
  const markConfigured=()=>{veh().empty=false};
  function shade(hex,amt){
    const h=String(hex||'#000000').replace('#',''),f=h.length===3?h.split('').map(c=>c+c).join(''):h;
    const n=parseInt(f,16)||0,r=n>>16&255,g=n>>8&255,b=n&255;
    const mix=v=>Math.round(amt>=0?v+(255-v)*amt:v*(1+amt));
    return'#'+[mix(r),mix(g),mix(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  const normHex=h=>{if(typeof h!=='string')return null;const m=h.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);if(!m)return null;const x=m[1];return (x.length===3?'#'+x[0]+x[0]+x[1]+x[1]+x[2]+x[2]:'#'+x).toUpperCase()};
  const colorOf=id=>{const p=COLORS.find(c=>c.id===id);if(p)return p;const hex=normHex(id);if(hex)return{id:'custom',n:hex,hex,light:shade(hex,.35),dark:shade(hex,-.45)};return COLORS[0]};
  const colorName=id=>{const p=COLORS.find(c=>c.id===id);if(p)return T('color.'+p.id);const hex=normHex(id);return hex||T('color.'+COLORS[0].id)};
  const bodyName=id=>T('body.'+(BODIES.some(x=>x.id===id)?id:BODIES[0].id));

  /* Blueprint HUD: siluetas de trazo fino, sin rellenos, con proporciones por carrocería */
  const SHAPES={
    hatch:{
      profile:'M96 187 L96 150 Q98 138 118 133 L196 128 L244 90 Q268 70 328 68 L394 72 Q428 80 450 108 L528 126 Q554 134 556 154 L556 187 L506 187 A35 35 0 0 0 436 187 L194 187 A35 35 0 0 0 124 187 L96 187 Z',
      glass:['M252 96 Q272 76 328 74 L392 78 Q422 86 442 110 L252 110 Z','M336 74 L336 110'],
      detail:'M252 110 L248 178 M442 110 L442 154 M104 142 L196 132 M470 124 L470 132 M428 116 L448 116',
      wheels:[[159,187,29],[471,187,29]],wb:'2520'
    },
    sedan:{
      profile:'M60 187 L60 146 Q62 134 84 130 L190 126 L238 88 Q266 68 330 66 L416 70 Q452 78 474 106 L540 124 Q570 132 572 152 L572 187 L521 187 A35 35 0 0 0 451 187 L185 187 A35 35 0 0 0 115 187 L60 187 Z',
      glass:['M248 94 Q270 74 330 72 L414 76 Q448 84 468 108 L248 108 Z','M342 72 L342 108'],
      detail:'M248 108 L244 178 M468 108 L468 148 M72 136 L190 132 M474 112 L538 128 M408 118 L424 118',
      wheels:[[150,187,29],[486,187,29]],wb:'2710'
    },
    suv:{
      profile:'M56 185 L58 112 Q60 98 82 94 L176 90 L212 52 Q230 40 268 38 L426 38 Q468 40 490 74 L542 98 Q572 108 574 134 L574 185 L527 185 A43 43 0 0 0 441 185 L197 185 A43 43 0 0 0 111 185 L56 185 Z',
      glass:['M224 82 L232 54 Q244 48 270 48 L422 48 Q460 50 482 80 L224 80 Z','M338 48 L338 80 M426 48 L426 80'],
      detail:'M224 80 L220 174 M482 80 L482 148 M68 104 L214 94 M490 90 L540 110',
      extra:'M216 34 L220 26 L422 26 L428 34 M232 26 L232 20 L402 20 L402 26',
      wheels:[[154,185,31],[484,185,31]],wb:'2860'
    },
    pickup:{
      profile:'M58 187 L58 126 L224 126 L236 80 Q246 64 272 62 L380 60 Q408 62 422 86 L432 112 L544 128 Q572 136 574 156 L574 187 L525 187 A35 35 0 0 0 455 187 L185 187 A35 35 0 0 0 115 187 L58 187 Z',
      glass:['M246 98 L252 80 Q262 68 280 66 L378 64 Q404 66 416 84 L426 106 L246 106 Z','M380 64 L380 106'],
      detail:'M246 106 L246 178 M426 106 L426 178 M224 126 L224 178 M436 118 L540 134 M432 124 L444 124',
      extra:'M64 138 L214 138 L214 178 L64 178 Z M64 158 L214 158',
      wheels:[[150,187,29],[490,187,29]],wb:'3090'
    },
    coupe:{
      profile:'M56 186 L58 154 Q62 140 90 136 L204 128 L258 98 Q292 84 348 90 L404 96 Q444 104 470 132 L538 144 Q566 150 570 166 L570 186 L517 186 A35 35 0 0 0 447 186 L193 186 A35 35 0 0 0 123 186 L56 186 Z',
      glass:['M266 106 Q296 92 348 96 L402 102 Q434 110 458 130 L266 118 Z','M356 96 L356 118'],
      detail:'M266 118 L262 176 M458 130 L458 156 M92 142 L204 134 M470 138 L536 148 M410 124 L426 124',
      wheels:[[158,186,30],[482,186,30]],wb:'2600'
    }
  };

  /* Tinta HUD: usa el color elegido y lo aclara cuando es demasiado oscuro para el fondo */
  function hudInk(c){
    const n=parseInt(c.hex.slice(1),16);
    const lum=(n>>16&255)*.299+(n>>8&255)*.587+(n&255)*.114;
    return lum<110?shade(c.light,Math.min(.5,(110-lum)/255+.12)):c.hex;
  }
  function defs(u,ink){
    return'<defs>'
      +'<pattern id="g'+u+'" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 L0 0 0 20" fill="none" stroke="'+ink+'" stroke-width=".5" stroke-linecap="round" opacity=".14"/></pattern>'
      +'<pattern id="G'+u+'" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0 L0 0 0 100" fill="none" stroke="'+ink+'" stroke-width=".8" stroke-linecap="round" opacity=".2"/></pattern>'
      +'<filter id="gl'+u+'" x="-25%" y="-35%" width="150%" height="170%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="'+ink+'" flood-opacity=".6"/></filter>'
      +'</defs>';
  }
  function hudGrid(u,ink){
    let h='<g fill="none" stroke="'+ink+'" stroke-linecap="round">';
    h+='<rect x="0" y="0" width="640" height="250" fill="url(#g'+u+')" stroke="none" opacity=".8"/>';
    h+='<rect x="0" y="0" width="640" height="250" fill="url(#G'+u+')" stroke="none" opacity=".7"/>';
    h+='<path d="M18 36 L18 20 L38 20 M602 20 L622 20 L622 36 M18 214 L18 230 L38 230 M602 230 L622 230 L622 214" stroke-width="1" opacity=".4"/>';
    h+='<path d="M320 18 L320 202" stroke-width=".8" stroke-dasharray="2 7" opacity=".22"/>';
    h+='<path d="M50 24 L50 32 M590 24 L590 32 M50 218 L50 224 M590 218 L590 224" stroke-width=".8" opacity=".3"/>';
    return h+'</g>';
  }
  function hudGround(ink,a,b,wb){
    let ticks='';for(let x=80;x<600;x+=40)ticks+='M'+x+' 213 L'+x+' 219 ';
    let h='<g fill="none" stroke="'+ink+'" stroke-linecap="round">';
    h+='<path d="M48 216 L592 216" stroke-width="1" opacity=".5"/>';
    h+='<path d="'+ticks.trim()+'" stroke-width=".8" opacity=".22"/>';
    h+='<path d="M'+a+' 217 L'+a+' 236 M'+b+' 217 L'+b+' 236 M'+a+' 232 L'+b+' 232" stroke-width="1" opacity=".55"/>';
    h+='<path d="M'+a+' 232 l7 -3 m-7 3 l7 3 M'+b+' 232 l-7 -3 m7 3 l-7 3" stroke-width="1" opacity=".7"/>';
    h+='</g><text x="'+((a+b)/2)+'" y="228" text-anchor="middle" fill="'+ink+'" opacity=".8" font-family="monospace" font-size="9" letter-spacing="1.2">WB '+wb+'</text>';
    return h;
  }
  function wheel(ink,x,y,r){
    const inner=r-8;
    let h='<g transform="translate('+x+' '+y+')" fill="none" stroke="'+ink+'" stroke-linecap="round">';
    h+='<circle r="'+r+'" stroke-width="1.75"/>';
    h+='<circle r="'+inner+'" stroke-width="1" opacity=".55"/>';
    h+='<circle r="4.5" stroke-width="1.75"/>';
    let spokes='';for(let i=0;i<5;i++){const t=(i*72-90)*Math.PI/180;spokes+='M'+(Math.cos(t)*7).toFixed(1)+' '+(Math.sin(t)*7).toFixed(1)+' L'+(Math.cos(t)*inner).toFixed(1)+' '+(Math.sin(t)*inner).toFixed(1)+' '}
    h+='<path d="'+spokes.trim()+'" stroke-width="1" opacity=".65"/>';
    h+='<path d="M0 '+(-r-3)+' L0 '+(-r+2)+' M0 '+(r-2)+' L0 '+(r+3)+'" stroke-width=".8" opacity=".35"/>';
    return h+'</g>';
  }
  function carArt(u,s,ink){
    let h='<g filter="url(#gl'+u+')" fill="none" stroke="'+ink+'" stroke-linecap="round" stroke-linejoin="round">';
    h+='<path d="'+s.profile+'" stroke-width="1.75"/>';
    if(s.extra)h+='<path d="'+s.extra+'" stroke-width="1.2" opacity=".7"/>';
    (s.glass||[]).forEach(g=>{h+='<path d="'+g+'" stroke-width="1.2" opacity=".7"/>'});
    if(s.detail)h+='<path d="'+s.detail+'" stroke-width="1" opacity=".5"/>';
    (s.wheels||[]).forEach(w=>{h+=wheel(ink,w[0],w[1],w[2])});
    return h+'</g>';
  }
  function motoArt(u,ink,w){
    let h='<g filter="url(#gl'+u+')" fill="none" stroke="'+ink+'" stroke-linecap="round" stroke-linejoin="round">';
    w.forEach(x=>{h+=wheel(ink,x[0],x[1],x[2])});
    h+='<path d="M160 184 L300 170 M300 170 L236 138 L318 130 L382 136 L420 150 L476 184 M318 130 L300 170 L382 136" stroke-width="1.75"/>';
    h+='<path d="M420 150 L452 112 L476 184 M438 112 L466 104 M452 112 L452 100" stroke-width="1.75"/>';
    h+='<path d="M262 136 Q280 108 330 106 L382 112 L396 134 L318 130 Z M382 112 L424 118 L432 128 L386 132" stroke-width="1.2" opacity=".85"/>';
    h+='<circle cx="320" cy="160" r="13" stroke-width="1.2"/><path d="M308 160 L332 160 M320 148 L320 172 M326 174 L388 174 Q420 174 438 160 M440 162 L448 158" stroke-width="1" opacity=".7"/>';
    h+='<path d="M132 160 Q156 148 178 160 M444 158 Q468 146 492 160" stroke-width="1.2" opacity=".7"/>';
    return h+'</g>';
  }
  function vehicleSVG(v){
    const u='v'+(++svgSeq),c=colorOf(v.color),ink=hudInk(c),moto=v.body==='moto',s=SHAPES[v.body]||SHAPES.hatch;
    const w=moto?[[160,184,32],[476,184,32]]:s.wheels;
    return'<svg viewBox="0 0 640 250" role="img" aria-label="'+esc(bodyName(v.body)+' '+colorName(v.color))+'">'
      +defs(u,ink)+hudGrid(u,ink)+hudGround(ink,w[0][0],w[1][0],moto?'1420':s.wb)
      +(moto?motoArt(u,ink,w):carArt(u,s,ink))+'</svg>';
  }

  /* ---------- Plano HUD real: bordes de la foto recortada (Sobel en canvas) ---------- */
  const BP_W=640,BP_H=250,BP_CACHE=new Map(),BP_PENDING=new Map(),BP_FAILED=new Set(),BP_MAX=8;
  let visualEpoch=0;
  /* Limpia fotos, planos y trabajos en curso para que un reinicio no "resucite" la imagen anterior. */
  function clearVehicleVisuals(){
    visualEpoch++;
    BP_CACHE.clear();BP_PENDING.clear();BP_FAILED.clear();
    demoPhotoJob=false;demoPhotoFailed=false;cutInFlight=null;vehicleDraft=null;
    killAIWorker();failActiveJob(cutError(true));
    document.querySelectorAll('.veh-bp-img,.veh-cutout,.veh-progress').forEach(el=>el.remove());
  }
  AC.clearVisuals=clearVehicleVisuals;
  function bpKey(src,ink){
    let h=2166136261;const step=Math.max(1,Math.floor(src.length/512));
    for(let i=0;i<src.length;i+=step){h^=src.charCodeAt(i);h=Math.imul(h,16777619)}
    return(h>>>0).toString(36)+'|'+ink;
  }
  function bpInk(accentColor){
    if(typeof accentColor==='string')return accentColor;
    const c=accentColor&&accentColor.hex?accentColor:colorOf(veh().color);
    return hudInk(c);
  }
  function bpRGB(hex){
    const h=String(hex||'#5598e7').replace('#',''),f=h.length===3?h.split('').map(c=>c+c).join(''):h;
    const n=parseInt(f,16)||0x5598e7;
    return[n>>16&255,n>>8&255,n&255];
  }
  function bpGrid(ctx,rgb){
    const ink=a=>'rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+a+')';
    ctx.fillStyle='#080c12';ctx.fillRect(0,0,BP_W,BP_H);
    const glow=ctx.createRadialGradient(BP_W/2,BP_H*.95,8,BP_W/2,BP_H*.95,BP_W*.72);
    glow.addColorStop(0,ink(.12));glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,BP_W,BP_H);
    ctx.lineWidth=1;ctx.strokeStyle=ink(.085);ctx.beginPath();
    for(let x=0;x<=BP_W;x+=20){ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,BP_H)}
    for(let y=0;y<=BP_H;y+=20){ctx.moveTo(0,y+.5);ctx.lineTo(BP_W,y+.5)}
    ctx.stroke();
    ctx.strokeStyle=ink(.16);ctx.beginPath();
    for(let x=0;x<=BP_W;x+=100){ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,BP_H)}
    for(let y=0;y<=BP_H;y+=100){ctx.moveTo(0,y+.5);ctx.lineTo(BP_W,y+.5)}
    ctx.stroke();
    ctx.strokeStyle=ink(.42);ctx.lineWidth=1.2;ctx.beginPath();
    ctx.moveTo(18,36);ctx.lineTo(18,20);ctx.lineTo(38,20);
    ctx.moveTo(602,20);ctx.lineTo(622,20);ctx.lineTo(622,36);
    ctx.moveTo(18,214);ctx.lineTo(18,230);ctx.lineTo(38,230);
    ctx.moveTo(602,230);ctx.lineTo(622,230);ctx.lineTo(622,214);
    ctx.stroke();
    ctx.setLineDash([2,7]);ctx.strokeStyle=ink(.22);ctx.beginPath();
    ctx.moveTo(320,18);ctx.lineTo(320,202);ctx.stroke();ctx.setLineDash([]);
    ctx.strokeStyle=ink(.42);ctx.beginPath();ctx.moveTo(48,216.5);ctx.lineTo(592,216.5);ctx.stroke();
    ctx.strokeStyle=ink(.22);ctx.beginPath();
    for(let x=80;x<600;x+=40){ctx.moveTo(x+.5,213);ctx.lineTo(x+.5,219)}
    ctx.stroke();
    ctx.fillStyle=ink(.55);ctx.font='9px monospace';
    ctx.fillText('CAD / EDGE SCAN',22,33);
    ctx.textAlign='right';ctx.fillText('HUD 640x250',618,33);ctx.textAlign='left';
  }
  async function buildBlueprint(photoDataUrl,ink){
    const im=await loadImage(photoDataUrl),W=BP_W,H=BP_H,N=W*H;
    const DETAIL_THR=30,CONTOUR_THR=90; /* luminancia (interiores) y alfa (contorno) */
    const raw=document.createElement('canvas');
    raw.width=im.naturalWidth||im.width;raw.height=im.naturalHeight||im.height;
    raw.getContext('2d',{willReadFrequently:true}).drawImage(im,0,0);
    const cut=trimTransparentPixels(raw,12),rgb=bpRGB(ink);
    const work=document.createElement('canvas');work.width=W;work.height=H;
    const wctx=work.getContext('2d',{willReadFrequently:true});
    const sc=Math.min(536/cut.width,168/cut.height),dw=cut.width*sc,dh=cut.height*sc;
    wctx.drawImage(cut,(W-dw)/2,34+(168-dh)/2,dw,dh);
    const px=wctx.getImageData(0,0,W,H).data;
    const val=new Float32Array(N),alphaArr=new Float32Array(N),blur=new Float32Array(N);
    const score=new Float32Array(N),lumMag=new Float32Array(N),alphaMag=new Float32Array(N);
    const gxArr=new Float32Array(N),gyArr=new Float32Array(N),axArr=new Float32Array(N),ayArr=new Float32Array(N);
    for(let i=0,p=0;i<px.length;i+=4,p++){
      const a=px[i+3];alphaArr[p]=a;
      /* sólo el interior (alfa > 50) aporta luminancia: parrilla, faros, puertas, llantas */
      val[p]=a>50?px[i]*.299+px[i+1]*.587+px[i+2]*.114:0;
    }
    for(let y=0;y<H;y++){const o=y*W;for(let x=0;x<W;x++){const i=o+x;
      blur[i]=(val[i>0?i-1:i]+2*val[i]+val[i<o+W-1?i+1:i])*.25}}
    for(let y=0;y<H;y++){const o=y*W;for(let x=0;x<W;x++){const i=o+x;
      val[i]=(blur[i>=W?i-W:i]+2*blur[i]+blur[i<N-W?i+W:i])*.25}}
    for(let y=1;y<H-1;y++){for(let x=1;x<W-1;x++){
      const i=y*W+x;
      const gx=(val[i-W+1]+2*val[i+1]+val[i+W+1])-(val[i-W-1]+2*val[i-1]+val[i+W-1]);
      const gy=(val[i+W-1]+2*val[i+W]+val[i+W+1])-(val[i-W-1]+2*val[i-W]+val[i-W+1]);
      const ax=(alphaArr[i-W+1]+2*alphaArr[i+1]+alphaArr[i+W+1])-(alphaArr[i-W-1]+2*alphaArr[i-1]+alphaArr[i+W-1]);
      const ay=(alphaArr[i+W-1]+2*alphaArr[i+W]+alphaArr[i+W+1])-(alphaArr[i-W-1]+2*alphaArr[i-W]+alphaArr[i-W+1]);
      const m=Math.sqrt(gx*gx+gy*gy),am=Math.sqrt(ax*ax+ay*ay);
      gxArr[i]=gx;gyArr[i]=gy;axArr[i]=ax;ayArr[i]=ay;
      lumMag[i]=m;alphaMag[i]=am;
      score[i]=Math.max(m/DETAIL_THR,am/CONTOUR_THR); /* 1 = umbral superado */
    }}
    const edge=document.createElement('canvas');edge.width=W;edge.height=H;
    const ectx=edge.getContext('2d'),out=ectx.createImageData(W,H),o=out.data;
    for(let y=1;y<H-1;y++){for(let x=1;x<W-1;x++){
      const i=y*W+x,s0=score[i];if(s0<1)continue;
      const fromAlpha=alphaMag[i]/CONTOUR_THR>lumMag[i]/DETAIL_THR;
      const hDir=fromAlpha?Math.abs(axArr[i])>=Math.abs(ayArr[i]):Math.abs(gxArr[i])>=Math.abs(gyArr[i]);
      const a=hDir?score[i-1]:score[i-W],b=hDir?score[i+1]:score[i+W];
      if(s0<a||s0>b)continue; /* supresión no máxima: trazo de 1 px */
      const s=Math.min(1,(s0-1)/2.5),j=i*4;
      /* cian luminoso en los trazos finos, blanco en los más definidos */
      o[j]=Math.round(165+90*s);o[j+1]=Math.round(232+23*s);o[j+2]=255;
      o[j+3]=Math.round(70+185*Math.pow(s,.6));
    }}
    ectx.putImageData(out,0,0);
    const res=document.createElement('canvas');res.width=W;res.height=H;
    const ctx=res.getContext('2d');bpGrid(ctx,rgb);
    /* base muy sutil: silueta tintada con el color elegido para dar volumen */
    const sil=document.createElement('canvas');sil.width=W;sil.height=H;
    const sctx=sil.getContext('2d'),sout=sctx.createImageData(W,H),sd=sout.data;
    for(let p=0,j=0;p<N;p++,j+=4){
      if(alphaArr[p]<=50)continue;
      sd[j]=rgb[0];sd[j+1]=rgb[1];sd[j+2]=rgb[2];sd[j+3]=alphaArr[p];
    }
    sctx.putImageData(sout,0,0);
    ctx.save();ctx.globalAlpha=.09;ctx.drawImage(sil,0,0);ctx.restore();
    ctx.save();ctx.globalCompositeOperation='lighter';
    ctx.shadowColor='rgba(150,232,255,.85)';ctx.shadowBlur=8;
    ctx.globalAlpha=.5;ctx.drawImage(edge,0,0);
    ctx.shadowBlur=0;ctx.globalAlpha=1;ctx.drawImage(edge,0,0);ctx.restore();
    return res.toDataURL('image/png');
  }
  /* Devuelve un PNG listo para mostrar; memoriza el resultado por foto + color. */
  function generateBlueprintFromPhoto(photoDataUrl,accentColor){
    if(!photoDataUrl)return Promise.resolve(null);
    const ink=bpInk(accentColor),key=bpKey(photoDataUrl,ink);
    if(BP_CACHE.has(key))return Promise.resolve(BP_CACHE.get(key));
    if(BP_PENDING.has(key))return BP_PENDING.get(key);
    if(BP_FAILED.has(key))return Promise.resolve(null);
    const epoch=visualEpoch;
    const p=buildBlueprint(photoDataUrl,ink).then(data=>{
      if(BP_PENDING.get(key)===p)BP_PENDING.delete(key);
      if(epoch!==visualEpoch)return null;
      BP_CACHE.set(key,data);
      if(BP_CACHE.size>BP_MAX)BP_CACHE.delete(BP_CACHE.keys().next().value);
      paintBlueprints();return data;
    },()=>{
      if(BP_PENDING.get(key)===p)BP_PENDING.delete(key);
      if(epoch===visualEpoch)BP_FAILED.add(key);
      return null;
    });
    BP_PENDING.set(key,p);return p;
  }
  function cachedBlueprint(v){
    return v&&v.photoDataUrl?BP_CACHE.get(bpKey(v.photoDataUrl,bpInk(colorOf(v.color))))||null:null;
  }
  function ensureBlueprint(v){if(hasPhoto(v))generateBlueprintFromPhoto(v.photoDataUrl,colorOf(v.color))}
  function paintBlueprints(){
    const v=veh(),data=cachedBlueprint(v);if(!data)return;
    document.querySelectorAll('.veh-bp-pending').forEach(el=>{
      const img=document.createElement('img');img.className='veh-bp-img';img.alt=T('blueprintAria');img.src=data;
      el.replaceWith(img);
    });
  }
  /* Silueta geométrica de referencia, sin foto */
  function blueprintPlaceholder(v,scanning){
    const u='b'+(++svgSeq),ink=hudInk(colorOf(v.color)),s=SHAPES[v.body]||SHAPES.hatch;
    const wb=v.body==='moto'?'1420':s.wb;
    let h='<svg viewBox="0 0 640 250" role="img" aria-label="'+esc(T('blueprintAria'))+'">';
    h+=defs(u,ink)+hudGrid(u,ink)+hudGround(ink,176,470,wb);
    h+='<g fill="none" stroke="'+ink+'" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="5 4" '
      +'filter="url(#gl'+u+')" opacity="'+(scanning?'.5':'.72')+'">';
    h+='<path d="M104 186 L108 146 L196 138 L248 100 L268 84 L420 84 Q448 88 470 112 L540 130 L556 150 L556 186" stroke-width="1.6"/>';
    h+='<path d="M248 100 L248 138 M470 112 L470 138 M196 138 L470 138 M108 146 L196 138 M540 130 L556 150" stroke-width="1" opacity=".6"/>';
    h+='<circle cx="176" cy="186" r="27" stroke-width="1.4"/><circle cx="470" cy="186" r="27" stroke-width="1.4"/>';
    return h+'</g></svg>';
  }
  function blueprintVisual(v){
    if(hasPhoto(v)){
      const data=cachedBlueprint(v);
      if(data)return'<img class="veh-bp-img" src="'+data+'" alt="'+esc(T('blueprintAria'))+'">';
      ensureBlueprint(v);
      return'<div class="veh-bp-pending">'+blueprintPlaceholder(v,true)+'</div>';
    }
    return'<div class="veh-bp-empty">'+blueprintPlaceholder(v,false)
      +'<p class="veh-bp-hint">'+esc(T('blueprintEmpty'))+'</p></div>';
  }

  function isPhotoActive(v){return !!(v&&v.usePhoto&&v.photoDataUrl)}
  function hasPhoto(v){return !!(v&&v.photoDataUrl)}

  function vehicleVisual(v){
    if(isPhotoActive(v)){
      const src=esc(v.photoDataUrl),alt=esc(T('myVehicle'));
      if(v.photoCut)return'<div class="veh-cutout is-cut"><img class="veh-reflection" src="'+src+'" alt="" aria-hidden="true"><img class="veh-photo" src="'+src+'" alt="'+alt+'"></div>';
      return'<div class="veh-cutout is-pano"><img class="veh-photo" src="'+src+'" alt="'+alt+'"></div>';
    }
    return blueprintVisual(v);
  }

  function stageHTML(v){
    const photo=isPhotoActive(v);
    const badge=photo
      ?'<span class="veh-badge"><svg width="20" height="20" class="ico"><use href="#i-camera"/></svg>'+T(v.photoCut?'cutoutBadge':'photoBadge')+'</span>'
      :'<span class="veh-badge"><svg width="20" height="20" class="ico"><use href="#i-cube"/></svg>'+T('blueprintBadge')+'</span>';
    const cls=photo?(v.photoCut?' cut':' pano'):' blueprint';
    return'<div class="veh-visual"><div class="veh-stage'+cls+'">'+badge+vehicleVisual(v)+'</div></div>';
  }

  /* Selector compacto del garaje: siempre visible, también con el estado en blanco. */
  function garageBarHTML(){
    const list=store.garage.list(),active=store.garage.activeId();
    const opts=list.map(r=>'<option value="'+esc(r.id)+'"'+(r.id===active?' selected':'')+'>'+esc(r.label)+'</option>').join('');
    return'<div class="garage-bar">'
      +'<label class="garage-sel"><svg width="18" height="18" class="ico"><use href="#i-car"/></svg><span class="sr-only">'+esc(T('garageSelect'))+'</span>'
      +'<select id="garageSel" data-i18n-aria="garageSelect" aria-label="'+esc(T('garageSelect'))+'">'+opts+'</select></label>'
      +'<span class="garage-count" title="'+esc(T('garageCount',{n:list.length}))+'">'+list.length+'</span>'
      +'<button type="button" class="btn sm ghost garage-add" data-act="veh-add" data-i18n-title="addVehicle" title="'+esc(T('addVehicle'))+'" aria-label="'+esc(T('addVehicle'))+'"><svg width="20" height="20" class="ico"><use href="#i-plus"/></svg><span>'+T('addVehicle')+'</span></button>'
      +'<button type="button" class="icon-btn garage-del" data-act="veh-del" data-i18n-title="deleteVehicle" title="'+esc(T('deleteVehicle'))+'" aria-label="'+esc(T('deleteVehicle'))+'"><svg width="20" height="20" class="ico"><use href="#i-x"/></svg></button>'
      +'</div>';
  }

  /* Estado en blanco: silueta genérica + invitación explícita a configurar nombre y foto. */
  function emptyStageHTML(){
    return'<div class="veh-visual"><div class="veh-stage blueprint">'
      +'<span class="veh-badge"><svg width="20" height="20" class="ico"><use href="#i-cube"/></svg>'+T('blueprintBadge')+'</span>'
      +'<div class="veh-bp-empty">'+blueprintPlaceholder(EMPTY_VEHICLE,false)
      +'<p class="veh-bp-hint">'+esc(T('setupHint'))+'</p></div></div></div>';
  }
  function renderEmptyVehicle(){
    $('#vehicleCard').innerHTML=garageBarHTML()+'<div class="veh">'+emptyStageHTML()+'<div class="veh-body">'
      +'<div class="veh-kicker">'+esc(T('noVehicle'))+'</div>'
      +'<h2 class="veh-name">'+esc(T('setupVehicle'))+'</h2>'
      +'<div class="veh-tools">'
      +'<button type="button" class="btn sm" data-act="edit-vehicle"><svg width="20" height="20" class="ico"><use href="#i-edit"/></svg>'+T('editVehicle')+'</button>'
      +'<label class="btn sm ghost" for="vehPhotoEmpty"><svg width="20" height="20" class="ico"><use href="#i-camera"/></svg>'+T('uploadPhoto')+'</label>'
      +'<input id="vehPhotoEmpty" type="file" accept="image/*" hidden>'
      +'</div></div></div>';
  }
  function renderVehicle(){
    if(!isConfigured()){renderEmptyVehicle();return}
    const v=veh(),c=colorOf(v.color),name=AC.core.vehicleLabel(v),photo=isPhotoActive(v),has=hasPhoto(v);
    if(has)ensureBlueprint(v); /* se precalcula para que el cambio de vista sea instantáneo */
    $('#vehicleCard').innerHTML=garageBarHTML()+'<div class="veh">'+stageHTML(v)+'<div class="veh-body">'
      +'<div class="veh-kicker">'+T('myVehicle')+'</div><h2 class="veh-name">'+esc(name||T('myCar'))+'</h2>'
      +'<div class="veh-meta"><span>'+esc(v.year)+'</span><span class="sep">·</span><span>'+esc(bodyName(v.body))+'</span><span class="sep">·</span>'
      +'<span class="dot" style="background:'+c.hex+'"></span><span>'+esc(colorName(v.color))+'</span></div>'
      +'<div class="veh-tools">'
      +'<button type="button" class="btn sm" data-act="edit-vehicle"><svg width="20" height="20" class="ico"><use href="#i-edit"/></svg>'+T('editVehicle')+'</button>'
      +'<label class="btn sm ghost" for="vehPhoto"><svg width="20" height="20" class="ico"><use href="#i-camera"/></svg>'+T(has?'changePhoto':'uploadPhoto')+'</label>'
      +'<input id="vehPhoto" type="file" accept="image/*" hidden>'
      +(has?'<button type="button" class="btn sm ghost" data-act="veh-view-toggle"><svg width="20" height="20" class="ico"><use href="#i-'+(photo?'cube':'camera')+'"/></svg>'+T(photo?'useBlueprint':'useMyPhoto')+'</button>':'')
      +(has&&(v.photoOriginal||v.photoCutDataUrl)?'<button type="button" class="btn sm ghost" data-act="veh-cut-toggle"><svg width="20" height="20" class="ico"><use href="#i-'+(v.photoCut&&!isStaleCut(v)?'camera':'cube')+'"/></svg>'+T(v.photoCut&&!isStaleCut(v)?'originalPhoto':'cutoutAI')+'</button>':'')
      +'</div></div></div>';
  }

  /* Inclinación 3D sutil (se enlaza una sola vez sobre la tarjeta) */
  function initTilt(){
    const card=$('#vehicleCard');if(!card)return;
    card.addEventListener('pointermove',e=>{
      const v=card.querySelector('.veh-visual'),st=card.querySelector('.veh-stage');if(!v||!st)return;
      const r=st.getBoundingClientRect();if(!r.width||!r.height)return;
      const px=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),py=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));
      v.style.setProperty('--ry',((px-.5)*7).toFixed(2)+'deg');
      v.style.setProperty('--rx',((.5-py)*5).toFixed(2)+'deg');
    });
    const reset=()=>{const v=card.querySelector('.veh-visual');if(v){v.style.setProperty('--ry','0deg');v.style.setProperty('--rx','0deg')}};
    card.addEventListener('pointerleave',reset);card.addEventListener('pointercancel',reset);
  }

  /* ---------- Recorte de fondo client-side (Web Worker + Transformers.js) ----------
     El módulo ESM, los pesos ONNX/WASM y la inferencia se ejecutan en
     js/bg-worker.js. El Worker devuelve RGBA crudo; el hilo principal crea el
     <canvas> y codifica el PNG con toDataURL (compatible con WebKit móvil).
     El PNG resultante se guarda en localStorage con el modelo que lo generó;
     un recorte de un modelo anterior se regenera al pulsar "Recorte IA". */
  const readFile=file=>new Promise((res,rej)=>{const rd=new FileReader();rd.onload=()=>res(rd.result);rd.onerror=()=>rej(new Error('file'));rd.readAsDataURL(file)});
  const loadImage=src=>new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('image'));im.src=src});
  const BG_WORKER_URL=new URL('./js/bg-worker.js',document.baseURI).href;
  /* Modelo válido para recortes vehiculares, compartido por PC y móvil. MODNet
     se excluye: está entrenado para personas y puede borrar casi toda la
     carrocería en autos claros. SegFormer-B0 q8 (~4 MB) además evita los
     abortos de Safari/WebKit con ONNX grandes sin caché persistente. */
  const BG_MODEL_ID='Xenova/segformer-b0-finetuned-ade-512-512';
  const BG_MODEL_IDS=[BG_MODEL_ID];
  const MIN_VISIBLE_MASK_RATIO=0.08; /* <8% visible => máscara rota / recorte vacío */
  /* Móvil = pantalla < 900 px O puntero grueso (cualquier dispositivo táctil). */
  const isMobileAI=()=>!!(window.matchMedia&&(window.matchMedia('(max-width:899px)').matches||window.matchMedia('(pointer:coarse)').matches));
  /* Mismo modelo en PC y móvil: 1024 px en PC, 512 px en móvil. */
  const aiMaxEdge=()=>isMobileAI()?512:1024;
  const PHOTO_FIELDS=['photoDataUrl','photoOriginal','photoFallback','photoCutDataUrl','photoCutModel','photoCut','photoCutWanted','photoView','usePhoto'];
  let cutInFlight=null,bgModelUsed='',aiWorker=null,activeAIJob=null,aiJobSeq=0;
  /* Un PNG guardado por una versión anterior no tiene photoCutModel (o tiene un
     id que ya no usamos): se considera obsoleto y se regenera bajo demanda. */
  const isStaleCut=v=>!!(v&&v.photoCutDataUrl&&(!v.photoCutModel||BG_MODEL_IDS.indexOf(v.photoCutModel)<0));
  /* Fuente siempre sin recortar: si la vista actual es el PNG recortado, se
     vuelve a la original guardada (o a la foto de demo) para no degradar el
     resultado al segmentar dos veces. */
  function cutSource(v){
    if(v.photoOriginal)return v.photoOriginal;
    if(v.photoFallback)return v.photoFallback;
    if(v.photoDataUrl===DEMO_PHOTO)return DEMO_PHOTO;
    return v.photoDataUrl||null;
  }

  /* No se reutiliza un Worker "pausado": cancelar o fallar termina el Worker
     para liberar de inmediato la memoria WASM del dispositivo. */
  const cutError=cancelled=>Object.assign(new Error(cancelled?'cut cancelled':'AI worker'),{cancelled:!!cancelled});
  function killAIWorker(){
    if(aiWorker){try{aiWorker.terminate()}catch(e){}aiWorker=null}
    bgModelUsed='';
  }
  function failActiveJob(err){
    const job=activeAIJob;if(!job)return;
    activeAIJob=null;job.reject(err);
  }
  function maskVisibleRatio(mask,pixels){
    const total=Math.max(1,Math.floor((pixels&&pixels.length||0)/4));
    if(mask&&typeof mask.ratio==='number')return mask.ratio;
    if(mask&&typeof mask.visible==='number')return mask.visible/total;
    let visible=0;
    const src=pixels||[];
    for(let i=3;i<src.length;i+=4){if(src[i]>128)visible++}
    return visible/total;
  }

  /* WebKit móvil no codifica PNG de forma fiable dentro del Worker: el canvas
     y el toDataURL se crean aquí. createImageData + set es más compatible que
     el constructor ImageData en Safari iOS. */
  function rgbaToPNG(buffer,width,height,mask){
    const w=Math.floor(Number(width)),h=Math.floor(Number(height));
    if(!(w>0)||!(h>0))throw new Error('invalid AI image size');
    const expected=w*h*4;
    let bytes;
    if(buffer instanceof ArrayBuffer)bytes=new Uint8ClampedArray(buffer);
    else if(buffer&&typeof buffer.length==='number')bytes=buffer instanceof Uint8ClampedArray?buffer:new Uint8ClampedArray(buffer);
    else throw new Error('missing AI pixel data');
    if(bytes.length<expected)throw new Error('incomplete AI pixel data ('+bytes.length+'/'+expected+')');
    const pixels=bytes.subarray(0,expected);
    const ratio=maskVisibleRatio(mask,pixels);
    if(ratio<MIN_VISIBLE_MASK_RATIO){
      const err=new Error('mask too empty ('+Math.round(ratio*100)+'%)');
      err.code='mask-too-empty';err.visibleRatio=ratio;throw err;
    }
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;
    const ctx=cv.getContext('2d');
    if(!ctx||typeof ctx.createImageData!=='function'||typeof ctx.putImageData!=='function')throw new Error('canvas 2d unavailable');
    const image=ctx.createImageData(w,h);
    image.data.set(pixels);
    ctx.putImageData(image,0,0);
    return cv.toDataURL('image/png');
  }
  function handleAIWorkerMessage(d){
    const job=activeAIJob;
    if(!job||!d||d.id!==job.id)return; /* descarta respuestas de un trabajo anterior */
    if(d.type==='progress'){job.onPct(d.pct);return}
    if(d.type==='model'){bgModelUsed=d.model||'';return}
    if(d.type==='done'){
      activeAIJob=null;
      try{
        const png=d.rgba?rgbaToPNG(d.rgba,d.width,d.height,d.mask):d.png;
        if(!png)throw new Error('AI worker returned no image');
        job.resolve(png);
      }catch(err){job.reject(err)}
      return;
    }
    if(d.type==='error'){activeAIJob=null;job.reject(new Error(d.message||'AI worker error'))}
  }
  function ensureAIWorker(){
    if(aiWorker)return aiWorker;
    const w=new Worker(BG_WORKER_URL,{type:'module'});
    aiWorker=w;
    w.addEventListener('message',e=>handleAIWorkerMessage(e.data));
    w.addEventListener('error',e=>{
      const detail=e&&(e.message||(e.error&&e.error.message));
      failActiveJob(new Error(detail?'AI worker: '+detail:'AI worker failed'));
      killAIWorker();
    });
    w.addEventListener('messageerror',()=>{failActiveJob(new Error('AI worker message error'));killAIWorker()});
    return w;
  }
  function requestCutout(src,onPct){
    const w=ensureAIWorker();
    const id=++aiJobSeq;
    const mobile=isMobileAI();
    return new Promise((resolve,reject)=>{
      if(activeAIJob)failActiveJob(cutError(true));
      activeAIJob={id,resolve,reject,onPct};
      /* PC y móvil comparten el pipeline SegFormer q8; `mobile`/`profile` se
         envían solo por compatibilidad. La app ya aplicó maxEdge a la foto. */
      w.postMessage({type:'cut',id,src,profile:mobile?'mobile':'desktop',mobile,maxEdge:mobile?512:1024});
    });
  }
  function cancelCutout(){
    hideProgress();
    killAIWorker();              /* worker.terminate() inmediato */
    failActiveJob(cutError(true));
    cutInFlight=null;            /* permite reintentar sin esperas */
    cutToast(T('cutCancelled'));
  }
  async function cutoutWithAI(src,onPct){
    onPct(4);
    const png=await requestCutout(src,onPct);
    onPct(100);
    return png;                 /* PNG codificado en el hilo principal desde el RGBA del Worker */
  }
  function trimTransparentPixels(srcCv,alphaThreshold){
    const w=srcCv.width,h=srcCv.height,ctx=srcCv.getContext('2d');
    const data=ctx.getImageData(0,0,w,h).data;
    let top=h,left=w,right=0,bottom=0,found=false;
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        if(data[(y*w+x)*4+3]>alphaThreshold){
          found=true;
          if(x<left)left=x; if(x>right)right=x; if(y<top)top=y; if(y>bottom)bottom=y;
        }
      }
    }
    if(!found)return srcCv;
    const pad=Math.max(2,Math.round(Math.max(right-left+1,bottom-top+1)*0.03));
    left=Math.max(0,left-pad); top=Math.max(0,top-pad);
    right=Math.min(w-1,right+pad); bottom=Math.min(h-1,bottom+pad);
    const cw=right-left+1,ch=bottom-top+1;
    const out=document.createElement('canvas'); out.width=cw; out.height=ch;
    out.getContext('2d').drawImage(srcCv,left,top,cw,ch,0,0,cw,ch);
    return out;
  }

  function pngFromBlob(blob,maxW,maxH){
    /* rgbaToPNG() ya entregó un data URL PNG; si viniera un Blob se
       transforma en object URL. Ambos caminos producen el mismo canvas. */
    const isData=typeof blob==='string'&&/^data:image\//.test(blob);
    const url=isData?blob:URL.createObjectURL(blob);
    const release=()=>{if(!isData)URL.revokeObjectURL(url)};
    return loadImage(url).then(im=>{
      const sc=Math.min(1,maxW/im.width,maxH/im.height),cv=document.createElement('canvas');
      cv.width=Math.max(1,Math.round(im.width*sc));cv.height=Math.max(1,Math.round(im.height*sc));
      cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);
      const trimmed=trimTransparentPixels(cv,15);
      const outW=640,outH=320,out=document.createElement('canvas');
      out.width=outW; out.height=outH;
      const octx=out.getContext('2d');
      const targetW=outW*0.82,targetH=outH*0.82;
      const scale=Math.min(targetW/trimmed.width,targetH/trimmed.height);
      const dw=trimmed.width*scale,dh=trimmed.height*scale;
      const dx=(outW-dw)/2,dy=(outH-dh)/2;
      octx.drawImage(trimmed,0,0,trimmed.width,trimmed.height,dx,dy,dw,dh);
      return out.toDataURL('image/png');
    }).then(data=>{release();return data},err=>{release();throw err});
  }
  /* El PNG recortado se guarda con un techo de tamaño para no agotar localStorage. */
  async function pngCutData(blob){
    let data=await pngFromBlob(blob,900,560);
    if(data.length>1400000)data=await pngFromBlob(blob,700,440);
    if(data.length>1400000)data=await pngFromBlob(blob,560,360);
    return data;
  }
  function jpegData(im,maxW,maxH,quality){
    const sc=Math.min(1,maxW/im.width,maxH/im.height),cv=document.createElement('canvas');
    cv.width=Math.max(1,Math.round(im.width*sc));cv.height=Math.max(1,Math.round(im.height*sc));
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#0b1018';ctx.fillRect(0,0,cv.width,cv.height);
    ctx.drawImage(im,0,0,cv.width,cv.height);
    return cv.toDataURL('image/jpeg',quality);
  }
  /* Respaldo sin conexión: encuadre panorámico con viñeta radial. No hay
     umbrales de color ni borrado por esquina: la imagen nunca se mancha. */
  function vignetteJPEG(im){
    let W=Math.min(im.width,900),H=Math.round(W/2);
    if(H>im.height){H=im.height;W=Math.min(im.width,Math.round(H*2))}
    const sx=Math.round((im.width-W)/2),sy=Math.round((im.height-H)*.42);
    const cv=document.createElement('canvas');cv.width=Math.max(1,W);cv.height=Math.max(1,H);
    const ctx=cv.getContext('2d');
    ctx.drawImage(im,sx,sy,W,H,0,0,cv.width,cv.height);
    const g=ctx.createRadialGradient(cv.width/2,cv.height*.46,cv.height*.12,
      cv.width/2,cv.height*.46,Math.max(cv.width,cv.height)*.68);
    g.addColorStop(0,'rgba(3,7,12,0)');
    g.addColorStop(.58,'rgba(3,7,12,.05)');
    g.addColorStop(1,'rgba(3,7,12,.62)');
    ctx.fillStyle=g;ctx.fillRect(0,0,cv.width,cv.height);
    return cv.toDataURL('image/jpeg',.78);
  }

  /* Indicador discreto: una píldora dentro del escenario, nunca una cortina. */
  function showProgress(){
    const label=esc(T('cuttingOut'));
    document.querySelectorAll('.veh-stage').forEach(st=>{
      if(st.querySelector('.veh-progress'))return;
      const el=document.createElement('div');el.className='veh-progress';
      el.innerHTML='<span class="veh-progress-spin" aria-hidden="true"></span><span>'+label+'</span><b>0%</b>'
        +'<button type="button" class="veh-progress-cancel" data-act="cut-cancel" aria-label="'+esc(T('cancel'))+'">'+esc(T('cancel'))+'</button>';
      st.appendChild(el);
    });
    const live=document.getElementById('cutStatus');if(live)live.textContent=T('cuttingOut');
  }
  function setProgress(pct){
    document.querySelectorAll('.veh-progress b').forEach(b=>{b.textContent=Math.max(0,Math.min(100,Math.round(pct)))+'%'});
  }
  function hideProgress(){
    document.querySelectorAll('.veh-progress').forEach(el=>el.remove());
    const live=document.getElementById('cutStatus');if(live)live.textContent='';
  }

  const photoTarget=inModal=>(inModal&&vehicleDraft)?vehicleDraft:veh();
  function persistPhoto(v,inModal,paint,tools){
    markConfigured();
    PHOTO_FIELDS.forEach(k=>{veh()[k]=v[k]});
    if(inModal&&vehicleDraft)PHOTO_FIELDS.forEach(k=>{vehicleDraft[k]=v[k]});
    commit();
    if(paint)paint();if(tools)tools();
  }
  function setPhotoView(v,which,keepWanted){
    if(!v)return;
    const cut=which==='cut'&&!!v.photoCutDataUrl;
    const original=which==='original'&&!!v.photoOriginal;
    const src=cut?v.photoCutDataUrl:(original?v.photoOriginal:(v.photoFallback||v.photoOriginal||v.photoDataUrl));
    if(src)v.photoDataUrl=src;
    v.photoView=cut?'cut':original?'original':'fallback';
    v.photoCut=cut;
    v.photoCutWanted=typeof keepWanted==='boolean'?keepWanted:which==='cut';
    v.usePhoto=true;v.empty=false;
  }
  /* Recorte bajo demanda. Si no hay conexión (o el módulo no está cacheado) se
     mantiene el encuadre con viñeta y se permite reintentar cuando vuelva la red. */
  function runCutout(src,inModal,paint,tools){
    if(cutInFlight&&cutInFlight.src===src)return cutInFlight.promise;
    const promise=doRunCutout(src,inModal,paint,tools);
    cutInFlight={src,promise};
    return promise.then(r=>{if(cutInFlight&&cutInFlight.promise===promise)cutInFlight=null;return r},
                        e=>{if(cutInFlight&&cutInFlight.promise===promise)cutInFlight=null;throw e});
  }
  async function doRunCutout(src,inModal,paint,tools){
    const epoch=visualEpoch;
    let v=photoTarget(inModal);
    if(v.photoCutDataUrl&&!isStaleCut(v)){
      setPhotoView(v,'cut');persistPhoto(v,inModal,paint,tools);return true;
    }
    if(navigator.onLine===false){
      /* Si hay un recorte anterior no lo descartamos: se muestra mientras no
         haya red para regenerarlo con el modelo nuevo. */
      if(v.photoCutDataUrl)setPhotoView(v,'cut');
      else setPhotoView(v,'fallback',true);
      persistPhoto(v,inModal,paint,tools);
      cutToast(T('photoFallback'));return false;
    }
    showProgress();setProgress(4);
    try{
      const png=await cutoutWithAI(src,setProgress);
      const cut=await pngCutData(png);
      if(epoch!==visualEpoch)return false;
      v=photoTarget(inModal);
      v.photoCutDataUrl=cut;
      v.photoCutModel=bgModelUsed||BG_MODEL_ID;
      setPhotoView(v,'cut');
      persistPhoto(v,inModal,paint,tools);
      cutToast(T(inModal?'photoReady':'photoSaved'));
      return true;
    }catch(err){
      /* Cancelar: el Worker ya fue terminado; se deja la foto original limpia
         y no se muestra el aviso de fallback (cancelCutout ya avisó). */
      if(err&&err.cancelled){
        killAIWorker();
        if(epoch===visualEpoch){
          v=photoTarget(inModal);
          setPhotoView(v,'original');
          persistPhoto(v,inModal,paint,tools);
        }
        return false;
      }
      console.warn('[AutoCare] AI cutout failed (technical detail):',err&&err.stack?err.stack:err);
      if(epoch===visualEpoch){
        v=photoTarget(inModal);
        /* Máscara vacía/rota: conservar foto original limpia, sin aplicar recorte. */
        if(err&&err.code==='mask-too-empty')setPhotoView(v,'original',false);
        else setPhotoView(v,'fallback',true);
        persistPhoto(v,inModal,paint,tools);
        cutToast(aiFailureMessage(err));
      }
      return false;
    }finally{hideProgress()}
  }
  function toggleCutout(inModal,paint,tools){
    const v=photoTarget(inModal);
    if(!v||!v.photoDataUrl)return;
    if(isStaleCut(v)){
      /* Recorte del modelo anterior: "Recorte IA" lo regenera en lugar de
         limitarse a volver a mostrar el PNG ya guardado. */
      const src=cutSource(v);
      if(src)runCutout(src,inModal,paint,tools);
      return;
    }
    if(v.photoCut||v.photoView==='cut'){
      setPhotoView(v,'original');persistPhoto(v,inModal,paint,tools);
      cutToast(T('originalPhoto'));return;
    }
    if(v.photoCutDataUrl){
      setPhotoView(v,'cut');persistPhoto(v,inModal,paint,tools);
      cutToast(T('cutoutAI'));return;
    }
    const src=cutSource(v);
    if(src)runCutout(src,inModal,paint,tools);
  }

  async function handlePhoto(file,inModal,paint,tools){
    if(!file)return;
    if(!/^image\//i.test(file.type)){toast(T('pickImage'));return}
    const epoch=visualEpoch;
    let src,im;
    try{src=await readFile(file);im=await loadImage(src)}
    catch(err){toast(err.message==='file'?T('fileReadErr'):T('photoReadErr'));return}
    if(epoch!==visualEpoch)return;
    /* La foto se reescribe en Canvas a 512 px en móvil (1024 px en escritorio)
       antes de cualquier proceso; el Worker vuelve a comprobar el límite.
       El dataURL resultante es la ÚNICA fuente que se guarda y se envía a IA. */
    let aiSrc=src,aiIm=im;
    const maxEdge=aiMaxEdge();
    try{
      aiSrc=jpegData(im,maxEdge,maxEdge,.86);
      aiIm=await loadImage(aiSrc);
    }catch(e){/* si Canvas falla, el Worker reintenta el redimensionado con OffscreenCanvas */}
    /* La foto original y su encuadre suave se guardan antes de intentar la IA:
       así siempre hay una vista utilizable, incluso sin conexión. */
    const v=photoTarget(inModal);
    try{
      v.photoOriginal=jpegData(aiIm,maxEdge,maxEdge,.74);
      v.photoFallback=vignetteJPEG(aiIm);
    }catch(e){v.photoOriginal=aiSrc;v.photoFallback=aiSrc}
    v.photoCutDataUrl=null;
    const wanted=v.photoCutWanted!==false;
    setPhotoView(v,'fallback',wanted);
    persistPhoto(v,inModal,paint,tools);
    if(wanted)return runCutout(aiSrc,inModal,paint,tools);
    cutToast(T(inModal?'photoReady':'photoSaved'));
    return false;
  }

  async function processDemoPhoto(){
    const v=veh();
    if(!hasDemo()||demoPhotoJob||demoPhotoFailed||!v||v.photoDataUrl!==DEMO_PHOTO||v.photoCutDataUrl)return;
    if(navigator.onLine===false){demoPhotoFailed=true;return}
    const epoch=visualEpoch;
    demoPhotoJob=true;
    try{
      const src=new URL(DEMO_PHOTO,location.href).href;
      const data=await cutoutWithAI(src,()=>{});
      const png=await pngCutData(data);
      if(epoch!==visualEpoch)return;
      const cur=veh();
      if(hasDemo()&&cur.photoDataUrl===DEMO_PHOTO){
        cur.photoCutDataUrl=png;
        cur.photoCutModel=bgModelUsed||BG_MODEL_ID;
        setPhotoView(cur,'cut');
        commit();
      }
    }catch(err){
      /* Un recorte del usuario (o un cambio de vehículo) puede terminar el
         Worker del demo: no se marca como fallido para permitir reintentarlo. */
      if(!(err&&err.cancelled)){
        demoPhotoFailed=true;
        console.warn('[AutoCare] Demo photo cutout skipped (technical detail):',err&&err.stack?err.stack:err);
        if(navigator.onLine!==false)cutToast(aiFailureMessage(err));
      }
    }finally{
      demoPhotoJob=false;
    }
  }

  const S=()=>state.settings;
  const today=()=>TL.todayISO();
  const hasDemo=()=>store.hasDemo();
  const demoCleared=()=>store.demoCleared();

  /* unidades */
  const dF=()=>TL.DIST[S().dist].f,vF=()=>TL.VOL[S().vol].f;
  const dOut=km=>km/dF(),dIn=v=>v*dF(),vOut=l=>l/vF(),vIn=v=>v*vF();
  const dU=()=>TL.DIST[S().dist].u,vU=()=>TL.VOL[S().vol].u+(S().vol==='galUK'?' UK':'');
  const ed=kmL=>TL.effDisp(kmL,S()),el=()=>TL.effLabel(S());
  function money(v,d){d=d==null?2:d;try{return new Intl.NumberFormat(LOC(),{style:'currency',currency:S().cur,minimumFractionDigits:d,maximumFractionDigits:d}).format(v)}catch(e){return S().cur+' '+nf(v,d)}}
  function fdate(s,long){const d=TL.parseISO(s),o={day:'numeric',month:'short'};if(long||d.getFullYear()!==new Date().getFullYear())o.year='numeric';return new Intl.DateTimeFormat(LOC(),o).format(d)}
  function mname(k,long){const p=k.split('-').map(Number);return new Intl.DateTimeFormat(LOC(),long?{month:'long',year:'numeric'}:{month:'short'}).format(new Date(p[0],p[1]-1,1))}
  function ago(n){if(n<=0)return T('today');if(n===1)return T('yesterday');if(n<45)return T('daysAgo',{n});if(n<365){const m=Math.round(n/30);return T('monthsAgo',{n:m})}const y=Math.round(n/365);return T('yearsAgo',{n:y})}
  function inn(n){if(n===0)return T('today');if(n===1)return T('tomorrow');if(n<45)return T('daysIn',{n});if(n<365){const m=Math.round(n/30);return T('monthsIn',{n:m})}const y=Math.round(n/365);return T('yearsIn',{n:y})}

  function commit(){store.commit(render)}

  /* ---------- Navegación en 3 pestañas ---------- */
  const VIEWS={tablero:'view-tablero',mantenimiento:'view-mantenimiento',analisis:'view-analisis'};
  function activateTab(name,focus,scroll){
    if(!VIEWS[name])name='tablero';
    document.querySelectorAll('.mainnav [data-tab]').forEach(b=>{
      const on=b.dataset.tab===name;
      b.setAttribute('aria-selected',String(on));
      b.tabIndex=on?0:-1;
    });
    /* `hidden` es la única fuente de verdad y se aplica al panel COMPLETO: así la
       ficha del vehículo y las alertas desaparecen junto con el Tablero. Se limpia
       cualquier display inline residual que pudiera "resucitar" un panel oculto. */
    Object.keys(VIEWS).forEach(k=>{
      const panel=document.getElementById(VIEWS[k]),on=k===name;
      panel.style.removeProperty('display');
      panel.hidden=!on;
      panel.setAttribute('aria-hidden',String(!on));
    });
    try{localStorage.setItem(store.KEY+'-tab',name)}catch(e){}
    if(focus){const b=document.querySelector('.mainnav [data-tab="'+name+'"]');if(b)b.focus()}
    if(scroll!==false)window.scrollTo({top:0,behavior:'smooth'});
  }
  function initTabs(){
    let active='tablero';try{active=localStorage.getItem(store.KEY+'-tab')||'tablero'}catch(e){}
    activateTab(active,null,false);
    const nav=document.querySelector('.mainnav');
    nav.addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)activateTab(b.dataset.tab)});
    nav.addEventListener('keydown',e=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
      e.preventDefault();
      const keys=Object.keys(VIEWS);
      const current=document.querySelector('.mainnav [data-tab][aria-selected="true"]');
      const i=current?keys.indexOf(current.dataset.tab):0;
      const next=e.key==='Home'?0:e.key==='End'?keys.length-1:(i+(e.key==='ArrowRight'?1:-1)+keys.length)%keys.length;
      activateTab(keys[next],true);
    });
  }

  /* ---------- Render ---------- */
  function render(){
    $('#vName').textContent=isConfigured()?(AC.core.vehicleLabel(veh())||S().name||T('myCar')):T('noVehicle');
    $('#demo').hidden=!hasDemo();
    const sm=TL.summarize(state,today());
    renderVehicle();renderHero(sm);renderStats(sm);renderAlerts(sm);renderRems(sm);renderDocs();renderTires(sm);renderQuick(sm);
    renderEff();renderSpend();renderCats();renderHist();renderCost(sm);renderValue();renderCompare();
    $('#foot').textContent=T('footer');
    processDemoPhoto();
  }

  function gaugeSVG(sm){
    const cx=120,cy=118,r=92,pt=(deg,rad)=>[cx+rad*Math.cos(deg*Math.PI/180),cy+rad*Math.sin(deg*Math.PI/180)];
    const arc=f=>{f=Math.min(Math.max(f,0),.999);const a=pt(180,r),b=pt(180+180*f,r);return'M'+a[0].toFixed(1)+' '+a[1].toFixed(1)+'A'+r+' '+r+' 0 0 1 '+b[0].toFixed(1)+' '+b[1].toFixed(1)};
    const has=sm.last!=null,vals=sm.segs.map(s=>ed(s.kmL));
    const mx=has?TL.niceTicks(0,Math.max.apply(null,vals)*1.15,4).slice(-1)[0]:10;
    let t='';for(let i=0;i<=20;i++){const maj=i%5===0,a=pt(180+9*i,maj?66:71),b=pt(180+9*i,78);t+='<line x1="'+a[0].toFixed(1)+'" y1="'+a[1].toFixed(1)+'" x2="'+b[0].toFixed(1)+'" y2="'+b[1].toFixed(1)+'" stroke="var(--line2)" stroke-width="'+(maj?2:1)+'"/>'}
    let avgM='';
    if(sm.avg!=null){const f=Math.min(ed(sm.avg)/mx,1),a=pt(180+180*f,80),b=pt(180+180*f,106);avgM='<line x1="'+a[0].toFixed(1)+'" y1="'+a[1].toFixed(1)+'" x2="'+b[0].toFixed(1)+'" y2="'+b[1].toFixed(1)+'" stroke="var(--fg)" stroke-width="2.5" stroke-linecap="round"><title>'+T('gaugeAverage')+'</title></line>'}
    return'<svg class="gauge" viewBox="0 0 240 150" role="img" aria-label="'+esc(has?T('gaugeAriaLast',{v:nf(ed(sm.last),1),u:el()}):T('gaugeAriaNone'))+'">'
      +'<path d="'+arc(.999)+'" fill="none" stroke="var(--s3)" stroke-width="14" stroke-linecap="round"/>'+t
      +(has?'<path d="'+arc(ed(sm.last)/mx)+'" fill="none" stroke="var(--accent)" stroke-width="14" stroke-linecap="round"/>':'')+avgM
      +'<text class="g-val" x="120" y="104" text-anchor="middle">'+(has?nf(ed(sm.last),1):'–')+'</text>'
      +'<text class="g-unit" x="120" y="126" text-anchor="middle">'+esc(el())+'</text>'
      +'<text class="g-end" x="28" y="140" text-anchor="middle">0</text><text class="g-end" x="212" y="140" text-anchor="middle">'+nf(mx,mx<10?1:0)+'</text></svg>';
  }
  function renderHero(sm){
    const has=sm.odo!=null,val=has?Math.round(dOut(sm.odo)):null;
    const str=has?String(val).padStart(6,'0'):'------',real=has?String(val).length:0;
    const digits=str.split('').map((c,i)=>'<span class="dg'+((!has||i<str.length-real)?' z':'')+'">'+(has?c:'–')+'</span>').join('');
    let note;
    if(!has)note=T('noOdoNote');
    else{note=T('lastRecord',{x:ago(TL.daysBetween(sm.lastDate,today()))});if(sm.rate)note+=' · '+T('perDay',{n:nf(dOut(sm.rate)),u:dU()})}
    const cap=sm.avg!=null?T('lastFillAvg',{v:nf(ed(sm.avg),1),u:esc(el())}):T('needTwoFills');
    $('#hero').innerHTML='<div><div class="lbl">'+T('odometer')+'</div><div class="odo" role="img" aria-label="'+T('odometer')+': '+(has?nf(val)+' '+dU():T('noData'))+'">'+digits+'<span class="odo-u">'+dU()+'</span></div><p class="hero-note">'+esc(note)+'</p></div>'
      +'<div>'+gaugeSVG(sm)+'<p class="g-cap">'+cap+'</p></div>';
  }
  function renderStats(sm){
    const tile=(l,v,s)=>'<div class="tile"><div class="lbl">'+l+'</div><div class="tv">'+v+'</div><div class="ts">'+s+'</div></div>';
    const prev=sm.prevCost>0?T('previousMonth',{v:money(sm.prevCost,0)}):T('noPrevMonth');
    $('#stats').innerHTML=
      tile(T('avgEff'),sm.avg!=null?nf(ed(sm.avg),1)+'<small>'+esc(el())+'</small>':'–',sm.segs.length?T('segment',{n:sm.segs.length}):T('needTwoFull'))
     +tile(T('costPer',{u:dU()}),sm.cpd.value!=null?money(sm.cpd.value*dF(),2):'–',sm.cpd.value!=null?T('costDistanceShort',{d:nf(dOut(sm.cpd.dist))}):T('costIncluded'))
     +tile(esc(mname(today().slice(0,7),false)),money(sm.monthCost,0),prev)
     +tile(T('totalRecorded'),money(sm.total,0),T('records',{n:sm.count}));
  }

  function renderAlerts(sm){
    const t=today(),items=[];let unset=0;
    state.reminders.forEach(r=>{const s=TL.remStatus(r,sm.odo,S(),t,sm.rate);if(s.state==='unset'){unset++;return}
      if(s.state!=='ok'){let d=[];
        if(s.kS==='over')d.push(T('overBy',{n:nf(dOut(-s.leftKm)),u:dU()}));else if(s.kS==='soon')d.push(T('leftBy',{n:nf(dOut(s.leftKm)),u:dU()}));
        if(s.dS==='over')d.push(T('overdueBy',{x:ago(-s.daysLeft)}));else if(s.dS==='soon')d.push(T('dueIn',{x:inn(s.daysLeft)}));
        items.push({sev:s.state==='over'?'bad':'warn',title:r.name,label:s.state==='over'?T('overdue'):T('soon'),detail:d.join(' · '),act:'rem-log',id:r.id,btn:T('register')})}});
    state.docs.forEach(d=>{const s=TL.docStatus(d,S(),t);if(s.state==='unset'){unset++;return}
      if(s.state!=='ok')items.push({sev:s.state==='over'?'bad':'warn',title:d.name,label:s.state==='over'?T('overdue'):T('soon'),detail:(s.days<0?T('docsExpired',{x:ago(-s.days)}):T('docsDue',{x:inn(s.days)}))+' · '+fdate(d.due,true),act:'doc-renew',id:d.id,btn:T('renew')})});
    items.sort((a,b)=>(a.sev==='bad'?0:1)-(b.sev==='bad'?0:1));
    if(!items.length){
      $('#alerts').innerHTML='<div class="al-ok"><svg width="20" height="20" class="ico"><use href="#i-check"/></svg><span>'+T('noAlerts')+(unset?T('unsetItems',{n:unset}):'')+'.</span></div>';return}
    $('#alerts').innerHTML='<div class="card"><div class="card-h"><h2>'+T('attention')+'</h2><span class="pill '+(items[0].sev==='bad'?'over':'soon')+'">'+T('alertsCount',{n:items.length})+'</span></div><ul class="al-list">'
      +items.map(i=>'<li class="al '+i.sev+'"><svg width="20" height="20" class="ico"><use href="#i-alert"/></svg><div><b>'+esc(i.title)+'</b><span class="d">'+esc(i.label)+' · '+esc(i.detail)+'</span></div><button class="btn sm" data-act="'+i.act+'" data-id="'+esc(i.id)+'">'+i.btn+'</button></li>').join('')+'</ul></div>';
  }

  function renderRems(sm){
    const t=today();
    let h='<div class="card-h"><h2>'+T('maintenance')+'</h2><button class="btn sm" data-act="rem-add"><svg width="20" height="20" class="ico" style="width:16px;height:16px"><use href="#i-plus"/></svg>'+T('add')+'</button></div>';
    if(!state.reminders.length)h+='<p class="empty">'+T('noReminders')+'</p>';
    else {
      const remCards=state.reminders.map(r=>{
      const s=TL.remStatus(r,sm.odo,S(),t,sm.rate);
      const edit='<button class="btn sm" data-act="rem-edit" data-id="'+esc(r.id)+'" aria-label="'+esc(T('editRem',{n:r.name}))+'"><svg width="20" height="20" class="ico" style="width:16px;height:16px"><use href="#i-edit"/></svg></button>';
      if(s.state==='unset')return'<article class="rem"><div class="rem-h"><b>'+esc(r.name)+'</b><span class="pill">'+T('noData')+'</span></div><div class="bar"><i style="width:0"></i></div><p class="rem-s">'+T('needLastChange')+'</p><div class="rem-a"><button class="btn sm" data-act="rem-edit" data-id="'+esc(r.id)+'">'+T('loadLastChange')+'</button></div></article>';
      const pill=s.state==='over'?T('overdue'):s.state==='soon'?T('soon'):T('upToDate');
      let m1='',m2='';
      if(s.leftKm!=null){m1=s.leftKm>0?T('left',{v:nf(dOut(s.leftKm)),u:dU()}):T('past',{v:nf(dOut(-s.leftKm)),u:dU()});m2=T('nextAt',{v:nf(dOut(s.nextOdo)),u:dU()})}
      else if(s.daysLeft!=null){m1=s.daysLeft>=0?T('expiresIn',{x:inn(s.daysLeft)}):T('expired',{x:ago(-s.daysLeft)})}
      let sub=[];
      if(s.eta!=null)sub.push(T('atRate',{x:s.eta<45?T('days',{n:s.eta}):T('months',{n:Math.round(s.eta/30)})}));
      if(s.dueDate&&s.leftKm!=null)sub.push(T('byDate',{d:fdate(s.dueDate)}));
      if(r.lastDate)sub.push(T('lastTime',{d:fdate(r.lastDate)}));
      return'<article class="rem st-'+s.state+'"><div class="rem-h"><b>'+esc(r.name)+'</b><span class="pill '+s.state+'">'+pill+'</span></div>'
        +'<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+Math.min(100,Math.round(s.pct*100))+'" aria-label="'+esc(r.name)+'"><i style="width:'+Math.min(100,Math.round(s.pct*100))+'%"></i></div>'
        +'<div class="rem-m"><span>'+m1+'</span><span>'+m2+'</span></div>'+(sub.length?'<p class="rem-s">'+esc(sub.join(' · '))+'</p>':'')
        +'<div class="rem-a">'+edit+'<button class="btn sm" data-act="rem-log" data-id="'+esc(r.id)+'">'+T('register')+'</button></div></article>';
      });
      const first=remCards.slice(0,30).join('');
      const rest=remCards.slice(30).join('');
      h+='<div class="list">'+first+'</div>';
      if(rest)h+='<details class="show-more"><summary class="btn sm">'+T('viewMore',{n:remCards.length-30})+'</summary><div class="list">'+rest+'</div></details>';
    }
    $('#rems').innerHTML=h;
  }

  function renderDocs(){
    const t=today();
    let h='<div class="card-h"><h2>'+T('documentation')+'</h2><button class="btn sm" data-act="doc-add"><svg width="20" height="20" class="ico" style="width:16px;height:16px"><use href="#i-plus"/></svg>'+T('add')+'</button></div>';
    if(!state.docs.length)h+='<p class="empty">'+T('noDocs')+'</p>';
    else {
      const docCards=state.docs.map(d=>{
      const s=TL.docStatus(d,S(),t);
      const pill=s.state==='unset'?'<span class="pill">'+T('noDate')+'</span>':'<span class="pill '+s.state+'">'+(s.state==='over'?T('overdue'):s.state==='soon'?T('soon'):T('upToDate'))+'</span>';
      const dd=s.state==='unset'?T('addDueDate'):(s.days<0?T('docsExpired',{x:ago(-s.days)}):T('docsDue',{x:inn(s.days)}))+' · '+fdate(d.due,true);
      return'<li class="doc"><svg width="20" height="20" class="ico"><use href="#i-doc"/></svg><div><b>'+esc(d.name)+pill+'</b><span class="d">'+esc(dd)+'</span></div>'
        +'<button class="btn sm" data-act="'+(s.state==='unset'?'doc-edit':'doc-renew')+'" data-id="'+esc(d.id)+'">'+(s.state==='unset'?T('addDate'):T('renew'))+'</button>'
        +'<button class="icon-btn" style="width:36px;height:36px" data-act="doc-edit" data-id="'+esc(d.id)+'" aria-label="'+esc(T('editDoc',{n:d.name}))+'"><svg width="20" height="20" class="ico" style="width:16px;height:16px"><use href="#i-edit"/></svg></button></li>';
      });
      const first=docCards.slice(0,30).join('');
      const rest=docCards.slice(30).join('');
      h+='<ul class="list">'+first+'</ul>';
      if(rest)h+='<details class="show-more"><summary class="btn sm">'+T('viewMore',{n:docCards.length-30})+'</summary><ul class="list">'+rest+'</ul></details>';
    }
    $('#docs').innerHTML=h;
  }

  /* ---------- Ficha rápida: componentes + documentos clave ---------- */
  function componentStatus(c,sm,t){
    if(!c||(!c.date&&c.odo==null))return{state:'unset'};
    const lim=AC.core.COMP_LIMITS[c.key]||{km:40000,months:48};
    const kmLimit=c.intervalKm||lim.km,moLimit=c.intervalMonths||lim.months;
    let kS='ok',leftKm=null,nextOdo=null;
    if(c.odo!=null&&sm.odo!=null){
      leftKm=kmLimit-(sm.odo-c.odo);nextOdo=c.odo+kmLimit;
      kS=leftKm<0?'over':leftKm<=S().warnKm?'soon':'ok';
    }
    let dS='ok',days=null,due=null;
    if(c.date){
      due=TL.addMonths(c.date,moLimit);days=TL.daysBetween(t,due);
      dS=days<0?'over':days<=S().warnDays?'soon':'ok';
    }
    const status=(kS==='over'||dS==='over')?'over':(kS==='soon'||dS==='soon')?'soon':'ok';
    return{state:status,kS,dS,leftKm,nextOdo,days,due,kmLimit,moLimit};
  }
  function renderQuick(sm){
    const t=today();
    const comps=AC.core.COMP_KEYS.map(k=>{
      const c=state.components.find(x=>x.key===k),s=componentStatus(c,sm,t);
      const pill=s.state==='unset'?'<span class="pill">'+T('noData')+'</span>':'<span class="pill '+s.state+'">'+(s.state==='over'?T('overdue'):s.state==='soon'?T('soon'):T('upToDate'))+'</span>';
      let detail=T('quickEmpty');
      if(s.state!=='unset'){
        const parts=[];
        if(c.date)parts.push(T('installedOn',{d:fdate(c.date,true)}));
        if(c.odo!=null)parts.push(T('installedAt',{v:nf(dOut(c.odo)),u:dU()}));
        if(s.leftKm!=null)parts.push(s.leftKm>0?T('left',{v:nf(dOut(s.leftKm)),u:dU()}):T('past',{v:nf(dOut(-s.leftKm)),u:dU()}));
        if(s.due)parts.push(T('dueShort',{d:fdate(s.due,true)}));
        detail=parts.join(' · ');
      }
      const icon=k==='tires'?'i-tire':k==='battery'?'i-cog':'i-wrench';
      return'<li class="quick-row"><span class="qi"><svg width="20" height="20" class="ico"><use href="#'+icon+'"/></svg></span><div><b>'+esc(T('comp.'+k))+' '+pill+'</b><span class="d">'+detail+'</span></div>'
        +'<button type="button" class="btn sm" data-act="comp-edit" data-id="'+k+'">'+(c?T('edit'):T('add'))+'</button></li>';
    }).join('');
    /* Los documentos (Seguro, Patente, Inspección) se muestran UNA SOLA VEZ en
       #docs. Esta tarjeta sólo resume componentes; duplicarlos confundía al
       usuario y doblaba los botones en pantallas pequeñas. */
    $('#quick').innerHTML='<div class="card-h"><h2>'+T('quickTitle')+'</h2><span class="lbl">'+esc(AC.core.vehicleLabel(veh()))+'</span></div>'
      +'<div class="quick-grid"><section><h3>'+T('components')+'</h3><ul class="list quick-list">'+comps+'</ul></section></div>';
  }

  /* ---------- Etapa 2 · Control de neumáticos ----------
     El desgaste se calcula siempre con el odómetro más alto del vehículo activo
     y se muestra como barra + porcentaje + kilómetros restantes. */
  function renderTires(sm){
    const t=state.tire||{},s=TL.tireStatus(t,sm.odo,S());
    let h='<div class="card-h"><h2>'+T('tireTitle')+'</h2><button type="button" class="btn sm" data-act="tire-edit">'
      +'<svg width="20" height="20" class="ico" style="width:16px;height:16px"><use href="#i-tire"/></svg>'+T(s.state==='unset'?'tireAdd':'tireEdit')+'</button></div>';
    if(s.state==='unset'){
      $('#tires').innerHTML=h+'<p class="empty">'+T('tireEmpty')+'</p>'
        +'<p class="tire-hint">'+T('tireHint',{n:nf(dOut(TL.TIRE_ROT_KM)),u:dU()})+'</p>';
      return;
    }
    const pill=s.state==='over'?T('overdue'):s.state==='soon'?T('soon'):T('upToDate');
    const meta=[];
    if(t.installDate)meta.push(T('installedOn',{d:fdate(t.installDate,true)}));
    if(t.installOdo!=null)meta.push(T('installedAt',{v:nf(dOut(t.installOdo)),u:dU()}));
    if(t.lifeKm!=null)meta.push(T('tireLifeValue',{v:nf(dOut(t.lifeKm)),u:dU()}));
    meta.push(s.left>0?T('tireRemaining',{v:nf(dOut(s.left)),u:dU()}):T('tirePast',{v:nf(dOut(-s.left)),u:dU()}));
    let rotLine='';
    if(t.rotDate||t.rotOdo!=null){
      const bits=[];
      if(t.rotDate)bits.push(fdate(t.rotDate,true));
      if(t.rotOdo!=null)bits.push(nf(dOut(t.rotOdo))+' '+dU());
      rotLine=T('tireRotatedAt',{x:bits.join(' · ')});
    }
    if(s.rot&&s.rot.due){if(rotLine)rotLine+=' · ';rotLine+=T('tireRotateDue',{v:nf(dOut(s.rot.since)),u:dU()})}
    const pct=Math.round(s.pct*100);
    $('#tires').innerHTML=h+'<div class="tire-card">'
      +'<div class="tire-head"><span class="tire-name">'+(t.brandSize?esc(t.brandSize):esc(T('comp.tires')))+'</span>'
      +'<span class="pill '+s.state+'">'+pill+'</span><b class="tire-pct">'+nf(pct,0)+'%</b></div>'
      +'<div class="tire-meter st-'+s.state+'"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'" aria-label="'+esc(T('tireWear'))+'"><i style="width:'+pct+'%"></i></div></div>'
      +'<div class="tire-meta">'+meta.map(x=>'<span>'+esc(x)+'</span>').join('')+(rotLine?'<span>'+esc(rotLine)+'</span>':'')+'</div>'
      +'<p class="tire-hint">'+T('tireHint',{n:nf(dOut(TL.TIRE_ROT_KM)),u:dU()})+'</p></div>';
  }

  /* ---------- Etapa 2 · Valor y depreciación ---------- */
  function renderValue(){
    const v=state.value||{},vi=TL.valueInfo(v,state.entries);
    let h='<div class="card-h"><h2>'+T('valueTitle')+'</h2><button type="button" class="btn sm" data-act="value-edit">'
      +'<svg width="20" height="20" class="ico" style="width:16px;height:16px"><use href="#i-gauge"/></svg>'+T(vi?'valueEdit':'valueAdd')+'</button></div>';
    if(!vi){$('#value').innerHTML=h+'<p class="empty">'+T('valueEmpty')+'</p>';return}
    const lines=[];
    if(vi.current!=null)lines.push('<div class="value-line"><span>'+T('valueCurrent',{c:esc(S().cur)})+'</span><b>'+money(vi.current,0)+'</b></div>');
    if(vi.purchase!=null)lines.push('<div class="value-line"><span>'+T('valuePurchase',{c:esc(S().cur)})+'</span><b>'+money(vi.purchase,0)+'</b></div>');
    if(vi.diff!=null){
      const up=vi.diff>=0;
      lines.push('<div class="value-line '+(up?'ok':'over')+'"><span>'+T(up?'valueGain':'valueDrop')+'</span><b>'
        +(up?'+':'')+money(vi.diff,0)+' ('+(vi.pct>=0?'+':'')+nf(vi.pct,1)+'%)</b></div>');
    }
    lines.push('<div class="value-line"><span>'+T('valueSpend')+'</span><b>'+money(vi.spend,0)+'</b></div>');
    if(vi.spendPct!=null)lines.push('<div class="value-line"><span>'+T('valueRelation')+'</span><b>'+nf(vi.spendPct,1)+'%</b></div>');
    if(vi.net!=null)lines.push('<div class="value-line"><span>'+T('valueNet')+'</span><b>'+money(vi.net,0)+'</b></div>');
    $('#value').innerHTML=h+'<div class="value-card"><div class="value-big">'+(vi.current!=null?money(vi.current,0):'–')+'</div>'
      +lines.join('')+'<p class="value-hint">'+T('valueHint')+'</p></div>';
  }

  /* ---------- Costo real por km / milla ---------- */
  function renderCost(sm){
    const c=sm.cpd;
    const sum=f=>state.entries.reduce((a,e)=>a+(f(e)?(e.cost||0):0),0);
    const fuel=sum(e=>e.type==='fuel'),maint=sum(e=>e.type==='exp'&&(e.cat==='service'||e.cat==='tires')),repair=sum(e=>e.type==='exp'&&e.cat==='repair');
    const line=(l,v)=>'<div class="cost-line"><span>'+l+'</span><b>'+v+'</b></div>';
    $('#cost').innerHTML='<div class="card-h"><h2>'+T('costPer',{u:dU()})+'</h2><span class="lbl">'+T('costReal')+'</span></div>'
      +'<div class="cost-big">'+(c.value!=null?money(c.value*dF(),2):'–')+'<small>/'+esc(dU())+'</small></div>'
      +'<div class="cost-lines">'
      +line(T('costFuel'),money(fuel,0))
      +line(T('costMaintRepair'),money(maint+repair,0))
      +line(T('costRepairDetail'),money(repair,0))
      +line(T('costDistance'),nf(dOut(c.dist))+' '+dU())
      +'</div><p class="hint">'+T('costFormula')+'</p>';
  }

  /* ---------- Comparación mes actual vs. anterior ---------- */
  function renderCompare(){
    const ms=TL.monthlySpend(state.entries,today(),2),prev=ms[0]||{g:{},total:0},cur=ms[1]||prev;
    const delta=cur.total-prev.total,pct=prev.total>0?delta/prev.total*100:(cur.total>0?null:0);
    const cls=pct==null?'':delta>0?'over':delta<0?'ok':'';
    const change=pct==null?T('noPrevSpend'):(delta>0?T('spendUp',{v:nf(Math.abs(pct),1)}):delta<0?T('spendDown',{v:nf(Math.abs(pct),1)}):T('spendSame'));
    const groups=[['fuel',T('group.fuel')],['maint',T('group.maint')],['other',T('group.other')]];
    const mx=Math.max(1,cur.total,prev.total);
    const rows=groups.map(g=>{
      const k=g[0],now=(cur.g[k]||0)+(k==='maint'?(cur.g.repair||0):0),was=(prev.g[k]||0)+(k==='maint'?(prev.g.repair||0):0);
      return'<div class="cmp-row"><span class="cmp-name">'+g[1]+'</span><span class="cmp-bar"><i style="width:'+(now/mx*100).toFixed(1)+'%"></i></span>'
        +'<b>'+money(now,0)+'</b><span class="cmp-prev">'+money(was,0)+'</span></div>';
    }).join('');
    $('#compare').innerHTML='<div class="card-h"><h2>'+T('compareTitle')+'</h2><span class="lbl">'+esc(S().cur)+'</span></div>'
      +'<div class="cmp-head"><div><span class="lbl">'+T('currentMonth')+'</span><b>'+money(cur.total,0)+'</b></div>'
      +'<div class="cmp-delta '+cls+'">'+(pct==null?'—':delta>0?'▲':delta<0?'▼':'—')+' '+change+'</div>'
      +'<div><span class="lbl">'+T('previousMonthShort')+'</span><b>'+money(prev.total,0)+'</b></div></div>'
      +'<div class="cmp-legend"><span></span><span>'+T('currentMonthShort')+'</span><span>'+T('previousMonthShort')+'</span></div>'
      +'<div class="cmp-rows">'+rows+'</div>';
  }

  /* ---- gráficos ---- */
  const W=640;
  function tableHTML(head,rows){return'<details class="tbl"><summary>'+T('viewTable')+'</summary><div class="tbl-w"><table><thead><tr>'+head.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></details>'}
  function bindHover(box,n,xOf,onIdx,onOut){
    const svg=box.querySelector('svg');if(!svg)return;
    const f=e=>{const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*W;let bi=0,bd=1e9;for(let i=0;i<n;i++){const d=Math.abs(xOf(i)-x);if(d<bd){bd=d;bi=i}}onIdx(bi)};
    svg.addEventListener('pointermove',f);svg.addEventListener('pointerdown',f);svg.addEventListener('pointerleave',onOut);
  }
  function decs(step){return(String(+step.toFixed(4)).split('.')[1]||'').length}

  function renderEff(){
    const all=TL.fuelSegments(state.entries),segs=all.slice(-24),n=segs.length;
    let h='<div class="ch-top"><div class="card-h" style="margin:0"><h2>'+T('effByFill')+'</h2></div><span class="lbl">'+esc(el())+'</span></div>';
    if(n<2){$('#eff').innerHTML=h+'<p class="empty">'+T('effEmpty')+'</p>';return}
    const H=230,pl=44,pr=14,pt=18,pb=30,vals=segs.map(s=>ed(s.kmL));
    let ds=0,vs=0;segs.forEach(s=>{ds+=s.dist;vs+=s.vol});const avg=ed(ds/vs);
    const mn=Math.min.apply(null,vals.concat(avg)),mx=Math.max.apply(null,vals.concat(avg)),rg=(mx-mn)||1;
    const tk=TL.niceTicks(Math.max(0,mn-rg*.3),mx+rg*.3,4),lo=tk[0],hi=tk[tk.length-1],dc=decs(tk[1]-tk[0]);
    const X=i=>pl+(n===1?.5:i/(n-1))*(W-pl-pr),Y=v=>pt+(1-(v-lo)/(hi-lo))*(H-pt-pb);
    let g='';tk.forEach(v=>{g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="var(--line)" stroke-width="1"/><text x="'+(pl-8)+'" y="'+(Y(v)+4).toFixed(1)+'" text-anchor="end">'+nf(v,dc)+'</text>'});
    const line=vals.map((v,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)).join('');
    const area=line+'L'+X(n-1).toFixed(1)+' '+Y(lo).toFixed(1)+'L'+X(0).toFixed(1)+' '+Y(lo).toFixed(1)+'Z';
    const xi=[0,Math.floor((n-1)/2),n-1].filter((v,i,a)=>a.indexOf(v)===i);
    let xl='';xi.forEach((i,k)=>{xl+='<text x="'+X(i).toFixed(1)+'" y="'+(H-8)+'" text-anchor="'+(i===0?'start':i===n-1?'end':'middle')+'">'+esc(fdate(segs[i].date))+'</text>'});
    let dots='';vals.forEach((v,i)=>{const last=i===n-1;dots+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="'+(last?5.5:4)+'" fill="var(--accent)" stroke="var(--s1)" stroke-width="2"/>'});
    const lastLbl='<text class="tx2" x="'+(X(n-1)-8).toFixed(1)+'" y="'+(Y(vals[n-1])-11).toFixed(1)+'" text-anchor="end" style="font-weight:600;font-size:12px">'+nf(vals[n-1],1)+'</text>';
    const avgY=Y(avg);
    const svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(T('effByFill')+', '+T('avgShort',{v:nf(avg,1)})+' '+el())+'">'+g
      +'<path d="'+area+'" fill="var(--accent)" opacity=".1"/>'
      +'<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+avgY.toFixed(1)+'" y2="'+avgY.toFixed(1)+'" stroke="var(--fg3)" stroke-width="1"/><text x="'+(pl+6)+'" y="'+(avgY-5).toFixed(1)+'">'+T('avgShort',{v:nf(avg,1)})+'</text>'
      +'<path d="'+line+'" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+dots+lastLbl+xl
      +'<circle id="effHov" r="7" fill="none" stroke="var(--fg)" stroke-width="2" visibility="hidden"/></svg>';
    $('#eff').innerHTML=h+'<div class="readout" id="effRead"></div><div class="chart" id="effChart">'+svg+'</div>'
      +tableHTML([T('date'),dU(),vU(),el()],segs.slice().reverse().map(s=>[fdate(s.date,true),nf(dOut(s.dist)),nf(vOut(s.vol),1),nf(ed(s.kmL),1)]));
    const rd=$('#effRead'),hov=$('#effHov'),def=T('segment',{n})+ ' · '+T('avgShort',{v:nf(avg,1)})+' '+el();rd.textContent=def;
    bindHover($('#effChart'),n,X,i=>{const s=segs[i];hov.setAttribute('cx',X(i));hov.setAttribute('cy',Y(vals[i]));hov.setAttribute('visibility','visible');rd.textContent=fdate(s.date,true)+' · '+nf(vals[i],1)+' '+el()+' · '+nf(dOut(s.dist))+' '+dU()+' con '+nf(vOut(s.vol),1)+' '+vU()},()=>{hov.setAttribute('visibility','hidden');rd.textContent=def});
  }

  const GCOL={fuel:'var(--c1)',maint:'var(--c2)',repair:'var(--c3)',other:'var(--c4)'};
  function topRound(x,y,w,h,r){r=Math.min(r,h);const f=v=>(+v).toFixed(1);return'M'+f(x)+' '+f(y+h)+'L'+f(x)+' '+f(y+r)+'Q'+f(x)+' '+f(y)+' '+f(x+r)+' '+f(y)+'L'+f(x+w-r)+' '+f(y)+'Q'+f(x+w)+' '+f(y)+' '+f(x+w)+' '+f(y+r)+'L'+f(x+w)+' '+f(y+h)+'Z'}
  function renderSpend(){
    const months=TL.monthlySpend(state.entries,today(),6),n=months.length;
    const head='<div class="ch-top"><div class="card-h" style="margin:0"><h2>'+T('spendByMonth')+'</h2></div><span class="lbl">'+esc(S().cur)+'</span></div>';
    const mx=Math.max.apply(null,months.map(m=>m.total));
    if(!(mx>0)){$('#spend').innerHTML=head+'<p class="empty">'+T('spendEmpty')+'</p>';return}
    const H=230,pl=48,pr=14,pt=22,pb=28,tk=TL.niceTicks(0,mx*1.05,4),hi=tk[tk.length-1];
    const Y=v=>pt+(1-v/hi)*(H-pt-pb),band=(W-pl-pr)/n,bw=Math.min(24,band*.5),X=i=>pl+band*i+band/2;
    let g='';tk.forEach(v=>{g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="var(--line)" stroke-width="1"/><text x="'+(pl-8)+'" y="'+(Y(v)+4).toFixed(1)+'" text-anchor="end">'+compact(v)+'</text>'});
    const order=['fuel','maint','repair','other'];let bars='',xl='';
    months.forEach((m,i)=>{
      let acc=0;const segs=order.filter(k=>m.g[k]>0);
      segs.forEach((k,si)=>{const y1=Y(acc),y2=Y(acc+m.g[k]),top=si===segs.length-1,hgt=Math.max(1,y1-y2-(top?0:2)),y=y2;
        bars+=top?'<path d="'+topRound(X(i)-bw/2,y,bw,hgt,4)+'" fill="'+GCOL[k]+'"/>':'<rect x="'+(X(i)-bw/2).toFixed(1)+'" y="'+(y2+2).toFixed(1)+'" width="'+bw+'" height="'+Math.max(1,y1-y2-2).toFixed(1)+'" fill="'+GCOL[k]+'"/>';
        acc+=m.g[k]});
      xl+='<text x="'+X(i).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(mname(m.key))+'</text>';
      if(i===n-1&&m.total>0)bars+='<text class="tx2" x="'+X(i).toFixed(1)+'" y="'+(Y(m.total)-7).toFixed(1)+'" text-anchor="middle" style="font-weight:600;font-size:12px">'+compact(m.total)+'</text>';
    });
    const legend='<div class="legend">'+order.map(k=>'<span><i style="background:'+GCOL[k]+'"></i>'+T('group.'+k)+'</span>').join('')+'</div>';
    const svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(T('spendAria'))+'">'+g+bars+xl+'<rect id="spHov" x="0" y="'+pt+'" width="'+band.toFixed(1)+'" height="'+(H-pt-pb)+'" fill="var(--fg)" opacity=".06" visibility="hidden"/></svg>';
    $('#spend').innerHTML=head+legend+'<div class="readout" id="spRead"></div><div class="chart" id="spChart">'+svg+'</div>'
      +tableHTML([T('month')].concat(order.map(k=>T('group.'+k)),[T('total')]),months.slice().reverse().map(m=>[mname(m.key,true)].concat(order.map(k=>money(m.g[k],0)),[money(m.total,0)])));
    const rd=$('#spRead'),hv=$('#spHov'),cur=months[n-1],def=mname(cur.key,true)+' · '+T('total').toLowerCase()+' '+money(cur.total,0);rd.textContent=def;
    bindHover($('#spChart'),n,X,i=>{const m=months[i];hv.setAttribute('x',(X(i)-band/2).toFixed(1));hv.setAttribute('visibility','visible');
      rd.textContent=mname(m.key,true)+' · '+T('total').toLowerCase()+' '+money(m.total,0)+(m.total>0?' — '+order.filter(k=>m.g[k]>0).map(k=>T('group.'+k)+' '+money(m.g[k],0)).join(' · '):'')},()=>{hv.setAttribute('visibility','hidden');rd.textContent=def});
  }

  const CICON={fuel:'i-fuel',service:'i-cog',tires:'i-tire',repair:'i-wrench',wash:'i-drop',docs:'i-doc',other:'i-box'};
  function renderCats(){
    const t=TL.catTotals(state.entries),keys=Object.keys(t).sort((a,b)=>t[b]-t[a]),mx=keys.length?t[keys[0]]:0;
    let h='<div class="card-h"><h2>'+T('catTitle')+'</h2></div>';
    if(!keys.length){$('#cats').innerHTML=h+'<p class="empty">'+T('catEmpty')+'</p>';return}
    h+='<ul class="list">'+keys.map(k=>'<li class="cat"><svg width="20" height="20" class="ico"><use href="#'+CICON[k]+'"/></svg><span class="nm">'+T('cat.'+k)+'</span><span class="am">'+money(t[k],0)+'</span><div class="mb"><i style="width:'+(t[k]/mx*100).toFixed(1)+'%;background:'+GCOL[TL.CATS[k].g]+'"></i></div></li>').join('')+'</ul>';
    $('#cats').innerHTML=h;
  }

  let hFilter='all',hLimit=12;
  function renderHist(){
    const segMap={};TL.fuelSegments(state.entries).forEach(s=>segMap[s.id]=s);
    const flt={all:()=>true,fuel:e=>e.type==='fuel',exp:e=>e.type==='exp',odo:e=>e.type==='odo'};
    const list=state.entries.filter(flt[hFilter]).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(b.odo||0)-(a.odo||0));
    const chip=(v,l)=>'<label class="chip"><input type="radio" name="hf" value="'+v+'" data-act="hist-f"'+(hFilter===v?' checked':'')+'><span>'+l+'</span></label>';
    let h='<div class="card-h"><h2>'+T('history')+'</h2></div><div class="chips hist-f" role="radiogroup" aria-label="'+T('filterAria')+'">'+chip('all',T('all'))+chip('fuel',T('fuel'))+chip('exp',T('exp'))+chip('odo',T('odometer'))+'</div>';
    if(!list.length){$('#hist').innerHTML=h+'<p class="empty">'+T('histEmpty')+'</p>';return}
    h+=list.slice(0,hLimit).map(e=>{
      const c=TL.catOf(e);let title,meta,val='';
      const o=TL.hasOdo(e)?' · '+nf(dOut(e.odo))+' '+dU():'';
      if(e.type==='fuel'){const sg=segMap[e.id];title=T('loadTitle',{v:nf(vOut(e.vol),1),u:vU()});meta=fdate(e.date)+o+(e.full===false?' · '+T('partial'):'')+(sg?' · <em>'+nf(ed(sg.kmL),1)+' '+esc(el())+'</em>':'');val=money(e.cost||0)}
      else if(e.type==='odo'){title=T('odometer');meta=fdate(e.date);val=nf(dOut(e.odo))+' '+dU()}
      else{title=e.desc||T('cat.'+c);meta=T('cat.'+c)+' · '+fdate(e.date)+o;val=e.cost?money(e.cost):''}
      return'<button class="row" data-act="edit-entry" data-id="'+esc(e.id)+'"><span class="ri"><svg width="20" height="20" class="ico"><use href="#'+(e.type==='odo'?'i-gauge':CICON[c])+'"/></svg></span><span><span class="rt">'+esc(title)+'</span><br><span class="rm">'+(e.type==='fuel'?meta:esc(meta))+'</span></span><span class="rv">'+esc(val)+'</span></button>';
    }).join('');
    if(list.length>hLimit)h+='<div class="more"><button class="btn sm" data-act="hist-more">'+T('viewMore',{n:list.length-hLimit})+'</button></div>';
    $('#hist').innerHTML=h;
  }

  /* ---------- Hoja modal ---------- */
  let lastFocus=null,sheetKind=null,savedBodyOverflow=null;
  /* Guardar el valor inline original y devolverlo siempre en closeSheet():
     si queda 'hidden' tras Guardar/Cancelar, el documento se queda sin
     respuesta táctil en Safari/WebKit móvil. */
  function lockBodyScroll(){
    if(savedBodyOverflow!==null)return;
    savedBodyOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    document.body.classList.add('lock');
  }
  function unlockBodyScroll(){
    if(savedBodyOverflow===null)return;
    document.body.style.overflow=savedBodyOverflow;
    savedBodyOverflow=null;
    document.body.classList.remove('lock');
  }
  function openSheet(html,focusSel){
    unlockBodyScroll();
    const b=$('#sheetBody'),wrap=$('#sheet'),wasHidden=wrap.hidden;
    b.innerHTML=html;wrap.hidden=false;wrap.scrollTop=0;lockBodyScroll();
    if(wasHidden)lastFocus=document.activeElement;
    const f=focusSel?b.querySelector(focusSel):null;
    /* En pantallas táctiles no se abre el teclado al abrir el modal: tapaba
       los botones Guardar/Cancelar y los dejaba fuera del viewport visible. */
    const coarse=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
    if(f&&(!coarse||!f.matches('input,textarea,select')))f.focus();
  }
  function closeSheet(){
    $('#sheet').hidden=true;$('#sheetBody').innerHTML='';sheetKind=null;vehicleDraft=null;
    unlockBodyScroll();
    if(lastFocus&&lastFocus.focus)lastFocus.focus();
    lastFocus=null;
  }
  let toastT=null;
  /* Un único temporizador: nunca queda fijado aunque se encadenen avisos.
     Los avisos de recorte viven 3 s; el resto mantiene los 2.5 s habituales. */
  function toast(m,ms){
    const t=$('#toast');if(!t)return;
    t.textContent=m;t.classList.add('on');
    clearTimeout(toastT);
    toastT=setTimeout(()=>{t.classList.remove('on');toastT=null},typeof ms==='number'?ms:2500);
  }
  /* Fallo real de guardado: storage.js emite `onStorageError` cuando fallan
     IndexedDB y el almacenamiento alternativo. El aviso es persistente. */
  (function(){
    const TEXT='Error al guardar los datos en este dispositivo. Exporta un respaldo JSON por seguridad.';
    function showStorageError(ev){
      let el=document.getElementById('storageErrorBanner');
      if(!el){
        el=document.createElement('div');el.id='storageErrorBanner';el.setAttribute('role','alert');
        el.style.cssText='position:fixed;left:50%;top:8px;transform:translateX(-50%);max-width:min(92vw,680px);z-index:2147483647;background:#8b1e1e;color:#fff;padding:12px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);font:600 14px/1.4 system-ui,sans-serif;text-align:center';
        (document.body||document.documentElement).appendChild(el);
      }
      el.textContent=(ev&&ev.detail&&ev.detail.message)||TEXT;
    }
    window.addEventListener('onStorageError',showStorageError);
    if(store&&store.lastStorageError&&store.lastStorageError())showStorageError({detail:store.lastStorageError()});
  })();
  const cutToast=m=>toast(m,3000);
  /* Sin red: aviso de encuadre. Con red: el motivo técnico real, nunca el
     texto genérico de "sin conexión" para un fallo de RAM/codificación/modelo. */
  function aiFailureMessage(err){
    if(err&&err.code==='mask-too-empty')return T('photoCutEmpty');
    const detail=err&&err.message?String(err.message):String(err||'unknown error');
    return navigator.onLine===false?T('photoFallback'):T('photoFailDetail',{error:detail});
  }
  const nv=id=>{const e=document.getElementById(id);return e?e.valueAsNumber:NaN};
  const sv=id=>{const e=document.getElementById(id);return e?e.value.trim():''};
  function head(title){return'<div class="sh-head"><h2 id="shT">'+title+'</h2><button class="icon-btn" type="button" data-close aria-label="'+T('close')+'"><svg width="20" height="20" class="ico"><use href="#i-x"/></svg></button></div>'}

  /* ---------- Modal de edición rápida del vehículo ---------- */
  function vehicleTools(v){
    const photo=isPhotoActive(v),has=hasPhoto(v);
    return'<label class="btn sm ghost" for="v-photo"><svg width="20" height="20" class="ico"><use href="#i-camera"/></svg>'+T(has?'changePhoto':'uploadPhoto')+'</label>'
      +'<input id="v-photo" type="file" accept="image/*" hidden>'
      +(has?'<button type="button" class="btn sm ghost" id="v-toggle-view"><svg width="20" height="20" class="ico"><use href="#i-'+(photo?'cube':'camera')+'"/></svg>'+T(photo?'useBlueprint':'useMyPhoto')+'</button>'
        +((v.photoOriginal||v.photoCutDataUrl)?'<button type="button" class="btn sm ghost" id="v-cut-toggle"><svg width="20" height="20" class="ico"><use href="#i-'+(v.photoCut&&!isStaleCut(v)?'camera':'cube')+'"/></svg>'+T(v.photoCut&&!isStaleCut(v)?'originalPhoto':'cutoutAI')+'</button>':'')
        +'<button type="button" class="btn sm ghost" id="v-del-photo">'+T('removePhoto')+'</button>':'');
  }
  function openVehicle(){
    sheetKind='vehicle';const d=Object.assign({},veh());vehicleDraft=d;
    const paint=()=>{const p=$('#v-preview');if(p)p.innerHTML=stageHTML(d)};
    const tools=()=>{const t=$('#v-tools');if(t)t.innerHTML=vehicleTools(d)};
    const sync=()=>{markConfigured();Object.assign(veh(),{brand:d.brand,model:d.model,year:d.year,body:d.body,color:d.color,
      photoDataUrl:d.photoDataUrl,photoOriginal:d.photoOriginal,photoFallback:d.photoFallback,photoCutDataUrl:d.photoCutDataUrl,
      photoCutModel:d.photoCutModel||null,
      photoCut:!!d.photoCut,photoCutWanted:d.photoCutWanted!==false,photoView:d.photoView||'fallback',usePhoto:!!d.usePhoto,empty:false});
      state.settings.name=AC.core.vehicleLabel(d);commit()};
    const other=BRANDS.indexOf(d.brand)<0;
    const colors=COLORS.map(c=>'<label class="col"><input type="radio" name="v-color" value="'+c.id+'"'+(d.color===c.id?' checked':'')+'><span><i style="background:linear-gradient(135deg,'+c.light+' 0%,'+c.hex+' 55%,'+c.dark+' 100%)"></i>'+esc(T('color.'+c.id))+'</span></label>').join('');
    openSheet(head(T('editVehicle'))+'<form id="frm" novalidate>'
      +'<div class="veh-modal-stage" id="v-preview"></div><div class="veh-view-tools" id="v-tools"></div>'
      +'<p class="hint">'+T('photoHint')+'</p>'
      +'<label class="fld"><span>'+T('brand')+'</span><select id="v-brand">'+BRANDS.map(b=>'<option value="'+esc(b)+'"'+(d.brand===b?' selected':'')+'>'+esc(b==='Otra'?T('other'):b)+'</option>').join('')+'</select></label>'
      +'<label class="fld" id="v-other-wrap"'+(other?'':' hidden')+'><span>'+T('otherBrand')+'</span><input id="v-brand-other" type="text" maxlength="40" value="'+esc(other?d.brand:'')+'" placeholder="'+esc(T('brandPlaceholder'))+'"></label>'
      +'<div class="row2"><label class="fld"><span>'+T('model')+'</span><input id="v-model" type="text" maxlength="40" value="'+esc(d.model)+'" placeholder="'+esc(T('modelPlaceholder'))+'" required></label>'
      +'<label class="fld"><span>'+T('year')+'</span><input id="v-year" type="number" inputmode="numeric" min="1900" max="2100" step="1" value="'+esc(d.year)+'"></label></div>'
      +'<label class="fld"><span>'+T('bodyType')+'</span><select id="v-body">'+BODIES.map(b=>'<option value="'+b.id+'"'+(d.body===b.id?' selected':'')+'>'+esc(T('body.'+b.id))+'</option>').join('')+'</select></label>'
      +'<div class="fld"><span>'+T('paintColor')+'</span><div class="cols">'+colors+'</div></div>'
      +'<p class="form-err" id="ferr" role="alert"></p>'
      +'<div class="sh-foot"><button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>','#v-model');
    paint();tools();
    $('#v-brand').addEventListener('change',()=>{$('#v-other-wrap').hidden=$('#v-brand').value!=='Otra';d.brand=$('#v-brand').value==='Otra'?sv('v-brand-other'):$('#v-brand').value;sync()});
    $('#v-brand-other')&&$('#v-brand-other').addEventListener('input',()=>{if($('#v-brand').value==='Otra'){d.brand=sv('v-brand-other');sync()}});
    $('#v-model').addEventListener('input',()=>{d.model=$('#v-model').value.trim();sync()});
    $('#v-year').addEventListener('input',()=>{const y=Number($('#v-year').value);if(Number.isFinite(y)){d.year=y;sync()}});
    $('#v-body').addEventListener('change',()=>{d.body=$('#v-body').value;paint();sync()});
    $('#frm').addEventListener('change',e=>{if(e.target.name==='v-color'){d.color=e.target.value;paint();sync()}});
    $('#v-tools').addEventListener('click',e=>{
      if(e.target.closest('#v-toggle-view')){d.usePhoto=!d.usePhoto;paint();tools();sync()}
      if(e.target.closest('#v-cut-toggle'))toggleCutout(true,paint,tools);
      if(e.target.closest('#v-del-photo')){
        ['photoDataUrl','photoOriginal','photoFallback','photoCutDataUrl','photoCutModel','photoCut','photoCutWanted','photoView','usePhoto'].forEach(k=>{d[k]=k==='photoCutWanted'?true:(k==='photoView'?'fallback':null)});
        paint();tools();sync();toast(T('photoRemoved'))
      }
    });
    $('#v-tools').addEventListener('change',e=>{if(e.target.id==='v-photo')handlePhoto(e.target.files&&e.target.files[0],true,paint,tools)});
    $('#frm').addEventListener('submit',e=>{
      e.preventDefault();
      const brand=$('#v-brand').value==='Otra'?sv('v-brand-other'):$('#v-brand').value;
      const model=sv('v-model'),year=nv('v-year');
      if(!brand)return $('#ferr').textContent=T('errBrand');
      if(!model)return $('#ferr').textContent=T('errModel');
      if(!Number.isFinite(year)||year<1900||year>2100)return $('#ferr').textContent=T('errYear');
      Object.assign(d,{brand,model,year:Math.round(year)});
      sync();closeSheet();toast(T('vehicleUpdated'));
    });
  }

  function armDelete(btn,fn){
    btn.addEventListener('click',()=>{if(btn.classList.contains('armed')){fn();return}btn.classList.add('armed');btn.textContent=T('confirmDelete');setTimeout(()=>{if(btn.isConnected){btn.classList.remove('armed');btn.textContent=T('delete')}},4000)});
  }

  /* ---------- Garaje: alta, cambio y baja de vehículos ---------- */
  function switchVehicle(id){
    if(id===store.garage.activeId())return;
    if(!store.garage.select(id))return;
    if(typeof AC.clearVisuals==='function')AC.clearVisuals();
    commit();
  }
  function addVehicle(){
    store.garage.add();
    if(typeof AC.clearVisuals==='function')AC.clearVisuals();
    commit();
    openVehicle();
    toast(T('vehicleAdded'));
  }
  function openVehicleDelete(){
    const id=store.garage.activeId(),label=AC.core.vehicleLabel(veh());
    openSheet(head(T('deleteVehicle'))+'<p class="hint">'+T('deleteVehicleHint',{n:esc(label)})+(store.garage.count()===1?'<br>'+T('lastVehicleHint'):'')+'</p>'
      +'<div class="sh-foot"><button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="button" class="btn danger" id="delVehGo">'+T('deleteVehicle')+'</button></div>','#delVehGo');
    armDelete($('#delVehGo'),()=>{
      store.garage.remove(id);
      if(typeof AC.clearVisuals==='function')AC.clearVisuals();
      commit();closeSheet();toast(T('vehicleDeleted'));
    });
  }

  /* ---------- Componentes críticos ---------- */
  function openComponent(key){
    if(AC.core.COMP_KEYS.indexOf(key)<0)return;
    sheetKind='comp';
    const c=state.components.find(x=>x.key===key),edit=!!c,lim=AC.core.COMP_LIMITS[key]||{km:40000,months:48};
    const km=x=>x!=null&&Number.isFinite(x)?+(dOut(x)).toFixed(0):'';
    openSheet(head(T(edit?'editComponent':'newComponent',{n:T('comp.'+key)}))+'<form id="frm" novalidate>'
      +'<div class="row2"><label class="fld"><span>'+T('installDate')+'</span><input id="c-date" type="date" value="'+(c&&c.date?c.date:'')+'"></label>'
      +'<label class="fld"><span>'+T('odoUnit',{u:dU()})+'</span><input id="c-odo" type="number" inputmode="decimal" step="any" min="0" value="'+(c?km(c.odo):'')+'"></label></div>'
      +'<div class="row2"><label class="fld"><span>'+T('expectedKm',{u:dU()})+'</span><input id="c-km" type="number" inputmode="decimal" step="any" min="0" value="'+km(c?c.intervalKm:lim.km)+'" placeholder="'+km(lim.km)+'"></label>'
      +'<label class="fld"><span>'+T('expectedMonths')+'</span><input id="c-mo" type="number" inputmode="numeric" step="1" min="0" value="'+(c&&c.intervalMonths?c.intervalMonths:lim.months)+'" placeholder="'+lim.months+'"></label></div>'
      +'<p class="hint">'+T('compHint')+'</p><p class="form-err" id="ferr" role="alert"></p>'
      +'<div class="sh-foot">'+(edit?'<button type="button" class="btn danger" id="delBtn">'+T('delete')+'</button><span class="sp"></span>':'')
      +'<button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>','#c-date');
    if(edit)armDelete($('#delBtn'),()=>{state.components=state.components.filter(x=>x!==c);commit();closeSheet();toast(T('compDeleted'))});
    $('#frm').addEventListener('submit',e=>{
      e.preventDefault();
      const date=sv('c-date'),odo=nv('c-odo'),ik=nv('c-km'),im=nv('c-mo');
      if(!date&&!Number.isFinite(odo))return $('#ferr').textContent=T('errComp');
      const rec={id:edit?c.id:uid('p'),key,date:date||null,odo:Number.isFinite(odo)?dIn(odo):null,
        intervalKm:ik>0?dIn(ik):null,intervalMonths:im>0?Math.round(im):null};
      if(edit){Object.keys(c).forEach(k=>delete c[k]);Object.assign(c,rec)}
      else state.components.push(rec);
      commit();closeSheet();toast(T('compSaved'));
    });
  }

  /* ---------- Etapa 2 · Formularios independientes por vehículo ---------- */
  function openTire(){
    sheetKind='tire';const t=state.tire||{},edit=!!(t.brandSize||t.installDate||t.installOdo!=null||t.lifeKm>0||t.rotDate||t.rotOdo!=null);
    const km=x=>x!=null&&Number.isFinite(x)?+(dOut(x)).toFixed(0):'';
    openSheet(head(T(edit?'tireEdit':'tireAdd'))+'<form id="frm" novalidate>'
      +'<label class="fld"><span>'+T('tireBrandSize')+'</span><input id="t-brand" type="text" maxlength="60" value="'+esc(t.brandSize||'')+'" placeholder="'+esc(T('tireBrandPlaceholder'))+'"></label>'
      +'<div class="row2"><label class="fld"><span>'+T('tireInstallDate')+'</span><input id="t-date" type="date" value="'+(t.installDate||'')+'"></label>'
      +'<label class="fld"><span>'+T('tireInstallOdo',{u:dU()})+'</span><input id="t-odo" type="number" inputmode="decimal" step="any" min="0" value="'+km(t.installOdo)+'" placeholder="'+esc(T('optional'))+'"></label></div>'
      +'<div class="row2"><label class="fld"><span>'+T('tireLife',{u:dU()})+'</span><input id="t-life" type="number" inputmode="decimal" step="any" min="0" value="'+km(t.lifeKm)+'" placeholder="'+nf(dOut(50000))+'"></label>'
      +'<label class="fld"><span>'+T('tireRotOdo',{u:dU()})+'</span><input id="t-rodo" type="number" inputmode="decimal" step="any" min="0" value="'+km(t.rotOdo)+'" placeholder="'+esc(T('optional'))+'"></label></div>'
      +'<label class="fld"><span>'+T('tireRotDate')+'</span><input id="t-rdate" type="date" value="'+(t.rotDate||'')+'"></label>'
      +'<p class="hint">'+T('tireHint',{n:nf(dOut(TL.TIRE_ROT_KM)),u:dU()})+'</p><p class="form-err" id="ferr" role="alert"></p>'
      +'<div class="sh-foot">'+(edit?'<button type="button" class="btn danger" id="delBtn">'+T('delete')+'</button><span class="sp"></span>':'')
      +'<button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>','#t-date');
    if(edit)armDelete($('#delBtn'),()=>{state.tire=Object.assign({},AC.core.TIRE_DEFAULT);commit();closeSheet();toast(T('tireDeleted'))});
    $('#frm').addEventListener('submit',e=>{
      e.preventDefault();
      const date=sv('t-date'),odo=nv('t-odo'),life=nv('t-life'),rd=sv('t-rdate'),ro=nv('t-rodo');
      if(!date&&!Number.isFinite(odo))return $('#ferr').textContent=T('errComp');
      demoCleared();
      state.tire={brandSize:sv('t-brand'),installDate:date||null,installOdo:Number.isFinite(odo)?dIn(odo):null,
        lifeKm:life>0?dIn(life):null,rotDate:rd||null,rotOdo:Number.isFinite(ro)?dIn(ro):null,demo:false};
      commit();closeSheet();toast(T('tireSaved'));
    });
  }
  function openValue(){
    sheetKind='value';const v=state.value||{},edit=!!(v.purchase!=null||v.current!=null);
    openSheet(head(T(edit?'valueEdit':'valueAdd'))+'<form id="frm" novalidate>'
      +'<label class="fld"><span>'+T('valuePurchase',{c:esc(S().cur)})+'</span><input id="val-p" type="number" inputmode="decimal" step="any" min="0" value="'+(v.purchase!=null?v.purchase:'')+'" placeholder="0"></label>'
      +'<label class="fld"><span>'+T('valueCurrent',{c:esc(S().cur)})+'</span><input id="val-c" type="number" inputmode="decimal" step="any" min="0" value="'+(v.current!=null?v.current:'')+'" placeholder="0"></label>'
      +'<p class="hint">'+T('valueHint')+'</p><p class="form-err" id="ferr" role="alert"></p>'
      +'<div class="sh-foot">'+(edit?'<button type="button" class="btn danger" id="delBtn">'+T('delete')+'</button><span class="sp"></span>':'')
      +'<button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>','#val-p');
    if(edit)armDelete($('#delBtn'),()=>{state.value=Object.assign({},AC.core.VALUE_DEFAULT);commit();closeSheet();toast(T('valueDeleted'))});
    $('#frm').addEventListener('submit',e=>{
      e.preventDefault();
      const p=nv('val-p'),c=nv('val-c');
      if(!Number.isFinite(p)||p<=0)return $('#ferr').textContent=T('errPurchase');
      if(!Number.isFinite(c)||c<0)return $('#ferr').textContent=T('errCurrent');
      demoCleared();
      state.value={purchase:p,current:c,demo:false};
      commit();closeSheet();toast(T('valueSaved'));
    });
  }

  /* Reinicio usado por "Borrar todos los datos" y por "Empezar con mis datos". */
  function resetAll(message){
    state=store.wipe();
    if(typeof AC.clearVisuals==='function')AC.clearVisuals();
    commit();
    closeSheet();
    toast(message||T('delDone'));
  }

  /* ---------- Formulario de registros ---------- */
  const SUGG={service:'suggest.service',repair:'suggest.repair',tires:'suggest.tires',wash:'suggest.wash',docs:'suggest.docs',other:'suggest.other'};
  const ECATS=['service','repair','tires','wash','docs','other'];

  function openEntry(kind,entry,pre){
    pre=pre||{};sheetKind='entry';const edit=!!entry,t=today(),cur=TL.currentOdo(state.entries);
    const tabs=edit?'':'<div class="tabs" role="tablist">'+[[T('fuel'),'fuel'],[T('exp'),'exp'],[T('odometer'),'odo']].map(x=>'<button type="button" role="tab" data-kind="'+x[1]+'" class="'+(kind===x[1]?'on':'')+'" aria-selected="'+(kind===x[1])+'">'+x[0]+'</button>').join('')+'</div>';
    const dt=entry?entry.date:t;
    const odoPh=cur!=null?T('lastOdo',{v:nf(dOut(cur))}):'';
    const odoVal=entry&&TL.hasOdo(entry)?+(dOut(entry.odo)).toFixed(1):'';
    const demoNote=(!edit&&hasDemo())?'<p class="hint">'+T('demoFirst')+'</p>':'';
    let body='';
    if(kind==='fuel'){
      const price=entry&&entry.vol>0?+(entry.cost/vOut(entry.vol)).toFixed(3):'';
      body='<div class="row2"><label class="fld"><span>'+T('date')+'</span><input id="f-date" type="date" value="'+dt+'" required></label>'
        +'<label class="fld"><span>'+T('odoUnit',{u:dU()})+'</span><input id="f-odo" type="number" inputmode="decimal" step="any" min="0" value="'+odoVal+'" placeholder="'+esc(odoPh)+'" required></label></div>'
        +'<div class="row2"><label class="fld"><span>'+T('amountUnit',{u:esc(vU())})+'</span><input id="f-vol" type="number" inputmode="decimal" step="any" min="0" value="'+(entry?+(vOut(entry.vol)).toFixed(2):'')+'" required></label>'
        +'<label class="fld"><span>'+T('pricePer',{u:esc(vU())})+'</span><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="'+price+'"></label></div>'
        +'<label class="fld"><span>'+T('totalPaid',{c:esc(S().cur)})+'</span><input id="f-total" type="number" inputmode="decimal" step="any" min="0" value="'+(entry&&entry.cost!=null?entry.cost:'')+'"></label>'
        +'<label class="sw"><span><b>'+T('fullTank')+'</b><span class="hint">'+T('fullTankHint')+'</span></span><input id="f-full" type="checkbox" '+(!entry||entry.full!==false?'checked':'')+'></label>'
        +'<div class="prev" id="fprev" aria-live="polite"></div>';
    }else if(kind==='exp'){
      const cat=(entry&&entry.cat)||pre.cat||'service';
      const rems=edit?'':(state.reminders.length?'<div class="fld"><span>'+T('resetReminders')+'</span><div class="chips" id="remChips">'+state.reminders.map(r=>'<label class="chip"><input type="checkbox" value="'+esc(r.id)+'" data-cat="'+esc(r.cat)+'"'+((pre.remId===r.id||(!pre.remId&&r.cat===cat))?' checked':'')+'><span>'+esc(r.name)+'</span></label>').join('')+'</div><span class="hint">'+T('resetRemHint')+'</span></div>':'');
      body='<div class="fld"><span>'+T('category')+'</span><div class="chips" id="catChips">'+ECATS.map(c=>'<label class="chip"><input type="radio" name="cat" value="'+c+'"'+(c===cat?' checked':'')+'><span>'+T('cat.'+c)+'</span></label>').join('')+'</div></div>'
        +'<label class="fld"><span>'+T('description')+'</span><input id="e-desc" list="dl" type="text" maxlength="80" value="'+esc((entry&&entry.desc)||pre.desc||'')+'" placeholder="'+esc(T('namePlaceholder'))+'"></label><datalist id="dl"></datalist>'
        +'<div class="row2"><label class="fld"><span>'+T('date')+'</span><input id="e-date" type="date" value="'+dt+'" required></label>'
        +'<label class="fld"><span>'+T('odoUnit',{u:dU()})+'</span><input id="e-odo" type="number" inputmode="decimal" step="any" min="0" value="'+odoVal+'" placeholder="'+esc(odoPh)+'"></label></div>'
        +'<label class="fld"><span>'+T('totalPaid',{c:esc(S().cur)})+'</span><input id="e-cost" type="number" inputmode="decimal" step="any" min="0" value="'+(entry&&entry.cost?entry.cost:'')+'"></label>'+rems;
    }else{
      body='<div class="row2"><label class="fld"><span>'+T('date')+'</span><input id="o-date" type="date" value="'+dt+'" required></label>'
        +'<label class="fld"><span>'+T('odoUnit',{u:dU()})+'</span><input id="o-odo" type="number" inputmode="decimal" step="any" min="0" value="'+odoVal+'" placeholder="'+esc(odoPh)+'" required></label></div>'
        +'<p class="hint">'+T('noOdoNote')+'</p>';
    }
    const title=edit?T('editRecord'):T('newRecord');
    openSheet(head(title)+tabs+'<form id="frm" novalidate>'+body+demoNote+'<p class="form-err" id="ferr" role="alert"></p><div class="sh-foot">'
      +(edit?'<button type="button" class="btn danger" id="delBtn">'+T('delete')+'</button><span class="sp"></span>':'')
      +'<button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>',kind==='fuel'?'#f-odo':kind==='odo'?'#o-odo':'#e-desc');

    const frm=$('#frm');
    document.querySelectorAll('.tabs [data-kind]').forEach(b=>b.addEventListener('click',()=>openEntry(b.dataset.kind,null,pre)));
    if(edit)armDelete($('#delBtn'),()=>{state.entries=state.entries.filter(e=>e.id!==entry.id);commit();closeSheet();toast(T('entryDeleted'))});
    const err=m=>{$('#ferr').textContent=m};
    if(kind==='fuel'){
      let lastEd=entry?'total':'price';
      const calc=()=>{const v=nv('f-vol'),p=nv('f-price'),tt=nv('f-total');
        if(lastEd==='total'){if(v>0&&tt>=0)$('#f-price').value=+(tt/v).toFixed(3)}
        else if(v>=0&&p>=0)$('#f-total').value=+(v*p).toFixed(2);
        preview()};
      const preview=()=>{
        const odo=nv('f-odo'),vol=nv('f-vol'),pv=$('#fprev');pv.className='prev';
        if(!(vol>0)||!Number.isFinite(odo)){pv.textContent='';return}
        const draft={id:'__draft',type:'fuel',date:sv('f-date')||t,odo:dIn(odo),vol:vIn(vol),full:$('#f-full').checked,cost:0};
        const others=state.entries.filter(e=>!entry||e.id!==entry.id);
        if(cur!=null&&draft.odo<cur-0.5&&!edit){pv.className='prev warn';pv.textContent=T('lowerOdo',{v:nf(dOut(cur))+' '+dU()});return}
        const sg=TL.fuelSegments(others.concat([draft])).find(s=>s.id==='__draft');
        if(sg)pv.innerHTML=T('effPreview',{v:nf(ed(sg.kmL),1),u:esc(el()),d:nf(dOut(sg.dist)),du:dU(),vol:nf(vOut(sg.vol),1),vu:esc(vU())});
        else if(!draft.full)pv.textContent=T('partialNote');
        else pv.textContent=T('startNote');
      };
      $('#f-vol').addEventListener('input',calc);$('#f-price').addEventListener('input',()=>{lastEd='price';calc()});$('#f-total').addEventListener('input',()=>{lastEd='total';calc()});
      $('#f-odo').addEventListener('input',preview);$('#f-date').addEventListener('input',preview);$('#f-full').addEventListener('change',preview);preview();
      frm.addEventListener('submit',e=>{e.preventDefault();
        const odo=nv('f-odo'),vol=nv('f-vol'),date=sv('f-date');let cost=nv('f-total');
        if(!date)return err(T('errDate'));
        if(!Number.isFinite(odo)||odo<0)return err(T('errOdo'));
        if(!(vol>0))return err(T('errVol'));
        if(!Number.isFinite(cost)){const p=nv('f-price');cost=Number.isFinite(p)?Math.round(p*vol*100)/100:0}
        const rec={id:entry?entry.id:uid('f'),type:'fuel',date,odo:dIn(odo),vol:vIn(vol),cost,full:$('#f-full').checked};
        saveEntry(rec,entry,[]);closeSheet();toast(T('fuelSaved'));
      });
    }else if(kind==='exp'){
      const fillDl=c=>{$('#dl').innerHTML=TLIST(SUGG[c]||'').map(s=>'<option value="'+esc(s)+'">').join('')};
      const curCat=()=>(frm.querySelector('input[name=cat]:checked')||{}).value||'service';
      fillDl(curCat());
      $('#catChips').addEventListener('change',()=>{fillDl(curCat());if(!edit&&!pre.remId)document.querySelectorAll('#remChips input').forEach(i=>{i.checked=i.dataset.cat===curCat()})});
      frm.addEventListener('submit',e=>{e.preventDefault();
        const date=sv('e-date'),odo=nv('e-odo'),cost=nv('e-cost'),cat=curCat(),desc=sv('e-desc');
        if(!date)return err(T('errDate'));
        if(!desc&&!(cost>0))return err(T('errDescCost'));
        const rec={id:entry?entry.id:uid('x'),type:'exp',cat,desc,date,odo:Number.isFinite(odo)?dIn(odo):null,cost:Number.isFinite(cost)?cost:0};
        const ids=[].slice.call(document.querySelectorAll('#remChips input:checked')).map(i=>i.value);
        saveEntry(rec,entry,ids);closeSheet();toast(T('expSaved'));
      });
    }else{
      frm.addEventListener('submit',e=>{e.preventDefault();
        const date=sv('o-date'),odo=nv('o-odo');
        if(!date)return err(T('errDate'));
        if(!Number.isFinite(odo)||odo<0)return err(T('errOdo'));
        saveEntry({id:entry?entry.id:uid('o'),type:'odo',date,odo:dIn(odo),cost:0},entry,[]);closeSheet();toast(T('odoSaved'));
      });
    }
  }
  function saveEntry(rec,old,remIds){
    demoCleared();
    const cur=TL.currentOdo(state.entries);
    if(old){const i=state.entries.findIndex(e=>e.id===old.id);if(i>=0)state.entries[i]=rec;else state.entries.push(rec)}
    else state.entries.push(rec);
    remIds.forEach(id=>{const r=state.reminders.find(x=>x.id===id);if(r){r.lastDate=rec.date;r.lastOdo=TL.hasOdo(rec)?rec.odo:(cur!=null?cur:null)}});
    commit();
  }

  /* ---------- Recordatorios ---------- */
  function openReminder(id){
    sheetKind='rem';const r=state.reminders.find(x=>x.id===id),edit=!!r,cur=TL.currentOdo(state.entries);
    const v=r||{name:'',cat:'service',intervalKm:null,intervalMonths:null,lastOdo:cur,lastDate:today()};
    const km=x=>x!=null&&Number.isFinite(x)?+(dOut(x)).toFixed(0):'';
    openSheet(head(edit?T('editReminder'):T('newReminder'))+'<form id="frm" novalidate>'
      +'<label class="fld"><span>'+T('name')+'</span><input id="r-name" type="text" maxlength="60" value="'+esc(v.name)+'" placeholder="'+esc(T('namePlaceholder'))+'" required></label>'
      +'<label class="fld"><span>'+T('expType')+'</span><select id="r-cat">'+['service','tires','repair','wash','other'].map(c=>'<option value="'+c+'"'+(v.cat===c?' selected':'')+'>'+T('cat.'+c)+'</option>').join('')+'</select></label>'
      +'<div class="row2"><label class="fld"><span>'+T('everyUnit',{u:dU()})+'</span><input id="r-km" type="number" inputmode="decimal" step="any" min="0" value="'+km(v.intervalKm)+'" placeholder="10000"></label>'
      +'<label class="fld"><span>'+T('everyMonths')+'</span><input id="r-mo" type="number" inputmode="numeric" step="1" min="0" value="'+(v.intervalMonths||'')+'" placeholder="'+T('optional')+'"></label></div>'
      +'<div class="row2"><label class="fld"><span>'+T('lastChange')+'</span><input id="r-date" type="date" value="'+(v.lastDate||'')+'"></label>'
      +'<label class="fld"><span>'+T('odoThen',{u:dU()})+'</span><input id="r-odo" type="number" inputmode="decimal" step="any" min="0" value="'+km(v.lastOdo)+'"></label></div>'
      +'<p class="hint">'+T('intervalHint')+'</p><p class="form-err" id="ferr" role="alert"></p>'
      +'<div class="sh-foot">'+(edit?'<button type="button" class="btn danger" id="delBtn">'+T('delete')+'</button><span class="sp"></span>':'')+'<button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>','#r-name');
    if(edit)armDelete($('#delBtn'),()=>{state.reminders=state.reminders.filter(x=>x.id!==id);commit();closeSheet();toast(T('remDeleted'))});
    $('#frm').addEventListener('submit',e=>{e.preventDefault();
      const name=sv('r-name'),ik=nv('r-km'),im=nv('r-mo'),ld=sv('r-date'),lo=nv('r-odo');
      if(!name)return $('#ferr').textContent=T('errName');
      if(!(ik>0)&&!(im>0))return $('#ferr').textContent=T('errInterval',{u:dU()});
      const rec={id:edit?r.id:uid('r'),name,cat:$('#r-cat').value,intervalKm:ik>0?dIn(ik):null,intervalMonths:im>0?Math.round(im):null,lastOdo:Number.isFinite(lo)?dIn(lo):null,lastDate:ld||null};
      if(edit){Object.keys(r).forEach(k=>delete r[k]);Object.assign(r,rec)}else state.reminders.push(rec);
      commit();closeSheet();toast(T('remSaved'));
    });
  }

  /* ---------- Documentos ---------- */
  function openDoc(id,pre){
    pre=pre||{};
    sheetKind='doc';const d=state.docs.find(x=>x.id===id),edit=!!d;
    const key=edit?(d.key||AC.core.docKeyOf(d.name)):(AC.core.DOC_KEYS.indexOf(pre.key)>=0?pre.key:null);
    openSheet(head(edit?T('editDoc'):T('newDoc'))+'<form id="frm" novalidate>'
      +'<label class="fld"><span>'+T('name')+'</span><input id="d-name" type="text" maxlength="60" list="dnl" value="'+esc(edit?d.name:(key?T('doc.'+key):''))+'" placeholder="'+esc(T('docNamePlaceholder'))+'" required></label><datalist id="dnl">'+['insurance','tax','inspection','license'].map(k=>'<option value="'+esc(T('doc.'+k))+'">').join('')+'</datalist>'
      +'<label class="fld"><span>'+T('docKey')+'</span><select id="d-key">'+[''].concat(AC.core.DOC_KEYS).map(k=>'<option value="'+k+'"'+(key===k?' selected':'')+'>'+esc(k?T('doc.'+k):T('none'))+'</option>').join('')+'</select></label>'
      +'<label class="fld"><span>'+T('due')+'</span><input id="d-due" type="date" value="'+(edit&&d.due?d.due:'')+'"></label>'
      +'<label class="fld"><span>'+T('note')+'</span><input id="d-note" type="text" maxlength="120" value="'+esc(edit?d.note:'')+'" placeholder="'+esc(T('docNotePlaceholder'))+'"></label>'
      +'<p class="form-err" id="ferr" role="alert"></p><div class="sh-foot">'+(edit?'<button type="button" class="btn danger" id="delBtn">'+T('delete')+'</button><span class="sp"></span>':'')+'<button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>',edit&&d.due?null:'#d-name');
    if(edit)armDelete($('#delBtn'),()=>{state.docs=state.docs.filter(x=>x.id!==id);commit();closeSheet();toast(T('docDeleted'))});
    $('#frm').addEventListener('submit',e=>{e.preventDefault();
      const name=sv('d-name');if(!name)return $('#ferr').textContent=T('errName');
      const dk=$('#d-key').value;
      const rec={id:edit?d.id:uid('c'),name,due:sv('d-due')||null,note:sv('d-note')};
      if(dk)rec.key=dk;
      if(edit){Object.keys(d).forEach(k=>delete d[k]);Object.assign(d,rec)}else state.docs.push(rec);
      commit();closeSheet();toast(T('docSaved'));
    });
  }
  function openRenew(id){
    sheetKind='renew';const d=state.docs.find(x=>x.id===id);if(!d)return;
    const t=today(),base=d.due&&d.due>t?d.due:t;
    openSheet(head(T('renewPrefix',{n:esc(d.name)}))+'<form id="frm" novalidate>'
      +'<label class="fld"><span>'+T('newDue')+'</span><input id="n-due" type="date" value="'+TL.addMonths(base,12)+'" required></label>'
      +'<label class="fld"><span>'+T('amountPaid',{c:esc(S().cur)})+'</span><input id="n-cost" type="number" inputmode="decimal" step="any" min="0" placeholder="'+T('optional')+'"></label>'
      +'<p class="hint">'+T('renewHint')+'</p><p class="form-err" id="ferr" role="alert"></p>'
      +'<div class="sh-foot"><button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('renew')+'</button></div></form>','#n-due');
    $('#frm').addEventListener('submit',e=>{e.preventDefault();
      const due=sv('n-due'),cost=nv('n-cost');if(!due)return $('#ferr').textContent=T('errNewDue');
      d.due=due;
      if(cost>0)state.entries.push({id:uid('x'),type:'exp',cat:'docs',desc:T('renewPrefix',{n:d.name}),date:today(),odo:null,cost});
      demoCleared();commit();closeSheet();toast(T('dueUpdated'));
    });
  }

  /* ---------- Configuración ---------- */
  let pendingImport=null;
  const CUR_FALLBACK='AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL'.split(' ');
  const CUR=(typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('currency'):CUR_FALLBACK);
  const validCur=c=>{try{new Intl.NumberFormat(LOC(),{style:'currency',currency:c});return true}catch(e){return false}};
  const systemOf=x=>x.dist==='km'&&x.vol==='L'&&x.eff==='dist'?'metric':(x.dist==='mi'&&x.vol==='galUS'&&x.eff==='vol'?'imperial':'custom');
  function openSettings(){
    sheetKind='set';const s=S();
    const sel=(id,opts,val)=>'<select id="'+id+'">'+opts.map(o=>'<option value="'+o[0]+'"'+(val===o[0]?' selected':'')+'>'+esc(o[1])+'</option>').join('')+'</select>';
    openSheet(head(T('settings'))+'<form id="frm" novalidate>'
      +'<label class="fld"><span>'+T('carName')+'</span><input id="s-name" type="text" maxlength="60" value="'+esc(veh().alias||AC.core.vehicleLabel(veh()))+'" placeholder="'+esc(AC.core.vehicleLabel(veh()))+'"></label>'
      +'<label class="fld"><span>'+T('unitSystem')+'</span>'+sel('s-system',[['metric',T('metric')],['imperial',T('imperial')],['custom',T('customUnits')]],systemOf(s))+'</label>'
      +'<div class="row2"><label class="fld"><span>'+T('distance')+'</span>'+sel('s-dist',[['km',T('kilometers')],['mi',T('miles')]],s.dist)+'</label>'
      +'<label class="fld"><span>'+T('fuelUnit')+'</span>'+sel('s-vol',Object.keys(TL.VOL).map(k=>[k,T('vol.'+k)]),s.vol)+'</label></div>'
      +'<label class="fld"><span>'+T('efficiency')+'</span><select id="s-eff"></select></label>'
      +'<label class="fld"><span>'+T('currencyISO')+'</span><input id="s-cur" list="curl" type="text" maxlength="3" value="'+esc(s.cur)+'" style="text-transform:uppercase"><span class="hint" id="curPrev"></span></label><datalist id="curl">'+CUR.map(c=>'<option value="'+esc(c)+'">').join('')+'</datalist>'
      +'<div class="row2"><label class="fld"><span>'+T('notifyWith',{u:'<span id="wkU"></span>'})+'</span><input id="s-wk" type="number" inputmode="decimal" step="any" min="0" value="'+Math.round(dOut(s.warnKm))+'"></label>'
      +'<label class="fld"><span>'+T('notifyDays')+'</span><input id="s-wd" type="number" inputmode="numeric" step="1" min="0" value="'+s.warnDays+'"></label></div>'
      +'<p class="form-err" id="ferr" role="alert"></p><div class="sh-foot"><button type="button" class="btn" data-close>'+T('cancel')+'</button><button type="submit" class="btn primary">'+T('save')+'</button></div></form>'
      +'<div class="sec" id="dataSec"><h3>'+T('dataSection')+'</h3><p class="hint" id="syncHint"></p><div class="chips" id="expBtns"><button type="button" class="btn sm" id="expJ">'+T('expJson')+'</button><button type="button" class="btn sm" id="expC">'+T('expCsv')+'</button></div>'
      +'<div class="chips"><label class="btn sm" for="impF" style="cursor:pointer">'+T('importCopy')+'</label><input id="impF" type="file" accept=".json,application/json" style="position:absolute;opacity:0;width:1px;height:1px"></div><div id="impBox"></div>'
      +'<button type="button" class="btn danger sm" id="delAll" style="justify-self:start">'+T('delAll')+'</button></div>','#s-name');
    const refresh=()=>{const d=$('#s-dist').value,v=$('#s-vol').value,du=TL.DIST[d].u,vu=TL.VOL[v].u+(v==='galUK'?' UK':'');
      const cur=$('#s-eff').value||S().eff;
      $('#s-eff').innerHTML='<option value="dist"'+(cur==='dist'?' selected':'')+'>'+T('higherBetter',{u:du+'/'+vu})+'</option><option value="vol"'+(cur==='vol'?' selected':'')+'>'+T('lowerBetter',{u:vu,d:du})+'</option>';
      $('#wkU').textContent=du};
    const applySystem=sys=>{if(sys==='metric'){$('#s-dist').value='km';$('#s-vol').value='L';$('#s-eff').value='dist'}
      else if(sys==='imperial'){$('#s-dist').value='mi';$('#s-vol').value='galUS';$('#s-eff').value='vol'}
      refresh();return true};
    refresh();
    $('#s-system').addEventListener('change',e=>applySystem(e.target.value));
    const custom=()=>{$('#s-system').value='custom';refresh()};
    $('#s-dist').addEventListener('change',custom);$('#s-vol').addEventListener('change',custom);$('#s-eff').addEventListener('change',custom);
    const prevCur=()=>{const c=sv('s-cur').toUpperCase();let t;try{t=new Intl.NumberFormat(LOC(),{style:'currency',currency:c}).format(1234.5)}catch(e){t=T('unknownCode')}$('#curPrev').textContent=T('example',{v:t})};
    prevCur();$('#s-cur').addEventListener('input',prevCur);
    const sk=store.syncKind();$('#syncHint').textContent=T('syncHint.'+((sk&&sk!=='load')?sk:'local'));
    $('#frm').addEventListener('submit',e=>{e.preventDefault();
      const c=sv('s-cur').toUpperCase(),wk=nv('s-wk'),wd=nv('s-wd');
      if(!c)return $('#ferr').textContent=T('errCurrency');
      if(!validCur(c))return $('#ferr').textContent=T('unknownCode');
      const alias=sv('s-name')||'';
      veh().alias=alias;
      Object.assign(state.settings,{name:alias||AC.core.vehicleLabel(veh()),dist:$('#s-dist').value,vol:$('#s-vol').value,eff:$('#s-eff').value,cur:c,warnKm:Number.isFinite(wk)&&wk>=0?TL.DIST[$('#s-dist').value].f*wk:1000,warnDays:Number.isFinite(wd)&&wd>=0?Math.round(wd):30});
      commit();closeSheet();toast(T('settingsSaved'));
    });
    cap('downloads').then(dl=>{if(!dl&&$('#expBtns'))$('#expBtns').hidden=true});
    $('#expJ').addEventListener('click',()=>store.exportFile('json',today,toast));
    $('#expC').addEventListener('click',()=>store.exportFile('csv',today,toast));
    $('#impF').addEventListener('change',e=>{
      store.readImport(e.target.files[0],(j,reason)=>{
        if(!j){
          const detail=(reason&&reason.msgText&&typeof reason.msgText==='string')?reason.msgText:T('importInvalid');
          $('#impBox').innerHTML='<p class="form-err">'+esc(detail)+'</p>';
          return;
        }
        pendingImport=j;
        const n=Array.isArray(j.entries)?j.entries.length:
          (Array.isArray(j.vehicles)?j.vehicles.reduce((a,r)=>a+((r&&r.entries&&r.entries.length)||0),0):0);
        $('#impBox').innerHTML='<p class="hint">'+T('importSummary',{n:n})+'</p><button type="button" class="btn danger sm" id="impGo">'+T('importGo')+'</button>';
        $('#impGo').addEventListener('click',()=>{
          try{
            state=store.set(pendingImport);pendingImport=null;state.updatedAt=Date.now();
            store.commit(render);closeSheet();toast(T('importDone'));
          }catch(err){
            if(store.restoreMemoryBackup)store.restoreMemoryBackup();
            state=store.state;render();
            toast((err&&err.msgText)||'No se pudo importar el respaldo; tus datos siguen intactos.');
          }
        });
      });
    });
    armDelete($('#delAll'),()=>resetAll(T('delDone')));
  }

  /* ---------- Eventos globales ---------- */
  const ACT={
    'add-fuel':()=>openEntry('fuel'),'add-exp':()=>openEntry('exp'),'add-odo':()=>openEntry('odo'),
    'settings':openSettings,'edit-vehicle':()=>openVehicle(),
    'veh-add':addVehicle,'veh-del':openVehicleDelete,
    'comp-edit':key=>openComponent(key),'doc-key':key=>openDoc(null,{key}),
    'tire-edit':openTire,'value-edit':openValue,
    'veh-view-toggle':()=>{const v=veh();if(!v.photoDataUrl)return;v.usePhoto=!v.usePhoto;commit();toast(T(v.usePhoto?'photoReady':'blueprintReady'))},
    'veh-cut-toggle':()=>toggleCutout(false),'cut-cancel':()=>cancelCutout(),
    'edit-entry':id=>{const e=state.entries.find(x=>x.id===id);if(e)openEntry(e.type==='fuel'?'fuel':e.type==='odo'?'odo':'exp',e)},
    'rem-add':()=>openReminder(),'rem-edit':id=>openReminder(id),
    'rem-log':id=>{const r=state.reminders.find(x=>x.id===id);if(r)openEntry('exp',null,{cat:r.cat,desc:r.name,remId:r.id})},
    'doc-add':()=>openDoc(),'doc-edit':id=>openDoc(id),'doc-renew':id=>openRenew(id),
    'hist-more':()=>{hLimit+=20;renderHist()},
    'clear-demo':()=>resetAll(T('dataCleared'))
  };
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-close]')){closeSheet();return}
    const b=e.target.closest('[data-act]');if(!b||b.type==='radio')return;
    const f=ACT[b.dataset.act];if(f)f(b.dataset.id);
  });
  document.addEventListener('change',e=>{
    const i=e.target;if(!i||!i.matches)return;
    if(i.matches('input[data-act="hist-f"]')){hFilter=i.value;hLimit=12;renderHist()}
    if(i.id==='garageSel'){switchVehicle(i.value);return}
    if(i.id==='vehPhoto'||i.id==='vehPhotoEmpty'){handlePhoto(i.files&&i.files[0]);i.value=''}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#sheet').hidden)closeSheet()});
  /* Última red de seguridad: nunca abandonar la página con el body bloqueado. */
  window.addEventListener('pagehide',()=>{unlockBodyScroll();hideProgress();killAIWorker()});

  /* ---------- Arranque ----------
     IndexedDB es la fuente de verdad: startApp() espera a la migración inicial
     (solo si la base estaba vacía) antes de leer el estado. */
  AC.render=render;
  AC.generateBlueprintFromPhoto=generateBlueprintFromPhoto;
  document.addEventListener('ac:langchange',()=>{if(store.setSync)store.setSync(store.syncKind());render()});
  function startApp(){
    state=store.state;
    document.addEventListener('autocare:storage-ready',()=>{state=store.state;render()});
    I18N.apply();
    const langSel=$('#langSel');
    if(langSel){langSel.value=I18N.lang;langSel.addEventListener('change',e=>{I18N.set(e.target.value);e.target.value=I18N.lang})}
    initTabs();
    render();
    initTilt();
    store.connect(()=>{state=store.state;render()});
  }
  if(store.whenReady)store.whenReady().then(startApp,startApp);
  else startApp();

  /* ---------- Service Worker (PWA) ---------- */
  if('serviceWorker' in navigator){
    let reloading=false;
    try{reloading=sessionStorage.getItem('ac-sw-reload')==='1'}catch(e){}
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(reloading)return;
      reloading=true;
      try{sessionStorage.setItem('ac-sw-reload','1')}catch(e){}
      window.location.reload();
    });
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('./sw.js').then(()=>{
        if(navigator.serviceWorker.controller){try{sessionStorage.removeItem('ac-sw-reload')}catch(e){}}
      }).catch(()=>{});
    });
  }
})();
