/**
 * UCF — viewport three.js.
 * Helper (grid, sumbu, bbox, seleksi) hidup di grup terpisah bertanda `ucfHelper`
 * sehingga tidak pernah dianggap bagian dari model / kandidat ekspor.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { viewPlacement, boxCorners } from './camera.js';

const DEFAULT_CENTER = new THREE.Vector3(0, 0.9, 0);
const DEFAULT_RADIUS = 1.15;
const MODEL_GAP = 0.45;

export class Viewport {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.models = [];
    this.modelSeq = 0;
    this.tween = null;
    this.currentView = 'perspektif';
    this._wireMemo = new Map();
    this.toggles = { grid: true, axes: true, bbox: false, wireframe: false };
    this._didDrag = false;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1220);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    this.camera.position.set(2.6, 1.9, 3.4);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute('aria-label', 'Viewport 3D UCF');
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(DEFAULT_CENTER);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 120;
    this.controls.zoomSpeed = 0.9;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };
    this.controls.addEventListener('start', () => this.cancelTween());

    this._addLights();

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'UCF_Models';
    this.scene.add(this.modelRoot);

    this.helperRoot = new THREE.Group();
    this.helperRoot.name = 'UCF_Helpers';
    this.helperRoot.userData.ucfHelper = true;
    this.scene.add(this.helperRoot);

    this.grid = new THREE.GridHelper(12, 24, 0x3b82f6, 0x1e293b);
    this.grid.name = 'Helper_Grid';
    this.grid.userData.ucfHelper = true;
    this.grid.position.y = 0;

    this.axes = new THREE.AxesHelper(1.25);
    this.axes.name = 'Helper_Sumbu';
    this.axes.userData.ucfHelper = true;

    this.bboxGroup = new THREE.Group();
    this.bboxGroup.name = 'Helper_BatasModel';
    this.bboxGroup.userData.ucfHelper = true;

    this.selectionHelper = new THREE.Box3Helper(new THREE.Box3(), 0x22d3ee);
    this.selectionHelper.name = 'Helper_Seleksi';
    this.selectionHelper.userData.ucfHelper = true;
    this.selectionHelper.material.depthTest = false;
    this.selectionHelper.material.transparent = true;
    this.selectionHelper.material.opacity = 0.9;
    this.selectionHelper.renderOrder = 20;
    this.selectionHelper.visible = false;

    this.helperRoot.add(this.grid, this.axes, this.bboxGroup, this.selectionHelper);
    this.grid.visible = this.toggles.grid;
    this.axes.visible = this.toggles.axes;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._down = null;
    this.frameListeners = new Set();
    this._lastTick = performance.now();
    this._bindPicking();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());

    this.fitAll({ animate: false });
  }

  _addLights() {
    const hemisphere = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.95);
    const key = new THREE.DirectionalLight(0xffffff, 1.85);
    key.position.set(4, 6, 5);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.5);
    fill.position.set(-5, 3, -4);
    const rim = new THREE.DirectionalLight(0xfde68a, 0.3);
    rim.position.set(0, 4, -6);
    for (const light of [hemisphere, key, fill, rim]) light.userData.ucfHelper = true;
    this.scene.add(hemisphere, key, fill, rim);
  }

  _bindPicking() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (event) => {
      this._down = { x: event.clientX, y: event.clientY, button: event.button, time: performance.now() };
    });
    dom.addEventListener('pointerup', (event) => {
      const down = this._down;
      this._down = null;
      if (!down || down.button !== 0 || event.button !== 0) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const rect = dom.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      this.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.modelRoot.children, true);
      const target = hits.length ? hits[0].object : null;
      this.options.onSelect?.(target);
    });
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Daftarkan callback per frame (dipakai pemutar animasi). */
  addFrameListener(fn) {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  tick() {
    const now = performance.now();
    const delta = Math.min(0.25, Math.max(0, (now - (this._lastTick || now)) / 1000));
    this._lastTick = now;
    for (const fn of this.frameListeners) {
      try { fn(delta); } catch (error) { console.error('frame listener error', error); }
    }
    if (this.tween) {
      const now = performance.now();
      const t = Math.min(1, (now - this.tween.start) / this.tween.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(this.tween.fromPos, this.tween.toPos, e);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.toTarget, e);
      if (t >= 1) {
        this.tween = null;
        this._emitSettled();
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _emitSettled() {
    this.options.onCameraSettled?.(this.cameraState());
  }

  cancelTween() {
    if (this.tween) this.tween = null;
  }

  get cameraSettled() {
    return this.tween === null;
  }

  cameraState() {
    const direction = this.camera.position.clone().sub(this.controls.target);
    const distance = direction.length();
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      up: this.camera.up.toArray(),
      direction: distance > 1e-9 ? direction.normalize().toArray() : [0, 0, 1],
      distance,
      fov: this.camera.fov,
      aspect: this.camera.aspect,
      view: this.currentView,
      settled: this.cameraSettled
    };
  }

  /** Kotak pembatas gabungan seluruh model (atau kotak default). */
  unionBox() {
    if (this.models.length) {
      const box = new THREE.Box3();
      for (const model of this.models) box.union(model.bbox);
      if (!box.isEmpty()) return box;
    }
    return new THREE.Box3(
      new THREE.Vector3(-0.55, 0, -0.55),
      new THREE.Vector3(0.55, 1.8, 0.55)
    );
  }

  /** Bola pembatas seluruh model; jatuh ke ukuran default bila viewport kosong. */
  bounds() {
    if (!this.models.length) return { center: DEFAULT_CENTER.clone(), radius: DEFAULT_RADIUS };
    const box = new THREE.Box3();
    for (const model of this.models) box.union(model.bbox);
    if (box.isEmpty()) return { center: DEFAULT_CENTER.clone(), radius: DEFAULT_RADIUS };
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 1e-5) {
      return { center: sphere.center.clone(), radius: DEFAULT_RADIUS };
    }
    return { center: sphere.center.clone(), radius: sphere.radius };
  }

  fitAll({ animate = true } = {}) {
    this.setView(this.currentView || 'perspektif', { animate });
  }

  setView(view, { animate = true } = {}) {
    const box = this.unionBox();
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    const placement = viewPlacement({
      center,
      radius,
      corners: boxCorners(box),
      fovDeg: this.camera.fov,
      aspect: this.camera.aspect,
      view,
      padding: 1.12
    });
    this.currentView = placement.view;
    this.applyPlacement(placement, { animate });
    return placement;
  }

  applyPlacement(placement, { animate = true } = {}) {
    this.camera.near = Math.max(0.005, Math.min(1, placement.distance / 1000));
    this.camera.far = Math.max(200, placement.distance * 40);
    this.camera.updateProjectionMatrix();
    this.controls.maxDistance = Math.max(120, placement.distance * 5);

    if (!animate) {
      this.tween = null;
      this.camera.position.copy(placement.position);
      this.controls.target.copy(placement.target);
      this.controls.update();
      this.camera.updateMatrixWorld(true);
      this._emitSettled();
      return;
    }
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: placement.position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: placement.target.clone(),
      start: performance.now(),
      duration: 340
    };
  }

  resetCamera() {
    this.setView('perspektif', { animate: true });
  }

  _nextSlotX(width) {
    if (!this.models.length) return 0;
    let maxX = -Infinity;
    for (const model of this.models) maxX = Math.max(maxX, model.bbox.max.x);
    return maxX + MODEL_GAP + width / 2;
  }

  /**
   * Bounding box dari mesh saja: sprite label, AxesHelper, dan objek bertanda
   * `ucfHelper` tidak ikut supaya ukuran model tidak terpengaruh helper.
   * SkinnedMesh dihitung memakai posisi verteks setelah skinning.
   */
  boundsOf(root) {
    const box = new THREE.Box3();
    if (!root) return box;
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!object.isMesh || !object.geometry) return;
      if (object.userData?.ucfHelper) return;
      let localBox;
      if (object.isSkinnedMesh) {
        object.computeBoundingBox();
        localBox = object.boundingBox;
      } else {
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        localBox = object.geometry.boundingBox;
      }
      if (!localBox || localBox.isEmpty()) return;
      box.union(localBox.clone().applyMatrix4(object.matrixWorld));
    });
    return box;
  }

  /**
   * Tambah model ke scene: kaki di y=0, pusat X/Z pada slot, tanpa mengubah skala sumber.
   */
  addModel(root, meta = {}) {
    const localBox = this.boundsOf(root);
    const size = localBox.getSize(new THREE.Vector3());
    const width = Number.isFinite(size.x) && size.x > 0 ? size.x : 0.5;
    const slotX = this._nextSlotX(width);

    if (!localBox.isEmpty()) {
      const center = localBox.getCenter(new THREE.Vector3());
      root.position.x += slotX - center.x;
      root.position.z += -center.z;
      root.position.y += -localBox.min.y;
    }
    root.updateMatrixWorld(true);
    this.modelRoot.add(root);

    const bbox = this.boundsOf(root);
    const bboxHelper = new THREE.Box3Helper(bbox.clone(), 0x64748b);
    bboxHelper.name = `Helper_BBox_${meta.name || 'model'}`;
    bboxHelper.userData.ucfHelper = true;
    bboxHelper.material.transparent = true;
    bboxHelper.material.opacity = 0.75;
    bboxHelper.material.depthTest = false;
    bboxHelper.visible = this.toggles.bbox;
    this.bboxGroup.add(bboxHelper);

    const restPose = [];
    root.traverse((object) => {
      if (object.isBone) restPose.push({ object, quat: object.quaternion.clone(), pos: object.position.clone() });
    });
    root.userData.ucfRestPose = restPose;

    const model = {
      id: `model-${++this.modelSeq}`,
      name: meta.name || `Model ${this.modelSeq}`,
      fileName: meta.fileName || meta.name || '—',
      root,
      bbox,
      bboxHelper,
      stats: meta.stats || null,
      clips: Array.isArray(meta.clips) ? meta.clips : [],
      restPose,
      report: meta.report || null
    };
    root.userData.ucfModelId = model.id;
    root.userData.ucfModel = true;
    this.models.push(model);
    this.applyWireframeToModel(model);
    this.options.onModelsChanged?.(this.models);
    return model;
  }

  /** Tambah objek bantu (skeleton, label) — tidak pernah dihitung sebagai model. */
  addHelper(object) {
    object.userData.ucfHelper = true;
    this.helperRoot.add(object);
    return object;
  }

  removeHelper(object) {
    if (!object) return false;
    this.helperRoot.remove(object);
    this._disposeObject?.(object);
    return true;
  }

  /** Raycast untuk pengujian: kembalikan objek terdekat di koordinat layar. */
  pickAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.modelRoot.children, true);
    if (!hits.length) return null;
    const hit = hits[0];
    const names = [];
    let node = hit.object;
    while (node) { if (node.name) names.push(node.name); node = node.parent; }
    return { name: hit.object.name, type: hit.object.type, point: hit.point.toArray(), path: names, distance: hit.distance };
  }

  modelById(id) {
    return this.models.find((model) => model.id === id) || null;
  }

  /** Hitung ulang bbox & helper setelah transform/geometri berubah. */
  refreshModel(id) {
    const model = this.modelById(id);
    if (!model) return false;
    model.root.updateMatrixWorld(true);
    model.bbox.copy(this.boundsOf(model.root));
    model.bboxHelper.box.copy(model.bbox);
    model.bboxHelper.updateMatrixWorld(true);
    this.options.onModelsChanged?.(this.models);
    return true;
  }

  /** Ganti isi model tanpa mengubah posisi root (dipakai rebuild humanoid). */
  replaceContent(id, content, stats = null) {
    const model = this.modelById(id);
    if (!model) return false;
    for (const child of [...model.root.children]) {
      model.root.remove(child);
      this._disposeObject(child);
    }
    model.root.add(content);
    model.root.updateMatrixWorld(true);
    model.bbox.copy(this.boundsOf(model.root));
    model.bboxHelper.box.copy(model.bbox);
    model.bboxHelper.updateMatrixWorld(true);
    if (stats) model.stats = stats;
    this.applyWireframeToModel(model);
    this.options.onModelsChanged?.(this.models);
    return true;
  }

  renameModel(id, name) {
    const model = this.modelById(id);
    if (!model) return false;
    model.name = name;
    model.root.name = name;
    this.options.onModelsChanged?.(this.models);
    return true;
  }

  removeModel(id) {
    const index = this.models.findIndex((model) => model.id === id);
    if (index < 0) return false;
    const [model] = this.models.splice(index, 1);
    this.bboxGroup.remove(model.bboxHelper);
    model.bboxHelper.geometry?.dispose?.();
    model.bboxHelper.material?.dispose?.();
    this.modelRoot.remove(model.root);
    this._disposeObject(model.root);
    this.selectionHelper.visible = false;
    this.options.onModelsChanged?.(this.models);
    return true;
  }

  clearModels() {
    for (const model of [...this.models]) this.removeModel(model.id);
    this._wireMemo.clear();
    this.currentView = 'perspektif';
    this.setView('perspektif', { animate: false });
  }

  _disposeObject(root) {
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    const disposedTextures = new Set();
    root.traverse((object) => {
      if (object.geometry && !disposedGeometries.has(object.geometry)) {
        disposedGeometries.add(object.geometry);
        object.geometry.dispose?.();
      }
      const materials = object.material
        ? Array.isArray(object.material) ? object.material : [object.material]
        : [];
      for (const material of materials) {
        if (!material || disposedMaterials.has(material)) continue;
        disposedMaterials.add(material);
        for (const value of Object.values(material)) {
          if (value && value.isTexture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose?.();
          }
        }
        material.dispose?.();
      }
    });
  }

  applyWireframeToModel(model) {
    const materials = this._collectMaterials(model.root);
    for (const material of materials) {
      if (!this._wireMemo.has(material)) this._wireMemo.set(material, material.wireframe === true);
      material.wireframe = this.toggles.wireframe;
    }
  }

  _collectMaterials(root) {
    const materials = new Set();
    root.traverse((object) => {
      if (!object.material) return;
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) if (material) materials.add(material);
    });
    return materials;
  }

  setWireframe(on) {
    this.toggles.wireframe = Boolean(on);
    for (const model of this.models) {
      for (const material of this._collectMaterials(model.root)) {
        if (!this._wireMemo.has(material)) this._wireMemo.set(material, material.wireframe === true);
        material.wireframe = this.toggles.wireframe;
      }
    }
  }

  setHelper(key, visible) {
    if (key === 'grid') {
      this.toggles.grid = Boolean(visible);
      this.grid.visible = this.toggles.grid;
    } else if (key === 'axes') {
      this.toggles.axes = Boolean(visible);
      this.axes.visible = this.toggles.axes;
    } else if (key === 'bbox') {
      this.toggles.bbox = Boolean(visible);
      for (const model of this.models) model.bboxHelper.visible = this.toggles.bbox;
    }
  }

  selectObject(object) {
    if (!object) {
      this.selectionHelper.visible = false;
      return null;
    }
    const box = this.boundsOf(object);
    if (box.isEmpty()) {
      this.selectionHelper.visible = false;
      return null;
    }
    this.selectionHelper.box.copy(box);
    this.selectionHelper.visible = true;
    this.selectionHelper.updateMatrixWorld(true);
    return box;
  }

  get helperObjectCount() {
    let count = 0;
    this.helperRoot.traverse((object) => {
      if (object.userData.ucfHelper) count += 1;
    });
    return count;
  }

  get helperNames() {
    return this.helperRoot.children.map((child) => child.name).filter(Boolean);
  }

  aggregateStats() {
    const totals = { models: this.models.length, meshes: 0, triangles: 0, bones: 0, skinnedMeshes: 0 };
    for (const model of this.models) {
      const stats = model.stats || {};
      totals.meshes += stats.meshes || 0;
      totals.triangles += stats.triangles || 0;
      totals.bones += stats.bones || 0;
      totals.skinnedMeshes += stats.skinnedMeshes || 0;
    }
    return totals;
  }

  bboxCorners() {
    const corners = [];
    for (const model of this.models) {
      const { min, max } = model.bbox;
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) corners.push([x, y, z]);
        }
      }
    }
    return corners;
  }

  projectCorners() {
    this.camera.updateMatrixWorld(true);
    return this.bboxCorners().map((corner) => {
      const v = new THREE.Vector3(...corner).project(this.camera);
      return [v.x, v.y, v.z];
    });
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearModels();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
