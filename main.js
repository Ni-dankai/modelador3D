// Importações Three.js necessárias
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as TWEEN from '@tweenjs/tween.js';

// main.js

const UI_WIDTH = 300; // Largura do painel de controles esquerdo
const LIBRARY_WIDTH = 300; // Largura do painel da biblioteca direito

// materiais
const MATS = {};
const CUSTOM_TEXTURES = {};
let customTextureList = [];

// Presets
const STORAGE_KEY = 'furniture3dPresets';
let presetsData = [];

// Sistema de instâncias de móveis
let furnitureInstances = [];
let selectedInstance = null;
let isDragging = false;
let dragPlane, raycaster, mouse;

let scene, camera, renderer, labelRenderer, controls;
let shelfGroup = null, gridHelper = null, dimGroup = null;
let handleGLTF = null;
let current     = {};
let ctrlPressed = false; // Novo estado global para Ctrl
let showDimensions = true; // Novo estado global para cotas
let showMainFurniture = false; // Controla visibilidade do móvel principal

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

  // Inicializa variáveis do sistema de instâncias
  dragPlane = new THREE.Plane();
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  camera = new THREE.PerspectiveCamera(
    60,
    (window.innerWidth - UI_WIDTH - LIBRARY_WIDTH) / window.innerHeight,
    1, 10000
  );
  camera.position.set(2000,2000,3000);

  // WebGL
  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(window.innerWidth - UI_WIDTH - LIBRARY_WIDTH, window.innerHeight);
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  // CSS2D overlay
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.classList.add('label-container');
  labelRenderer.setSize(window.innerWidth - UI_WIDTH - LIBRARY_WIDTH, window.innerHeight);
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

  // Grade inicial (independente do móvel)
  createInitialGrid();

  initMaterials();
  current = readUI();
  
  // Inicializa componentes necessários sem criar o móvel principal
  setTimeout(() => {
    addCustomTextureUI();
    // Inicializa o painel da lista de peças, mas vazio
    generatePartsList();
  }, 50);
  
  bindUI();
  window.addEventListener('resize', onResize);
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  animate();
}

// Cria uma grade inicial no cenário
function createInitialGrid() {
  if (gridHelper) {
    scene.remove(gridHelper);
  }
  
  // Cria uma grade muito grande e infinita
  gridHelper = new THREE.GridHelper(50000, 500, 0x444444, 0xaaaaaa);
  gridHelper.position.y = -0.1; // Posiciona ligeiramente abaixo do nível do chão
  gridHelper.name = 'InfiniteGrid';
  scene.add(gridHelper);
  
  console.log('Grade infinita criada');
}

// Atualiza a visibilidade da grade baseado na configuração
function updateGridVisibility() {
  const showGrid = document.getElementById('grid').checked;
  if (gridHelper) {
    gridHelper.visible = showGrid;
  } else if (showGrid) {
    createInitialGrid();
  }
}

function onResize() {
  camera.aspect = (window.innerWidth - UI_WIDTH - LIBRARY_WIDTH) / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth - UI_WIDTH - LIBRARY_WIDTH, window.innerHeight);
  labelRenderer.setSize(window.innerWidth - UI_WIDTH - LIBRARY_WIDTH, window.innerHeight);
}

function initMaterials() {
  const loader = new THREE.TextureLoader();

  // 1) Cria material de madeira básico primeiro
  MATS.wood = (length, depth, rotateGrain = false) => {
    return new THREE.MeshStandardMaterial({ color: 0xcd853f }); // Cor madeira padrão
  };

  // 2) Textura base carregada assincronamente
  const woodBaseTex = loader.load(
    'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/hardwood2_diffuse.jpg',
    tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.center.set(0.5, 0.5);
      
      // Atualiza o material de madeira com a textura carregada
      MATS.wood = (length, depth, rotateGrain = false) => {
        const texClone = tex.clone();
        texClone.wrapS = texClone.wrapT = THREE.RepeatWrapping;
        texClone.repeat.set(length / 500, depth / 500);
        texClone.center.set(0.5, 0.5);
        texClone.rotation = rotateGrain ? Math.PI / 2 : 0;
        texClone.needsUpdate = true;
        return new THREE.MeshStandardMaterial({ map: texClone });
      };
      
      // Reconstrói o móvel com a nova textura
      if (shelfGroup) {
        rebuildShelf();
      }
    },
    undefined,
    err => {
      console.warn('Falha ao carregar textura de madeira, usando cor sólida:', err);
      // Mantém o material de cor sólida como fallback
    }
  );

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
  
  // Eventos básicos
  const btnUpdate = document.getElementById('btnUpdate');
  if (btnUpdate) btnUpdate.addEventListener('click', upd);
  
  const btnExport = document.getElementById('btnExport');
  if (btnExport) btnExport.addEventListener('click', exportGLTF);
  
  document.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('change', upd);
  });
  
  // Listener especial para o checkbox da grade
  const gridCheckbox = document.getElementById('grid');
  if (gridCheckbox) {
    gridCheckbox.addEventListener('change', updateGridVisibility);
  }
  
  // Eventos para biblioteca de presets
  const saveBtn = document.getElementById('btnSavePreset');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveCurrentPreset);
  }
  
  // Evento para limpar cena
  const clearBtn = document.getElementById('btnClearScene');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearScene);
  }
  
  // Adiciona o botão "Criar Móvel" na interface
  const toggleMainBtn = document.getElementById('btnToggleMainFurniture');
  if (toggleMainBtn) {
    toggleMainBtn.addEventListener('click', toggleMainFurniture);
  } else {
    // Se o botão não existe, vamos criá-lo
    const ui = document.getElementById('ui');
    if (ui) {
      const btnContainer = document.createElement('div');
      btnContainer.style.marginTop = '15px';
      btnContainer.style.marginBottom = '15px';
      btnContainer.style.textAlign = 'center';
      
      const btn = document.createElement('button');
      btn.id = 'btnToggleMainFurniture';
      btn.textContent = 'Criar Móvel';
      btn.style.padding = '8px 15px';
      btn.style.backgroundColor = '#4CAF50';
      btn.style.color = 'white';
      btn.style.border = 'none';
      btn.style.borderRadius = '4px';
      btn.style.fontWeight = 'bold';
      btn.addEventListener('click', toggleMainFurniture);
      
      btnContainer.appendChild(btn);
      
      // Insere após os controles principais, antes da lista de peças
      const partsList = document.getElementById('partsList');
      if (partsList) {
        ui.insertBefore(btnContainer, partsList);
      } else {
        ui.appendChild(btnContainer);
      }
    }
  }
  
  // Carrega os presets salvos
  loadPresets();
  
  // Inicializa lista de instâncias
  updateInstancesList();
  
  // Adiciona listeners para manipulação de instâncias
  setTimeout(() => {
    addInstanceInteractionListeners();
  }, 100);
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
    shelfGroup = null;
  }
  
  // Remove dimensões existentes
  if (dimGroup) {
    scene.remove(dimGroup);
    dimGroup.traverse(obj => {
      if (obj.element) obj.element.remove();
    });
    dimGroup = null;
  }
  
  // Apenas cria o móvel principal se showMainFurniture for true
  if (showMainFurniture) {
    // Não remove a grade aqui, ela é gerenciada separadamente
    shelfGroup = createShelfGroup(current);
    scene.add(shelfGroup);
    if (showDimensions) addDimensions(current); // Só adiciona cotas se ativado
  }
  
  // Atualiza lista de peças (pode estar vazia se não houver móvel principal)
  generatePartsList();
}

function createShelfGroup(p){
  const {
    W,H,D,boxTh,doorTh,
    legH,legD,shelves,doors,doorMargin,
    footOffset,handles,backPanel,grid,material
  } = p;

  // Atualiza a visibilidade da grade ao invés de recriar
  updateGridVisibility();

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
  try {
    if (mat === 'wood' && MATS.wood) {
      material = MATS.wood(mainDim, secDim, rotateGrain);
    } else if (mat && mat.startsWith('custom_') && CUSTOM_TEXTURES[mat]) {
      material = CUSTOM_TEXTURES[mat](mainDim, secDim, rotateGrain, isDoor);
    } else if (MATS[mat]) {
      material = MATS[mat]();
    } else {
      // Fallback para material básico
      material = new THREE.MeshStandardMaterial({ color: 0xcd853f });
    }
  } catch (err) {
    console.warn('Error creating material, using fallback:', err);
    material = new THREE.MeshStandardMaterial({ color: 0xcd853f });
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
  // Remove outlines existentes para evitar duplicações
  group.traverse(o => {
    if(o.isLineSegments && o.userData.isOutline) {
      if(o.parent) o.parent.remove(o);
    }
  });
  
  // Primeiro, calcula a bounding box do móvel inteiro
  const bbox = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  
  // Cria uma geometria de caixa com o tamanho exato do móvel
  const boxGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  
  // Cria linhas apenas para as bordas da caixa
  const edges = new THREE.EdgesGeometry(boxGeometry);
  const line = new THREE.LineSegments(
    edges, 
    new THREE.LineBasicMaterial({color: 0x000000, linewidth: 1})
  );
  
  // Marca como outline para poder remover depois
  line.userData.isOutline = true;
  
  // Posiciona a caixa no centro do móvel
  line.position.copy(center);
  
  // Adiciona ao grupo
  group.add(line);
  
  // Também adiciona linhas para cada componente individual (opcional)
  group.traverse(o => {
    if(o.isMesh && o.name !== 'Puxador'){
      const edges = new THREE.EdgesGeometry(o.geometry);
      const line = new THREE.LineSegments(
        edges, 
        new THREE.LineBasicMaterial({color: 0x222222, linewidth: 0.5, opacity: 0.3, transparent: true})
      );
      line.userData.isOutline = true;
      o.add(line);
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  TWEEN.update();
  
  // Rotação automática
  if (current.autoRotate && shelfGroup) {
    shelfGroup.rotation.y += 0.005;
  }
  
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function exportGLTF() {
  if (!showMainFurniture || !shelfGroup) {
    showPresetFeedback('Nenhum móvel para exportar! Clique em "Criar Móvel" primeiro.', 'error');
    return;
  }

  const exporter = new GLTFExporter();
  const options = {
    binary: true,
    includeCustomExtensions: false,
    forceIndices: false,
    forcePowerOfTwoTextures: false,
    maxTextureSize: 4096,
    animations: [],
    onlyVisible: true
  };

  // Clona o grupo para evitar modificar o original
  const clonedGroup = shelfGroup.clone();
  
  // Remove linhas de contorno da exportação
  clonedGroup.traverse(obj => {
    if (obj.isLineSegments || obj.isLine) {
      obj.parent.remove(obj);
    }
  });

  exporter.parse(
    clonedGroup,
    result => {
      const blob = new Blob([result], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'movel_3d.glb';
      a.click();
      URL.revokeObjectURL(url);
    },
    error => {
      console.error('Erro na exportação GLTF:', error);
      alert('Erro ao exportar o modelo!');
    },
    options
  );
}

// ===== BIBLIOTECA DE PRESETS =====

// Carrega presets do localStorage
function loadPresets() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    console.log('Dados salvos no localStorage:', saved);
    
    if (saved) {
      presetsData = JSON.parse(saved);
      console.log('Presets carregados:', presetsData);
      
      // Converte presets do formato antigo se necessário
      convertLegacyPresets();
    } else {
      console.log('Nenhum preset encontrado no localStorage');
      presetsData = [];
    }
  } catch (err) {
    console.error('Erro ao carregar presets:', err);
    presetsData = [];
  }
  
  // Só atualiza a UI se os elementos existirem
  setTimeout(() => {
    if (document.getElementById('presets-list')) {
      updatePresetsUI();
    }
  }, 100);
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
  // Verifica se tem um móvel principal para salvar
  if (!showMainFurniture || !shelfGroup) {
    showPresetFeedback('Não há móvel para salvar! Clique em "Criar Móvel" primeiro.', 'error');
    return;
  }
  
  const nameInput = document.getElementById('preset-name');
  let presetName = nameInput.value.trim();
  
  if (!presetName) {
    showPresetFeedback('Digite um nome para o preset!', 'error');
    return;
  }
  
  // Verifica se já existe um preset com esse nome
  const existingIndex = presetsData.findIndex(p => p.name === presetName);
  
  if (existingIndex !== -1) {
    if (!confirm(`Já existe um preset chamado "${presetName}". Deseja substituí-lo?`)) {
      return;
    }
  }
  
  // Captura thumbnail do móvel atual
  const thumbnail = captureShelfThumbnail();
  
  const preset = {
    id: existingIndex !== -1 ? presetsData[existingIndex].id : Date.now().toString(),
    name: presetName,
    params: { ...current },
    timestamp: new Date().toISOString(),
    thumbnail: thumbnail
  };
  
  if (existingIndex !== -1) {
    presetsData[existingIndex] = preset;
  } else {
    presetsData.push(preset);
  }
  
  savePresetsToStorage();
  updatePresetsUI();
  
  // Limpa o campo de nome
  nameInput.value = '';
  
  showPresetFeedback('Preset salvo com sucesso!');
}

// Deleta preset
function deletePreset(id) {
  const preset = presetsData.find(p => p.id === id);
  if (!preset) return;
  
  if (confirm(`Tem certeza que deseja excluir o preset "${preset.name}"?`)) {
    presetsData = presetsData.filter(p => p.id !== id);
    savePresetsToStorage();
    updatePresetsUI();
    showPresetFeedback('Preset excluído!');
  }
}

// Renomeia preset
function renamePreset(id) {
  const preset = presetsData.find(p => p.id === id);
  if (!preset) return;
  
  const newName = prompt('Novo nome para o preset:', preset.name);
  if (!newName || newName.trim() === '') return;
  
  const trimmedName = newName.trim();
  
  // Verifica se já existe outro preset com esse nome
  const existing = presetsData.find(p => p.name === trimmedName && p.id !== id);
  if (existing) {
    alert('Já existe um preset com esse nome!');
    return;
  }
  
  preset.name = trimmedName;
  savePresetsToStorage();
  updatePresetsUI();
  showPresetFeedback('Preset renomeado!');
}

// Importa preset (carrega no móvel principal)
function importPreset(id) {
  const preset = presetsData.find(p => p.id === id);
  if (!preset) return;
  
  // Aplica os parâmetros do preset aos controles da UI
  Object.entries(preset.params).forEach(([key, value]) => {
    const element = document.getElementById(key === 'W' ? 'width' :
                                          key === 'H' ? 'height' :
                                          key === 'D' ? 'depth' :
                                          key === 'boxTh' ? 'boxThickness' :
                                          key === 'doorTh' ? 'doorThickness' :
                                          key === 'legH' ? 'legHeight' :
                                          key === 'legD' ? 'legDiameter' :
                                          key === 'doorMargin' ? 'doorMargin' :
                                          key === 'footOffset' ? 'footOffset' :
                                          key);
    
    if (element) {
      if (element.type === 'checkbox') {
        element.checked = value;
      } else {
        element.value = value;
      }
    }
  });
  
  // Atualiza o móvel
  tweenUpdate(current, readUI());
  showPresetFeedback(`Preset "${preset.name}" carregado!`);
}

// Importa como nova instância na cena
function importAsInstance(id) {
  const preset = presetsData.find(p => p.id === id);
  if (!preset) return;
  
  // Cria uma nova instância do móvel com os parâmetros do preset
  const furnitureGroup = createShelfGroup(preset.params);
  furnitureGroup.name = `Instance_${preset.name}_${Date.now()}`;
  
  // Posiciona a instância ligeiramente deslocada
  const offset = furnitureInstances.length * 1500; // 1.5m de distância entre instâncias
  furnitureGroup.position.set(offset, 0, 0);
  
  scene.add(furnitureGroup);
  
  // Adiciona à lista de instâncias
  const instance = {
    id: Date.now().toString(),
    name: preset.name,
    group: furnitureGroup,
    params: { ...preset.params }
  };
  
  furnitureInstances.push(instance);
  updateInstancesList();
  
  showPresetFeedback(`"${preset.name}" adicionado à cena!`);
}

// Importa como nova instância na cena (versão compatível)
function importModuleInstance(presetName) {
  console.log('Tentando importar preset como instância:', presetName);
  
  if (!presetsData || presetsData.length === 0) {
    showPresetFeedback('Nenhum preset disponível!', 'error');
    return;
  }
  
  const preset = presetsData.find(p => p.name === presetName);
  if (!preset) {
    showPresetFeedback(`Preset "${presetName}" não encontrado!`, 'error');
    return;
  }
  
  if (!preset.params && !preset.data) {
    showPresetFeedback(`Dados do preset "${presetName}" são inválidos!`, 'error');
    return;
  }
  
  console.log('Importando instância do preset:', presetName);
  
  try {
    // Usa preset.params (novo formato) ou preset.data (formato antigo)
    const presetParams = preset.params || preset.data;
    
    // Cria uma nova instância do móvel com os parâmetros do preset
    const furnitureGroup = createShelfGroup(presetParams);
    furnitureGroup.name = `Instance_${presetName}_${Date.now()}`;
    
    // Posiciona a instância ligeiramente deslocada
    const offset = furnitureInstances.length * 1500; // 1.5m de distância entre instâncias
    furnitureGroup.position.set(offset, 0, 0);
    
    scene.add(furnitureGroup);
    
    // Adiciona à lista de instâncias
    const instance = {
      id: Date.now().toString(),
      name: presetName,
      group: furnitureGroup,
      params: { ...presetParams }
    };
    
    furnitureInstances.push(instance);
    updateInstancesList();
    
    showPresetFeedback(`"${presetName}" adicionado à cena!`);
    return instance;
  } catch (err) {
    console.error('Erro ao importar instância:', err);
    showPresetFeedback(`Erro ao importar: ${err.message}`, 'error');
    return null;
  }
}

// Atualiza a UI da biblioteca de presets
function updatePresetsUI() {
  const listContainer = document.getElementById('presets-list');
  if (!listContainer) return;
  
  listContainer.innerHTML = '';
  
  if (presetsData.length === 0) {
    listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">Nenhum preset salvo</div>';
    return;
  }
  
  presetsData.forEach(preset => {
    const item = document.createElement('div');
    item.className = 'preset-item';
    
    // Thumbnail
    const thumbnailEl = preset.thumbnail 
      ? `<img src="${preset.thumbnail}" class="preset-thumbnail" alt="Thumbnail">`
      : '<div class="preset-thumbnail-placeholder">📦</div>';
    
    item.innerHTML = `
      <div class="preset-info" onclick="importPreset('${preset.id}')">
        ${thumbnailEl}
        <span class="preset-name">${preset.name}</span>
      </div>
      <div class="preset-actions">
        <button class="preset-btn" onclick="importAsInstance('${preset.id}')" title="Adicionar à cena">➕</button>
        <button class="preset-btn" onclick="renamePreset('${preset.id}')" title="Renomear">✏️</button>
        <button class="preset-btn" onclick="deletePreset('${preset.id}')" title="Excluir">🗑️</button>
      </div>
    `;
    
    listContainer.appendChild(item);
  });
}

// ===== SISTEMA DE MÚLTIPLAS INSTÂNCIAS =====

// Limpa a cena (remove todas as instâncias)
function clearScene() {
  if (furnitureInstances.length === 0) {
    showPresetFeedback('A cena já está vazia!');
    return;
  }
  
  if (confirm('Tem certeza que deseja remover todos os móveis da cena?')) {
    furnitureInstances.forEach(instance => {
      scene.remove(instance.group);
      // Dispose geometry and materials
      instance.group.traverse(obj => {
        if (obj.isMesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    });
    
    furnitureInstances = [];
    selectedInstance = null;
    updateInstancesList();
    hideTransformPanel();
    showPresetFeedback('Cena limpa!');
  }
}

// Atualiza a lista de instâncias na UI
function updateInstancesList() {
  const listContainer = document.getElementById('instances-list');
  if (!listContainer) return;
  
  listContainer.innerHTML = '';
  
  if (furnitureInstances.length === 0) {
    listContainer.innerHTML = '<div style="padding: 10px; text-align: center; color: #666;">Nenhum móvel na cena</div>';
    return;
  }
  
  furnitureInstances.forEach((instance, index) => {
    const item = document.createElement('div');
    item.className = 'instance-item';
    item.innerHTML = `
      <span class="instance-name">${instance.name} (${index + 1})</span>
      <div class="instance-actions">
        <button class="btn-select" onclick="selectInstance('${instance.id}')">Selecionar</button>
        <button class="btn-remove" onclick="removeInstanceById('${instance.id}')">×</button>
      </div>
    `;
    listContainer.appendChild(item);
  });
}

// Seleciona uma instância
function selectInstance(id) {
  // Primeiro, remove o destaque da instância anteriormente selecionada
  if (selectedInstance) {
    // Restaura a aparência normal da instância anterior
    selectedInstance.group.traverse(obj => {
      if (obj.isLineSegments && obj.userData.isSelectionHighlight) {
        if (obj.parent) obj.parent.remove(obj);
      }
    });
  }
  
  selectedInstance = furnitureInstances.find(inst => inst.id === id);
  if (selectedInstance) {
    showTransformPanel();
    
    // Adiciona um destaque visual à nova instância selecionada
    const bbox = new THREE.Box3().setFromObject(selectedInstance.group);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    
    // Cria uma caixa de seleção ligeiramente maior para destacar
    const boxGeometry = new THREE.BoxGeometry(size.x + 10, size.y + 10, size.z + 10);
    const edges = new THREE.EdgesGeometry(boxGeometry);
    const line = new THREE.LineSegments(
      edges, 
      new THREE.LineBasicMaterial({
        color: 0x00ff00,  // Verde para destaque
        linewidth: 2,
        opacity: 0.8,
        transparent: true
      })
    );
    
    // Marca como highlight para poder remover depois
    line.userData.isSelectionHighlight = true;
    
    // Posiciona no centro da instância
    line.position.copy(center.clone().sub(selectedInstance.group.position));
    
    // Adiciona à instância
    selectedInstance.group.add(line);
    
    // Move a câmera para focar na instância
    controls.target.copy(selectedInstance.group.position);
    controls.update();
  }
}

// Remove instância por ID
function removeInstanceById(id) {
  const instance = furnitureInstances.find(inst => inst.id === id);
  if (!instance) return;
  
  if (confirm(`Remover "${instance.name}" da cena?`)) {
    scene.remove(instance.group);
    // Dispose resources
    instance.group.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(mat => mat.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    
    furnitureInstances = furnitureInstances.filter(inst => inst.id !== id);
    
    if (selectedInstance && selectedInstance.id === id) {
      // Remove o destaque da instância selecionada
      selectedInstance.group.traverse(obj => {
        if (obj.isLineSegments && obj.userData.isSelectionHighlight) {
          if (obj.parent) obj.parent.remove(obj);
        }
      });
      selectedInstance = null;
      hideTransformPanel();
    }
    
    updateInstancesList();
    showPresetFeedback('Instância removida!');
  }
}

// Mostra o painel de transformação
function showTransformPanel() {
  const panel = document.getElementById('instance-transform-panel');
  if (!panel || !selectedInstance) return;
  
  panel.style.display = 'block';
  
  // Preenche os valores atuais
  const pos = selectedInstance.group.position;
  const rot = selectedInstance.group.rotation;
  
  document.getElementById('instance-pos-x').value = Math.round(pos.x);
  document.getElementById('instance-pos-y').value = Math.round(pos.y);
  document.getElementById('instance-pos-z').value = Math.round(pos.z);
  document.getElementById('instance-rot-x').value = Math.round(rot.x * 180 / Math.PI);
  document.getElementById('instance-rot-y').value = Math.round(rot.y * 180 / Math.PI);
  document.getElementById('instance-rot-z').value = Math.round(rot.z * 180 / Math.PI);
}

// Esconde o painel de transformação
function hideTransformPanel() {
  const panel = document.getElementById('instance-transform-panel');
  if (panel) {
    panel.style.display = 'none';
  }
}

// Aplica transformação da instância selecionada
function applyInstanceTransform() {
  if (!selectedInstance) return;
  
  const posX = parseFloat(document.getElementById('instance-pos-x').value) || 0;
  const posY = parseFloat(document.getElementById('instance-pos-y').value) || 0;
  const posZ = parseFloat(document.getElementById('instance-pos-z').value) || 0;
  const rotX = parseFloat(document.getElementById('instance-rot-x').value) || 0;
  const rotY = parseFloat(document.getElementById('instance-rot-y').value) || 0;
  const rotZ = parseFloat(document.getElementById('instance-rot-z').value) || 0;
  
  selectedInstance.group.position.set(posX, posY, posZ);
  selectedInstance.group.rotation.set(
    rotX * Math.PI / 180,
    rotY * Math.PI / 180,
    rotZ * Math.PI / 180
  );
  
  showPresetFeedback('Transformação aplicada!');
}

// Duplica a instância selecionada
function duplicateInstance() {
  if (!selectedInstance) return;
  
  const duplicated = createShelfGroup(selectedInstance.params);
  duplicated.name = `${selectedInstance.name}_copy_${Date.now()}`;
  
  // Posiciona a cópia ligeiramente deslocada
  const pos = selectedInstance.group.position;
  duplicated.position.set(pos.x + 500, pos.y, pos.z + 500);
  duplicated.rotation.copy(selectedInstance.group.rotation);
  
  scene.add(duplicated);
  
  const newInstance = {
    id: Date.now().toString(),
    name: selectedInstance.name + ' (cópia)',
    group: duplicated,
    params: { ...selectedInstance.params }
  };
  
  furnitureInstances.push(newInstance);
  updateInstancesList();
  
  showPresetFeedback('Instância duplicada!');
}

// Remove a instância selecionada
function removeInstance() {
  if (!selectedInstance) return;
  
  removeInstanceById(selectedInstance.id);
}

// Adiciona listeners para interação com instâncias
function addInstanceInteractionListeners() {
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mouseup', onMouseUp);
}

function onMouseDown(event) {
  mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
  mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  
  // Verifica se clicou em alguma instância
  const instanceGroups = furnitureInstances.map(inst => inst.group);
  const intersects = raycaster.intersectObjects(instanceGroups, true);
  
  if (intersects.length > 0) {
    // Encontra a instância clicada
    const clickedGroup = intersects[0].object.parent;
    let targetInstance = null;
    
    // Busca recursivamente pelo grupo pai correto
    let searchObj = intersects[0].object;
    while (searchObj && !targetInstance) {
      targetInstance = furnitureInstances.find(inst => inst.group === searchObj);
      searchObj = searchObj.parent;
    }
    
    if (targetInstance) {
      // Seleciona a instância ao clicar
      if (selectedInstance !== targetInstance) {
        // Se selecionando uma instância diferente da atual, chama selectInstance
        selectInstance(targetInstance.id);
      }
      
      // Se estiver com Shift pressionado, inicia o arrasto
      if (event.shiftKey) {
        isDragging = true;
        
        // Configura o plano de arrastar
        const normal = new THREE.Vector3(0, 1, 0);
        dragPlane.setFromNormalAndCoplanarPoint(normal, targetInstance.group.position);
        
        // Calcular o ponto de interseção inicial para manter o offset do clique
        const initialIntersection = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragPlane, initialIntersection);
        
        // Armazenar o offset entre a posição do clique e o centro do objeto
        selectedInstance.dragOffset = initialIntersection.clone().sub(targetInstance.group.position);
        
        controls.enabled = false;
      }
    } else if (!event.shiftKey) {
      // Se clicou fora de qualquer instância, desseleciona
      if (selectedInstance) {
        // Remove o destaque da instância selecionada
        selectedInstance.group.traverse(obj => {
          if (obj.isLineSegments && obj.userData.isSelectionHighlight) {
            if (obj.parent) obj.parent.remove(obj);
          }
        });
        selectedInstance = null;
        hideTransformPanel();
      }
    }
  } else if (!event.shiftKey) {
    // Se clicou fora de qualquer instância, desseleciona
    if (selectedInstance) {
      // Remove o destaque da instância selecionada
      selectedInstance.group.traverse(obj => {
        if (obj.isLineSegments && obj.userData.isSelectionHighlight) {
          if (obj.parent) obj.parent.remove(obj);
        }
      });
      selectedInstance = null;
      hideTransformPanel();
    }
  }
}

function onMouseMove(event) {
  if (!isDragging || !selectedInstance) return;
  
  mouse.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
  mouse.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  
  const intersection = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
    // Calcula a nova posição do móvel com base no offset do ponto de clique
    const newPosition = intersection.clone().sub(selectedInstance.dragOffset);
    
    // Atualiza a posição do grupo
    selectedInstance.group.position.copy(newPosition);
    
    // Atualiza a caixa de seleção destacada para acompanhar o móvel
    selectedInstance.group.traverse(obj => {
      if (obj.isLineSegments && obj.userData.isSelectionHighlight) {
        // A caixa de seleção já está anexada ao grupo, então se move junto
        // Apenas garantimos que está centralizada no grupo
        const bbox = new THREE.Box3().setFromObject(selectedInstance.group);
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        
        // Calcula o offset relativo à posição do grupo
        const localCenter = center.clone().sub(selectedInstance.group.position);
        obj.position.copy(localCenter);
      }
    });
    
    // Atualiza os campos de posição em tempo real
    showTransformPanel();
  }
}

function onMouseUp(event) {
  if (isDragging) {
    isDragging = false;
    controls.enabled = true;
    
    // Limpar o dragOffset quando terminar de arrastar
    if (selectedInstance) {
      delete selectedInstance.dragOffset;
    }
  }
}

// Captura thumbnail do móvel atual
function captureShelfThumbnail() {
  if (!shelfGroup) return null;
  
  try {
    // Salva estado atual da câmera
    const originalPosition = camera.position.clone();
    const originalRotation = camera.rotation.clone();
    const originalTarget = controls.target.clone();
    const originalRotationY = shelfGroup.rotation.y;
    
    // Configura câmera para captura
    const box = new THREE.Box3().setFromObject(shelfGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 2;
    
    camera.position.set(center.x + distance, center.y + distance * 0.5, center.z + distance);
    camera.lookAt(center);
    controls.target.copy(center);
    
    // Rotaciona o móvel para melhor visualização
    shelfGroup.rotation.y = Math.PI / 6;
    
    // Renderiza em tamanho menor para thumbnail
    const originalSize = { 
      width: renderer.domElement.width, 
      height: renderer.domElement.height 
    };
    renderer.setSize(200, 200);
    renderer.render(scene, camera);
    
    // Captura como imagem
    const thumbnail = renderer.domElement.toDataURL('image/jpeg', 0.8);
    
    // Restaura tamanho do renderer
    renderer.setSize(originalSize.width, originalSize.height);
    
    // Restaura estado da câmera
    camera.position.copy(originalPosition);
    camera.rotation.copy(originalRotation);
    controls.target.copy(originalTarget);
    shelfGroup.rotation.y = originalRotationY;
    controls.update();
    
    return thumbnail;
  } catch (err) {
    console.warn('Erro ao capturar thumbnail, tentando método alternativo:', err);
    
    // Método alternativo mais simples
    try {
      const originalRotationY = shelfGroup.rotation.y;
      shelfGroup.rotation.y = Math.PI / 6;
      renderer.render(scene, camera);
      const thumbnail = renderer.domElement.toDataURL('image/jpeg', 0.6);
      shelfGroup.rotation.y = originalRotationY;
      renderer.render(scene, camera);
      return thumbnail;
    } catch (err2) {
      console.warn('Falha total na captura de thumbnail:', err2);
      return null;
    }
  }
}

// Mostra mensagem de feedback para presets
function showPresetFeedback(message, type = 'success') {
  let feedback = document.getElementById('presetFeedback');
  if (!feedback) {
    feedback = document.createElement('div');
    feedback.id = 'presetFeedback';
    feedback.style.position = 'fixed';
    feedback.style.top = '10px';
    feedback.style.right = '320px'; // Ao lado do painel da biblioteca
    feedback.style.padding = '10px 15px';
    feedback.style.borderRadius = '4px';
    feedback.style.zIndex = 1000;
    feedback.style.fontSize = '14px';
    feedback.style.fontWeight = 'bold';
    feedback.style.display = 'none';
    document.body.appendChild(feedback);
  }
  
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

// ===== COTAS E DIMENSÕES =====

function addDimensions(p) {
  if (!shelfGroup) return;
  
  if (dimGroup) {
    scene.remove(dimGroup);
    dimGroup.traverse(obj => {
      if (obj.element) obj.element.remove();
    });
  }
  
  labelRenderer.domElement.innerHTML = '';
  dimGroup = new THREE.Group();
  
  const { W, H, D, legH, boxTh, shelves } = p;
  const y0 = legH;
  const innerH = H - legH;
  const sideH = innerH - 2*boxTh;
  const gapV = (sideH - shelves*boxTh)/(shelves+1);
  
  // Cotas principais
  drawDim(
    new THREE.Vector3(-W/2, y0, D/2 + 100),
    new THREE.Vector3(W/2, y0, D/2 + 100),
    new THREE.Vector3(0, 0, 0),
    `${W}mm`
  );
  
  drawDim(
    new THREE.Vector3(W/2 + 100, y0, -D/2),
    new THREE.Vector3(W/2 + 100, y0 + H, -D/2),
    new THREE.Vector3(0, 0, 0),
    `${H}mm`
  );
  
  // Dimensões entre prateleiras
  if (shelves > 0) {
    // Lateral direita para dimensões verticais
    const dimX = W/2 + 50; // 50mm à direita do móvel
    
    // Distância até a primeira prateleira
    const firstShelfY = y0 + boxTh + gapV;
    drawDim(
      new THREE.Vector3(dimX, y0 + boxTh, 0),
      new THREE.Vector3(dimX, firstShelfY, 0),
      new THREE.Vector3(0, 0, 0),
      `${Math.round(gapV)}mm`
    );
    
    // Distância entre prateleiras
    for (let i = 0; i < shelves - 1; i++) {
      const startY = y0 + boxTh + gapV + i * (boxTh + gapV) + boxTh;
      const endY = startY + gapV;
      drawDim(
        new THREE.Vector3(dimX, startY, 0),
        new THREE.Vector3(dimX, endY, 0),
        new THREE.Vector3(0, 0, 0),
        `${Math.round(gapV)}mm`
      );
    }
    
    // Distância da última prateleira até o topo
    const lastShelfTopY = y0 + boxTh + gapV + (shelves - 1) * (boxTh + gapV) + boxTh;
    drawDim(
      new THREE.Vector3(dimX, lastShelfTopY, 0),
      new THREE.Vector3(dimX, y0 + innerH, 0),
      new THREE.Vector3(0, 0, 0),
      `${Math.round(gapV)}mm`
    );
  }
  
  scene.add(dimGroup);
}

function drawDim(p1, p2, off, text) {
  const mat = new THREE.LineBasicMaterial({ color: 0x000 });
  const a = p1.clone().add(off), b = p2.clone().add(off);
  dimGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat));
  
  const perp = new THREE.Vector3().subVectors(p2, p1).normalize();
  const dir = new THREE.Vector3(-perp.y, perp.x, perp.z).multiplyScalar(5);
  dimGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([a, a.clone().add(dir), b, b.clone().add(dir)]), mat));
  
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = text;
  const lbl = new CSS2DObject(div);
  lbl.position.copy(mid);
  dimGroup.add(lbl);
}

function toggleDimensions(force) {
  if (typeof force === 'boolean') {
    showDimensions = force;
  } else {
    showDimensions = !showDimensions;
  }
  
  if (shelfGroup) {
    if (showDimensions) {
      addDimensions(current);
    } else if (dimGroup) {
      scene.remove(dimGroup);
      dimGroup.traverse(obj => {
        if (obj.element) obj.element.remove();
      });
      labelRenderer.domElement.innerHTML = '';
    }
  }
}

function generatePartsList() {
  const listElement = document.getElementById('partsList');
  if (!listElement) return;
  
  // Limpa a lista de peças
  listElement.innerHTML = '<h3>Lista de Peças</h3>';
  
  // Se não houver móvel principal, mostra mensagem informativa
  if (!shelfGroup) {
    listElement.innerHTML += '<div style="padding:10px; color:#666; text-align:center;">Nenhum móvel em edição.<br>Clique em "Criar Móvel" para começar.</div>';
    return;
  }
  
  const parts = {};
  const dimensions = {};
  
  shelfGroup.traverse(obj => {
    if (obj.isMesh && obj.name && obj.name !== 'Puxador') {
      // Armazena a contagem
      parts[obj.name] = (parts[obj.name] || 0) + 1;
      
      // Armazena as dimensões (apenas uma vez para cada tipo)
      if (!dimensions[obj.name]) {
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        // Arredonda para mm inteiros
        dimensions[obj.name] = {
          width: Math.round(size.x),
          height: Math.round(size.y),
          depth: Math.round(size.z)
        };
      }
    }
  });
  
  // Cria tabela para exibir de forma mais organizada
  let html = '<table style="width:100%; margin-top:10px;">';
  html += '<tr><th>Peça</th><th>Qtd</th><th>Dimensões (mm)</th></tr>';
  
  Object.entries(parts).forEach(([name, count]) => {
    const dim = dimensions[name];
    const dimText = dim ? `${dim.width} × ${dim.height} × ${dim.depth}` : '—';
    html += `<tr><td>${name}</td><td>${count}</td><td>${dimText}</td></tr>`;
  });
  
  html += '</table>';
  listElement.innerHTML += html;
}

// ===== EVENTOS DE TECLADO E MOUSE =====

function onKeyDown(event) {
  if (event.key === 'Control') {
    ctrlPressed = true;
  }
}

function onKeyUp(event) {
  if (event.key === 'Control') {
    ctrlPressed = false;
  }
}

function onDocumentClick(evt) {
  if (!ctrlPressed || !shelfGroup) return;
  
  // Ajuste para levar em conta o offset do container do canvas
  const canvas = renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const offsetX = evt.clientX - rect.left;
  const offsetY = evt.clientY - rect.top;
  
  mouse.x = (offsetX / canvas.clientWidth) * 2 - 1;
  mouse.y = -(offsetY / canvas.clientHeight) * 2 + 1;
  
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(shelfGroup.children, true);
  
  console.log('Clique com Ctrl detectado, intersects:', intersects.length);
  
  if (intersects.length > 0) {
    let door = intersects[0].object;
    let found = false;
    
    // Busca recursivamente até encontrar um objeto com userData.open
    while (door && !found) {
      if (door.userData && door.userData.hasOwnProperty('open')) {
        found = true;
        break;
      }
      door = door.parent;
    }
    
    if (found && door) {
      console.log('Porta encontrada:', door);
      const ud = door.userData;
      const targetRotation = ud.open ? 0 : ud.twist;
      
      new TWEEN.Tween(door.rotation)
        .to({ y: targetRotation }, 800)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .start();
      
      ud.open = !ud.open;
      console.log('Porta ' + (ud.open ? 'aberta' : 'fechada'));
    }
  }
}

function get(id) { return document.getElementById(id).value; }
function chk(id) { return document.getElementById(id).checked; }

// Expor funções globalmente para onclick no HTML
window.importPreset = importPreset;
window.importAsInstance = importAsInstance;
window.importModuleInstance = importModuleInstance;
window.deletePreset = deletePreset;
window.renamePreset = renamePreset;
window.selectInstance = selectInstance;
window.removeInstanceById = removeInstanceById;
window.applyInstanceTransform = applyInstanceTransform;
window.duplicateInstance = duplicateInstance;
window.removeInstance = removeInstance;
window.toggleDimensions = toggleDimensions;

// Converte presets do formato antigo para o novo formato
function convertLegacyPresets() {
  let hasChanges = false;
  
  presetsData.forEach(preset => {
    // Se tem 'data' mas não tem 'params', converte
    if (preset.data && !preset.params) {
      preset.params = preset.data;
      delete preset.data;
      hasChanges = true;
      console.log(`Convertido preset legacy: ${preset.name}`);
    }
    
    // Se não tem ID, adiciona um
    if (!preset.id) {
      preset.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      hasChanges = true;
    }
  });
  
  if (hasChanges) {
    savePresetsToStorage();
    console.log('Presets convertidos para novo formato');
  }
}

// Chama a conversão ao carregar os presets
loadPresets();
convertLegacyPresets();

// Função para mostrar/esconder o móvel principal
function toggleMainFurniture() {
  // Inverte o estado atual
  showMainFurniture = !showMainFurniture;
  
  // Atualiza o texto do botão com base no estado
  const btn = document.getElementById('btnToggleMainFurniture');
  if (btn) {
    if (showMainFurniture) {
      btn.textContent = 'Remover Móvel Principal';
      btn.style.backgroundColor = '#f44336'; // Vermelho
    } else {
      btn.textContent = 'Criar Móvel';
      btn.style.backgroundColor = '#4CAF50'; // Verde
    }
  }
  
  // Reconstrói o móvel com o novo estado
  rebuildShelf();
  
  // Mensagem de feedback
  if (showMainFurniture) {
    showPresetFeedback('Móvel principal criado!');
  } else {
    showPresetFeedback('Móvel principal removido.');
  }
}

// Expor função globalmente para ser acessível pelo HTML
window.toggleMainFurniture = toggleMainFurniture;