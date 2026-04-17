import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, SMAA } from "@react-three/postprocessing";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Box3, DoubleSide, Path, Shape, SRGBColorSpace, TextureLoader, Vector3 } from "three";
import type { Group, Mesh, MeshStandardMaterial, Object3D, Texture } from "three";
import type { HexTile } from "../types";
import { BIOME_ASSET_KEY, MAP_3D_ASSETS, type Map3dAssetConfig, type Map3dAssetKey } from "../config/map3dAssets";
import { generateTilePropPlan, type PropInstancePlan } from "../config/map3dProps";
import { colorFromAddress } from "../utils/helpers/converters";
import { biomeResourceMeta } from "./biomeResourceMeta";

type Props = {
  hexes: HexTile[];
  myAddress?: string;
  selectedHex?: string;
  earthquakeTargets?: string[];
  onHexClick: (hexId: string) => void;
  contextMenuActions?: HexContextMenuActions;
};

type HexContextMenuAction = {
  visible?: boolean | ((hexId: string) => boolean);
  enabled: boolean | ((hexId: string) => boolean);
  label: string | ((hexId: string) => string);
  hint?: string | ((hexId: string) => string);
  details?: ReactNode | ((hexId: string) => ReactNode);
  onClick: (hexId: string) => void;
};

type HexContextMenuActions = {
  discover?: HexContextMenuAction;
  build?: HexContextMenuAction;
  upgrade?: HexContextMenuAction;
  collect?: HexContextMenuAction;
};

const biomeStyle: Record<string, { base: string; edge: string; glow: string; resource: string }> = {
  Plains: { base: "#b9db6f", edge: "#ffd369", glow: "#ecffb0", resource: "food" },
  Forest: { base: "#4cbc79", edge: "#5bff9d", glow: "#9fffc8", resource: "wood" },
  Mountains: { base: "#5f84cf", edge: "#9cc4ff", glow: "#d1e4ff", resource: "stone/ore" },
  Desert: { base: "#e49b55", edge: "#ffad69", glow: "#ffd8b0", resource: "energy" }
};

const HEX_RADIUS = 1.9;
const PROP_TARGET_FOOTPRINT = 0.95;
const PROP_DEBUG_ENABLED = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_MAP3D_PROP_DEBUG || "").toLowerCase()
);

const tilePosition = (q: number, r: number) => {
  const x = HEX_RADIUS * Math.sqrt(3) * (q + r / 2);
  const z = HEX_RADIUS * 1.5 * r;
  return [x, z] as const;
};

type AssetLoadState = {
  status: "idle" | "loading" | "ready" | "failed";
  scene?: Object3D;
  error?: string;
};

type TextureLoadState = {
  status: "idle" | "loading" | "ready" | "failed";
  texture?: Texture;
  error?: string;
};

type NormalizedTransform = {
  position: [number, number, number];
  scale: [number, number, number];
  topY: number;
};

const ASSET_KEYS = Object.keys(MAP_3D_ASSETS) as Map3dAssetKey[];

function useMapAssets() {
  const [assets, setAssets] = useState<Record<Map3dAssetKey, AssetLoadState>>(() =>
    ASSET_KEYS.reduce((acc, key) => {
      acc[key] = { status: "idle" };
      return acc;
    }, {} as Record<Map3dAssetKey, AssetLoadState>)
  );

  useEffect(() => {
    let disposed = false;
    const loader = new GLTFLoader();

    for (const key of ASSET_KEYS) {
      const definition = MAP_3D_ASSETS[key];
      if (!definition.url) {
        setAssets((prev) => ({ ...prev, [key]: { status: "failed" } }));
        continue;
      }

      setAssets((prev) => ({ ...prev, [key]: { status: "loading" } }));
      loader.load(
        definition.url,
        (gltf) => {
          if (disposed) return;
          setAssets((prev) => ({ ...prev, [key]: { status: "ready", scene: gltf.scene } }));
        },
        undefined,
        () => {
          if (disposed) return;
          setAssets((prev) => ({ ...prev, [key]: { status: "failed" } }));
        }
      );
    }

    return () => {
      disposed = true;
    };
  }, []);

  return assets;
}

function useMapTextures() {
  const [textures, setTextures] = useState<Record<Map3dAssetKey, TextureLoadState>>(() =>
    ASSET_KEYS.reduce((acc, key) => {
      acc[key] = { status: "idle" };
      return acc;
    }, {} as Record<Map3dAssetKey, TextureLoadState>)
  );

  useEffect(() => {
    let disposed = false;
    const loader = new TextureLoader();

    for (const key of ASSET_KEYS) {
      const definition = MAP_3D_ASSETS[key];
      if (!definition.textureUrl) {
        setTextures((prev) => ({ ...prev, [key]: { status: "failed" } }));
        continue;
      }

      setTextures((prev) => ({ ...prev, [key]: { status: "loading" } }));
      loader.load(
        definition.textureUrl,
        (texture) => {
          if (disposed) return;
          texture.colorSpace = SRGBColorSpace;
          texture.flipY = false;
          texture.needsUpdate = true;
          setTextures((prev) => ({ ...prev, [key]: { status: "ready", texture } }));
        },
        undefined,
        () => {
          if (disposed) return;
          setTextures((prev) => ({ ...prev, [key]: { status: "failed" } }));
        }
      );
    }

    return () => {
      disposed = true;
    };
  }, []);

  return textures;
}

function useGltfLibrary(urls: string[]) {
  const [assets, setAssets] = useState<Record<string, AssetLoadState>>({});
  const requestedRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    const timeoutMs = 15000;

    for (const url of urls) {
      if (!url || requestedRef.current.has(url)) continue;
      requestedRef.current.add(url);
      setAssets((prev) => ({ ...prev, [url]: { status: "loading" } }));

      const timeout = setTimeout(() => {
        setAssets((prev) => {
          if (prev[url]?.status !== "loading") return prev;
          return { ...prev, [url]: { status: "failed", error: "timeout" } };
        });
      }, timeoutMs);

      loader
        .loadAsync(url)
        .then((gltf) => {
          clearTimeout(timeout);
          setAssets((prev) => ({ ...prev, [url]: { status: "ready", scene: gltf.scene } }));
        })
        .catch((err) => {
          clearTimeout(timeout);
          const message = err instanceof Error ? err.message : String(err);
          setAssets((prev) => ({ ...prev, [url]: { status: "failed", error: message } }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [urls]);

  return assets;
}

function useTextureLibrary(urls: string[]) {
  const [textures, setTextures] = useState<Record<string, TextureLoadState>>({});
  const requestedRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const loader = new TextureLoader();
    const timeoutMs = 12000;

    for (const url of urls) {
      if (!url || requestedRef.current.has(url)) continue;
      requestedRef.current.add(url);
      setTextures((prev) => ({ ...prev, [url]: { status: "loading" } }));

      const timeout = setTimeout(() => {
        setTextures((prev) => {
          if (prev[url]?.status !== "loading") return prev;
          return { ...prev, [url]: { status: "failed", error: "timeout" } };
        });
      }, timeoutMs);

      new Promise<Texture>((resolve, reject) => {
        loader.load(
          url,
          (texture) => resolve(texture),
          undefined,
          (err) => reject(err)
        );
      })
        .then((texture) => {
          clearTimeout(timeout);
          texture.colorSpace = SRGBColorSpace;
          texture.flipY = false;
          texture.needsUpdate = true;
          setTextures((prev) => ({ ...prev, [url]: { status: "ready", texture } }));
        })
        .catch((err) => {
          clearTimeout(timeout);
          const message = err instanceof Error ? err.message : String(err);
          setTextures((prev) => ({ ...prev, [url]: { status: "failed", error: message } }));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [urls]);

  return textures;
}

function PropInstanceMesh({
  plan,
  assetState,
  textureState,
  debugEnabled,
  surfaceY
}: {
  plan: PropInstancePlan;
  assetState?: AssetLoadState;
  textureState?: TextureLoadState;
  debugEnabled: boolean;
  surfaceY: number;
}) {
  const propAssetInstance = useMemo(
    () => (assetState?.status === "ready" && assetState.scene ? assetState.scene.clone(true) : null),
    [assetState?.scene, assetState?.status]
  );
  const canUsePropAsset = Boolean(propAssetInstance);

  const normalizedPropTransform = useMemo<NormalizedTransform>(() => {
    const defaultScale = plan.scale;
    if (!assetState?.scene) {
      return {
        position: plan.position,
        scale: defaultScale
      };
    }

    const box = new Box3().setFromObject(assetState.scene);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);
    const footprint = Math.max(size.x, size.z, 0.0001);
    const fitScale = PROP_TARGET_FOOTPRINT / footprint;

    return {
      position: [
        plan.position[0],
        surfaceY + plan.position[1],
        plan.position[2]
      ],
      scale: [
        defaultScale[0] * fitScale,
        defaultScale[1] * fitScale,
        defaultScale[2] * fitScale
      ]
    };
  }, [assetState?.scene, plan.position, plan.scale, surfaceY]);

  useEffect(() => {
    const texture = textureState?.status === "ready" ? textureState.texture : undefined;
    if (!propAssetInstance || !texture) return;

    propAssetInstance.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => {
          const m = (material as MeshStandardMaterial).clone();
          m.map = texture;
          m.alphaMap = null;
          m.transparent = true;
          m.alphaTest = 0.5;
          m.color.set("#ffffff");
          m.metalness = 0;
          m.roughness = 1;
          m.emissiveMap = texture;
          m.emissive.set("#ffffff");
          m.emissiveIntensity = 0.25;
          m.side = DoubleSide;
          m.needsUpdate = true;
          return m;
        });
      } else {
        const material = (mesh.material as MeshStandardMaterial).clone();
        material.map = texture;
        material.alphaMap = null;
        material.transparent = true;
        material.alphaTest = 0.5;
        material.color.set("#ffffff");
        material.metalness = 0;
        material.roughness = 1;
        material.emissiveMap = texture;
        material.emissive.set("#ffffff");
        material.emissiveIntensity = 0.25;
        material.side = DoubleSide;
        material.needsUpdate = true;
        mesh.material = material;
      }
    });
  }, [propAssetInstance, textureState?.status, textureState?.texture]);

  if (!canUsePropAsset) {
    if (!debugEnabled) return null;
    return (
      <mesh position={[plan.position[0], surfaceY + plan.position[1], plan.position[2]]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color={assetState?.status === "failed" ? "#ff6b6b" : "#ffd369"} />
      </mesh>
    );
  }

  return (
    <primitive
      object={propAssetInstance!}
      position={normalizedPropTransform.position}
      rotation={plan.rotation}
      scale={normalizedPropTransform.scale}
    />
  );
}

function HexTileMesh({
  hex,
  selected,
  hovered,
  mine,
  quake,
  biomeAssetConfig,
  biomeAssetState,
  structureAssetConfig,
  structureAssetState,
  biomeTextureState,
  propPlans,
  propAssetsByUrl,
  propTexturesByUrl,
  debugProps,
  onHover,
  onSelect,
  onOpenContext
}: {
  hex: HexTile;
  selected: boolean;
  hovered: boolean;
  mine: boolean;
  quake: boolean;
  biomeAssetConfig?: Map3dAssetConfig;
  biomeAssetState?: AssetLoadState;
  structureAssetConfig?: Map3dAssetConfig;
  structureAssetState?: AssetLoadState;
  biomeTextureState?: TextureLoadState;
  propPlans: PropInstancePlan[];
  propAssetsByUrl: Record<string, AssetLoadState>;
  propTexturesByUrl: Record<string, TextureLoadState>;
  debugProps: boolean;
  onHover: (hexId?: string) => void;
  onSelect: (hexId: string) => void;
  onOpenContext: (hexId: string, clientX: number, clientY: number) => void;
}) {
  const groupRef = useRef<Group>(null);
  const [x, z] = tilePosition(hex.q, hex.r);
  const biome = biomeStyle[hex.biome];
  const ownerColor = colorFromAddress(hex.owner);
  const level = hex.structure?.level ?? 0;
  const baseHeight = 0.6 + (hex.biome === "Mountains" ? 0.25 : 0) + (hex.biome === "Desert" ? -0.08 : 0);
  const pulse = selected ? 1.12 : hovered ? 1.07 : 1;
  const highlightColor = selected ? "#ffffff" : "#56f0ff";
  const highlightOpacity = selected ? 0.95 : hovered ? 0.8 : 0;
  const biomeAssetInstance = useMemo(
    () => (biomeAssetState?.status === "ready" && biomeAssetState.scene ? biomeAssetState.scene.clone(true) : null),
    [biomeAssetState?.scene, biomeAssetState?.status]
  );
  const materialsRef = useRef<MeshStandardMaterial[]>([]);
  const fallbackMaterialRef = useRef<MeshStandardMaterial>(null);
  const structureAssetInstance = useMemo(
    () =>
      level > 0 && structureAssetState?.status === "ready" && structureAssetState.scene
        ? structureAssetState.scene.clone(true)
        : null,
    [level, structureAssetState?.scene, structureAssetState?.status]
  );
  const hasTextureOverride = Boolean(biomeAssetConfig?.textureUrl);
  const canUseBiomeAsset = Boolean(
    biomeAssetInstance && (!hasTextureOverride || biomeTextureState?.status === "ready")
  );
  const normalizedBiomeTransform = useMemo<NormalizedTransform>(() => {
    const defaultScale = biomeAssetConfig?.scale ?? [1, 1, 1];
    if (!biomeAssetState?.scene) {
      return {
        position: biomeAssetConfig?.position ?? [0, -baseHeight / 2, 0],
        scale: defaultScale,
        topY: baseHeight / 2 + 0.02
      };
    }

    const box = new Box3().setFromObject(biomeAssetState.scene);
    const size = new Vector3();
    const center = new Vector3();
    box.getSize(size);
    box.getCenter(center);
    const footprint = Math.max(size.x, size.z, 0.0001);
    const fitScale = (HEX_RADIUS * 2) / footprint;
    const positionY = biomeAssetConfig?.position?.[1] ?? -box.min.y * fitScale;
    const scaleY = defaultScale[1] * fitScale;

    return {
      position: [
        -center.x * fitScale,
        positionY,
        -center.z * fitScale
      ],
      scale: [
        defaultScale[0] * fitScale,
        defaultScale[1] * fitScale,
        defaultScale[2] * fitScale
      ],
      topY: positionY + box.max.y * scaleY + 0.02
    };
  }, [baseHeight, biomeAssetConfig?.position, biomeAssetConfig?.scale, biomeAssetState?.scene]);
  const tileTopY = baseHeight / 2 + normalizedBiomeTransform.topY;
  const ownerBorderHeight = tileTopY / 3;
  const ownerBorderBottomY = tileTopY * 0.75;
  const ownerBorderCenterY = ownerBorderBottomY + ownerBorderHeight / 2;
  const ownerBorderOuterRadius = HEX_RADIUS * 1.02;
  const ownerBorderInnerRadius = HEX_RADIUS * 0.87;
  const ownerBorderTopShape = useMemo(() => {
    const outer = new Shape();
    const capYaw = Math.PI / 6;
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i + capYaw;
      const x = Math.cos(angle) * ownerBorderOuterRadius;
      const y = Math.sin(angle) * ownerBorderOuterRadius;
      if (i === 0) outer.moveTo(x, y);
      else outer.lineTo(x, y);
    }
    outer.closePath();

    const hole = new Path();
    for (let i = 5; i >= 0; i -= 1) {
      const angle = (Math.PI / 3) * i + capYaw;
      const x = Math.cos(angle) * ownerBorderInnerRadius;
      const y = Math.sin(angle) * ownerBorderInnerRadius;
      if (i === 5) hole.moveTo(x, y);
      else hole.lineTo(x, y);
    }
    hole.closePath();
    outer.holes.push(hole);
    return outer;
  }, [ownerBorderInnerRadius, ownerBorderOuterRadius]);

  useEffect(() => {
    const texture = biomeTextureState?.status === "ready" ? biomeTextureState.texture : undefined;
    if (!biomeAssetInstance) return;

    const materials: MeshStandardMaterial[] = [];

    biomeAssetInstance.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((material) => {
          const m = (material as MeshStandardMaterial).clone();
          if (texture) {
            m.map = texture;
            m.alphaMap = null;
            m.transparent = false;
            m.alphaTest = 0;
          }
          m.color.set("#ffffff");
          m.metalness = 0;
          m.roughness = 1;
          if (texture) {
            m.emissiveMap = texture;
          }
          m.emissive.set(biome.glow);
          m.emissiveIntensity = 0;
          m.side = DoubleSide;
          m.needsUpdate = true;
          materials.push(m);
          return m;
        });
      } else {
        const material = (mesh.material as MeshStandardMaterial).clone();
        if (texture) {
          material.map = texture;
          material.alphaMap = null;
          material.transparent = false;
          material.alphaTest = 0;
        }
        material.color.set("#ffffff");
        material.metalness = 0;
        material.roughness = 1;
        if (texture) {
          material.emissiveMap = texture;
        }
        material.emissive.set(biome.glow);
        material.emissiveIntensity = 0;
        material.side = DoubleSide;
        material.needsUpdate = true;
        mesh.material = material;
        materials.push(material);
      }
    });

    materialsRef.current = materials;
  }, [biome.glow, biomeAssetInstance, biomeTextureState?.status, biomeTextureState?.texture]);

  const targetY = selected ? 0.3 : hovered ? 0.15 : 0;

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.position.x = x + (quake ? Math.sin(clock.elapsedTime * 42) * 0.08 : 0);
    groupRef.current.position.y += (targetY - groupRef.current.position.y) * 0.15;

    const pulseIntensity = selected ? 0.85 + Math.sin(clock.elapsedTime * 5) * 0.45 : hovered ? 0.2 : mine ? 0.1 : 0;
    if (canUseBiomeAsset) {
      const emissiveColor = selected || hovered ? biome.glow : mine ? "#56f0ff" : "#000000";
      for (const mat of materialsRef.current) {
        mat.emissive.set(emissiveColor);
        if (mat.emissiveIntensity !== pulseIntensity) {
          mat.emissiveIntensity = pulseIntensity;
        }
      }
    } else if (fallbackMaterialRef.current) {
      fallbackMaterialRef.current.emissive.set(selected || hovered ? biome.glow : mine ? "#56f0ff" : "#000000");
      fallbackMaterialRef.current.emissiveIntensity = selected
        ? 0.32 + Math.sin(clock.elapsedTime * 5) * 0.16
        : hovered
          ? 0.16
          : mine
            ? 0.08
            : 0;
    }
  });

  return (
    <group ref={groupRef} position={[x, 0, z]}>
      <group
        position={[0, baseHeight / 2, 0]}
        rotation={[0, Math.PI / 6, 0]}
        scale={[pulse, 1, pulse]}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(hex.id);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          onHover(undefined);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(hex.id);
        }}
        onContextMenu={(event) => {
          event.stopPropagation();
          const native = event.nativeEvent as MouseEvent;
          native.preventDefault();
          onSelect(hex.id);
          onOpenContext(hex.id, native.clientX, native.clientY);
        }}
      >
        {canUseBiomeAsset ? (
          <primitive
            object={biomeAssetInstance!}
            position={normalizedBiomeTransform.position}
            rotation={biomeAssetConfig?.rotation ?? [0, 0, 0]}
            scale={normalizedBiomeTransform.scale}
          />
        ) : (
          <mesh>
            <cylinderGeometry args={[HEX_RADIUS, HEX_RADIUS, baseHeight, 6]} />
            <meshStandardMaterial
              ref={fallbackMaterialRef}
              color={biome.base}
              metalness={0.15}
              roughness={0.62}
              emissive={selected || hovered ? biome.glow : mine ? "#56f0ff" : "#000000"}
              emissiveIntensity={selected ? 0.2 : hovered ? 0.16 : mine ? 0.08 : 0}
            />
          </mesh>
        )}

        {propPlans.map((plan, index) => (
          <PropInstanceMesh
            key={`${hex.id}:prop:${plan.assetId}:${index}`}
            plan={plan}
            assetState={propAssetsByUrl[plan.url]}
            textureState={plan.textureUrl ? propTexturesByUrl[plan.textureUrl] : undefined}
            debugEnabled={debugProps}
            surfaceY={normalizedBiomeTransform.topY}
          />
        ))}

        {debugProps
          ? propPlans.map((plan, index) => (
              <mesh
                key={`${hex.id}:prop-debug:${plan.assetId}:${index}`}
                position={[plan.position[0], normalizedBiomeTransform.topY + plan.position[1], plan.position[2]]}
              >
                <sphereGeometry args={[0.035, 10, 10]} />
                <meshBasicMaterial color="#56f0ff" />
              </mesh>
            ))
          : null}
      </group>

      {hex.owner ? (
        <group position={[0, ownerBorderCenterY, 0]}>
          <mesh>
            <cylinderGeometry args={[ownerBorderOuterRadius, ownerBorderOuterRadius, ownerBorderHeight, 6, 1, true]} />
            <meshBasicMaterial
              color={ownerColor}
              side={DoubleSide}
              transparent
              opacity={selected ? 0.95 : hovered ? 0.86 : 0.78}
            />
          </mesh>
          <mesh>
            <cylinderGeometry args={[ownerBorderInnerRadius, ownerBorderInnerRadius, ownerBorderHeight, 6, 1, true]} />
            <meshBasicMaterial
              color={ownerColor}
              side={DoubleSide}
              transparent
              opacity={selected ? 0.95 : hovered ? 0.86 : 0.78}
            />
          </mesh>
          <mesh position={[0, ownerBorderHeight / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <shapeGeometry args={[ownerBorderTopShape]} />
            <meshBasicMaterial
              color={ownerColor}
              side={DoubleSide}
              transparent
              opacity={selected ? 0.95 : hovered ? 0.86 : 0.78}
            />
          </mesh>
        </group>
      ) : null}

      {level > 0 ? (
        <group position={[0, baseHeight + 0.18, 0]}>
          {structureAssetInstance ? (
            <primitive
              object={structureAssetInstance}
              position={structureAssetConfig?.position ?? [0, 0, 0]}
              rotation={structureAssetConfig?.rotation ?? [0, 0, 0]}
              scale={structureAssetConfig?.scale ?? [1, 1, 1]}
            />
          ) : (
            <>
              <mesh position={[0, 0.2, 0]}>
                <cylinderGeometry args={[0.38, 0.48, 0.34, 6]} />
                <meshStandardMaterial color={ownerColor} roughness={0.5} metalness={0.2} />
              </mesh>
              {level >= 2 ? (
                <>
                  <mesh position={[0, 0.58, 0]}>
                    <boxGeometry args={[0.35, 0.44, 0.35]} />
                    <meshStandardMaterial color="#f6f9ff" roughness={0.4} metalness={0.1} />
                  </mesh>
                  <mesh position={[0, 0.91, 0]}>
                    <coneGeometry args={[0.24, 0.32, 6]} />
                    <meshStandardMaterial color={ownerColor} roughness={0.45} metalness={0.18} />
                  </mesh>
                </>
              ) : (
                <mesh position={[0, 0.55, 0]}>
                  <coneGeometry args={[0.29, 0.36, 6]} />
                  <meshStandardMaterial color="#f6f9ff" roughness={0.45} metalness={0.08} />
                </mesh>
              )}
            </>
          )}
        </group>
      ) : null}
    </group>
  );
}

export function HexMap({ hexes, myAddress, selectedHex, onHexClick, earthquakeTargets = [], contextMenuActions }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const quakeSet = useMemo(() => new Set(earthquakeTargets), [earthquakeTargets]);
  const [hoveredHex, setHoveredHex] = useState<string | undefined>();
  const [contextMenu, setContextMenu] = useState<{ hexId: string; x: number; y: number } | null>(null);
  const [debugProps] = useState(() => {
    if (typeof window === "undefined") return PROP_DEBUG_ENABLED;
    const local = window.localStorage.getItem("cryptocatan:map3d-prop-debug");
    if (local == null) return PROP_DEBUG_ENABLED;
    return ["1", "true", "yes", "on"].includes(local.toLowerCase());
  });
  const assets = useMapAssets();
  const textures = useMapTextures();
  const propPlansByHex = useMemo(() => {
    const plans: Record<string, PropInstancePlan[]> = {};
    for (const hex of hexes) {
      plans[hex.id] = generateTilePropPlan(hex);
    }
    return plans;
  }, [hexes]);
  const propUrls = useMemo(
    () => {
      const urls = new Set<string>();
      for (const plans of Object.values(propPlansByHex) as PropInstancePlan[][]) {
        for (const plan of plans) {
          if (plan.url) urls.add(plan.url);
        }
      }
      return Array.from(urls);
    },
    [propPlansByHex]
  );
  const propTextureUrls = useMemo(
    () => {
      const urls = new Set<string>();
      for (const plans of Object.values(propPlansByHex) as PropInstancePlan[][]) {
        for (const plan of plans) {
          if (plan.textureUrl) urls.add(plan.textureUrl);
        }
      }
      return Array.from(urls);
    },
    [propPlansByHex]
  );
  const propAssetsByUrl = useGltfLibrary(propUrls);
  const propTexturesByUrl = useTextureLibrary(propTextureUrls);
  const propDebugStats = useMemo(() => {
    let totalPlanned = 0;
    for (const plans of Object.values(propPlansByHex) as PropInstancePlan[][]) {
      totalPlanned += plans.length;
    }
    const totalModels = propUrls.length;
    const modelsLoading = propUrls.filter((url) => propAssetsByUrl[url]?.status === "loading").length;
    const modelsReady = propUrls.filter((url) => propAssetsByUrl[url]?.status === "ready").length;
    const modelsFailed = propUrls.filter((url) => propAssetsByUrl[url]?.status === "failed").length;
    const totalTextures = propTextureUrls.length;
    const texturesLoading = propTextureUrls.filter((url) => propTexturesByUrl[url]?.status === "loading").length;
    const texturesReady = propTextureUrls.filter((url) => propTexturesByUrl[url]?.status === "ready").length;
    const texturesFailed = propTextureUrls.filter((url) => propTexturesByUrl[url]?.status === "failed").length;
    const loadingModelUrls = propUrls.filter((url) => propAssetsByUrl[url]?.status === "loading");
    const failedModelUrls = propUrls.filter((url) => propAssetsByUrl[url]?.status === "failed");
    const loadingTextureUrls = propTextureUrls.filter((url) => propTexturesByUrl[url]?.status === "loading");
    const failedTextureUrls = propTextureUrls.filter((url) => propTexturesByUrl[url]?.status === "failed");
    const selectedPlanned = selectedHex ? (propPlansByHex[selectedHex]?.length ?? 0) : 0;

    return {
      totalPlanned,
      selectedPlanned,
      totalModels,
      modelsLoading,
      modelsReady,
      modelsFailed,
      totalTextures,
      texturesLoading,
      texturesReady,
      texturesFailed,
      loadingModelUrls,
      failedModelUrls,
      loadingTextureUrls,
      failedTextureUrls
    };
  }, [propAssetsByUrl, propPlansByHex, propTextureUrls, propTexturesByUrl, propUrls, selectedHex]);
  const selectedTile = useMemo(
    () => hexes.find((hex) => hex.id === (contextMenu?.hexId ?? selectedHex)),
    [contextMenu?.hexId, hexes, selectedHex]
  );

  const openContextMenu = (hexId: string, clientX: number, clientY: number) => {
    const bounds = wrapRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setContextMenu({
      hexId,
      x: clientX - bounds.left + 10,
      y: clientY - bounds.top + 10
    });
  };

  useEffect(() => {
    if (!contextMenu || !wrapRef.current || !contextMenuRef.current) return;
    const bounds = wrapRef.current.getBoundingClientRect();
    const menuBounds = contextMenuRef.current.getBoundingClientRect();
    const margin = 12;
    const nextX = Math.max(margin, Math.min(bounds.width - menuBounds.width - margin, contextMenu.x));
    const nextY = Math.max(margin, Math.min(bounds.height - menuBounds.height - margin, contextMenu.y));
    if (Math.abs(nextX - contextMenu.x) > 0.5 || Math.abs(nextY - contextMenu.y) > 0.5) {
      setContextMenu((prev) => (prev ? { ...prev, x: nextX, y: nextY } : prev));
    }
  }, [contextMenu]);

  const resolveActionVisible = (action: HexContextMenuAction | undefined, hexId: string) => {
    if (!action) return false;
    if (typeof action.visible === "function") return action.visible(hexId);
    return action.visible ?? true;
  };

  const resolveActionEnabled = (action: HexContextMenuAction | undefined, hexId: string) => {
    if (!action) return false;
    return typeof action.enabled === "function" ? action.enabled(hexId) : action.enabled;
  };

  const resolveActionLabel = (action: HexContextMenuAction | undefined, hexId: string, fallback: string) => {
    if (!action) return fallback;
    return typeof action.label === "function" ? action.label(hexId) : action.label;
  };

  const resolveActionHint = (action: HexContextMenuAction | undefined, hexId: string) => {
    if (!action?.hint) return "";
    return typeof action.hint === "function" ? action.hint(hexId) : action.hint;
  };

  const resolveActionDetails = (action: HexContextMenuAction | undefined, hexId: string) => {
    if (!action?.details) return null;
    return typeof action.details === "function" ? action.details(hexId) : action.details;
  };

  const getVisibleActionCount = (hexId: string) => {
    let count = 0;
    if (resolveActionVisible(contextMenuActions?.discover, hexId)) count += 1;
    if (resolveActionVisible(contextMenuActions?.build, hexId)) count += 1;
    if (resolveActionVisible(contextMenuActions?.upgrade, hexId)) count += 1;
    if (resolveActionVisible(contextMenuActions?.collect, hexId)) count += 1;
    return count;
  };

  const renderContextAction = (
    action: HexContextMenuAction | undefined,
    hexId: string,
    fallbackLabel: string,
    actionKey: "discover" | "build" | "upgrade" | "collect"
  ) => {
    if (!resolveActionVisible(action, hexId)) return null;
    const enabled = resolveActionEnabled(action, hexId);
    const hint = resolveActionHint(action, hexId);
    const details = resolveActionDetails(action, hexId);
    const useDiscoverCostGrid = actionKey === "discover" && getVisibleActionCount(hexId) === 1;
    return (
      <div className="hex-context-menu__action-row" key={fallbackLabel}>
        <span className="hex-context-menu__action-btn-wrap" title={!enabled && hint ? hint : undefined}>
          <button
            type="button"
            className="hex-context-menu__action-btn"
            disabled={!enabled}
            onClick={() => {
              action?.onClick(hexId);
              setContextMenu(null);
            }}
          >
            {resolveActionLabel(action, hexId, fallbackLabel)}
          </button>
        </span>
        {details ? <div className={`hex-context-menu__cost-strip${useDiscoverCostGrid ? " hex-context-menu__cost-strip--grid2" : ""}`}>{details}</div> : null}
      </div>
    );
  };

  return (
    <div
      className="map-wrap"
      ref={wrapRef}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <Canvas
        camera={{ position: [0, 28, 24], fov: 46 }}
        shadows
        onPointerMissed={() => {
          setHoveredHex(undefined);
          setContextMenu(null);
        }}
      >
        <ambientLight intensity={0.62} />
        <directionalLight position={[18, 28, 12]} intensity={1.1} castShadow />
        <directionalLight position={[-16, 12, -14]} intensity={0.34} />

        <group>
          {hexes.map((hex) => {
            const mine = Boolean(hex.owner && myAddress && hex.owner.toLowerCase() === myAddress.toLowerCase());
            const biomeAssetKey = BIOME_ASSET_KEY[hex.biome as "Plains" | "Forest" | "Mountains" | "Desert"];
            const structureAssetKey = (hex.structure?.level ?? 0) >= 2 ? "structure.level2" : "structure.level1";
            return (
              <HexTileMesh
                key={`${hex.id}:${hex.structure?.level ?? 0}:${hex.structure?.builtAtRound ?? 0}`}
                hex={hex}
                quake={quakeSet.has(hex.id)}
                selected={selectedHex === hex.id}
                hovered={hoveredHex === hex.id}
                mine={mine}
                biomeAssetConfig={MAP_3D_ASSETS[biomeAssetKey]}
                biomeAssetState={assets[biomeAssetKey]}
                biomeTextureState={textures[biomeAssetKey]}
                structureAssetConfig={MAP_3D_ASSETS[structureAssetKey]}
                structureAssetState={assets[structureAssetKey]}
                propPlans={propPlansByHex[hex.id] ?? []}
                propAssetsByUrl={propAssetsByUrl}
                propTexturesByUrl={propTexturesByUrl}
                debugProps={debugProps}
                onHover={setHoveredHex}
                onSelect={(hexId) => {
                  onHexClick(hexId);
                  setContextMenu(null);
                }}
                onOpenContext={openContextMenu}
              />
            );
          })}
        </group>

        <OrbitControls
          enableRotate
          enablePan={false}
          enableZoom
          enableDamping
          dampingFactor={0.08}
          rotateSpeed={0.7}
          zoomSpeed={0.95}
          minDistance={10}
          maxDistance={70}
          minPolarAngle={Math.PI * 0.12}
          maxPolarAngle={Math.PI * 0.49}
        />

        <EffectComposer disableNormalPass multisampling={0}>
          <SMAA />
        </EffectComposer>
      </Canvas>

      {contextMenu && selectedTile ? (
        <div
          ref={contextMenuRef}
          className={`hex-context-menu${getVisibleActionCount(selectedTile.id) === 0 ? " hex-context-menu--compact" : ""}`}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="hex-context-menu__title">{selectedTile.id}</p>
          <p>
            Biome: <strong style={{ color: biomeStyle[selectedTile.biome].edge }}>{selectedTile.biome}</strong>
          </p>
          <p>
            Resource:{" "}
            <strong className="hex-context-menu__resource-pill">
              {(() => {
                const { Icon, color, label } = biomeResourceMeta[selectedTile.biome];
                return (
                  <>
                    <Icon size={13} color={color} aria-hidden />
                    <span>{label}</span>
                  </>
                );
              })()}
            </strong>
          </p>
          <p>
            Owner: <strong style={{ color: selectedTile.owner ? colorFromAddress(selectedTile.owner) : "#f3f7ff" }}>{selectedTile.owner ? (myAddress && selectedTile.owner.toLowerCase() === myAddress.toLowerCase() ? "You" : `${selectedTile.owner.slice(0, 6)}…${selectedTile.owner.slice(-4)}`) : "none"}</strong>
          </p>
          <p>Structure: <strong>{selectedTile.structure ? `L${selectedTile.structure.level}` : "none"}</strong></p>
          {renderContextAction(contextMenuActions?.discover, selectedTile.id, "Discover / Claim", "discover")}
          {renderContextAction(contextMenuActions?.build, selectedTile.id, "Build lvl1", "build")}
          {renderContextAction(contextMenuActions?.upgrade, selectedTile.id, "Upgrade", "upgrade")}
          {renderContextAction(contextMenuActions?.collect, selectedTile.id, "Collect resources", "collect")}
          <div className="hex-context-menu__actions">
            <button type="button" onClick={() => setContextMenu(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {debugProps ? (
        <div
          style={{
            position: "absolute",
            right: "0.8rem",
            bottom: "0.8rem",
            zIndex: 25,
            minWidth: "260px",
            border: "1px solid rgba(86, 240, 255, 0.35)",
            borderRadius: "10px",
            background: "rgba(6, 11, 34, 0.82)",
            color: "#e7f4ff",
            fontSize: "12px",
            lineHeight: 1.35,
            padding: "0.5rem 0.6rem"
          }}
        >
          <p style={{ margin: "0 0 0.3rem", fontWeight: 700 }}>Prop debug</p>
          <p style={{ margin: 0 }}>planned(total/selected): {propDebugStats.totalPlanned}/{propDebugStats.selectedPlanned}</p>
          <p style={{ margin: 0 }}>models(loading/ready/failed/total): {propDebugStats.modelsLoading}/{propDebugStats.modelsReady}/{propDebugStats.modelsFailed}/{propDebugStats.totalModels}</p>
          <p style={{ margin: 0 }}>textures(loading/ready/failed/total): {propDebugStats.texturesLoading}/{propDebugStats.texturesReady}/{propDebugStats.texturesFailed}/{propDebugStats.totalTextures}</p>
          {propDebugStats.loadingModelUrls.length ? (
            <p style={{ margin: "0.3rem 0 0" }}>loading models: {propDebugStats.loadingModelUrls.slice(0, 3).join(", ")}</p>
          ) : null}
          {propDebugStats.failedModelUrls.length ? (
            <p style={{ margin: "0.2rem 0 0", color: "#ffadad" }}>failed models: {propDebugStats.failedModelUrls.slice(0, 3).join(", ")}</p>
          ) : null}
          {propDebugStats.loadingTextureUrls.length ? (
            <p style={{ margin: "0.2rem 0 0" }}>loading textures: {propDebugStats.loadingTextureUrls.slice(0, 2).join(", ")}</p>
          ) : null}
          {propDebugStats.failedTextureUrls.length ? (
            <p style={{ margin: "0.2rem 0 0", color: "#ffadad" }}>failed textures: {propDebugStats.failedTextureUrls.slice(0, 2).join(", ")}</p>
          ) : null}
          <p style={{ margin: "0.3rem 0 0", opacity: 0.86 }}>
            Set VITE_MAP3D_PROP_DEBUG=true or localStorage key cryptocatan:map3d-prop-debug=true
          </p>
        </div>
      ) : null}

      {hoveredHex ? <div className="hex-hover-badge">Hover: {hoveredHex}</div> : null}
    </div>
  );
}
