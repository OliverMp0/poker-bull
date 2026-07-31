import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
const w = 768, h = 1068;
const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d")!;

  g.fillStyle = "#f8fafc";
  g.strokeStyle = "rgba(2,6,23,.25)";
  g.lineWidth = 10;
  roundRect(g, 16, 16, w - 32, h - 32, 36);
  g.fill();
  g.stroke();

  const r = rankLabel(card.rank);
  const s = suitSymbol(card.suit);

  // Top-left corner
  g.fillStyle = suitColor(card.suit);
  g.font = "bold 120px ui-sans-serif, system-ui";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText(r, 60, 165);

  g.font = "bold 108px ui-sans-serif, system-ui";
  g.fillText(s, 63, 279);

  // Large center rank + suit
  g.font = "bold 270px ui-sans-serif, system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(r, w / 2, h / 2 - 60);

  g.font = "bold 210px ui-sans-serif, system-ui";
  g.fillText(s, w / 2, h / 2 + 150);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeCardTextureBack(): THREE.Texture {
const w = 768, h = 1068;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d")!;

  g.fillStyle = "#0b1220";
  g.strokeStyle = "rgba(255,255,255,.18)";
  g.lineWidth = 10;
  roundRect(g, 16, 16, w - 32, h - 32, 36);
  g.fill();
  g.stroke();

  g.strokeStyle = "rgba(56, 189, 248, .28)";
  g.lineWidth = 4;
  for (let y = 60; y < h - 60; y += 28) {
    g.beginPath();
    g.moveTo(50, y);
    g.lineTo(w - 50, y);
    g.stroke();
  }

  g.fillStyle = "rgba(255,255,255,.82)";
  g.font = "bold 60px ui-sans-serif, system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("POKER", w/2, h/2 - 32);
  g.fillText("BULL", w/2, h/2 + 36);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
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
  private turnMarker: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private controls!: OrbitControls;
  private dirty = true;
  private lastGs: GameState | null = null;
  private lastDeckSeed: number | null = null;
  private lastReveal = false;
  private animationMode: "deal" | "reveal" | "none" = "none";

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(3, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#070a0f");

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 9.2, 11.8);
    this.camera.lookAt(0, 0, -0.6);

    const hemi = new THREE.HemisphereLight(0xbfd7ff, 0x07110e, 1.2);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfff4dd, 1.6);
    dir.position.set(6, 9, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -8;
    dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8;
    dir.shadow.camera.bottom = -8;
    this.scene.add(dir);

    const fill = new THREE.PointLight(0x22d3ee, 10, 18);
    fill.position.set(-6, 4, -5);
    this.scene.add(fill);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: 0x020706, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.68;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(6.2, 6.2, 0.6, 64),
      new THREE.MeshStandardMaterial({ color: 0x0f3d2e, roughness: 0.92, metalness: 0.04 })
    );
    table.position.y = -0.35;
    table.receiveShadow = true;
    table.castShadow = true;
    this.scene.add(table);

    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(6.48, 6.48, 0.5, 64),
      new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 0.48, metalness: 0.08 })
    );
    rail.position.y = -0.47;
    rail.receiveShadow = true;
    this.scene.add(rail);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(6.25, 0.18, 16, 128),
      new THREE.MeshStandardMaterial({ color: 0x8a6533, roughness: 0.3, metalness: 0.5 })
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
    this.dealerMarker.castShadow = true;
    this.scene.add(this.dealerMarker);

    this.turnMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.035, 10, 48),
      new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.75 })
    );
    this.turnMarker.rotation.x = Math.PI / 2;
    this.turnMarker.position.y = 0.025;
    this.scene.add(this.turnMarker);

    this.scene.add(this.cardsGroup);

    // Camera controls: rotate (drag/1-finger), zoom (wheel/pinch), constrained
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0, -0.6);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 22;
    this.controls.minPolarAngle = 0.15;             // don't go fully top-down
    this.controls.maxPolarAngle = Math.PI * 0.46;   // don't go below table
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.9;
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.update();

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  setState(gs: GameState | null) {
    if (gs) {
      this.animationMode = this.lastDeckSeed !== gs.round.deckSeed
        ? "deal"
        : (!this.lastReveal && !!gs.round.reveal ? "reveal" : "none");
      this.lastDeckSeed = gs.round.deckSeed;
      this.lastReveal = !!gs.round.reveal;
    }
    this.lastGs = gs;
    this.dirty = true;
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const aspect = w / h;
    this.camera.aspect = aspect;

    // Adapt FOV/distance so all seats fit on narrow/portrait screens.
    if (aspect < 1) {
      // portrait — pull back further and widen FOV a touch
      this.camera.fov = 52;
      const dir = this.camera.position.clone().sub(this.controls?.target ?? new THREE.Vector3(0, 0, -0.6)).normalize();
      const dist = 15;
      const target = this.controls?.target ?? new THREE.Vector3(0, 0, -0.6);
      this.camera.position.copy(target).add(dir.multiplyScalar(dist));
    } else {
      this.camera.fov = 42;
    }
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

    const active = activeIndices(gs.players);
    const localSeat = active.findIndex(index => gs.players[index].isHuman);
    const act = localSeat > 0
      ? [...active.slice(localSeat), ...active.slice(0, localSeat)]
      : active;
    const n = act.length;

    // place dealer marker — offset inward toward center so it doesn't obscure cards
    const dealerSeat = act.indexOf(gs.round.dealerIndex);
    const dealerAng = seatAngle(dealerSeat, n);
    const dealerPos = this.playerAnchorPosition(gs, gs.round.dealerIndex, n, act);
    // push 1.2 units toward center (radial inward)
    const inwardX = -Math.sin(dealerAng) * 1.2;
    const inwardZ = Math.cos(dealerAng) * 1.2;
    this.dealerMarker.position.set(dealerPos.x + inwardX, 0.03, dealerPos.z + inwardZ);

    const turnPos = this.playerAnchorPosition(gs, gs.round.turnIndex, n, act);
    this.turnMarker.position.set(turnPos.x, 0.025, turnPos.z);

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
        mesh.castShadow = true;
        mesh.receiveShadow = true;

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

        const target = new THREE.Vector3(
          pos.x + dx * tangentX,
          yPos,
          pos.z + dx * tangentZ
        );

        if (this.animationMode === "deal") {
          mesh.position.set(0, 1.1, 0);
          mesh.scale.setScalar(0.12);
          mesh.userData.animation = {
            type: "deal",
            target,
            start: performance.now() + seat * 65 + ci * 45,
            duration: 520,
          };
        } else if (this.animationMode === "reveal") {
          mesh.position.copy(target);
          mesh.scale.x = 1;
          mesh.userData.animation = {
            type: "reveal",
            target,
            start: performance.now() + seat * 70 + ci * 35,
            duration: 360,
          };
        } else {
          mesh.position.copy(target);
        }

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
    const now = performance.now();
    for (const child of this.cardsGroup.children) {
      const mesh = child as CardMesh;
      const animation = mesh.userData.animation as { type: "deal" | "reveal"; target: THREE.Vector3; start: number; duration: number } | undefined;
      if (!animation || now < animation.start) continue;
      const progress = Math.min(1, (now - animation.start) / animation.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      if (animation.type === "deal") {
        mesh.position.lerpVectors(new THREE.Vector3(0, 1.1, 0), animation.target, eased);
        const scale = 0.12 + eased * 0.88;
        mesh.scale.setScalar(scale);
      } else {
        mesh.scale.x = Math.max(0.04, Math.abs(progress * 2 - 1));
      }
      if (progress === 1) {
        mesh.position.copy(animation.target);
        mesh.scale.setScalar(1);
        delete mesh.userData.animation;
      }
    }
    const pulse = 1 + Math.sin(now * 0.004) * 0.09;
    this.turnMarker.scale.setScalar(pulse);
    this.turnMarker.material.opacity = 0.62 + Math.sin(now * 0.004) * 0.2;
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function seatAngle(seat: number, n: number): number {
  // seat 0 at PI (bottom, near camera); others spread around
  return Math.PI + (seat / n) * Math.PI * 2;
}
