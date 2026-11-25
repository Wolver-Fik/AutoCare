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
  /* Ficha rápida: claves estables (independientes del idioma) para componentes y documentos */
  const COMP_KEYS=['tires','battery','brakes'];
  const DOC_KEYS=['insurance','tax','inspection'];
  const COMP_LIMITS={tires:{km:40000,months:60},battery:{km:40000,months:48},brakes:{km:30000,months:36}};
  let seq=0;
  const rid=p=>p+Date.now().toString(36)+(++seq).toString(36)+Math.random().toString(36).slice(2,5);
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
  function docKeyOf(name){
    const n=String(name||'').toLowerCase();if(!n)return null;
    const words={
      insurance:['seguro','insurance','assurance','versicherung','assicurazione','страхов','保険'],
      tax:['patente','impuesto','licenciamento','imposto','registration','tax','taxe','tassa','bollo','steuer','zulassung','налог','税'],
      inspection:['inspec','inspeção','inspection','contrôle','revisione','revision','hu / au','vtv','itv','техосмотр','車両検査','車検']
    };
    for(let i=0;i<DOC_KEYS.length;i++){const k=DOC_KEYS[i];if(words[k].some(w=>n.indexOf(w)>=0))return k}
    return null;
  }
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
  const VEHICLE_DEFAULT={brand:'Chevrolet',model:'Onix RS',year:2024,body:'hatchback',color:'#F8FAFC',alias:'',
    photoDataUrl:DEMO_PHOTO,photoOriginal:null,photoFallback:null,photoCutDataUrl:null,photoCutModel:null,
    photoCut:false,photoCutWanted:true,photoView:'fallback',usePhoto:true};
  /* Estado "sin vehículo": ni demo, ni datos de fábrica, ni foto. La marca `empty`
     evita que normalize() vuelva a inyectar VEHICLE_DEFAULT al recargar. */
  const EMPTY_VEHICLE={brand:'',model:'',year:'',body:'hatch',color:'#F8FAFC',alias:'',
    photoDataUrl:null,photoOriginal:null,photoFallback:null,photoCutDataUrl:null,photoCutModel:null,
    photoCut:false,photoCutWanted:true,photoView:'fallback',usePhoto:false,empty:true};

  function defaults(){return{v:1,updatedAt:0,settings:{name:tr('myCar'),dist:'km',vol:'L',eff:'dist',cur:'UYU',warnKm:1000,warnDays:30},vehicle:Object.assign({},VEHICLE_DEFAULT),entries:[],reminders:[],docs:[],components:[]}}
  /* Un registro del garaje encapsula TODA la información de un vehículo. El estado
     expone accessors (vehicle, entries, reminders, docs, components) que apuntan al
     registro activo: así el resto de la app sigue trabajando con `state.entries` y
     cada cambio queda aislado dentro de su vehículo. */
  function emptyRecord(){return{id:rid('v'),vehicle:Object.assign({},EMPTY_VEHICLE),entries:[],reminders:[],docs:[],components:[]}}
  function activeOf(s){
    if(!s||!Array.isArray(s.vehicles)||!s.vehicles.length)s.vehicles=[emptyRecord()];
    let r=null;
    for(let i=0;i<s.vehicles.length;i++)if(s.vehicles[i]&&s.vehicles[i].id===s.activeId){r=s.vehicles[i];break}
    if(!r){r=s.vehicles[0];s.activeId=r.id}
    if(!r.vehicle||typeof r.vehicle!=='object')r.vehicle=Object.assign({},EMPTY_VEHICLE);
    ['entries','reminders','docs','components'].forEach(k=>{if(!Array.isArray(r[k]))r[k]=[]});
    return r;
  }
  function attach(s){
    ['vehicle','entries','reminders','docs','components'].forEach(k=>{
      Object.defineProperty(s,k,{enumerable:true,configurable:true,
        get(){return activeOf(s)[k]},
        set(v){activeOf(s)[k]=v}});
    });
    return s;
  }
  function assemble(settings,records,activeId,updatedAt){
    const s={v:1,updatedAt:updatedAt||0,settings:Object.assign({},defaults().settings,settings||{}),vehicles:records,activeId:''};
    s.activeId=activeId||(records[0]&&records[0].id)||'';
    return attach(s);
  }
  function blank(){
    const s=defaults();s.updatedAt=Date.now();s.settings.name='';
    const r=emptyRecord();return assemble(s.settings,[r],r.id,s.updatedAt);
  }
  function vehicleLabel(v){
    if(v&&typeof v.alias==='string'&&v.alias.trim())return v.alias.trim().slice(0,60);
    return (((v&&v.brand)||'')+' '+((v&&v.model)||'')).trim()||tr('myCar');
  }

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
      {id:id('c'),name:tr('doc.insurance'),due:addDays(today,18),note:'',key:'insurance',demo:true},
      {id:id('c'),name:tr('doc.tax'),due:addDays(today,96),note:'',key:'tax',demo:true},
      {id:id('c'),name:tr('doc.inspection'),due:addDays(today,263),note:'',key:'inspection',demo:true}];
    const rec={id:rid('v'),vehicle:st.vehicle,entries:st.entries,reminders:st.reminders,docs:st.docs,components:[]};
    return assemble(st.settings,[rec],rec.id,Date.now());
  }

  function normalizeVehicle(raw){
    const v=Object.assign({},VEHICLE_DEFAULT),raw0=(raw&&typeof raw==='object')?raw:{};
    const year=Number(raw0.year);
    const photoRe=/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i;
    const pathRe=/^(?:\.\/|\/)?[\w./-]+\.(?:png|jpe?g|webp|avif|svg)$/i;
    const dataUrl=s=>typeof s==='string'&&photoRe.test(s)?s:null;
    const photoRaw=typeof raw0.photoDataUrl==='string'?raw0.photoDataUrl:(typeof raw0.photo==='string'?raw0.photo:null);
    const photoDataUrl=photoRaw&&(photoRe.test(photoRaw)||pathRe.test(photoRaw))?photoRaw:null;
    const usePhoto=photoDataUrl?(typeof raw0.usePhoto==='boolean'?raw0.usePhoto:raw0.view==='photo'):false;
    /* Recorte ya procesado: se guarda en localStorage y se reutiliza tal cual.
       Se recuerda el modelo que lo generó para poder regenerarlo bajo demanda
       cuando se instale un segmentador nuevo (recortes antiguos sin esta
       marca se tratan como obsoletos). */
    const photoOriginal=dataUrl(raw0.photoOriginal);
    const photoFallback=dataUrl(raw0.photoFallback);
    let photoCutDataUrl=dataUrl(raw0.photoCutDataUrl);
    const photoCutModel=typeof raw0.photoCutModel==='string'&&raw0.photoCutModel.length<120?raw0.photoCutModel:null;
    const legacyCut=!!photoDataUrl&&!photoCutDataUrl&&raw0.photoCut===true&&/^data:image\/png/i.test(photoDataUrl);
    if(legacyCut)photoCutDataUrl=photoDataUrl;
    const photoCut=!!photoCutDataUrl&&(raw0.photoView==='cut'||(!raw0.photoView&&(raw0.photoCut===true||legacyCut)));
    let photoView=photoCut?'cut':(raw0.photoView==='original'||raw0.photoView==='fallback'?raw0.photoView:(photoOriginal?'original':'fallback'));
    if(photoView==='cut'&&!photoCutDataUrl)photoView=photoOriginal?'original':'fallback';
    const bodyRaw=raw0.body==='hatchback'?'hatch':raw0.body;
    const colorRaw=typeof raw0.color==='string'?raw0.color.trim():'';
    const colorHex=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorRaw)?(colorRaw.length===4?'#'+colorRaw[1]+colorRaw[1]+colorRaw[2]+colorRaw[2]+colorRaw[3]+colorRaw[3]:colorRaw).toUpperCase():null;
    const color=COLORS.some(x=>x.id===raw0.color)?raw0.color:(colorHex||v.color);
    return{
      brand:typeof raw0.brand==='string'&&raw0.brand.trim()?raw0.brand.trim().slice(0,40):v.brand,
      model:typeof raw0.model==='string'&&raw0.model.trim()?raw0.model.trim().slice(0,40):v.model,
      alias:typeof raw0.alias==='string'?raw0.alias.trim().slice(0,60):'',
      year:Number.isFinite(year)&&year>=1900&&year<=2100?Math.round(year):v.year,
      body:BODIES.some(x=>x.id===bodyRaw)?bodyRaw:v.body,
      color,
      photoDataUrl,photoOriginal,photoFallback,photoCutDataUrl,photoCutModel,
      photoCut,photoCutWanted:raw0.photoCutWanted!==false,photoView,usePhoto,
      empty:raw0.empty===true
    };
  }

  function normalizeDoc(raw){
    if(!raw||typeof raw!=='object')return null;
    const name=typeof raw.name==='string'?raw.name.trim().slice(0,60):'';
    const key=DOC_KEYS.indexOf(raw.key)>=0?raw.key:docKeyOf(name);
    const due=typeof raw.due==='string'&&DATE_RE.test(raw.due)?raw.due:null;
    const d={id:typeof raw.id==='string'&&raw.id?raw.id:rid('c'),name:name||(key?tr('doc.'+key):''),due,
      note:typeof raw.note==='string'?raw.note.slice(0,160):''};
    if(key)d.key=key;
    if(raw.demo)d.demo=true;
    return d;
  }
  function normalizeComponent(raw){
    if(!raw||typeof raw!=='object'||COMP_KEYS.indexOf(raw.key)<0)return null;
    const odo=Number(raw.odo);
    const km=Number(raw.intervalKm),mo=Number(raw.intervalMonths);
    const c={id:typeof raw.id==='string'&&raw.id?raw.id:rid('p'),key:raw.key,
      date:typeof raw.date==='string'&&DATE_RE.test(raw.date)?raw.date:null,
      odo:Number.isFinite(odo)&&odo>=0?odo:null,
      intervalKm:Number.isFinite(km)&&km>0?km:null,
      intervalMonths:Number.isFinite(mo)&&mo>0?Math.round(mo):null};
    return (c.date||c.odo!=null)?c:null;
  }
  function normalizeRecord(raw){
    const r=raw&&typeof raw==='object'?raw:{};
    return{
      id:typeof r.id==='string'&&r.id?r.id:rid('v'),
      vehicle:normalizeVehicle(r.vehicle),
      entries:(Array.isArray(r.entries)?r.entries:[]).filter(e=>e&&e.id&&e.date&&e.type),
      reminders:Array.isArray(r.reminders)?r.reminders:[],
      docs:(Array.isArray(r.docs)?r.docs:[]).map(normalizeDoc).filter(Boolean),
      components:(Array.isArray(r.components)?r.components:[]).map(normalizeComponent).filter(Boolean)
    };
  }
  function normalize(d){
    d=d&&typeof d==='object'?d:{};
    const settings=Object.assign({},defaults().settings,(d.settings&&typeof d==='object')?d.settings:{});
    /* Un estado reiniciado se respeta tal cual: sin vehículo, sin foto y sin demo. */
    if(!Array.isArray(d.vehicles)&&d.vehicle&&d.vehicle.empty===true){
      const b=blank();b.settings=Object.assign({},b.settings,settings);b.settings.name='';return b;
    }
    /* Compatibilidad: los backups v1 guardaban un solo vehículo en la raíz. */
    const rawRecords=Array.isArray(d.vehicles)&&d.vehicles.length?d.vehicles:[{
      vehicle:d.vehicle,entries:d.entries,reminders:d.reminders,docs:d.docs,components:d.components
    }];
    const records=rawRecords.map(normalizeRecord);
    if(!records.length)records.push(emptyRecord());
    const activeId=typeof d.activeId==='string'&&records.some(r=>r.id===d.activeId)?d.activeId:records[0].id;
    const st=assemble(settings,records,activeId,d.updatedAt||0);
    if(activeOf(st).vehicle.empty===true)st.settings.name='';
    return st;
  }

  /* ---------- Persistencia local y remota ---------- */
  const KEY='tablero-auto-v1';
  const cap=n=>{try{return window.claude&&window.claude.use?window.claude.use(n):Promise.resolve(null)}catch(e){return Promise.resolve(null)}};

  function load(){
    try{
      /* Tras un reinicio no se guarda el estado vacío: sólo un marcador que impide
         que load() vuelva a generar el demo de fábrica. */
      if(localStorage.getItem(KEY+'-empty')==='1')return blank();
      const r=localStorage.getItem(KEY);if(r)return normalize(JSON.parse(r));
    }catch(e){}
    return demo(todayISO());
  }

  let state=load();
  let dbRef=null,saving=false,again=false,timer=null,retry=null,syncKind='local';

  function persistState(){
    try{
      localStorage.removeItem(KEY+'-empty');
      localStorage.setItem(KEY,JSON.stringify(state));
      return true;
    }catch(e){return false}
  }
  function save(){
    try{
      /* El marcador "vacío" sólo aplica al garaje de una sola tarjeta: con
         varios vehículos, borrar el activo no debe descartar los demás. */
      if(state&&state.vehicle&&state.vehicle.empty&&(state.vehicles||[]).length<=1){
        localStorage.removeItem(KEY);
        localStorage.setItem(KEY+'-empty','1');
        return;
      }
      if(!persistState()){
        /* Cuota casi llena: se conserva el PNG ya recortado de cada vehículo
           (lo esencial para seguir funcionando offline) y se descartan las copias
           sin recortar. */
        (state.vehicles||[]).forEach(r=>{
          const v=r&&r.vehicle;if(!v||(!v.photoOriginal&&!v.photoFallback))return;
          v.photoOriginal=null;v.photoFallback=null;
          if(v.photoView!=='cut'&&v.photoCutDataUrl)v.photoDataUrl=v.photoCutDataUrl;
        });
        persistState();
      }
    }catch(e){}
  }

  /* ---------- Reinicio absoluto ---------- */
  const IMAGE_RE=/\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:$|\?)/i;
  function clearLocalStorage(){
    try{
      const langKey=(AC.i18n&&AC.i18n.KEY)||'autocare-lang',doomed=[KEY,KEY+'-tab',KEY+'-empty'];
      /* Se copia la lista antes de borrar: eliminar durante la iteración
         hacía que Safari se saltara claves y dejara datos residuales. */
      const keys=[];for(let i=0;i<localStorage.length;i++)keys.push(localStorage.key(i));
      keys.forEach(k=>{
        if(k&&(k===KEY||k===KEY+'-tab'||k===KEY+'-empty'||(k.indexOf('autocare-')===0&&k!==langKey))&&doomed.indexOf(k)<0)doomed.push(k);
      });
      doomed.forEach(k=>{try{localStorage.removeItem(k)}catch(e){}});
    }catch(e){}
  }
  function isUserImageRequest(req){
    try{
      const u=new URL(req.url);
      if(/^\.?\/?icons\//i.test(u.pathname)||/\/icons\//i.test(u.pathname))return false;
      return req.destination==='image'||IMAGE_RE.test(u.pathname);
    }catch(e){return false}
  }
  async function purgeAppStores(){
    /* IndexedDB: sólo bases propias/de imagenes; se respeta la DB remota (Firestore). */
    try{
      if(typeof indexedDB!=='undefined'&&typeof indexedDB.databases==='function'){
        const list=await indexedDB.databases();
        await Promise.all(list.filter(x=>/autocare|ac[-_]?(img|photo|bp|blueprint)/i.test(String(x.name||''))).map(x=>new Promise(res=>{
          try{const q=indexedDB.deleteDatabase(x.name);q.onsuccess=q.onerror=q.onblocked=()=>res()}
          catch(e){res()}
        })));
      }
    }catch(e){}
    /* Cache Storage: se eliminan imagenes de usuario, no los iconos de la app. */
    try{
      if(window.caches){
        const names=await caches.keys();
        await Promise.all(names.map(async name=>{
          const c=await caches.open(name),reqs=await c.keys();
          await Promise.all(reqs.filter(isUserImageRequest).map(r=>c.delete(r).catch(()=>{})));
        }));
      }
    }catch(e){}
    /* El service worker también limpia su caché ( útil en iPhone / modo standalone ). */
    try{
      const msg={type:'AC_PURGE_USER_IMAGES'};
      if(navigator.serviceWorker&&navigator.serviceWorker.controller)navigator.serviceWorker.controller.postMessage(msg);
      else if(navigator.serviceWorker&&navigator.serviceWorker.getRegistration){
        navigator.serviceWorker.getRegistration().then(r=>{
          const w=r&&(r.active||r.waiting||r.installing);if(w)w.postMessage(msg);
        }).catch(()=>{});
      }
    }catch(e){}
  }
  function wipe(){
    clearTimeout(timer);clearTimeout(retry);timer=null;retry=null;again=false;
    clearLocalStorage();
    state=blank();
    save();
    purgeAppStores();
    return state;
  }

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
  /* Copia plana: los accessors del garaje se serializan con el registro activo
     y `vehicles` conserva TODOS los vehículos, componentes y vencimientos. */
  const snapshot=()=>JSON.parse(JSON.stringify(state));
  async function flush(){
    if(saving){again=true;return}
    saving=true;
    try{await dbRef.set(snapshot());setSync('synced')}
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

  /* ---------- Modo demo (se aplica a todos los vehículos del garaje) ---------- */
  const eachRecord=fn=>{(state.vehicles||[]).forEach(r=>{if(r)fn(r)})};
  function hasDemo(){
    let found=false;
    eachRecord(r=>{
      if((r.entries||[]).some(e=>e.demo)||(r.reminders||[]).some(x=>x.demo)||(r.docs||[]).some(x=>x.demo))found=true;
    });
    return found;
  }
  function clearDemo(){
    eachRecord(r=>{
      r.entries=(r.entries||[]).filter(e=>!e.demo);
      r.reminders=(r.reminders||[]).map(x=>x.demo?{id:x.id,name:x.name,cat:x.cat,intervalKm:x.intervalKm,intervalMonths:x.intervalMonths,lastOdo:null,lastDate:null}:x);
      r.docs=(r.docs||[]).map(d=>d.demo?{id:d.id,name:d.name,due:null,note:'',key:d.key}:d);
    });
  }
  function demoCleared(){if(hasDemo())clearDemo()}

  /* ---------- Garaje multi-vehículo ---------- */
  function garageList(){
    return (state.vehicles||[]).map(r=>({id:r.id,label:vehicleLabel(r.vehicle),vehicle:r.vehicle}));
  }
  function selectVehicle(id){
    const r=(state.vehicles||[]).find(x=>x.id===id);if(!r)return false;
    state.activeId=id;state.settings.name=vehicleLabel(r.vehicle);save();return true;
  }
  function addVehicle(){
    const v=Object.assign({},EMPTY_VEHICLE);
    v.empty=false;v.year=new Date().getFullYear();v.brand='';v.model='';
    const docs=DOC_KEYS.map(k=>({id:rid('c'),name:tr('doc.'+k),due:null,note:'',key:k}));
    const list=state.vehicles||[],active=activeOf(state);
    /* Si el garaje está vacío (tras "Borrar todos los datos"), el primer vehículo
       ocupa esa tarjeta en vez de dejar un registro fantasma. */
    if(list.length===1&&active.vehicle.empty===true){
      active.vehicle=v;active.entries=[];active.reminders=[];active.docs=docs;active.components=[];
      state.activeId=active.id;
    }else{
      list.push({id:rid('v'),vehicle:v,entries:[],reminders:[],docs,components:[]});
      state.activeId=list[list.length-1].id;
    }
    state.settings.name=vehicleLabel(v);save();
    return activeOf(state);
  }
  function removeVehicle(id){
    const list=state.vehicles||[];
    /* Nunca se deja el garaje sin tarjeta: borrar el último vehículo lo deja en blanco. */
    if(list.length<=1){
      const r=list[0]||emptyRecord();
      r.vehicle=Object.assign({},EMPTY_VEHICLE);r.entries=[];r.reminders=[];r.docs=[];r.components=[];
      if(!list.length)list.push(r);
      state.activeId=r.id;state.settings.name='';save();return true;
    }
    const i=list.findIndex(x=>x.id===id);if(i<0)return false;
    list.splice(i,1);
    if(state.activeId===id)state.activeId=list[Math.min(i,list.length-1)].id;
    state.settings.name=vehicleLabel(activeOf(state).vehicle);save();return true;
  }

  /* ---------- Exportación e importación ---------- */
  async function exportFile(kind,today,notify){
    const dl=await cap('downloads');if(!dl){notify(tr('exportUnavailable'));return}
    let data,name='autocare-'+today();
    if(kind==='json'){data=JSON.stringify(snapshot(),null,1);name+='.json'}
    else{
      const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
      const rows=[[tr('csv.vehicle'),tr('csv.date'),tr('csv.type'),tr('csv.category'),tr('csv.description'),tr('csv.odo'),tr('csv.volume'),tr('csv.cost'),tr('csv.full')]];
      (state.vehicles||[]).forEach(r=>(r.entries||[]).slice().sort((a,b)=>a.date<b.date?-1:1).forEach(e=>{
        rows.push([vehicleLabel(r.vehicle),e.date,e.type,catOf(e),e.desc||'',e.odo!=null?+e.odo.toFixed(1):'',e.vol!=null?+e.vol.toFixed(2):'',e.cost||0,e.type==='fuel'?(e.full!==false?tr('csv.yes'):tr('csv.no')):'']);
      }));
      data=rows.map(r=>r.map(q).join(',')).join('\n');name+='.csv';
    }
    try{await dl.save({filename:name,data});notify(tr('exportReady'))}catch(e){if(!e||e.code!=='declined')notify(tr('exportFail'))}
  }
  function readImport(file,done){
    if(!file)return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{const j=JSON.parse(rd.result);if(!j||(!Array.isArray(j.entries)&&!Array.isArray(j.vehicles)))throw 0;done(normalize(j),null)}
      catch(x){done(null,'invalid')}
    };
    rd.readAsText(file);
  }

  /* API pública consumida por app.js */
  AC.core={DIST,VOL,CATS,GROUPS,COMP_KEYS,DOC_KEYS,COMP_LIMITS,BRANDS,BODIES,COLORS,VEHICLE_DEFAULT,EMPTY_VEHICLE,DEMO_PHOTO,iso,todayISO,parseISO,addDays,addMonths,daysBetween,catOf,hasOdo,docKeyOf,vehicleLabel,defaults,blank,demo,normalize};
  AC.storage={
    KEY,cap,load,normalize,commit,connect,setSync,wipe,snapshot,
    get state(){return state},
    set(v){state=v;return state},
    syncKind:()=>syncKind,
    hasDemo,demoCleared,clearDemo,exportFile,readImport,
    garage:{list:garageList,select:selectVehicle,add:addVehicle,remove:removeVehicle,
      activeId:()=>state.activeId,count:()=>(state.vehicles||[]).length,label:vehicleLabel}
  };
})(window.AC);
