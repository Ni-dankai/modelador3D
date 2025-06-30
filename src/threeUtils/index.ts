import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// exporta só o que o Canvas3D precisa:
export function createPanel(w: number, h: number, d: number, mat: string, MATS: any) {
  const geo = new RoundedBoxGeometry(w, h, d, 2, 2);
  const material = MATS[mat](w, d);
  return new THREE.Mesh(geo, material);
}

export function createHandles(doorMesh, isLeftDoor, handleGLTF: THREE.Object3D) {
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
    const box0  = new THREE.Box3().setFromObject(grip);
    const size0 = box0.getSize(new THREE.Vector3());
    grip.scale.multiplyScalar((h * 0.2) / size0.x);
  
    // 3) recentrar pivô
    const container = new THREE.Group();
    container.name = 'HandlePivot';
    container.add(grip);
    const box1 = new THREE.Box3().setFromObject(grip);
    const center = new THREE.Vector3();
    box1.getCenter(center);
    grip.position.sub(center);
  
    // 4) rotação
    const sideX = isLeftDoor ? 1 : -1;
    container.rotation.set(
      -Math.PI / 2,
       sideX * Math.PI / 2,
       Math.PI
    );
  
    // 5) medidas e posição
    const gripW = size0.x * grip.scale.x;
    const posX  = sideX * (w / 2 - gripW / 2 - 10);
    const posY  = h * 0.35;
    const posZ  = th / 2;
  
    container.position.set(posX, posY, posZ);
    doorMesh.add(container);
}

export function addOutline(group: THREE.Object3D) {
  group.traverse(o=>{
      if(o instanceof THREE.Mesh){
        const edges=new THREE.EdgesGeometry(o.geometry);
        const line=new THREE.LineSegments(edges,new THREE.LineBasicMaterial({color:0x000}));
        line.renderOrder=999;
        o.add(line);
      }
    });
}

export function createShelfGroup(params: any, MATS: any, handleGLTF: THREE.Object3D, scene: THREE.Scene) {
  const {
      W,H,D,boxTh,doorTh,
      legH,legD,shelves,doors,doorMargin,
      footOffset,handles,backPanel,grid,material
    } = params;
  
    if(grid){
      const gridHelper = new THREE.GridHelper(3000,30,0x444444,0xaaaaaa);
      scene.add(gridHelper);
    }
  
    const innerH = H - legH,
          sideH  = innerH - 2*boxTh,
          innerW = W - 2*boxTh,
          backTh = backPanel?2:0,
          gapV   = (sideH - shelves*boxTh)/(shelves+1);
  
    const group = new THREE.Group();
  
    // Base
    const base = createPanel(W,boxTh,D,material, MATS);
    base.name='Base';
    base.position.set(0, legH + boxTh/2, 0);
    group.add(base);
  
    // Tampo
    const top = createPanel(W,boxTh,D,material, MATS);
    top.name='Tampo';
    top.position.set(0, legH + boxTh + sideH + boxTh/2, 0);
    group.add(top);
  
    // Laterais
    ['Lateral','Lateral'].forEach((nm,i)=>{
      const m = createPanel(boxTh,sideH,D,material, MATS);
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
        const m=createPanel(secW,boxTh,shelfD,material, MATS);
        m.name='Prateleira';
        m.position.set(-innerW/2 + secW/2 + j*(secW+boxTh), y0, 0);
        group.add(m);
      }
    }
  
    // Divisórias & Portas
    if(doors>0){
      for(let i=1;i<doors;i++){
        const d=createPanel(boxTh,sideH,D-backTh,material, MATS);
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
  
        const door=createPanel(wdo,hdo,doorTh,material, MATS);
        door.name='Porta';
        door.position.x = isLeft? wdo/2 : -wdo/2;
        piv.add(door);
  
        if(handles) createHandles(door, isLeft, handleGLTF);
        group.add(piv);
      }
    }
  
    // Painel Traseiro
    if(backPanel){
      const b=createPanel(W-2*boxTh,sideH,2,material, MATS);
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