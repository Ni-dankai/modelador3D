// main.js
import * as THREE from 'three';
import { OrbitControls }                      from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry }                 from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFExporter }                       from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader }                         from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject }         from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import TWEEN                                  from '@tweenjs/tween.js';

const UI_WIDTH = 300;

// materiais
const MATS = {};
const CUSTOM_TEXTURES = {};
let customTextureList = [];

// Presets
const STORAGE_KEY = 'furniture3dPresets';
let presetsData = [];

let scene, camera, renderer, labelRenderer, controls;
let shelfGroup = null, gridHelper = null, dimGroup = null;
let handleGLTF = null;
let current     = {};
let ctrlPressed = false; // Novo estado global para Ctrl
let showDimensions = true; // Novo estado global para cotas

// carrega modelo de puxador
new GLTFLoader().load(
  '/models/handle.glb',
  gltf => handleGLTF = gltf.scene,
  undefined,
  err  => console.warn('handle.glb load failed:', err.message)
);

init();
function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0f0f0);

  camera = new THREE.PerspectiveCamera(
    60,
    (window.innerWidth - UI_WIDTH) / window.innerHeight,
    1, 10000
  );
  camera.position.set(2000,2000,3000);

  // WebGL
  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth - UI_WIDTH, window.innerHeight);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // CSS2D overlay
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.classList.add('label-container');
  labelRenderer.setSize(window.innerWidth - UI_WIDTH, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top      = '0';
  document.getElementById('canvas-container').appendChild(labelRenderer.domElement);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,500,0);
  controls.update();

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff,0.4));
  const dl = new THREE.DirectionalLight(0xffffff,1);
  dl.position.set(1000,2000,1000);
  scene.add(dl);

  initMaterials();
  current = readUI();
  rebuildShelf();
  bindUI();
  window.addEventListener('resize', onResize);
  document.addEventListener('click', onDocumentClick);
  animate();
}

function onResize() {
  camera.aspect = (window.innerWidth - UI_WIDTH) / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth - UI_WIDTH, window.innerHeight);
  labelRenderer.setSize(window.innerWidth - UI_WIDTH, window.innerHeight);
}

function initMaterials() {
  const loader = new THREE.TextureLoader();

  // 1) Textura base carregada UMA vez
  const woodBaseTex = loader.load(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/hardwood2_diffuse.jpg',
    tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.center.set(0.5, 0.5);
      // Opcional: só agora dispara o primeiro rebuildShelf(), 
      // para garantir que a textura já esteja pronta.
      rebuildShelf();
    },
    undefined,
    err => console.error('Falha ao carregar madeira:', err)
  );

  // 2) Cria material de madeira clonando somente se image existir
  MATS.wood = (length, depth, rotateGrain = false) => {
    // Se ainda não carregou, devolve um material cinza neutro
    if (!woodBaseTex.image) {
      return new THREE.MeshStandardMaterial({ color: 0xdddddd });
    }
    // Senão, faz o clone com dados válidos
    const tex = woodBaseTex.clone();
    tex.image       = woodBaseTex.image;       
    tex.wrapS       = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(length / 500, depth / 500);
    tex.center.set(0.5, 0.5);
    tex.rotation    = rotateGrain ? Math.PI / 2 : 0;
    tex.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: tex });
  };

  MATS.lacquer = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness:0.3, metalness:0.1 });
  MATS.metal   = () => new THREE.MeshStandardMaterial({ color: 0x888888, roughness:0.2, metalness:1 });
  MATS.glass   = () => new THREE.MeshPhysicalMaterial({ color:0xffffff, roughness:0.1, transmission:0.9, transparent:true, opacity:0.5 });
}

function readUI(){
  return {
    W: +get('width'),
    H: +get('height'),
    D: +get('depth'),
    boxTh:     +get('boxThickness'),
    doorTh:    +get('doorThickness'),
    legH:      +get('legHeight'),
    legD:      +get('legDiameter'),
    shelves:   +get('shelves'),
    doors:     +get('doors'),
    doorMargin:+get('doorMargin'),
    footOffset:+get('footOffset'),
    handles:   chk('handles'),
    backPanel: chk('backPanel'),
    grid:      chk('grid'),
    autoRotate:chk('autoRotate'),
    material:  document.getElementById('material').value
  };
}

function bindUI(){
  const upd = ()=> tweenUpdate(current, readUI());
  document.getElementById('btnUpdate').onclick = upd;
  document.getElementById('btnExport').onclick = exportGLTF;
  document.querySelectorAll('input,select').forEach(el=>el.onchange = upd);
  
  // Eventos para biblioteca de presets
  document.getElementById('btnSavePreset').onclick = saveCurrentPreset;
  
  // Carrega os presets salvos
  loadPresets();
}

function tweenUpdate(from,to){
  ['handles','backPanel','grid','autoRotate','material'].forEach(k=>from[k]=to[k]);
  const nums = ['W','H','D','boxTh','doorTh','legH','legD','shelves','doors','doorMargin','footOffset'];
  const tgt = {};
  nums.forEach(k=>tgt[k]=to[k]);
  new TWEEN.Tween(from)
    .to(tgt,600)
    .easing(TWEEN.Easing.Quadratic.InOut)
    .onUpdate(rebuildShelf)
    .onComplete(rebuildShelf)
    .start();
}

function rebuildShelf(){
  if(shelfGroup){
    scene.remove(shelfGroup);
    shelfGroup.traverse(o=>{
      if(o.isMesh){
        o.geometry.dispose();
        Array.isArray(o.material)?o.material.forEach(m=>m.dispose()):o.material.dispose();
      }
    });
  }
  if(gridHelper){
    scene.remove(gridHelper);
    gridHelper = null;
  }
  shelfGroup = createShelfGroup(current);
  scene.add(shelfGroup);
  if (showDimensions) addDimensions(current); // Só adiciona cotas se ativado
  generatePartsList();
}

function createShelfGroup(p){
  const {
    W,H,D,boxTh,doorTh,
    legH,legD,shelves,doors,doorMargin,
    footOffset,handles,backPanel,grid,material
  } = p;

  if(grid){
    gridHelper = new THREE.GridHelper(3000,30,0x444444,0xaaaaaa);
    scene.add(gridHelper);
  }

  const innerH = H - legH,
        sideH  = innerH - 2*boxTh,
        innerW = W - 2*boxTh,
        backTh = backPanel?2:0,
        gapV   = (sideH - shelves*boxTh)/(shelves+1);

  const group = new THREE.Group();

  // Base
  const base = createPanel(W,boxTh,D,material);
  base.name='Base';
  base.position.set(0, legH + boxTh/2, 0);
  group.add(base);

  // Tampo
  const top = createPanel(W,boxTh,D,material);
  top.name='Tampo';
  top.position.set(0, legH + boxTh + sideH + boxTh/2, 0);
  group.add(top);

  // Laterais
  ['Lateral','Lateral'].forEach((nm,i)=>{
    const m = createPanel(boxTh,sideH,D,material);
    m.name=nm;
    m.position.set((i?1:-1)*(W/2-boxTh/2), legH+boxTh+sideH/2, 0);
    group.add(m);
  });

  // Prateleiras
  const shelfD = D - 2*boxTh;
  const secs   = doors>0?doors:1;
  const totW   = innerW - ((doors>0)?(doors-1)*boxTh:0);
  const secW   = totW/secs;
  for(let i=0;i<shelves;i++){
    const y0 = legH+boxTh+gapV + i*(boxTh+gapV);
    for(let j=0;j<secs;j++){
      const m=createPanel(secW,boxTh,shelfD,material);
      m.name='Prateleira';
      m.position.set(-innerW/2 + secW/2 + j*(secW+boxTh), y0, 0);
      group.add(m);
    }
  }

  // Divisórias & Portas
  if(doors>0){
    for(let i=1;i<doors;i++){
      const d=createPanel(boxTh,sideH,D-backTh,material);
      d.name='Divisória';
      d.position.set(-innerW/2 + i*(secW+boxTh) - boxTh/2,
                     legH+boxTh+sideH/2,
                     backPanel? backTh/2:0);
      group.add(d);
    }
    for(let i=0;i<doors;i++){
      const isLeft = i%2===0;
      const wdo=secW-2*doorMargin, hdo=sideH-2*doorMargin;
      const zdo=D/2-boxTh/2-doorTh/2;
      const hx=-W/2+boxTh+i*(secW+boxTh)+(isLeft?doorMargin:secW-doorMargin);

      const piv=new THREE.Object3D();
      piv.position.set(hx, legH+boxTh+doorMargin+hdo/2, zdo);
      piv.userData={ open:false, twist:isLeft?-Math.PI/2:Math.PI/2, w:wdo,h:hdo,th:doorTh };

      const door=createPanel(wdo,hdo,doorTh,material, 'Porta');
      door.name='Porta';
      door.position.x = isLeft? wdo/2 : -wdo/2;
      piv.add(door);

      if(handles) createHandles(door, isLeft);
      group.add(piv);
    }
  }

  // Painel Traseiro
  if(backPanel){
    const b=createPanel(W-2*boxTh,sideH,2,material);
    b.name='Fundo';
    b.position.set(0, legH+boxTh+sideH/2, -D/2+1);
    group.add(b);
  }

  // Sapatas Dinâmicas com balanço
  const maxSpan = 800;
  const count   = Math.max(2, Math.ceil((W-2*footOffset)/maxSpan)+1);
  const availW  = W - 2*footOffset;
  const step    = availW / (count - 1);
  const geoF    = new THREE.CylinderGeometry(legD/2,legD/2,legH,12);
  const matF    = new THREE.MeshStandardMaterial({color:0x553311});

  for(let i=0;i<count;i++){
    const x = -W/2 + footOffset + i*step;
    const fr = new THREE.Mesh(geoF, matF);
    fr.name='Sapata';
    fr.position.set(x, legH/2, D/2 - legD/2 - footOffset);
    group.add(fr);
    const bk = fr.clone();
    bk.position.z = -D/2 + legD/2 + footOffset;
    group.add(bk);
  }

  addOutline(group);
  return group;
}

function addCustomTextureUI() {
  // Cria input de upload se não existir
  if (!document.getElementById('customTextureInput')) {
    const panel = document.getElementById('control-panel') || document.body;
    const label = document.createElement('label');
    label.textContent = 'Importar textura (.jpg): ';
    label.style.display = 'block';
    label.style.margin = '8px 0 2px 0';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jpg,image/jpeg';
    input.id = 'customTextureInput';
    input.style.marginRight = '8px';
    label.appendChild(input);
    panel.insertBefore(label, panel.firstChild);
    input.addEventListener('change', handleCustomTextureUpload);
  }
  // Carrega texturas customizadas da sessão
  const saved = sessionStorage.getItem('customTextureList');
  if (saved) {
    customTextureList = JSON.parse(saved);
    customTextureList.forEach(t => loadCustomTexture(t));
  }
  updateMaterialSelect();
}

function handleCustomTextureUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.match('image/jpeg')) {
    alert('Apenas arquivos .jpg são suportados.');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(ev) {
    const url = ev.target.result;
    const name = 'custom_' + Date.now();
    customTextureList.push({ name, url });
    sessionStorage.setItem('customTextureList', JSON.stringify(customTextureList));
    loadCustomTexture({ name, url }, true);
    updateMaterialSelect(name);
    showTextureFeedback('Textura importada!');
  };
  reader.readAsDataURL(file);
}

function loadCustomTexture({ name, url }, selectAfter) {
  const loader = new THREE.TextureLoader();
  loader.load(url, tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.center.set(0.5, 0.5);
    CUSTOM_TEXTURES[name] = (length, depth, rotateGrain = false, isDoor = false) => {
      const t = tex.clone();
      t.image = tex.image;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(length / 500, isDoor ? length / 500 : depth / 500); // Para portas, repeat proporcional à largura/altura
      t.center.set(0.5, 0.5);
      t.rotation = rotateGrain ? Math.PI / 2 : 0;
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t });
    };
    updateMaterialSelect(selectAfter ? name : undefined);
  });
}

function updateMaterialSelect(selectName) {
  const sel = document.getElementById('material');
  if (!sel) return;
  // Remove opções customizadas antigas
  Array.from(sel.options).forEach(opt => {
    if (opt.value.startsWith('custom_')) sel.removeChild(opt);
  });
  // Adiciona opções customizadas
  customTextureList.forEach(({ name }, i) => {
    if (!sel.querySelector(`option[value="${name}"]`)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = 'Textura Customizada ' + (i + 1);
      sel.appendChild(opt);
    }
  });
  if (selectName) sel.value = selectName;
}

function showTextureFeedback(msg) {
  let el = document.getElementById('textureFeedback');
  if (!el) {
    el = document.createElement('div');
    el.id = 'textureFeedback';
    el.style.position = 'fixed';
    el.style.top = '10px';
    el.style.right = '10px';
    el.style.background = '#222';
    el.style.color = '#fff';
    el.style.padding = '8px 16px';
    el.style.borderRadius = '6px';
    el.style.zIndex = 1000;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = 1;
  setTimeout(() => { el.style.opacity = 0; }, 1800);
}

function createPanel(w, h, d, mat, name) {
  const geo = new RoundedBoxGeometry(w, h, d, 2, 2);
  // Detecta se é porta: nome contém 'porta' ou profundidade pequena e altura grande
  const isDoor = (name && name.toLowerCase().includes('porta')) || (d <= 30 && h > 200);

  // Determina a maior dimensão e ajusta rotação do veio
  let mainDim = w, secDim = d, rotateGrain = false;
  if (h >= w && h >= d) {
    mainDim = h;
    secDim = isDoor ? w : d;
    rotateGrain = true;
  } else if (d >= w && d >= h) {
    mainDim = d;
    secDim = w;
    rotateGrain = true;
  } else {
    mainDim = w;
    secDim = isDoor ? h : d;
    rotateGrain = false;
  }

  let material;
  if (mat === 'wood') {
    material = MATS.wood(mainDim, secDim, rotateGrain);
  } else if (mat.startsWith('custom_') && CUSTOM_TEXTURES[mat]) {
    material = CUSTOM_TEXTURES[mat](mainDim, secDim, rotateGrain, isDoor);
  } else {
    material = MATS[mat]();
  }
  return new THREE.Mesh(geo, material);
}

function createHandles(doorMesh, isLeftDoor) {
  const pd = doorMesh.parent.userData;
  const w  = pd.w, h = pd.h, th = pd.th;

  // 1) clone ou fallback
  let grip = handleGLTF
    ? handleGLTF.clone(true)
    : new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3, h * 0.2, 12),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
      );
  grip.name = 'Puxador';

  // 2) escala
  // Tamanho fixo do puxador, ex: 300mm
  const tamanhoPuxador = 300; // mm
  const box0  = new THREE.Box3().setFromObject(grip);
  const size0 = box0.getSize(new THREE.Vector3());
  grip.scale.multiplyScalar(tamanhoPuxador / size0.x);

  // 3) container para rotação e posição
  const container = new THREE.Group();
  container.name = 'HandlePivot';
  container.add(grip);

  // 4) rotação (aplique no grip, não no container)
  const sideX = isLeftDoor ? 1 : -1;
  grip.rotation.set(
    -Math.PI / 2,
    sideX * Math.PI / 2,
    Math.PI
  );

  // 5) medidas e posição
  // Garante simetria: cada puxador a 50mm da borda externa da porta
  const posX = isLeftDoor ? (w / 2 - 50) : (-w / 2 + 50);
  // Alinha a base dos puxadores na mesma altura
  const boxGrip = new THREE.Box3().setFromObject(grip);
  const sizeGrip = boxGrip.getSize(new THREE.Vector3());
  const centerGrip = boxGrip.getCenter(new THREE.Vector3());
  // Ajuste: alinhar a base dos puxadores a 50mm da borda superior da porta e descer 50mm
  const baseAltura = h / 2 - sizeGrip.y / 2 - 50; // desce 50mm
  const posY = baseAltura - centerGrip.y;
  const posZ = th + 23; // sempre para fora da porta

  container.position.set(posX, posY, posZ);
  doorMesh.add(container);
}

function addOutline(group){
  group.traverse(o=>{
    if(o.isMesh){
      const edges=new THREE.EdgesGeometry(o.geometry);
      const line=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:0x000}));
      line.renderOrder=999;
      o.add(line);
    }
  });
}

function drawDim(p1,p2,off,text){
  const mat=new THREE.LineBasicMaterial({color:0x000});
  const a=p1.clone().add(off), b=p2.clone().add(off);
  dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]), mat));
  const perp=new THREE.Vector3().subVectors(p2,p1).normalize();
  const dir=new THREE.Vector3(-perp.y,perp.x,perp.z).multiplyScalar(5);
  dimGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([a,a.clone().add(dir),b,b.clone().add(dir)]), mat));
  const mid=a.clone().add(b).multiplyScalar(0.5);
  const div=document.createElement('div');
  div.className='label'; div.textContent=text;
  const lbl=new CSS2DObject(div); lbl.position.copy(mid);
  dimGroup.add(lbl);
}

function createDimField(p1, p2, off, paramId) {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'dim-input';
  input.value = document.getElementById(paramId).value;
  const label = new CSS2DObject(input);
  const mid = p1.clone().add(p2).multiplyScalar(0.5).add(off);
  label.position.copy(mid);
  dimGroup.add(label);
  input.addEventListener('change', () => {
    const v = parseFloat(input.value) || 0;
    document.getElementById(paramId).value = v;
    const target = readUI();
    tweenUpdate(current, target);
  });
}

function toggleDimensions(force) {
  if (typeof force === 'boolean') {
    showDimensions = force;
  } else {
    showDimensions = !showDimensions;
  }
  if (shelfGroup) {
    if (dimGroup) shelfGroup.remove(dimGroup);
    dimGroup = null;
    if (showDimensions) addDimensions(current);
    else if (labelRenderer && labelRenderer.domElement) labelRenderer.domElement.innerHTML = '';
  }
}
window.toggleDimensions = toggleDimensions;

function addDimensions(p) {
  if (!shelfGroup) return;
  if (dimGroup) shelfGroup.remove(dimGroup);
  labelRenderer.domElement.innerHTML = '';
  dimGroup = new THREE.Group();
  shelfGroup.add(dimGroup);

  const innerH = p.H - p.legH,
        sideH  = innerH - 2*p.boxTh,
        gapV   = (sideH - p.shelves*p.boxTh)/(p.shelves+1);

  const EXT = 150;
  const OFF_L = new THREE.Vector3(0, -20, 0);
  const OFF_H = new THREE.Vector3(20,  0, 0);
  const OFF_D = new THREE.Vector3(20,  0, 0);

  createDimField(
    new THREE.Vector3(-p.W/2, p.legH,  p.D/2 + EXT),
    new THREE.Vector3( p.W/2, p.legH,  p.D/2 + EXT),
    OFF_L, 'width'
  );

  createDimField(
    new THREE.Vector3(p.W/2 + EXT, p.legH,        0),
    new THREE.Vector3(p.W/2 + EXT, p.legH + p.H, 0),
    OFF_H, 'height'
  );

  createDimField(
    new THREE.Vector3(p.W/2 + EXT, p.legH,   -p.D/2),
    new THREE.Vector3(p.W/2 + EXT, p.legH,    p.D/2),
    OFF_D, 'depth'
  );

  for (let i = 0; i <= p.shelves; i++) {
    const y = p.legH + p.boxTh + i*(p.boxTh + gapV);
    drawDim(
      new THREE.Vector3(p.W/2 + 30, y, p.D/4),
      new THREE.Vector3(p.W/2 + 30, y + gapV, p.D/4),
      new THREE.Vector3(0,0,0),
      `${Math.round(gapV)} mm`
    );
  }
}

function generatePartsList(){
  if(!shelfGroup)return;
  const parts={};
  shelfGroup.traverse(o=>{
    if(!o.isMesh) return;
    const nm=o.name||'Peça';
    const sz=new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    const ds=`${Math.round(sz.x)}×${Math.round(sz.y)}×${Math.round(sz.z)} mm`;
    const key=`${nm}|${ds}`;
    parts[key]=parts[key]||{name:nm,dims:ds,qty:0};
    parts[key].qty++;
  });
  const ct=document.getElementById('partsList');
  const rows=Object.values(parts).map(p=>`<tr><td>${p.name}</td><td>${p.dims}</td><td>${p.qty}</td></tr>`).join('');
  ct.innerHTML=`
    <h3>📦 Lista de Peças</h3>
    <table>
      <thead><tr><th>Nome</th><th>Dimensões</th><th>Qtd</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function onDocumentClick(evt){
  if(!shelfGroup)return;
  // Só permite interação se Ctrl estiver pressionado e botão esquerdo do mouse
  if (!ctrlPressed || evt.button !== 0) return;
  const mx=((evt.clientX-UI_WIDTH)/(window.innerWidth-UI_WIDTH))*2-1;
  const my=-(evt.clientY/window.innerHeight)*2+1;
  const ray=new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(mx,my), camera);
  const hits=ray.intersectObject(shelfGroup,true);
  if(!hits.length)return;
  const piv=hits[0].object.parent;
  if(piv.userData.twist!==undefined){
    new TWEEN.Tween(piv.rotation)
      .to({y:piv.userData.open?0:piv.userData.twist},400)
      .easing(TWEEN.Easing.Quadratic.Out)
      .start();
    piv.userData.open = !piv.userData.open;
  }
}

window.addEventListener('keydown', e => {
  if (e.key === 'Control') ctrlPressed = true;
});
window.addEventListener('keyup', e => {
  if (e.key === 'Control') ctrlPressed = false;
});

function animate(time){
  requestAnimationFrame(animate);
  TWEEN.update(time);
  if(shelfGroup && current.autoRotate) shelfGroup.rotation.y += 0.005;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function exportGLTF(){
  if(!shelfGroup)return;
  new GLTFExporter().parse(shelfGroup, gltf=>{
    const blob=new Blob([JSON.stringify(gltf)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='estante.glb';
    a.click();
  });
}

// Captura uma thumbnail do móvel atual
function captureThumbnail(width = 100, height = 100) {
  if (!shelfGroup) return null;
  
  console.log("Iniciando captura de thumbnail...");
  
  // Criar um canvas temporário para captura
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempRenderer = new THREE.WebGLRenderer({
    canvas: tempCanvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  tempRenderer.setSize(width, height);
  
  // Salvar configuração original da câmera e cena
  const originalPosition = camera.position.clone();
  const originalCameraRotation = camera.rotation.clone();
  const originalTarget = controls.target.clone();
  const originalBackground = scene.background;
  const originalShelfRotation = shelfGroup ? shelfGroup.rotation.y : 0;
  
  try {
    // Configurar para captura
    scene.background = new THREE.Color(0xf5f5f5);
    if (shelfGroup) {
      shelfGroup.rotation.y = Math.PI / 6; // Rotação de 30 graus para melhor visualização
    }
    
    // Ajustar câmera para enquadrar o móvel
    const box = new THREE.Box3().setFromObject(shelfGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    // Definir posição da câmera para captura
    const tempCamera = camera.clone();
    const fov = tempCamera.fov * (Math.PI / 180);
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = maxSize / (2 * Math.tan(fov / 2)) * 1.5;
    
    tempCamera.position.set(
      center.x + distance * 0.8, 
      center.y + distance * 0.5, 
      center.z + distance * 0.8
    );
    tempCamera.lookAt(center);
    tempCamera.updateProjectionMatrix();
    
    // Renderizar e capturar
    tempRenderer.render(scene, tempCamera);
    const dataURL = tempCanvas.toDataURL('image/png');
    console.log("Thumbnail gerada com sucesso!");
    
    // Visualização de debug (remove em produção)
    console.log("Dados da thumbnail:", dataURL.substring(0, 100) + "...");
    
    return dataURL;
  } catch (err) {
    console.error("Erro ao capturar thumbnail:", err);
    return null;
  } finally {
    // Restaurar configurações originais
    camera.position.copy(originalPosition);
    camera.rotation.copy(originalCameraRotation);
    controls.target.copy(originalTarget);
    controls.update();
    scene.background = originalBackground;
    if (shelfGroup) {
      shelfGroup.rotation.y = originalShelfRotation;
    }
    
    // Renderizar novamente na visualização original
    renderer.setSize(window.innerWidth - UI_WIDTH, window.innerHeight);
    renderer.render(scene, camera);
    
    // Limpar recursos
    tempRenderer.dispose();
  }
}

// Método alternativo para capturar thumbnails
function simpleCaptureThumb() {
  if (!shelfGroup || !renderer) return null;
  
  // Salvar estado atual
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  const originalRotationY = shelfGroup.rotation.y;
  
  try {
    // Rotacionar móvel para uma boa visualização
    shelfGroup.rotation.y = Math.PI / 5;
    
    // Renderizar
    renderer.render(scene, camera);
    
    // Capturar imagem
    const dataUrl = renderer.domElement.toDataURL('image/png');
    console.log('Thumbnail simples capturada com sucesso');
    return dataUrl;
  } catch (e) {
    console.error('Erro ao capturar thumbnail simples:', e);
    return null;
  } finally {
    // Restaurar estado
    shelfGroup.rotation.y = originalRotationY;
    renderer.render(scene, camera);
  }
}

function get(id){ return document.getElementById(id).value; }
function chk(id){ return document.getElementById(id).checked; }

// Adiciona suporte para textura customizada via upload
window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('textureUpload');
  const select = document.getElementById('material');
  const feedback = document.getElementById('textureFeedback');
  if (!input || !select) return;

  input.addEventListener('change', e => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.match('image/jpeg')) {
      feedback.textContent = 'Apenas arquivos .jpg são suportados.';
      return;
    }
    const reader = new FileReader();
    reader.onload = function(ev) {
      const url = ev.target.result;
      const texId = 'custom_' + file.name.replace(/\W/g, '_');
      // Registra a função no CUSTOM_TEXTURES antes de atualizar o select
      new THREE.TextureLoader().load(url, tex => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.center.set(0.5, 0.5);
        CUSTOM_TEXTURES[texId] = (w, d, rotateGrain = false, isDoor = false) => {
          const t = tex.clone();
          t.image = tex.image;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(w / 500, isDoor ? w / 500 : d / 500); // Para portas, repeat proporcional à largura/altura
          t.center.set(0.5, 0.5);
          t.rotation = rotateGrain ? Math.PI / 2 : 0;
          t.needsUpdate = true;
          return new THREE.MeshStandardMaterial({ map: t });
        };
        // Adiciona opção ao select se não existir
        if (!select.querySelector('option[value="'+texId+'"]')) {
          const opt = document.createElement('option');
          opt.value = texId;
          opt.textContent = 'Textura: ' + file.name;
          select.appendChild(opt);
        }
        // Salva a textura no sessionStorage
        sessionStorage.setItem(texId, url);
        // Seleciona a textura importada
        select.value = texId;
        feedback.innerHTML = '<span style="color:green">Textura importada!</span>';
        // Dispara evento para atualizar móvel
        select.dispatchEvent(new Event('change'));
      });
    };
    reader.readAsDataURL(file);
  });
});

// ===== BIBLIOTECA DE PRESETS =====

// Carrega presets do localStorage
function loadPresets() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    console.log('Dados salvos no localStorage:', saved);
    
    if (saved) {
      presetsData = JSON.parse(saved);
      console.log('Presets carregados:', presetsData);
    } else {
      console.log('Nenhum preset encontrado no localStorage');
      presetsData = [];
    }
  } catch (err) {
    console.error('Erro ao carregar presets:', err);
    presetsData = [];
  }
  
  updatePresetsUI();
}

// Salva presets no localStorage
function savePresetsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presetsData));
  } catch (err) {
    console.error('Erro ao salvar presets:', err);
    showPresetFeedback('Erro ao salvar presets! Verifique o console.');
  }
}

// Salva o preset atual
function saveCurrentPreset() {
  const nameInput = document.getElementById('preset-name');
  let presetName = nameInput.value.trim();
  
  if (!presetName) {
    showPresetFeedback('Digite um nome para o preset!', 'error');
    return;
  }
  
  // Obtém parâmetros atuais do móvel
  const presetData = readUI();
  console.log('Dados do preset a ser salvo:', presetData);
  
  // Captura thumbnail do móvel atual
  console.log('Capturando thumbnail para o preset:', presetName);
  
  // Tentar primeiro o método avançado, depois o simples se falhar
  let thumbnail = null;
  try {
    thumbnail = captureThumbnail(150, 150);
  } catch (e) {
    console.error('Falha no método de captura avançada, tentando método simples:', e);
    thumbnail = simpleCaptureThumb();
  }
  
  console.log('Thumbnail capturada com sucesso?', !!thumbnail);
  
  // Verifica se já existe um preset com este nome
  const existingIndex = presetsData.findIndex(p => p.name === presetName);
  
  if (existingIndex >= 0) {
    if (!confirm(`Já existe um preset chamado "${presetName}". Deseja substituí-lo?`)) {
      return;
    }
    presetsData[existingIndex] = { name: presetName, data: presetData, thumbnail };
    console.log(`Preset "${presetName}" atualizado com thumbnail:`, !!thumbnail);
  } else {
    presetsData.push({ name: presetName, data: presetData, thumbnail });
    console.log(`Novo preset "${presetName}" adicionado com thumbnail:`, !!thumbnail);
  }
  
  // Salva no localStorage e atualiza UI
  savePresetsToStorage();
  updatePresetsUI();
  nameInput.value = '';
  showPresetFeedback(`Preset "${presetName}" salvo com sucesso!`);
}

// Carrega um preset
function loadPreset(presetName) {
  console.log('Tentando carregar preset:', presetName);
  console.log('Lista de presets disponíveis:', presetsData);
  
  const preset = presetsData.find(p => p.name === presetName);
  
  if (!preset) {
    console.error('Preset não encontrado:', presetName);
    showPresetFeedback(`Preset "${presetName}" não encontrado!`, 'error');
    return;
  }
  
  console.log('Dados do preset encontrado:', preset);
  
  if (!preset.data) {
    console.error('Dados do preset são inválidos:', preset);
    showPresetFeedback(`Dados do preset "${presetName}" são inválidos!`, 'error');
    return;
  }
  
  // Aplica os valores do preset à UI
  try {
    console.log('Aplicando dados à UI:', preset.data);
    applyPresetToUI(preset.data);
    
    // Reconstrói o móvel
    current = readUI();
    console.log('Valores atualizados após aplicar preset:', current);
    rebuildShelf();
    
    showPresetFeedback(`Preset "${presetName}" carregado com sucesso!`);
  } catch (err) {
    console.error('Erro ao aplicar preset:', err);
    showPresetFeedback(`Erro ao aplicar preset "${presetName}": ${err.message}`, 'error');
  }
}

// Renomeia um preset
function renamePreset(oldName) {
  const newName = prompt(`Digite o novo nome para o preset "${oldName}":`, oldName);
  
  if (!newName || newName === oldName) {
    return; // Cancelado ou mesmo nome
  }
  
  // Verifica se já existe um preset com o novo nome
  if (presetsData.some(p => p.name === newName)) {
    showPresetFeedback(`Já existe um preset chamado "${newName}"!`, 'error');
    return;
  }
  
  const presetIndex = presetsData.findIndex(p => p.name === oldName);
  if (presetIndex >= 0) {
    presetsData[presetIndex].name = newName;
    savePresetsToStorage();
    updatePresetsUI();
    showPresetFeedback(`Preset renomeado para "${newName}"!`);
  }
}

// Exclui um preset
function deletePreset(presetName) {
  if (!confirm(`Tem certeza que deseja excluir o preset "${presetName}"?`)) {
    return;
  }
  
  const presetIndex = presetsData.findIndex(p => p.name === presetName);
  if (presetIndex >= 0) {
    presetsData.splice(presetIndex, 1);
    savePresetsToStorage();
    updatePresetsUI();
    showPresetFeedback(`Preset "${presetName}" excluído!`);
  }
}

// Aplica valores de um preset aos inputs da UI
function applyPresetToUI(presetData) {
  // Aplica cada valor do preset ao seu respectivo campo na UI
  document.getElementById('width').value = presetData.W;
  document.getElementById('height').value = presetData.H;
  document.getElementById('depth').value = presetData.D;
  document.getElementById('boxThickness').value = presetData.boxTh;
  document.getElementById('doorThickness').value = presetData.doorTh;
  document.getElementById('legHeight').value = presetData.legH;
  document.getElementById('legDiameter').value = presetData.legD;
  document.getElementById('shelves').value = presetData.shelves;
  document.getElementById('doors').value = presetData.doors;
  document.getElementById('doorMargin').value = presetData.doorMargin;
  document.getElementById('footOffset').value = presetData.footOffset;
  
  // Checkboxes
  document.getElementById('handles').checked = presetData.handles;
  document.getElementById('backPanel').checked = presetData.backPanel;
  document.getElementById('grid').checked = presetData.grid;
  document.getElementById('autoRotate').checked = presetData.autoRotate;
  
  // Material
  document.getElementById('material').value = presetData.material || 'wood';
}

// Atualiza a interface dos presets com thumbnails
function updatePresetsUI() {
  const presetsList = document.getElementById('presets-list');
  if (!presetsList) return;
  
  console.log('Atualizando UI de presets:', presetsData);
  
  // Limpa a lista atual
  presetsList.innerHTML = '';
  
  if (presetsData.length === 0) {
    presetsList.innerHTML = '<div class="preset-item">Nenhum preset salvo</div>';
    return;
  }
  
  // Adiciona cada preset à lista com thumbnail
  presetsData.forEach(preset => {
    console.log('Renderizando preset:', preset.name, 'thumbnail disponível:', !!preset.thumbnail);
    
    const presetItem = document.createElement('div');
    presetItem.className = 'preset-item';
    
    // Container para thumbnail e nome (lado esquerdo)
    const infoContainer = document.createElement('div');
    infoContainer.className = 'preset-info';
    infoContainer.style.display = 'flex';
    infoContainer.style.alignItems = 'center';
    infoContainer.style.flex = '1';
    infoContainer.style.cursor = 'pointer';
    infoContainer.onclick = () => loadPreset(preset.name);
    
    // Elemento para a thumbnail (independente se há imagem ou não)
    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.style.width = '50px';
    thumbnailContainer.style.height = '50px';
    thumbnailContainer.style.marginRight = '10px';
    thumbnailContainer.style.borderRadius = '4px';
    thumbnailContainer.style.border = '1px solid #ddd';
    thumbnailContainer.style.overflow = 'hidden';
    thumbnailContainer.style.display = 'flex';
    thumbnailContainer.style.alignItems = 'center';
    thumbnailContainer.style.justifyContent = 'center';
    thumbnailContainer.style.backgroundColor = '#f0f0f0';
    
    // Thumbnail ou ícone de placeholder
    if (preset.thumbnail) {
      const thumbnail = document.createElement('img');
      thumbnail.className = 'preset-thumbnail';
      thumbnail.src = preset.thumbnail;
      thumbnail.alt = preset.name;
      thumbnail.style.width = '100%';
      thumbnail.style.height = '100%';
      thumbnail.style.objectFit = 'cover';
      
      // Verificar se a imagem carrega corretamente
      thumbnail.onerror = () => {
        console.error('Erro ao carregar thumbnail para:', preset.name);
        thumbnailContainer.innerHTML = '📦';
        thumbnailContainer.style.fontSize = '24px';
      };
      
      thumbnailContainer.appendChild(thumbnail);
    } else {
      // Placeholder se não houver thumbnail
      thumbnailContainer.textContent = '📦';
      thumbnailContainer.style.fontSize = '24px';
    }
    
    infoContainer.appendChild(thumbnailContainer);
    
    // Nome do preset
    const nameSpan = document.createElement('span');
    nameSpan.className = 'preset-name';
    nameSpan.textContent = preset.name;
    infoContainer.appendChild(nameSpan);
    
    presetItem.appendChild(infoContainer);
    
    // Botões de ação (lado direito)
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'preset-actions';
    
    // Botão renomear
    const renameBtn = document.createElement('button');
    renameBtn.className = 'preset-btn';
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Renomear';
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      renamePreset(preset.name);
    };
    actionsDiv.appendChild(renameBtn);
    
    // Botão excluir
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'preset-btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Excluir';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      deletePreset(preset.name);
    };
    actionsDiv.appendChild(deleteBtn);
    
    presetItem.appendChild(actionsDiv);
    presetsList.appendChild(presetItem);
  });
}

// Exibe mensagem de feedback para ações de presets
function showPresetFeedback(message, type = 'success') {
  // Verifica se já existe um elemento de feedback
  let feedback = document.getElementById('preset-feedback');
  
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'preset-feedback';
    feedback.style.position = 'fixed';
    feedback.style.bottom = '20px';
    feedback.style.right = '20px';
    feedback.style.padding = '10px 20px';
    feedback.style.borderRadius = '4px';
    feedback.style.zIndex = '9999';
    feedback.style.fontWeight = 'bold';
    feedback.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    document.body.appendChild(feedback);
  }
  
  // Define a cor com base no tipo de mensagem
  if (type === 'error') {
    feedback.style.backgroundColor = '#f44336';
    feedback.style.color = '#ffffff';
  } else {
    feedback.style.backgroundColor = '#4CAF50';
    feedback.style.color = '#ffffff';
  }
  
  feedback.textContent = message;
  feedback.style.display = 'block';
  
  // Esconde a mensagem após 3 segundos
  setTimeout(() => {
    feedback.style.display = 'none';
  }, 3000);
}