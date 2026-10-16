// Exercise the shipped page and its actual fixed-step physics; no third-party dependencies.
// Run: node rocketlab/tests/autoland.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map(), listeners = {};
function element(tag = 'div') {
  const children = [], classes = new Set(), attributes = {};
  return { tagName:tag.toUpperCase(), children, style:{}, value:'', textContent:'', innerHTML:'',
    classList:{add:k=>classes.add(k), toggle:(k,on)=>on ? classes.add(k) : classes.delete(k)},
    setAttribute:(k,v)=>attributes[k]=v, getAttribute:k=>attributes[k],
    appendChild:c=>children.push(c), setPointerCapture(){}, matches:s=>s.split(',').includes(tag),
    querySelector:s=>{ if(!children[s]) children[s]=element(s); return children[s]; },
    getContext:()=>({setTransform(){}}) };
}
const document = {getElementById:id=>{if(!elements.has(id)) elements.set(id,element());return elements.get(id);},
  createElement:element, querySelectorAll:()=>elements.get('keys').children,
  addEventListener:(k,fn)=>listeners[k]=fn, hidden:false};
const context = vm.createContext({document, location:{search:''}, URLSearchParams, console,
  innerWidth:1280, innerHeight:900, devicePixelRatio:1, requestAnimationFrame(){},
  addEventListener:(k,fn)=>listeners[k]=fn});
context.window = context;
vm.runInContext(script, context);
const run = code => vm.runInContext(code, context);
let count = 0;
function test(name, fn){ fn(); count++; console.log('PASS', name); }
function key(k, extra={}){listeners.keydown({key:k,code:k===' '?'Space':'Key'+k.toUpperCase(),preventDefault(){},target:element(),...extra});}
function release(k){listeners.keyup({key:k,code:k===' '?'Space':'Key'+k.toUpperCase()});}
function flight(initial={}, config={}){
  run(`setupRocket(buildRocket({...configFromURL(), ...${JSON.stringify(config)}})); Object.assign(st, {y:86,lifted:true,...${JSON.stringify(initial)}});`);
}
function simulate(seconds=100){
  return run(`(() => {
    let maxThrottle=0, minFuel=Infinity, impact=null;
    for(let n=0;n<${seconds}/DT && !st.status;n++){
      const before = {...st}; step();
      if(st.status) impact = {vx:before.vx,vy:before.vy,th:st.th,om:before.om};
      for(const e of eng){ if(!Number.isFinite(e.u)||e.u<0||e.u>1+1e-9) throw Error('invalid throttle'); maxThrottle=Math.max(maxThrottle,e.u); }
      if(![st.x,st.y,st.vx,st.vy,st.th,st.om,st.fuel].every(Number.isFinite)) throw Error('nonfinite state');
      minFuel=Math.min(minFuel,st.fuel);
    }
    return {...st, auto:{...autopilot}, maxThrottle,minFuel,impact};
  })()`);
}

test('L on launch pad does not fire engines or start autopilot',()=>{
  run('reset()'); key('l'); assert.equal(run('autopilot.active'),false);
  simulate(1); assert.equal(run('st.lifted'),false); assert.equal(run('st.fuel'),800);
});

const cases = [
  ['vertical descent',{vy:-20}],
  ['ascending after launch',{y:35,vy:18}],
  ['horizontal drift right',{vx:8,vy:-5}],
  ['horizontal drift left',{x:-40,vx:-8,vy:-5}],
  ['tilted and rotating',{th:0.5,om:0.25,vy:-8}],
  ['negative tilt and spin',{th:-0.5,om:-0.25,vy:-8}],
  ['low-altitude descent',{y:16,vy:-5}],
  ['high-speed descent',{y:190,vy:-35}],
  ['Hopper preset',{vy:-15,vx:4},{source:'hopper'}],
  ['five main engines',{vy:-20,vx:6,th:0.3},{engines:5}],
  ['two main engines with adequate thrust',{vy:-15,vx:5},{engines:2,thrust:15000}],
  ['one centered main with RCS',{vy:-15,vx:5},{engines:1,thrust:30000}],
  ['differential main control without RCS',{vy:-8,vx:3,th:0.2},{rcs:0}],
  ['low fuel but recoverable',{fuel:100,y:26,vy:-8}],
];
for(const [name,state,config] of cases) test('safe touchdown: '+name,()=>{
  flight(state,config); key('l'); const end=simulate();
  assert.equal(end.status,1,JSON.stringify(end));
  assert.ok(end.imp<=4 && Math.abs(run('wrap(st.th)'))<=12*Math.PI/180);
  assert.ok(end.minFuel>=0); assert.equal(end.auto.active,false);
  assert.equal(end.auto.phase,'완료 · 착륙 성공');
  assert.equal(run('eng.every(e=>e.u===0)'),true);
  console.log('  touchdown',end.imp.toFixed(2)+'m/s', 'fuel',end.fuel.toFixed(1)+'kg');
});

test('L toggles once per press, physical L works with Korean key text',()=>{
  flight(); key('l'); key('l',{repeat:true}); assert.equal(run('autopilot.active'),true);
  release('l'); key('l'); assert.equal(run('autopilot.active'),false);
  key('ㅣ',{code:'KeyL'}); assert.equal(run('autopilot.active'),true);
});
test('every original manual key cancels and still operates its engine',()=>{
  for(const k of ['a','s','d','f','g','j','k',' ']){
    flight({}, {engines:5}); key('l'); key(k); run('step()');
    assert.equal(run('autopilot.active'),false,k);
    assert.equal(run(`eng.some(e=>e.u===1 && (e.key===${JSON.stringify(k)} || (${JSON.stringify(k)}===' ' && e.kind==='main')))`),true,k);
    release(k);
  }
});
test('screen autopilot button toggles and engine pointer cancels',()=>{
  flight(); run('autoBtn.onclick()'); assert.equal(run('autopilot.active'),true);
  run('eng[0].btn.onpointerdown({preventDefault(){},pointerId:1})');
  assert.equal(run('autopilot.active'),false); run('step()'); assert.equal(run('eng[0].u'),1);
  run('eng[0].btn.onpointercancel()'); run('step()'); assert.equal(run('eng[0].u'),0);
});
test('reset clears automation, held keys, engine outputs, and replay state',()=>{
  flight(); key('l'); run('step(); keys.a=true'); key('r');
  assert.equal(run('autopilot.active'),false); assert.equal(run('Object.values(keys).some(Boolean)'),false);
  assert.equal(run('eng.some(e=>e.u>0)'),false); assert.equal(run('mode'),'live');
});
test('replay cancels automation and preserves recorded automation telemetry',()=>{
  flight(); key('l'); run('step(); trail.push(liveFrame()); step(); trail.push(liveFrame()); startReplay()');
  assert.equal(run('autopilot.active'),false); assert.equal(run('mode'),'replay');
  assert.equal(run('shownFrame().auto.active'),true); key('l'); assert.equal(run('autopilot.active'),false);
});
test('text inputs and system shortcuts do not trigger flight controls',()=>{
  flight(); key('l',{target:element('input')}); assert.equal(run('autopilot.active'),false);
  key('l',{metaKey:true}); assert.equal(run('autopilot.active'),false);
});
test('blur releases manual throttle',()=>{
  flight(); key('a'); listeners.blur(); run('step()'); assert.equal(run('eng[0].u'),0);
});
test('unrecoverable low fast descent reports warning and failure',()=>{
  flight({y:10,vy:-40}); key('l'); run('step()');
  assert.match(run('autopilot.warning'),/고도 부족/);
  const end=simulate(); assert.equal(end.status,2); assert.equal(end.auto.active,false);
  assert.match(end.auto.phase,/실패/);
});
test('insufficient thrust is explicit and never exceeds engine limits',()=>{
  flight({vy:-5},{thrust:2000}); key('l'); run('step()');
  assert.match(run('autopilot.warning'),/추력 부족/); assert.equal(simulate().status,2);
});
test('zero fuel refuses activation; depletion cuts off every engine',()=>{
  flight({fuel:0}); key('l'); assert.equal(run('autopilot.active'),false);
  assert.match(run('autopilot.phase'),/연료 소진/);
  flight({fuel:0.01,y:16,vy:-12}); key('l'); run('step(); step()');
  assert.equal(run('st.fuel'),0); assert.equal(run('eng.some(e=>e.u>0)'),false);
  assert.match(run('autopilot.warning'),/연료 소진/);
  assert.equal(simulate().status,2);
});
test('leaving bounds terminates automation',()=>{
  flight({x:299.9,vx:20}); key('l'); run('step()');
  assert.equal(run('st.status'),3); assert.equal(run('autopilot.active'),false);
});
test('HUD exposes active and completed state',()=>{
  flight(); key('l'); run('step(); hud()');
  assert.match(elements.get('h_auto').textContent,/ON/);
  assert.equal(run('autoBtn.getAttribute("aria-pressed")'),'true');
  simulate(); run('hud()'); assert.match(elements.get('h_auto').textContent,/착륙 성공/);
});
test('booster level changes flight response without resetting flight',()=>{
  const response = [];
  for (const level of [1,2,3]){
    flight(); run(`setBoosterLevel(${level})`); key('j'); run('step()');
    response.push(run('st.om'));
  }
  assert.ok(Math.abs(response[1]-2*response[0])<1e-10);
  assert.ok(Math.abs(response[2]-3*response[0])<1e-10);
  const before = run('JSON.stringify(st)');
  run('setBoosterLevel(1)'); assert.equal(run('JSON.stringify(st)'),before);
});
test('autopilot handles each booster level and an in-flight strength change',()=>{
  for (const level of [1,2,3]){
    flight({vx:6,th:0.4,om:0.2,vy:-8}); key('l');
    run(`for(let i=0;i<50;i++) step(); setBoosterLevel(${level});`);
    assert.equal(run('autopilot.active'),true);
    assert.equal(simulate().status,1,'level '+level);
  }
});
console.log(`${count} checks passed.`);
