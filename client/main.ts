import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createScene, createCamera, createRenderer, createLights, createFloor } from './sim/scene';
import { createRobot } from './sim/robot';
import {
  connectSocket,
  getSocket,
  isConnected,
  getClientId,
  sendState,
  onCommand,
} from './socket-client';

// ─── Speed settings (per-second values) ───
let speed = 6;       // units/s (at 60fps: 0.1/frame)
let turnSpeed = 3;   // rad/s  (at 60fps: 0.05/frame)

// ─── Command state ───
let cmdVelocity = 0;       // units/s
let cmdAngularVelocity = 0; // rad/s
let pendingTurnAngle = 0;
let commandActive = false;
let lastVelocityCmdTime = 0;
let lastAngularCmdTime = 0;
const CMD_TIMEOUT = 200; // ms
let lastFrameTime = 0;

// ─── Distance tracking ───
// Robot model is 1.8 units long, representing a 20cm car
// So 1cm = 1.8/20 = 0.09 simulation units
const CM_TO_UNITS = 1.8 / 20;
let targetDistance = 0;
let traveledDistance = 0;
let lastDistancePos = { x: 0, z: 0 };
let distanceTracking = false;

// ─── Debug mode state ───
const STORAGE_KEY = 'car-sim-debug';
let debugMode = false;
let debugPanelVisible = false;
const keyState: Record<string, boolean> = {};
const DEBUG_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

function loadDebugState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      debugMode = saved.debugMode ?? false;
      showTrail = saved.showTrail ?? false;
      if (saved.speed !== undefined) {
        // Migrate old per-frame values (0.01-0.5) to per-second (×60)
        speed = saved.speed < 1 ? saved.speed * 60 : saved.speed;
      }
      if (saved.turnSpeed !== undefined) {
        turnSpeed = saved.turnSpeed < 1 ? saved.turnSpeed * 60 : saved.turnSpeed;
      }
      if (saved.lightPos) lightPos = saved.lightPos;
      // Save migrated values back
      saveDebugState();
    }
  } catch { /* ignore */ }
}

function saveDebugState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    debugMode, showTrail, speed, turnSpeed, lightPos,
  }));
}

// ─── Robot state ───
const robotState = {
  x: 0, z: 0, rotation: Math.PI,
  velocity: 0, angularVelocity: 0,
};

// ─── Three.js objects ───
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let robot: THREE.Group;
let wheels: THREE.Group[];
let walls: THREE.Mesh[] = [];
let ball: THREE.Mesh;
let bucket: THREE.Mesh;
let environmentGroup: THREE.Group;
let groundPlane: THREE.Mesh;
let onboardCamera: THREE.PerspectiveCamera;
let onboardRenderTarget: THREE.WebGLRenderTarget;

// ─── Arm state ───
interface ArmState {
  lowerArm: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
  gripper: THREE.Group;
  state: 'idle' | 'picking_down' | 'picking_up' | 'holding' | 'dropping_down' | 'dropping_up';
  hasBall: boolean;
  grabbedObject: THREE.Mesh | null;
  targetRotations: { lowerArm: number; elbow: number; wrist: number };
}
let arm: ArmState;

// ─── Dragging state ───
let isDragging = false;
let draggingObject: THREE.Mesh | null = null;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ─── Trail ───
let showTrail = false;
const MAX_TRAIL_POINTS = 600;
const TRAIL_RECORD_INTERVAL = 3;
let trailPoints: THREE.Vector3[] = [];
let trailLine: THREE.Line | null = null;
let trailFrameCounter = 0;

// ─── Lighting reference ───
let dirLight: THREE.DirectionalLight;
let lightPos = { x: 10, y: 20, z: 10 };

// ─── State reporting ───
let lastReportTime = 0;
const REPORT_INTERVAL = 100; // 10Hz

// ─── Camera canvas ───
let cameraCanvas: HTMLCanvasElement;
let cameraCtx: CanvasRenderingContext2D;

// ─── Connection status elements ───
let statusDot: HTMLElement;
let statusText: HTMLElement;
let copyIdBtn: HTMLElement;

// ─── Command log ───
const MAX_LOG_ENTRIES = 50;
let logEntries: HTMLElement;
let logClearBtn: HTMLElement;

function addLogEntry(action: string, params: Record<string, unknown>) {
  if (!logEntries) return;
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8);
  const paramStr = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `<span class="param">${k}=${v}</span>`)
    .join(' ');

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="ts">${ts}</span><span class="act">${action}</span> ${paramStr}`;

  logEntries.insertBefore(entry, logEntries.firstChild);

  // Trim old entries
  while (logEntries.children.length > MAX_LOG_ENTRIES) {
    logEntries.lastChild?.remove();
  }
}

// ═══════════════════════════════════════════════════════════════
// Environment Setup
// ═══════════════════════════════════════════════════════════════

function setupEnvironment() {
  // Green ball
  const ballGeo = new THREE.SphereGeometry(0.25, 16, 16);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xccff00, roughness: 0.8 });
  ball = new THREE.Mesh(ballGeo, ballMat);
  ball.position.set(0, 0.25, -5);
  ball.castShadow = true;
  ball.userData = { w: 0.5, d: 0.5, isDraggable: true };
  environmentGroup.add(ball);
  walls.push(ball);

  // Red bucket
  const bucketGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const bucketMat = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.6 });
  bucket = new THREE.Mesh(bucketGeo, bucketMat);
  bucket.position.set(0, 0.3, 5);
  bucket.castShadow = true;
  bucket.userData = { w: 0.6, d: 0.6, isDraggable: true, isBucket: true };
  environmentGroup.add(bucket);
  walls.push(bucket);
}

// ═══════════════════════════════════════════════════════════════
// Grabbable Object Detection
// ═══════════════════════════════════════════════════════════════

function findGrabbableObject(): THREE.Mesh | null {
  const robotPos = robot.position.clone();
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(robot.quaternion);
  const grabPos = robotPos.clone().add(forward.multiplyScalar(1.5));

  let closestObj: THREE.Mesh | null = null;
  let minDistance = 1.5;

  for (const obj of walls) {
    if (obj.geometry.type === 'SphereGeometry' || obj.userData.isGrabbable) {
      const dist = obj.position.distanceTo(grabPos);
      if (dist < minDistance) {
        minDistance = dist;
        closestObj = obj;
      }
    }
  }

  return closestObj;
}

function isGrabAvailable(): boolean {
  if (arm.state !== 'idle') return false;
  return findGrabbableObject() !== null;
}

// ═══════════════════════════════════════════════════════════════
// State Reporting (via WebSocket)
// ═══════════════════════════════════════════════════════════════

function reportState() {
  const state = {
    x: robotState.x,
    z: robotState.z,
    rotation: robotState.rotation,
    velocity: robotState.velocity,
    angularVelocity: robotState.angularVelocity,
    armState: arm.state === 'holding' ? 'holding' : 'idle',
    hasBall: arm.hasBall,
    isColliding: isColliding,
    grabAvailable: isGrabAvailable(),
    ballPosition: ball ? { x: ball.position.x, z: ball.position.z } : null,
  };
  sendState(state);
}

// ═══════════════════════════════════════════════════════════════
// Physics Update
// ═══════════════════════════════════════════════════════════════

let isColliding = false;

function updatePhysics() {
  const now = performance.now();
  const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.1) : 1 / 60;
  lastFrameTime = now;

  const commandActiveNow = commandActive && (now - lastVelocityCmdTime) < CMD_TIMEOUT;
  const velocityActive = commandActiveNow && (now - lastVelocityCmdTime) < CMD_TIMEOUT;
  const angularActive = commandActiveNow && (now - lastAngularCmdTime) < CMD_TIMEOUT;

  // Keep velocity active during distance tracking (ignore timeout)
  if (velocityActive || distanceTracking) {
    robotState.velocity = cmdVelocity * dt;
  } else if (debugMode) {
    let kv = 0;
    if (keyState['KeyW'] || keyState['ArrowUp']) kv = speed;
    if (keyState['KeyS'] || keyState['ArrowDown']) kv = -speed;
    robotState.velocity = kv * dt;
  } else {
    robotState.velocity *= 0.9;
  }

  if (pendingTurnAngle !== 0) {
    // Angle-based turn: consume pendingTurnAngle at turnSpeed rate (rad/s * dt)
    const maxStep = turnSpeed * dt;
    const step = Math.sign(pendingTurnAngle) * Math.min(Math.abs(pendingTurnAngle), maxStep);
    robotState.angularVelocity = step;
    pendingTurnAngle -= step;
  } else if (angularActive) {
    robotState.angularVelocity = cmdAngularVelocity * dt;
  } else if (debugMode) {
    let ka = 0;
    if (keyState['KeyA'] || keyState['ArrowLeft']) ka = turnSpeed;
    if (keyState['KeyD'] || keyState['ArrowRight']) ka = -turnSpeed;
    robotState.angularVelocity = ka * dt;
  } else {
    robotState.angularVelocity *= 0.9;
  }

  const nextX = robotState.x + Math.sin(robotState.rotation) * robotState.velocity;
  const nextZ = robotState.z + Math.cos(robotState.rotation) * robotState.velocity;

  // AABB collision
  isColliding = false;
  const robotRadius = 0.9;

  for (const wall of walls) {
    if (arm.grabbedObject === wall) continue;
    const w = wall.userData.w as number;
    const d = wall.userData.d as number;
    if (
      nextX > wall.position.x - w / 2 - robotRadius &&
      nextX < wall.position.x + w / 2 + robotRadius &&
      nextZ > wall.position.z - d / 2 - robotRadius &&
      nextZ < wall.position.z + d / 2 + robotRadius
    ) {
      isColliding = true;
      break;
    }
  }

  if (!isColliding) {
    robotState.x = nextX;
    robotState.z = nextZ;

    // Distance tracking
    if (distanceTracking && targetDistance > 0) {
      const dx = robotState.x - lastDistancePos.x;
      const dz = robotState.z - lastDistancePos.z;
      traveledDistance += Math.sqrt(dx * dx + dz * dz);
      lastDistancePos = { x: robotState.x, z: robotState.z };

      if (traveledDistance >= targetDistance) {
        // Auto-stop
        cmdVelocity = 0;
        robotState.velocity = 0;
        lastVelocityCmdTime = 0;
        distanceTracking = false;
      }
    }
  } else {
    robotState.velocity = 0;
  }

  robotState.rotation += robotState.angularVelocity;

  // Apply to 3D object
  robot.position.x = robotState.x;
  robot.position.z = robotState.z;
  robot.rotation.y = robotState.rotation;

  // Update onboard camera to follow robot
  onboardCamera.position.set(
    robotState.x + Math.sin(robotState.rotation) * 0.6,
    0.7,
    robotState.z + Math.cos(robotState.rotation) * 0.6
  );
  onboardCamera.rotation.y = robotState.rotation + Math.PI;

  // Wheel animation
  const wheelRadius = 0.3;
  const rotAmount = robotState.velocity / wheelRadius;
  const turnRot = robotState.angularVelocity * 0.5 / wheelRadius;
  if (wheels.length === 2) {
    wheels[0].rotateY(-rotAmount - turnRot);
    wheels[1].rotateY(-rotAmount + turnRot);
  }

  // Update OrbitControls target to follow robot
  controls.target.set(robotState.x, 0, robotState.z);
}

// ═══════════════════════════════════════════════════════════════
// Arm Update (State Machine)
// ═══════════════════════════════════════════════════════════════

function doGrab() {
  if (arm.state !== 'idle') return;
  const obj = findGrabbableObject();
  if (!obj) return;

  if (draggingObject === obj) {
    isDragging = false;
    draggingObject = null;
  }

  arm.grabbedObject = obj;
  arm.hasBall = obj === ball;
  arm.state = 'picking_down';
  arm.targetRotations = { lowerArm: Math.PI / 2.2, elbow: Math.PI / 4, wrist: Math.PI / 4 };
}

function doRelease() {
  if (arm.state !== 'holding') return;
  arm.state = 'dropping_down';
  arm.targetRotations = { lowerArm: Math.PI / 2.2, elbow: Math.PI / 4, wrist: Math.PI / 4 };
}

function updateArm() {
  arm.lowerArm.rotation.x += (arm.targetRotations.lowerArm - arm.lowerArm.rotation.x) * 0.1;
  arm.elbow.rotation.x += (arm.targetRotations.elbow - arm.elbow.rotation.x) * 0.1;
  arm.wrist.rotation.x += (arm.targetRotations.wrist - arm.wrist.rotation.x) * 0.1;

  const atTarget =
    Math.abs(arm.lowerArm.rotation.x - arm.targetRotations.lowerArm) < 0.05 &&
    Math.abs(arm.elbow.rotation.x - arm.targetRotations.elbow) < 0.05 &&
    Math.abs(arm.wrist.rotation.x - arm.targetRotations.wrist) < 0.05;

  if (!atTarget) return;

  switch (arm.state) {
    case 'picking_down':
      if (arm.grabbedObject) {
        arm.gripper.add(arm.grabbedObject);
        arm.grabbedObject.position.set(0, 0.35, 0);
      }
      arm.state = 'picking_up';
      arm.targetRotations = { lowerArm: -Math.PI / 6, elbow: Math.PI / 1.5, wrist: -Math.PI / 4 };
      break;

    case 'picking_up':
      arm.state = 'holding';
      break;

    case 'dropping_down':
      if (arm.grabbedObject) {
        const worldPos = new THREE.Vector3();
        arm.grabbedObject.getWorldPosition(worldPos);
        environmentGroup.add(arm.grabbedObject);
        arm.grabbedObject.position.copy(worldPos);
        arm.grabbedObject.position.y = 0.25;
        arm.grabbedObject = null;
        arm.hasBall = false;
      }
      arm.state = 'dropping_up';
      arm.targetRotations = { lowerArm: Math.PI / 4, elbow: Math.PI / 2.5, wrist: -Math.PI / 6 };
      break;

    case 'dropping_up':
      arm.state = 'idle';
      break;
  }
}

// ═══════════════════════════════════════════════════════════════
// Mouse / Drag Handling
// ═══════════════════════════════════════════════════════════════

function updateMouse(e: MouseEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function findDraggableUnderMouse(e: MouseEvent): THREE.Mesh | null {
  updateMouse(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(walls, false);
  for (const hit of hits) {
    const obj = hit.object as THREE.Mesh;
    if (obj.userData.isDraggable && obj !== arm.grabbedObject) {
      return obj;
    }
  }
  return null;
}

function onMouseDown(e: MouseEvent) {
  const obj = findDraggableUnderMouse(e);
  if (obj) {
    isDragging = true;
    draggingObject = obj;
    controls.enabled = false;
    renderer.domElement.style.cursor = 'grabbing';
    return;
  }
}

function onMouseMove(e: MouseEvent) {
  if (isDragging && draggingObject) {
    updateMouse(e);
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(groundPlane);
    if (intersects.length > 0) {
      const point = intersects[0].point;
      draggingObject.position.x = point.x;
      draggingObject.position.z = point.z;
      draggingObject.position.y = draggingObject.userData.isBucket ? 0.3 : 0.25;
    }
    return;
  }

  if (!isDragging) {
    const obj = findDraggableUnderMouse(e);
    renderer.domElement.style.cursor = obj ? 'grab' : '';
  }
}

function onMouseUp(_e: MouseEvent) {
  if (isDragging) {
    isDragging = false;
    draggingObject = null;
    controls.enabled = true;
    renderer.domElement.style.cursor = '';
  }
}

// ═══════════════════════════════════════════════════════════════
// WebSocket Command Handler
// ═══════════════════════════════════════════════════════════════

function handleCommand(data: { action: string; value?: number; distance?: number; angle?: number; speed?: number; time?: number }) {
  const { action, value, distance, angle } = data;

  // Log the command
  addLogEntry(action, { value, distance, angle, speed: data.speed, time: data.time });

  commandActive = true;

  // Apply speed if specified
  if (typeof data.speed === 'number') {
    speed = data.speed;
    saveDebugState();
  }

  switch (action) {
    case 'up':
      cmdVelocity = speed;
      lastVelocityCmdTime = performance.now();
      if (typeof distance === 'number' && distance > 0) {
        targetDistance = distance * CM_TO_UNITS; // cm to meters
        traveledDistance = 0;
        lastDistancePos = { x: robotState.x, z: robotState.z };
        distanceTracking = true;
      } else {
        distanceTracking = false;
      }
      break;
    case 'down':
      cmdVelocity = -speed;
      lastVelocityCmdTime = performance.now();
      if (typeof distance === 'number' && distance > 0) {
        targetDistance = distance * CM_TO_UNITS;
        traveledDistance = 0;
        lastDistancePos = { x: robotState.x, z: robotState.z };
        distanceTracking = true;
      } else {
        distanceTracking = false;
      }
      break;
    case 'left':
      if (typeof angle === 'number' && angle > 0) {
        // Convert degrees to radians and use turnAngle mechanism
        const rad = (angle * Math.PI) / 180;
        pendingTurnAngle = rad;
        cmdAngularVelocity = 0;
      } else {
        cmdAngularVelocity = turnSpeed;
        lastAngularCmdTime = performance.now();
      }
      break;
    case 'right':
      if (typeof angle === 'number' && angle > 0) {
        const rad = -(angle * Math.PI) / 180;
        pendingTurnAngle = rad;
        cmdAngularVelocity = 0;
      } else {
        cmdAngularVelocity = -turnSpeed;
        lastAngularCmdTime = performance.now();
      }
      break;
    case 'stop':
      cmdVelocity = 0;
      cmdAngularVelocity = 0;
      pendingTurnAngle = 0;
      lastVelocityCmdTime = 0;
      lastAngularCmdTime = 0;
      commandActive = false;
      robotState.velocity = 0;
      robotState.angularVelocity = 0;
      distanceTracking = false;
      break;
    case 'grab':
      doGrab();
      break;
    case 'release':
      doRelease();
      break;
    case 'setSpeed':
      if (typeof value === 'number') speed = value;
      saveDebugState();
      break;
    case 'setTurnSpeed':
      if (typeof value === 'number') turnSpeed = value;
      saveDebugState();
      break;
    case 'turnAngle':
      if (typeof value === 'number') {
        pendingTurnAngle = value;
        cmdAngularVelocity = 0;
      }
      break;
  }
}

// ═══════════════════════════════════════════════════════════════
// Resize Handler
// ═══════════════════════════════════════════════════════════════

function onResize() {
  const container = document.getElementById('container')!;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// ═══════════════════════════════════════════════════════════════
// Trail
// ═══════════════════════════════════════════════════════════════

function updateTrail() {
  if (!showTrail || !trailLine) return;

  trailFrameCounter++;
  if (trailFrameCounter % TRAIL_RECORD_INTERVAL !== 0) return;

  trailPoints.push(new THREE.Vector3(robotState.x, 0.02, robotState.z));

  while (trailPoints.length > MAX_TRAIL_POINTS) {
    trailPoints.shift();
  }

  const positions = new Float32Array(trailPoints.length * 3);
  for (let i = 0; i < trailPoints.length; i++) {
    positions[i * 3] = trailPoints[i].x;
    positions[i * 3 + 1] = trailPoints[i].y;
    positions[i * 3 + 2] = trailPoints[i].z;
  }
  trailLine.geometry.dispose();
  trailLine.geometry = new THREE.BufferGeometry();
  trailLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
}

// ═══════════════════════════════════════════════════════════════
// Camera Rendering
// ═══════════════════════════════════════════════════════════════

function renderOnboardCamera() {
  if (!onboardCamera || !onboardRenderTarget || !cameraCtx) return;

  // Hide robot body for onboard camera view
  robot.visible = false;
  renderer.setRenderTarget(onboardRenderTarget);
  renderer.render(scene, onboardCamera);
  renderer.setRenderTarget(null);
  robot.visible = true;

  // Read pixels and render to 2D canvas
  const pixels = new Uint8Array(320 * 240 * 4);
  renderer.readRenderTargetPixels(onboardRenderTarget, 0, 0, 320, 240, pixels);

  // Y-axis flip: draw row by row bottom-to-top
  const imageData = cameraCtx.createImageData(320, 240);
  for (let y = 0; y < 240; y++) {
    const srcRow = (239 - y) * 320 * 4;
    const dstRow = y * 320 * 4;
    for (let x = 0; x < 320 * 4; x++) {
      imageData.data[dstRow + x] = pixels[srcRow + x];
    }
  }
  cameraCtx.putImageData(imageData, 0, 0);
}

// ═══════════════════════════════════════════════════════════════
// Connection Status
// ═══════════════════════════════════════════════════════════════

function updateConnectionStatus() {
  if (!statusDot || !statusText) return;
  const connected = isConnected();
  statusDot.className = 'dot ' + (connected ? 'connected' : 'disconnected');
  statusText.textContent = connected ? `Connected (${getClientId()})` : 'Disconnected';

  if (connected && copyIdBtn) {
    copyIdBtn.style.display = 'inline-block';
    if (!(copyIdBtn as any)._wired) {
      (copyIdBtn as any)._wired = true;
      copyIdBtn.addEventListener('click', () => {
        const id = getClientId();
        navigator.clipboard.writeText(id).then(() => {
          copyIdBtn.textContent = 'Copied!';
          copyIdBtn.classList.add('copied');
          setTimeout(() => {
            copyIdBtn.textContent = 'Copy ID';
            copyIdBtn.classList.remove('copied');
          }, 1500);
        });
      });
    }
  } else if (copyIdBtn) {
    copyIdBtn.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════
// Reset Simulation
// ═══════════════════════════════════════════════════════════════

function resetSimulation() {
  robotState.x = 0;
  robotState.z = 0;
  robotState.rotation = Math.PI;
  robotState.velocity = 0;
  robotState.angularVelocity = 0;
  cmdVelocity = 0;
  cmdAngularVelocity = 0;
  pendingTurnAngle = 0;
  lastVelocityCmdTime = 0;
  lastAngularCmdTime = 0;
  commandActive = false;
  distanceTracking = false;
  targetDistance = 0;
  traveledDistance = 0;

  robot.position.x = 0;
  robot.position.z = 0;
  robot.rotation.y = Math.PI;

  if (arm.grabbedObject) {
    const worldPos = new THREE.Vector3();
    arm.grabbedObject.getWorldPosition(worldPos);
    environmentGroup.add(arm.grabbedObject);
    arm.grabbedObject.position.copy(worldPos);
    arm.grabbedObject.position.y = 0.25;
    arm.grabbedObject = null;
    arm.hasBall = false;
  }
  arm.state = 'idle';
  arm.targetRotations = { lowerArm: Math.PI / 4, elbow: Math.PI / 2.5, wrist: -Math.PI / 6 };

  if (ball) ball.position.set(0, 0.25, -5);
  if (bucket) bucket.position.set(0, 0.3, 5);

  // Clear trail
  trailPoints = [];
  trailFrameCounter = 0;
  if (trailLine) {
    trailLine.geometry.dispose();
    trailLine.geometry = new THREE.BufferGeometry();
    trailLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  }
}

// ═══════════════════════════════════════════════════════════════
// Debug UI
// ═══════════════════════════════════════════════════════════════

let prevKeyQ = false;
let prevKeyE = false;

function toggleDebugPanel() {
  debugPanelVisible = !debugPanelVisible;
  const panel = document.getElementById('debug-panel');
  if (panel) {
    panel.style.display = debugPanelVisible ? 'block' : 'none';
  }
}

function updateDebugInput() {
  if (!debugMode) return;

  const qDown = keyState['KeyQ'] ?? false;
  const eDown = keyState['KeyE'] ?? false;

  if (qDown && !prevKeyQ) doGrab();
  if (eDown && !prevKeyE) doRelease();

  prevKeyQ = qDown;
  prevKeyE = eDown;
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement;
}

function createDebugUI() {
  const style = document.createElement('style');
  style.textContent = `
    #debug-toggle {
      position: fixed; top: 12px; right: 12px; z-index: 1001;
      width: 40px; height: 40px; border: none; border-radius: 8px;
      background: rgba(30,30,50,0.85); color: #ccc; font-size: 22px;
      cursor: pointer; line-height: 40px; text-align: center;
      transition: background 0.2s;
    }
    #debug-toggle:hover { background: rgba(60,60,100,0.9); }
    #debug-toggle.active { background: rgba(80,120,200,0.85); color: #fff; }

    #debug-panel {
      position: fixed; top: 12px; right: 60px; z-index: 1000;
      width: 240px; max-height: calc(100vh - 24px); overflow-y: auto;
      background: rgba(20,20,40,0.92); color: #ddd; font: 13px/1.5 sans-serif;
      border-radius: 10px; padding: 14px; display: none;
      user-select: none;
    }
    #debug-panel h3 {
      margin: 0 0 6px; font-size: 15px; color: #fff;
      display: flex; justify-content: space-between; align-items: center;
    }
    #debug-panel h4 {
      margin: 12px 0 4px; font-size: 12px; text-transform: uppercase;
      color: #888; letter-spacing: 0.5px;
    }
    #debug-panel button {
      width: 100%; margin: 2px 0; padding: 6px 10px; border: none;
      border-radius: 5px; cursor: pointer; font-size: 13px;
      background: rgba(255,255,255,0.1); color: #ddd;
      transition: background 0.15s;
    }
    #debug-panel button:hover { background: rgba(255,255,255,0.2); }
    #debug-panel button:active { background: rgba(255,255,255,0.3); }
    #debug-panel .btn-close {
      width: auto; padding: 2px 8px; font-size: 16px; line-height: 1;
      background: transparent; color: #888;
    }
    #debug-panel .btn-close:hover { color: #fff; background: rgba(255,60,60,0.3); }
    #debug-panel .btn-stop { background: rgba(255,80,80,0.2); color: #f66; }
    #debug-panel .btn-stop:hover { background: rgba(255,80,80,0.35); }
    #debug-panel .btn-reset { background: rgba(255,180,40,0.2); color: #fb0; }
    #debug-panel .btn-reset:hover { background: rgba(255,180,40,0.35); }

    #debug-panel .dpad {
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px;
      width: fit-content; margin: 0 auto;
    }
    #debug-panel .dpad button { width: 44px; height: 36px; margin: 0; font-size: 16px; }

    #debug-panel label { display: block; margin-top: 4px; font-size: 11px; color: #aaa; }
    #debug-panel input[type="range"] { width: 100%; margin: 2px 0; accent-color: #7af; }

    #debug-panel .hint {
      margin-top: 10px; padding: 6px 8px; font-size: 11px; color: #888;
      background: rgba(255,255,255,0.04); border-radius: 4px; text-align: center;
    }
  `;
  document.head.appendChild(style);

  // Toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'debug-toggle';
  toggleBtn.innerHTML = '&#9881;';
  toggleBtn.title = 'Settings';
  if (debugMode) toggleBtn.classList.add('active');
  toggleBtn.addEventListener('click', () => {
    debugMode = !debugMode;
    if (debugMode) {
      toggleBtn.classList.add('active');
    } else {
      toggleBtn.classList.remove('active');
    }
    saveDebugState();
    if (!debugMode && debugPanelVisible) toggleDebugPanel();
    if (debugMode && !debugPanelVisible) toggleDebugPanel();
  });
  document.body.appendChild(toggleBtn);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  if (debugMode && debugPanelVisible) panel.style.display = 'block';

  // Header
  const header = document.createElement('h3');
  header.innerHTML = 'Settings';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', toggleDebugPanel);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Movement D-pad
  const movementH4 = document.createElement('h4');
  movementH4.textContent = 'Movement';
  panel.appendChild(movementH4);

  const dpad = document.createElement('div');
  dpad.className = 'dpad';

  const makeDpadBtn = (label: string, keys: string[]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('mousedown', () => keys.forEach(k => keyState[k] = true));
    btn.addEventListener('mouseup', () => keys.forEach(k => keyState[k] = false));
    btn.addEventListener('mouseleave', () => keys.forEach(k => keyState[k] = false));
    return btn;
  };

  dpad.appendChild(document.createElement('div'));
  dpad.appendChild(makeDpadBtn('\u2191', ['ArrowUp', 'KeyW']));
  dpad.appendChild(document.createElement('div'));

  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'S';
  stopBtn.className = 'btn-stop';
  stopBtn.addEventListener('click', () => {
    robotState.velocity = 0;
    robotState.angularVelocity = 0;
    cmdVelocity = 0;
    cmdAngularVelocity = 0;
    pendingTurnAngle = 0;
    lastVelocityCmdTime = 0;
    lastAngularCmdTime = 0;
    commandActive = false;
    distanceTracking = false;
  });
  dpad.appendChild(makeDpadBtn('\u2190', ['ArrowLeft', 'KeyA']));
  dpad.appendChild(stopBtn);
  dpad.appendChild(makeDpadBtn('\u2192', ['ArrowRight', 'KeyD']));

  dpad.appendChild(document.createElement('div'));
  dpad.appendChild(makeDpadBtn('\u2193', ['ArrowDown', 'KeyS']));
  dpad.appendChild(document.createElement('div'));

  panel.appendChild(dpad);

  // Actions
  const actionsH4 = document.createElement('h4');
  actionsH4.textContent = 'Actions';
  panel.appendChild(actionsH4);

  const grabBtn = document.createElement('button');
  grabBtn.textContent = 'Grab (Q)';
  grabBtn.addEventListener('click', doGrab);
  panel.appendChild(grabBtn);

  const releaseBtn = document.createElement('button');
  releaseBtn.textContent = 'Release (E)';
  releaseBtn.addEventListener('click', doRelease);
  panel.appendChild(releaseBtn);

  // Display
  const displayH4 = document.createElement('h4');
  displayH4.textContent = 'Display';
  panel.appendChild(displayH4);

  const trailBtn = document.createElement('button');
  trailBtn.textContent = showTrail ? 'Trail: ON' : 'Trail: OFF';
  trailBtn.addEventListener('click', () => {
    showTrail = !showTrail;
    trailBtn.textContent = showTrail ? 'Trail: ON' : 'Trail: OFF';
    if (trailLine) {
      trailLine.visible = showTrail;
      if (!showTrail) {
        trailPoints = [];
        trailFrameCounter = 0;
        trailLine.geometry.dispose();
        trailLine.geometry = new THREE.BufferGeometry();
        trailLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      }
    }
    saveDebugState();
  });
  panel.appendChild(trailBtn);

  // Reset
  const resetH4 = document.createElement('h4');
  resetH4.textContent = 'Reset';
  panel.appendChild(resetH4);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset Simulation';
  resetBtn.className = 'btn-reset';
  resetBtn.addEventListener('click', resetSimulation);
  panel.appendChild(resetBtn);

  // Speed
  const speedH4 = document.createElement('h4');
  speedH4.textContent = 'Speed';
  panel.appendChild(speedH4);

  const speedLabel = document.createElement('label');
  speedLabel.textContent = `Speed: ${speed.toFixed(1)} u/s`;
  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.min = '0.5';
  speedSlider.max = '20';
  speedSlider.step = '0.5';
  speedSlider.value = String(speed);
  speedSlider.addEventListener('input', () => {
    speed = parseFloat(speedSlider.value);
    speedLabel.textContent = `Speed: ${speed.toFixed(1)} u/s`;
    saveDebugState();
  });
  panel.appendChild(speedLabel);
  panel.appendChild(speedSlider);

  const turnLabel = document.createElement('label');
  turnLabel.textContent = `TurnSpeed: ${turnSpeed.toFixed(1)} rad/s`;
  const turnSlider = document.createElement('input');
  turnSlider.type = 'range';
  turnSlider.min = '0.5';
  turnSlider.max = '10';
  turnSlider.step = '0.5';
  turnSlider.value = String(turnSpeed);
  turnSlider.addEventListener('input', () => {
    turnSpeed = parseFloat(turnSlider.value);
    turnLabel.textContent = `TurnSpeed: ${turnSpeed.toFixed(1)} rad/s`;
    saveDebugState();
  });
  panel.appendChild(turnLabel);
  panel.appendChild(turnSlider);

  // Light
  const lightH4 = document.createElement('h4');
  lightH4.textContent = 'Light';
  panel.appendChild(lightH4);

  const makeLightSlider = (axis: string, min: number, max: number) => {
    const label = document.createElement('label');
    label.textContent = `${axis}: ${(lightPos as any)[axis.toLowerCase()]}`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = '1';
    slider.value = String((lightPos as any)[axis.toLowerCase()]);
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      (lightPos as any)[axis.toLowerCase()] = val;
      label.textContent = `${axis}: ${val}`;
      if (dirLight) {
        dirLight.position.set(lightPos.x, lightPos.y, lightPos.z);
        dirLight.shadow.camera.updateProjectionMatrix();
      }
      saveDebugState();
    });
    panel.appendChild(label);
    panel.appendChild(slider);
  };

  makeLightSlider('X', -30, 30);
  makeLightSlider('Y', -30, 30);
  makeLightSlider('Z', -30, 30);

  // Keyboard hint
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'WASD = move | Q/E = grab/release';
  panel.appendChild(hint);

  document.body.appendChild(panel);

  if (debugMode) {
    debugPanelVisible = true;
    panel.style.display = 'block';
  }
}

// ═══════════════════════════════════════════════════════════════
// Animation Loop
// ═══════════════════════════════════════════════════════════════

function animate() {
  requestAnimationFrame(animate);

  updateDebugInput();
  updatePhysics();
  updateArm();
  controls.update();
  updateTrail();
  renderer.render(scene, camera);

  // Render onboard camera
  renderOnboardCamera();

  // Report state at 10Hz
  const now = performance.now();
  if (now - lastReportTime >= REPORT_INTERVAL) {
    reportState();
    lastReportTime = now;
  }
}

// ═══════════════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════════════

function init() {
  loadDebugState();

  // Get DOM elements
  const container = document.getElementById('container')!;
  cameraCanvas = document.getElementById('camera-canvas') as HTMLCanvasElement;
  cameraCtx = cameraCanvas.getContext('2d')!;
  statusDot = document.getElementById('status-dot')!;
  statusText = document.getElementById('status-text')!;
  copyIdBtn = document.getElementById('copy-id-btn')!;
  logEntries = document.getElementById('log-entries')!;
  logClearBtn = document.getElementById('log-clear-btn')!;
  logClearBtn.addEventListener('click', () => { logEntries.innerHTML = ''; });

  // Scene
  scene = createScene();

  // Camera
  camera = createCamera(container.clientWidth, container.clientHeight);

  // Renderer
  renderer = createRenderer(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  // Lights + Floor
  dirLight = createLights(scene, lightPos);
  createFloor(scene);

  // Invisible ground for raycasting
  const groundGeo = new THREE.PlaneGeometry(160, 160);
  const groundMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  groundPlane = new THREE.Mesh(groundGeo, groundMat);
  groundPlane.rotation.x = -Math.PI / 2;
  groundPlane.name = 'ground';
  scene.add(groundPlane);

  // Environment
  environmentGroup = new THREE.Group();
  scene.add(environmentGroup);
  setupEnvironment();

  // Robot
  const parts = createRobot(scene);
  robot = parts.robot;
  wheels = parts.wheelMeshes;
  onboardCamera = parts.onboardCamera;
  onboardRenderTarget = parts.onboardRenderTarget;
  robot.rotation.y = Math.PI;

  arm = {
    lowerArm: parts.lowerArm,
    elbow: parts.elbow,
    wrist: parts.wrist,
    gripper: parts.gripper,
    state: 'idle',
    hasBall: false,
    grabbedObject: null,
    targetRotations: { lowerArm: Math.PI / 4, elbow: Math.PI / 2.5, wrist: -Math.PI / 6 },
  };

  scene.add(robot);

  // Trail line
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  const trailMat = new THREE.LineBasicMaterial({ color: 0x4ade80, linewidth: 1, depthTest: true });
  trailLine = new THREE.Line(trailGeo, trailMat);
  trailLine.visible = showTrail;
  scene.add(trailLine);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 4;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.update();

  // Events
  renderer.domElement.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', onResize);

  // Hide loading spinner
  document.getElementById('loading')?.classList.add('hidden');

  // Connect WebSocket
  const socket = connectSocket();

  // Register command handler
  onCommand(handleCommand);

  // Update connection status periodically
  setInterval(updateConnectionStatus, 1000);

  // Debug UI
  createDebugUI();

  // Go
  animate();
}

// ═══════════════════════════════════════════════════════════════
// Keyboard Events (debug mode)
// ═══════════════════════════════════════════════════════════════

window.addEventListener('keydown', (e) => {
  if (!debugMode) return;
  if (isInputFocused()) return;
  if (DEBUG_KEYS.includes(e.code)) {
    e.preventDefault();
    keyState[e.code] = true;
  }
});

window.addEventListener('keyup', (e) => {
  if (!debugMode) return;
  if (DEBUG_KEYS.includes(e.code)) {
    keyState[e.code] = false;
  }
});

init();
