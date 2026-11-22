/* AutoCare · Almacenamiento, modo demo y respaldo de datos (JSON / CSV) */
window.AC = window.AC || {};
(function (AC) {
  'use strict';

  /* Traducción disponible desde el primer momento (i18n.js se carga antes) */
  const tr=s=>{try{return AC.i18n.t(s)}catch(e){return s}};
  const tl=s=>{try{return AC.i18n.tl(s)}catch(e){return []}};

  /* ---------- Modelo de datos y utilidades compartidas ---------- */
  const DIST={km:{f:1,u:'km'},mi:{f:1.609344,u:'mi'}};
  const VOL={L:{f:1,u:'L',n:'Litros'},galUS:{f:3.785411784,u:'gal',n:'Galones (EE. UU.)'},galUK:{f:4.54609,u:'gal',n:'Galones (Reino Unido)'}};
  const CATS={fuel:{n:'Combustible',g:'fuel'},service:{n:'Service',g:'maint'},tires:{n:'Neumáticos',g:'maint'},repair:{n:'Arreglos',g:'repair'},wash:{n:'Lavado',g:'other'},docs:{n:'Seguro y trámites',g:'other'},other:{n:'Otros',g:'other'}};
  const GROUPS={fuel:'Combustible',maint:'Mantenimiento',repair:'Arreglos',other:'Otros'};
  const pad=n=>String(n).padStart(2,'0');
  const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const todayISO=()=>iso(new Date());
  const parseISO=s=>{const p=String(s).split('-').map(Number);return new Date(p[0],p[1]-1,p[2])};
  const addDays=(s,n)=>{const d=parseISO(s);d.setDate(d.getDate()+n);return iso(d)};
  function addMonths(s,n){const d=parseISO(s);const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+n);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return iso(d)}
  const daysBetween=(a,b)=>Math.round((parseISO(b)-parseISO(a))/864e5);
  const catOf=e=>e.type==='fuel'?'fuel':(e.cat&&CATS[e.cat]?e.cat:'other');
  const hasOdo=e=>e&&e.odo!=null&&Number.isFinite(e.odo);

  /* ---------- Ficha visual del vehículo ---------- */
  const BRANDS=['Chevrolet','Toyota','Volkswagen','Ford','Fiat','Honda','Hyundai','Peugeot','Renault','Nissan','BMW','Audi','Mercedes-Benz','Kia','Mazda','Suzuki','Otra'];
  const BODIES=[{id:'hatch',n:'Hatchback'},{id:'sedan',n:'Sedan'},{id:'suv',n:'SUV'},{id:'pickup',n:'Pickup'},{id:'coupe',n:'Coupe'},{id:'moto',n:'Moto'}];
  const COLORS=[
    {id:'rojo',n:'Rojo Deportivo',hex:'#c8102e',light:'#ff6374',dark:'#6d0017'},
    {id:'negro',n:'Negro Obsidiana',hex:'#171a20',light:'#505866',dark:'#04060a'},
    {id:'blanco',n:'Blanco Perla',hex:'#e8edf3',light:'#ffffff',dark:'#9fabb9'},
    {id:'plata',n:'Gris Plata',hex:'#a9b3bf',light:'#e8eef5',dark:'#616d7b'},
    {id:'grafito',n:'Gris Grafito',hex:'#4b5361',light:'#8f9bab',dark:'#202732'},
    {id:'azul',n:'Azul Profundo',hex:'#12539f',light:'#5aa3ff',dark:'#062248'},
    {id:'verde',n:'Verde Esmeralda',hex:'#0f8a60',light:'#4ad9a4',dark:'#04432e'},
    {id:'naranja',n:'Amarillo/Naranja',hex:'#f2a007',light:'#ffd763',dark:'#9d5a00'}
  ];
  const DEMO_PHOTO='./icons/demo-car.png';
  const VEHICLE_DEFAULT={brand:'Chevrolet',model:'Onix RS',year:2024,body:'hatchback',color:'#F8FAFC',photoDataUrl:DEMO_PHOTO,photoCut:false,usePhoto:true};

  function defaults(){return{v:1,updatedAt:0,settings:{name:tr('myCar'),dist:'km',vol:'L',eff:'dist',cur:'UYU',warnKm:1000,warnDays:30},vehicle:Object.assign({},VEHICLE_DEFAULT),entries:[],reminders:[],docs:[]}}

  /* Datos de ejemplo: se reemplazan con el primer registro real */
  function demo(today){
    const st=defaults();let n=0;const id=p=>p+(++n);
    st.settings.name=VEHICLE_DEFAULT.brand+' '+VEHICLE_DEFAULT.model;
    const fills=[[2,48230,41.2,78.5],[9,47712,40.6,78.5],[16,47195,39.8,77.9],[24,46640,44.9,77.9],[31,46130,40.1,77.9],[38,45620,38.7,76.4],[46,45098,41.8,76.4],[53,44580,39.9,76.4],[61,44050,42.5,75.2],[69,43540,40.4,75.2]];
    fills.forEach(f=>st.entries.push({id:id('d'),type:'fuel',date:addDays(today,-f[0]),odo:f[1],vol:f[2],cost:Math.round(f[2]*f[3]*100)/100,full:true,demo:true}));
    st.entries.push(
      {id:id('d'),type:'exp',cat:'service',desc:tl('suggest.service')[0],date:addDays(today,-60),odo:44100,cost:3450,demo:true},
      {id:id('d'),type:'exp',cat:'wash',desc:tl('suggest.wash')[0],date:addDays(today,-12),odo:null,cost:380,demo:true},
      {id:id('d'),type:'exp',cat:'repair',desc:tl('suggest.repair')[0],date:addDays(today,-95),odo:42300,cost:5200,demo:true},
      {id:id('d'),type:'exp',cat:'tires',desc:tl('suggest.tires')[1],date:addDays(today,-140),odo:38900,cost:1200,demo:true});
    st.reminders=[
      {id:id('r'),name:tr('demo.remOil'),cat:'service',intervalKm:10000,intervalMonths:12,lastOdo:44100,lastDate:addDays(today,-60),demo:true},
      {id:id('r'),name:tr('demo.remTires'),cat:'tires',intervalKm:10000,intervalMonths:null,lastOdo:38900,lastDate:addDays(today,-140),demo:true},
      {id:id('r'),name:tr('demo.remBrakes'),cat:'repair',intervalKm:20000,intervalMonths:12,lastOdo:42300,lastDate:addDays(today,-95),demo:true}];
    st.docs=[
      {id:id('c'),name:tr('doc.insurance'),due:addDays(today,18),note:'',demo:true},
      {id:id('c'),name:tr('doc.tax'),due:addDays(today,96),note:'',demo:true},
      {id:id('c'),name:tr('doc.inspection'),due:addDays(today,263),note:'',demo:true}];
    return st;
  }

  function normalize(d){
    const b=defaults(),raw=(d&&d.vehicle)||{},v=b.vehicle;
    const year=Number(raw.year);
    const photoRe=/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i;
    const pathRe=/^(?:\.\/|\/)?[\w./-]+\.(?:png|jpe?g|webp|avif|svg)$/i;
    const photoRaw=typeof raw.photoDataUrl==='string'?raw.photoDataUrl:(typeof raw.photo==='string'?raw.photo:null);
    const photoDataUrl=photoRaw&&(photoRe.test(photoRaw)||pathRe.test(photoRaw))?photoRaw:null;
    const usePhoto=photoDataUrl?(typeof raw.usePhoto==='boolean'?raw.usePhoto:raw.view==='photo'):false;
    const bodyRaw=raw.body==='hatchback'?'hatch':raw.body;
    const colorRaw=typeof raw.color==='string'?raw.color.trim():'';
    const colorHex=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorRaw)?(colorRaw.length===4?'#'+colorRaw[1]+colorRaw[1]+colorRaw[2]+colorRaw[2]+colorRaw[3]+colorRaw[3]:colorRaw).toUpperCase():null;
    const color=COLORS.some(x=>x.id===raw.color)?raw.color:(colorHex||v.color);
    const vehicle={
      brand:typeof raw.brand==='string'&&raw.brand.trim()?raw.brand.trim().slice(0,40):v.brand,
      model:typeof raw.model==='string'&&raw.model.trim()?raw.model.trim().slice(0,40):v.model,
      year:Number.isFinite(year)&&year>=1900&&year<=2100?Math.round(year):v.year,
      body:BODIES.some(x=>x.id===bodyRaw)?bodyRaw:v.body,
      color,
      photoDataUrl,photoCut:photoDataUrl&&raw.photoCut===true,usePhoto
    };
    return{v:1,updatedAt:(d&&d.updatedAt)||0,settings:Object.assign({},b.settings,d&&d.settings),vehicle,
      entries:(Array.isArray(d&&d.entries)?d.entries:[]).filter(e=>e&&e.id&&e.date&&e.type),
      reminders:Array.isArray(d&&d.reminders)?d.reminders:[],docs:Array.isArray(d&&d.docs)?d.docs:[]};
  }

  /* ---------- Persistencia local y remota ---------- */
  const KEY='tablero-auto-v1';
  const cap=n=>{try{return window.claude&&window.claude.use?window.claude.use(n):Promise.resolve(null)}catch(e){return Promise.resolve(null)}};

  function load(){
    try{const r=localStorage.getItem(KEY);if(r)return normalize(JSON.parse(r))}catch(e){}
    return demo(todayISO());
  }

  let state=load();
  let dbRef=null,saving=false,again=false,timer=null,retry=null,syncKind='local';

  function save(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){}}
  function setSync(k){
    syncKind=k;const el=document.getElementById('sync');if(!el)return;
    el.className='sync '+k;
    const tx=document.getElementById('syncTx');if(tx)tx.textContent=tr('sync.'+k);
    el.title=k==='synced'?tr('syncHint.synced'):tr('syncHint.local');
  }
  function queueRemote(){
    if(!dbRef){setSync('local');return}
    clearTimeout(timer);setSync('pending');timer=setTimeout(flush,700);
  }
  async function flush(){
    if(saving){again=true;return}
    saving=true;
    try{await dbRef.set(JSON.parse(JSON.stringify(state)));setSync('synced')}
    catch(e){
      if(e&&e.code==='invalid_argument'){dbRef=null;setSync('local')}
      else{setSync('error');clearTimeout(retry);retry=setTimeout(()=>{if(dbRef)flush()},15000)}
    }
    saving=false;if(again){again=false;flush()}
  }
  function commit(onRender){state.updatedAt=Date.now();save();queueRemote();if(onRender)onRender()}

  function connect(onRemote){
    setSync('load');
    cap('db').then(db=>{
      if(!db){setSync('local');return}
      let ref;try{ref=db.doc('garage/main')}catch(e){setSync('local');return}
      const slow=setTimeout(()=>setSync('slow'),10000);let first=true;
      ref.onSnapshot(snap=>{
        if(!snap.metadata.fromCache)clearTimeout(slow);
        if(snap.metadata.hasPendingWrites)return;
        dbRef=ref;
        const d=snap.exists?snap.data():null;
        if(d&&(d.updatedAt||0)>state.updatedAt){state=normalize(d);save();if(onRemote)onRemote()}
        else if(first&&!hasDemo()&&state.updatedAt>((d&&d.updatedAt)||0)){setTimeout(queueRemote,0)}
        first=false;
        if(!snap.metadata.fromCache&&syncKind!=='pending'&&syncKind!=='error')setSync('synced');
      },err=>{if(err&&err.code==='revoked'){dbRef=null;setSync('local')}else setSync('error')});
    });
  }

  /* ---------- Modo demo ---------- */
  function hasDemo(){return state.entries.some(e=>e.demo)||state.reminders.some(r=>r.demo)||state.docs.some(d=>d.demo)}
  function clearDemo(){
    state.entries=state.entries.filter(e=>!e.demo);
    state.reminders=state.reminders.map(r=>r.demo?{id:r.id,name:r.name,cat:r.cat,intervalKm:r.intervalKm,intervalMonths:r.intervalMonths,lastOdo:null,lastDate:null}:r);
    state.docs=state.docs.map(d=>d.demo?{id:d.id,name:d.name,due:null,note:''}:d);
  }
  function demoCleared(){if(hasDemo())clearDemo()}

  /* ---------- Exportación e importación ---------- */
  async function exportFile(kind,today,notify){
    const dl=await cap('downloads');if(!dl){notify(tr('exportUnavailable'));return}
    let data,name='autocare-'+today();
    if(kind==='json'){data=JSON.stringify(state,null,1);name+='.json'}
    else{
      const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
      const rows=[[tr('csv.date'),tr('csv.type'),tr('csv.category'),tr('csv.description'),tr('csv.odo'),tr('csv.volume'),tr('csv.cost'),tr('csv.full')]];
      state.entries.slice().sort((a,b)=>a.date<b.date?-1:1).forEach(e=>rows.push([e.date,e.type,catOf(e),e.desc||'',e.odo!=null?+e.odo.toFixed(1):'',e.vol!=null?+e.vol.toFixed(2):'',e.cost||0,e.type==='fuel'?(e.full!==false?tr('csv.yes'):tr('csv.no')):'']));
      data=rows.map(r=>r.map(q).join(',')).join('\n');name+='.csv';
    }
    try{await dl.save({filename:name,data});notify(tr('exportReady'))}catch(e){if(!e||e.code!=='declined')notify(tr('exportFail'))}
  }
  function readImport(file,done){
    if(!file)return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{const j=JSON.parse(rd.result);if(!j||!Array.isArray(j.entries))throw 0;done(normalize(j),null)}
      catch(x){done(null,'invalid')}
    };
    rd.readAsText(file);
  }

  /* API pública consumida por app.js */
  AC.core={DIST,VOL,CATS,GROUPS,BRANDS,BODIES,COLORS,VEHICLE_DEFAULT,DEMO_PHOTO,iso,todayISO,parseISO,addDays,addMonths,daysBetween,catOf,hasOdo,defaults,demo,normalize};
  AC.storage={
    KEY,cap,load,normalize,commit,connect,setSync,
    get state(){return state},
    set(v){state=v;return state},
    syncKind:()=>syncKind,
    hasDemo,demoCleared,clearDemo,exportFile,readImport
  };
})(window.AC);
