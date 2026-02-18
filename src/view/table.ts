import * as THREE from "three";  
import type { Card, GameState, Suit } from "../game/types";  
import { rankLabel } from "../game/calls";  
import { activeIndices } from "../game/engine";  
  
type CardMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;  
  
function suitSymbol(s: Suit): string {  
  if (s === "C") return "♣";  
  if (s === "D") return "♦";  
  if (s === "H") return "♥";  
  return "♠";  
}  
function suitColor(s: Suit): string {  
  return (s === "D" || s === "H") ? "#ef4444" : "#111827";  
}  
  
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {  
  ctx.beginPath();  
  ctx.moveTo(x + r, y);  
  ctx.arcTo(x + w, y, x + w, y + h, r);  
  ctx.arcTo(x + w, y + h, x, y + h, r);  
  ctx.arcTo(x, y + h, x, y, r);  
  ctx.arcTo(x, y, x + w, y, r);  
  ctx.closePath();  
}  
  
function makeCardTextureFace(card: Card): THREE.Texture {  
  const w = 256, h = 356;  
  const cv = document.createElement("canvas");  
  cv.width = w; cv.height = h;  
  const g = cv.getContext("2d")!;  
  
  g.fillStyle = "#f8fafc";  
  g.strokeStyle = "rgba(2,6,23,.18)";  
  g.lineWidth = 6;  
  roundRect(g, 10, 10, w - 20, h - 20, 22);  
  g.fill();  
  g.stroke();  
  
  const r = rankLabel(card.rank);  
  const s = suitSymbol(card.suit);  
  
  g.fillStyle = suitColor(card.suit);  
  g.font = "bold 46px ui-sans-serif, system-ui";  
  g.textAlign = "left";  
  g.textBaseline = "alphabetic";  
  g.fillText(r, 22, 60);  
  
  g.font = "bold 40px ui-sans-serif, system-ui";  
  g.fillText(s, 24, 104);  
  
  g.font = "bold 130px ui-sans-serif, system-ui";  
  g.textAlign = "center";  
  g.textBaseline = "middle";  
  g.fillText(s, w / 2, h / 2 + 6);  
  
  const tex = new THREE.CanvasTexture(cv);  
  tex.colorSpace = THREE.SRGBColorSpace;  
  tex.anisotropy = 4;  
  return tex;  
}  
  
function makeCardTextureBack(): THREE.Texture {  
  const w = 256, h = 356;  
  const cv = document.createElement("canvas");  
  cv.width = w; cv.height = h;  
  const g = cv.getContext("2d")!;  
  
  g.fillStyle = "#0b1220";  
  g.strokeStyle = "rgba(255,255,255,.18)";  
  g.lineWidth = 6;  
  roundRect(g, 10, 10, w - 20, h - 20, 22);  
  g.fill();  
  g.stroke();  
  
  g.strokeStyle = "rgba(56, 189, 248, .28)";  
  g.lineWidth = 3;  
  for (let y = 34; y < h - 34; y += 18) {  
    g.beginPath();  
    g.moveTo(30, y);  
    g.lineTo(w - 30, y);  
    g.stroke();  
  }  
  
  g.fillStyle = "rgba(255,255,255,.82)";  
  g.font = "bold 34px ui-sans-serif, system-ui";  
  g.textAlign = "center";  
  g.textBaseline = "middle";  
  g.fillText("POKER", w/2, h/2 - 18);  
  g.fillText("BULL", w/2, h/2 + 20);  
  
  const tex = new THREE.CanvasTexture(cv);  
  tex.colorSpace = THREE.SRGBColorSpace;  
  tex.anisotropy = 4;  
  return tex;  
}  
  
export class TableView {  
  private renderer: THREE.WebGLRenderer;  
  private scene: THREE.Scene;  
  private camera: THREE.PerspectiveCamera;  
  
  private backTex = makeCardTextureBack();  
  private faceTexCache = new Map<string, THREE.Texture>();  
  
  private cardsGroup = new THREE.Group();  
  private dealerMarker: THREE.Mesh;  
  private dirty = true;  
  private lastGs: GameState | null = null;  
  
  constructor(private canvas: HTMLCanvasElement) {  
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });  
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));  
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;  
  
    this.scene = new THREE.Scene();  
    this.scene.background = new THREE.Color("#070a0f");  
  
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);  
    this.camera.position.set(0, 7.2, 10.5);  
    this.camera.lookAt(0, 0, 0);  
  
    const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x0b0f14, 1.1);  
    this.scene.add(hemi);  
  
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);  
    dir.position.set(6, 9, 5);  
    this.scene.add(dir);  
  
    const table = new THREE.Mesh(  
      new THREE.CylinderGeometry(6.2, 6.2, 0.6, 64),  
      new THREE.MeshStandardMaterial({ color: 0x0f3d2e, roughness: 0.92, metalness: 0.04 })  
    );  
    table.position.y = -0.35;  
    this.scene.add(table);  
  
    const rim = new THREE.Mesh(  
      new THREE.TorusGeometry(6.25, 0.18, 16, 128),  
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.45, metalness: 0.25 })  
    );  
    rim.rotation.x = Math.PI / 2;  
    rim.position.y = -0.05;  
    this.scene.add(rim);  
  
    // subtle center decal  
    const decal = new THREE.Mesh(  
      new THREE.CircleGeometry(2.1, 48),  
      new THREE.MeshStandardMaterial({ color: 0x0b2f24, roughness: 1.0, metalness: 0.0 })  
    );  
    decal.rotation.x = -Math.PI / 2;  
    decal.position.y = -0.04;  
    this.scene.add(decal);  
  
    // dealer marker  
    this.dealerMarker = new THREE.Mesh(  
      new THREE.CylinderGeometry(0.26, 0.26, 0.06, 24),  
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.35, metalness: 0.2 })  
    );  
    this.dealerMarker.position.y = 0.02;  
    this.scene.add(this.dealerMarker);  
  
    this.scene.add(this.cardsGroup);  
  
    window.addEventListener("resize", () => this.resize());  
    this.resize();  
  }  
  
  setState(gs: GameState | null) {  
    this.lastGs = gs;  
    this.dirty = true;  
  }  
  
  private resize() {  
    const w = this.canvas.clientWidth;  
    const h = this.canvas.clientHeight;  
    this.camera.aspect = w / h;  
    this.camera.updateProjectionMatrix();  
    this.renderer.setSize(w, h, false);  
  }  
  
  private getFaceTex(card: Card): THREE.Texture {  
    const key = `${card.rank}${card.suit}`;  
    const hit = this.faceTexCache.get(key);  
    if (hit) return hit;  
    const tex = makeCardTextureFace(card);  
    this.faceTexCache.set(key, tex);  
    return tex;  
  }  
  
  private rebuildFromState(gs: GameState) {
    // clear cards
    while (this.cardsGroup.children.length) {
      const o = this.cardsGroup.children.pop()!;
      o.traverse(obj => {
        const m = obj as THREE.Mesh;
        if ((m as any).geometry) (m as any).geometry.dispose?.();
        // materials/textures are cached; do not dispose maps here
        (m as any).material?.dispose?.();
      });
    }

    const act = activeIndices(gs.players);
    const n = act.length;

    // place dealer marker — offset inward toward center so it doesn't obscure cards
    const dealerSeat = act.indexOf(gs.round.dealerIndex);
    const dealerAng = seatAngle(dealerSeat, n);
    const dealerPos = this.playerAnchorPosition(gs, gs.round.dealerIndex, n, act);
    // push 1.2 units toward center (radial inward)
    const inwardX = -Math.sin(dealerAng) * 1.2;
    const inwardZ = Math.cos(dealerAng) * 1.2;
    this.dealerMarker.position.set(dealerPos.x + inwardX, 0.03, dealerPos.z + inwardZ);

    // reveal means show all face-up
    const reveal = !!gs.round.reveal;

    // table top is at y = -0.05; cards sit just above
    const cardY = 0.01;

    // cards per player
    for (let seat = 0; seat < n; seat++) {
      const pi = act[seat];
      const p = gs.players[pi];
      const pos = this.playerAnchorPosition(gs, pi, n, act);

      const faceUp = reveal || p.isHuman;

      // Dynamic spread so cards don't fully overlap
      const maxSpread = 1.05;
      const handCount = p.hand.length;
      const spread = Math.min(maxSpread, 4.5 / Math.max(handCount, 1));
      const startX = -spread * (handCount - 1) * 0.5;

      const ang = seatAngle(seat, n);

      // Tangent direction (left-to-right from player's perspective looking at center)
      // Radial direction is (sin(ang), 0, -cos(ang)), tangent perpendicular to it:
      const tangentX = Math.cos(ang);
      const tangentZ = Math.sin(ang);

      for (let ci = 0; ci < handCount; ci++) {
        const card = p.hand[ci];

        const geo = new THREE.PlaneGeometry(0.9, 1.25);
        const mat = new THREE.MeshStandardMaterial({
          map: faceUp ? this.getFaceTex(card) : this.backTex,
          roughness: 0.85,
          metalness: 0.0,
          side: THREE.DoubleSide,
        });
        const mesh: CardMesh = new THREE.Mesh(geo, mat);

        // Lay card flat face-up on table then orient around Y.
        // X = -PI/2 lays the plane flat (face up).
        // Y = ang - PI orients the card text to face outward toward the player.
        mesh.rotation.order = "YXZ";
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.y = ang - Math.PI;

        // Spread cards along the tangent direction
        const dx = startX + ci * spread;

        // stagger y slightly per card to prevent z-fighting
        const yPos = cardY + ci * 0.004;

        mesh.position.set(
          pos.x + dx * tangentX,
          yPos,
          pos.z + dx * tangentZ
        );

        this.cardsGroup.add(mesh);
      }
    }
  }  
  
  private playerAnchorPosition(gs: GameState, playerIndex: number, n: number, act: number[]): THREE.Vector3 {  
    const seat = act.indexOf(playerIndex);  
    const ang = seatAngle(seat, n);  
  
    // human seat at bottom (towards camera)  
    const radius = 4.7;  
    const x = Math.sin(ang) * radius;  
    const z = Math.cos(ang) * radius;  
  
    // rotate table so seat 0 appears at bottom: we define seat 0 as human if present  
    // We'll place "act[0]" at bottom by rotating angles by PI (so z is negative).  
    return new THREE.Vector3(x, 0, -z);  
  }  
  
  frame() {  
    if (this.lastGs && this.dirty) {  
      this.rebuildFromState(this.lastGs);  
      this.dirty = false;  
    }  
    this.renderer.render(this.scene, this.camera);  
  }  
}  
  
function seatAngle(seat: number, n: number): number {  
  // seat 0 at PI (bottom, near camera); others spread around  
  return Math.PI + (seat / n) * Math.PI * 2;  
}  
