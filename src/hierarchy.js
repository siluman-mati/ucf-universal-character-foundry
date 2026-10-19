/**
 * UCF — panel hierarki objek.
 * Menampilkan seluruh scene graph hasil impor; tulang dibedakan dari mesh.
 */
import * as THREE from 'three';
import { formatNumber } from './format.js';

const TYPE_LABEL = Object.freeze({
  bone: 'Tulang',
  skinned: 'Skinned mesh',
  mesh: 'Mesh',
  light: 'Cahaya',
  camera: 'Kamera',
  group: 'Grup'
});

export function nodeType(object) {
  if (!object) return 'group';
  if (object.isBone) return 'bone';
  if (object.isSkinnedMesh) return 'skinned';
  if (object.isMesh) return 'mesh';
  if (object.isLight) return 'light';
  if (object.isCamera) return 'camera';
  return 'group';
}

export function nodeTypeLabel(object) {
  return TYPE_LABEL[nodeType(object)] || 'Objek';
}

export function nodeDisplayName(object) {
  const name = typeof object?.name === 'string' ? object.name.trim() : '';
  return name || `(${nodeTypeLabel(object)} tanpa nama)`;
}

export function countNodes(root) {
  let count = 0;
  root?.traverse?.(() => { count += 1; });
  return count;
}

export function objectDetails(object) {
  if (!object) return null;
  const type = nodeType(object);
  const box = new THREE.Box3().setFromObject(object);
  const world = new THREE.Vector3();
  object.getWorldPosition(world);
  const details = {
    uuid: object.uuid,
    name: nodeDisplayName(object),
    type,
    typeLabel: nodeTypeLabel(object),
    parentName: object.parent ? nodeDisplayName(object.parent) : '—',
    childCount: object.children?.length || 0,
    worldPosition: [world.x, world.y, world.z],
    localPosition: [object.position.x, object.position.y, object.position.z],
    hasGeometry: Boolean(object.isMesh && object.geometry),
    materials: [],
    vertices: null,
    triangles: null,
    skinned: Boolean(object.isSkinnedMesh),
    boneCount: 0,
    skeletonBones: null,
    morphTargets: 0,
    bounds: null
  };

  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    details.bounds = { size: size.toArray(), empty: false };
  }

  if (object.isMesh && object.geometry) {
    const position = object.geometry.getAttribute?.('position');
    details.vertices = position ? position.count : 0;
    const index = object.geometry.getIndex?.();
    details.triangles = Math.floor((index ? index.count : details.vertices) / 3);
    const materials = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    details.materials = materials.filter(Boolean).map((material) => material.name || '(tanpa nama)');
    const morphPositions = object.geometry.morphAttributes?.position;
    details.morphTargets = Array.isArray(morphPositions) ? morphPositions.length : 0;
  }

  object.traverse((child) => {
    if (child.isBone) details.boneCount += 1;
  });

  if (object.isSkinnedMesh && object.skeleton) {
    details.skeletonBones = object.skeleton.bones.length;
  }

  return details;
}

/**
 * Bangun panel hierarki. Semua node dirender; kedalaman > expandedDepth dilipat.
 */
export function renderHierarchy(container, models, options = {}) {
  const { onSelect = null, selectedUuid = null, expandedDepth = 2 } = options;
  container.innerHTML = '';
  if (!models || !models.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.padding = '8px';
    empty.textContent = 'Belum ada model. Impor .glb atau .gltf.';
    container.appendChild(empty);
    return 0;
  }

  const context = { onSelect, expandedDepth: Number.isFinite(expandedDepth) ? expandedDepth : 2 };
  let total = 0;

  const build = (object, depth) => {
    total += 1;
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.uuid = object.uuid;

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.uuid = object.uuid;
    row.style.paddingLeft = `${4 + depth * 12}px`;
    row.setAttribute('role', 'treeitem');

    const caret = document.createElement('span');
    caret.className = 'caret';
    const children = object.children || [];
    if (!children.length) caret.classList.add('empty');
    caret.textContent = '▶';
    caret.setAttribute('aria-hidden', 'true');

    const dot = document.createElement('span');
    dot.className = `type-dot ${nodeType(object)}`;
    dot.title = nodeTypeLabel(object);

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = nodeDisplayName(object);

    const meta = document.createElement('span');
    meta.className = 'tree-meta';
    meta.textContent = children.length ? String(children.length) : '';

    row.append(caret, dot, name, meta);
    row.addEventListener('click', () => onSelect?.(object, row));
    caret.addEventListener('click', (event) => {
      if (!children.length) return;
      event.stopPropagation();
      node.classList.toggle('collapsed');
    });

    node.appendChild(row);

    if (children.length) {
      const childBox = document.createElement('div');
      childBox.className = 'tree-children';
      for (const child of children) childBox.appendChild(build(child, depth + 1));
      node.appendChild(childBox);
      if (depth >= context.expandedDepth) node.classList.add('collapsed');
    }

    return node;
  };

  for (const model of models) container.appendChild(build(model.root, 0));

  if (selectedUuid) markSelected(container, selectedUuid);
  return total;
}

export function markSelected(container, uuid) {
  for (const row of container.querySelectorAll('.tree-row.selected')) {
    row.classList.remove('selected');
  }
  if (!uuid) return;
  const row = container.querySelector(`.tree-row[data-uuid="${CSS.escape(uuid)}"]`);
  if (row) {
    row.classList.add('selected');
    row.scrollIntoView({ block: 'nearest' });
  }
}

/** Filter nama node; leluhur dari node yang cocok tetap ditampilkan. */
export function filterHierarchy(container, rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();
  const nodes = Array.from(container.querySelectorAll('.tree-node'));

  if (!query) {
    for (const node of nodes) {
      node.classList.remove('filtered-out', 'has-match');
      if (node.dataset.filterSavedCollapsed !== undefined) {
        node.classList.toggle('collapsed', node.dataset.filterSavedCollapsed === '1');
        delete node.dataset.filterSavedCollapsed;
      }
    }
    return;
  }

  for (const node of nodes) {
    if (node.dataset.filterSavedCollapsed === undefined) {
      node.dataset.filterSavedCollapsed = node.classList.contains('collapsed') ? '1' : '0';
    }
    const name = node.querySelector(':scope > .tree-row .tree-name');
    node.classList.toggle('_match', Boolean(name && name.textContent.toLowerCase().includes(query)));
  }

  const compute = (node) => {
    let hasMatch = node.classList.contains('_match');
    const directChildren = node.querySelectorAll(':scope > .tree-children > .tree-node');
    for (const child of directChildren) {
      if (compute(child)) hasMatch = true;
    }
    node.classList.toggle('has-match', hasMatch);
    node.classList.toggle('filtered-out', !hasMatch);
    if (hasMatch) node.classList.remove('collapsed');
    return hasMatch;
  };

  for (const node of container.querySelectorAll(':scope > .tree-node')) compute(node);
  for (const node of nodes) node.classList.remove('_match');
}

export { formatNumber };
