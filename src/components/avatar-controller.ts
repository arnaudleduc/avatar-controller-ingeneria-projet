import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { capitalizeFirstLetter } from "../utils/string-utils.js";

@customElement("avatar-controller")
export class AvatarController extends LitElement {
  // Propriétés du composant
  @property({ type: String })
  modelUrl = "";

  @property({ type: Number })
  width = 400;

  @property({ type: Number })
  height = 400;

  @property({ type: Boolean })
  autoplay = false;

  // État interne
  @state()
  private _isLoading = false;

  @state()
  private _currentAnimation: string | null = null;

  @state()
  private _modelLoaded = false;

  // Références aux objets Three.js
  private _scene: THREE.Scene | null = null;
  private _camera: THREE.PerspectiveCamera | null = null;
  private _renderer: THREE.WebGLRenderer | null = null;
  private _mixer: THREE.AnimationMixer | null = null;
  private _model: THREE.Group | null = null;
  private _animations: Map<string, THREE.AnimationAction> = new Map();
  private _animationNames: string[] = [];
  private _lastFrameTime: number = performance.now();
  private _controls: OrbitControls | null = null;

  // Styles du composant
  static styles = css`
    :host {
      display: block;
    }

    .container {
      position: relative;
      width: 100%;
      height: 100%;
    }

    .loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 1.2em;
    }

    .controls {
      position: absolute;
      bottom: 0;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 20px;
      z-index: 1;
      max-width: 580px;
      overflow-x: auto;
      padding: 10px;
      scrollbar-width: thin;
      scrollbar-color: #4287f5 #f0f0f0;
    }

    .controls::-webkit-scrollbar {
      height: 6px;
    }

    .controls::-webkit-scrollbar-track {
      background: #f0f0f0;
      border-radius: 3px;
    }

    .controls::-webkit-scrollbar-thumb {
      background-color: #4287f5;
      border-radius: 3px;
    }

    button {
      width: 100px;
      padding: 16px 16px;
      border: none;
      border-radius: 4px;
      background-color: #4287f5;
      color: white;
      cursor: pointer;
      transition: background-color 0.3s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: center;
      flex-shrink: 0;
    }

    button:hover {
      background-color: #16339c;
    }

    button:disabled {
      background-color: #cccccc;
      cursor: not-allowed;
    }
  `;

  // Méthodes du cycle de vie
  firstUpdated() {
    this._initScene();
  }

  updated(changedProperties: Map<string, any>) {
    if (
      changedProperties.has("modelUrl") &&
      this.modelUrl &&
      !this._modelLoaded
    ) {
      // Utiliser une microtask pour éviter les cycles de mise à jour
      Promise.resolve().then(() => this._loadModel());
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._cleanup();
  }

  // Méthodes privées
  private async _initScene() {
    // Création de la scène
    this._scene = new THREE.Scene();

    // Configuration de la caméra
    this._camera = new THREE.PerspectiveCamera(
      75,
      this.width / this.height,
      0.1,
      1000
    );
    this._camera.position.z = 2.5;

    // Configuration du renderer
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(this.width, this.height);
    this._renderer.setPixelRatio(window.devicePixelRatio);
    // Configuration HDR
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Insérer le canvas dans la div dédiée du template
    const canvasContainer = this.shadowRoot?.getElementById("three-canvas");
    if (canvasContainer) {
      canvasContainer.innerHTML = "";
      canvasContainer.appendChild(this._renderer.domElement);

      // Créer les orbit controls après un court délai pour s'assurer que le canvas est bien attaché
      setTimeout(() => {
        this._setupOrbitControls();
      }, 100);
    }

    // Chargement de la HDR en background
    try {
      const hdrLoader = new RGBELoader();
      const pmremGenerator = new THREE.PMREMGenerator(this._renderer);
      pmremGenerator.compileEquirectangularShader();
      const texture = await hdrLoader.loadAsync("/images/dojoHDR.hdr");
      const envMap = pmremGenerator.fromEquirectangular(texture).texture;
      this._scene.environment = envMap;
      this._scene.background = envMap;
      texture.dispose();
      pmremGenerator.dispose();
    } catch (e) {
      // Si la HDR ne se charge pas, on garde le fond gris
      this._scene.background = new THREE.Color(0x808080);
      console.error("Erreur lors du chargement de la HDR :", e);
    }

    // Ajout de lumières
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this._scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    this._scene.add(directionalLight);

    // Démarrage de la boucle de rendu
    this._animate();
  }

  private _setupOrbitControls() {
    if (!this._camera || !this._renderer) return;

    // Configuration des orbit controls
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.05;
    this._controls.enableZoom = true;
    this._controls.enablePan = false;
    this._controls.minDistance = 1;
    this._controls.maxDistance = 10;
    this._controls.maxPolarAngle = Math.PI;
  }

  private async _loadModel() {
    if (!this._scene) return;

    this._isLoading = true;
    this._modelLoaded = false;
    this._cleanup();

    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(this.modelUrl);

      this._model = gltf.scene;
      this._scene.add(this._model);

      // Configuration de l'animation mixer
      this._animationNames = [];
      if (gltf.animations.length > 0) {
        this._mixer = new THREE.AnimationMixer(this._model);
        gltf.animations.forEach((animation) => {
          const action = this._mixer?.clipAction(animation);
          if (action) {
            this._animations.set(animation.name, action);
            this._animationNames.push(animation.name);
          }
        });
        // Log des animations disponibles
      } else {
        console.log("Aucune animation trouvée dans ce modèle.");
      }

      // Centrer et ajuster la taille du modèle
      const box = new THREE.Box3().setFromObject(this._model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      this._model.scale.multiplyScalar(scale);

      this._model.position.sub(center.multiplyScalar(scale));

      this._modelLoaded = true;
    } catch (error) {
      console.error("Erreur lors du chargement du modèle:", error);
    } finally {
      this._isLoading = false;
    }
  }

  private _animate() {
    if (!this._renderer || !this._scene || !this._camera) return;

    requestAnimationFrame(() => this._animate());

    // Calcul du vrai deltaTime
    const now = performance.now();
    const delta = (now - this._lastFrameTime) / 1000; // en secondes
    this._lastFrameTime = now;

    if (this._mixer) {
      this._mixer.update(delta);
    }

    // Mise à jour des controls
    if (this._controls) {
      this._controls.update();
    }

    this._renderer.render(this._scene, this._camera);
  }

  private _cleanup() {
    if (this._scene) {
      // Retirer tous les objets de type 'Scene' (modèles) de la scène
      this._scene.children
        .filter((obj) => obj.type === "Scene")
        .forEach((obj) => this._scene!.remove(obj));
    }
    if (this._controls) {
      this._controls.dispose();
      this._controls = null;
    }
    this._model = null;
    this._mixer = null;
    this._animations.clear();
  }

  // Gestionnaires d'événements
  private _playAnimation(animationName: string) {
    const action = this._animations.get(animationName);
    if (!action || this._currentAnimation === animationName) return;

    // Arrêter toutes les autres animations sauf celle à jouer
    this._animations.forEach((a, name) => {
      if (name !== animationName) {
        a.fadeOut(0.5);
      }
    });

    // Blending smooth entre animations
    if (this._currentAnimation) {
      const currentAction = this._animations.get(this._currentAnimation);
      if (currentAction) {
        action.enabled = true;
        action.crossFadeFrom(currentAction, 0.5, false);
      } else {
        action.fadeIn(0.5);
      }
    } else {
      action.fadeIn(0.5);
    }
    action.play();
    this._currentAnimation = animationName;

    // Émettre un événement personnalisé
    this.dispatchEvent(
      new CustomEvent("animation-start", {
        detail: { animation: animationName },
      })
    );

    // Écouter la fin de l'animation
    action.getMixer().addEventListener("finished", () => {
      this._currentAnimation = null;
      this.dispatchEvent(
        new CustomEvent("animation-end", {
          detail: { animation: animationName },
        })
      );
    });
  }

  // Template du composant
  render() {
    return html`
      <div
        class="container"
        style="width: ${this.width}px; height: ${this.height}px;"
      >
        <div id="three-canvas"></div>
        ${this._isLoading ? html`<div class="loading">Chargement...</div>` : ""}
        <div class="controls">
          ${this._animationNames.map(
            (name) => html`
              <button
                @click=${() => this._playAnimation(name)}
                ?disabled=${this._isLoading || this._currentAnimation === name}
              >
                ${capitalizeFirstLetter(name)}
              </button>
            `
          )}
        </div>
      </div>
    `;
  }
}
