import * as THREE from 'three';

export function createScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a24);
    scene.fog = new THREE.Fog(0x1a1a24, 40, 200);
    return scene;
}

export function createCamera(width: number, height: number) {
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 20, 20);
    camera.lookAt(0, 0, 0);
    return camera;
}

export function createRenderer(width: number, height: number) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    return renderer;
}

export function createLights(scene: THREE.Scene, lightPos: { x: number, y: number, z: number }) {
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(lightPos.x, lightPos.y, lightPos.z);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 200;
    dirLight.shadow.camera.left = -80;
    dirLight.shadow.camera.right = 80;
    dirLight.shadow.camera.top = 80;
    dirLight.shadow.camera.bottom = -80;
    scene.add(dirLight);

    return dirLight;
}

export function createFloor(scene: THREE.Scene) {
    const planeGeo = new THREE.PlaneGeometry(160, 160);
    const planeMat = new THREE.MeshStandardMaterial({
        color: 0x3a3a4a,
        roughness: 0.8,
        metalness: 0.2
    });
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);

    // 1m x 1m grid (1m = 9 units, car is 20cm = 1.8 units)
    const gridSize = 144; // 16 cells x 9 units = 16m x 16m
    const divisions = 16;
    const grid = new THREE.GridHelper(gridSize, divisions, 0x555577, 0x444460);
    grid.position.y = 0.01;
    scene.add(grid);

    return plane;
}
