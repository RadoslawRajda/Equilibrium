import { motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { HexGrid, Layout, Hexagon, Text } from "react-hexgrid";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { HexTile } from "../types";
import { colorFromAddress } from "../utils/helpers/converters";

type Props = {
  hexes: HexTile[];
  myAddress?: string;
  selectedHex?: string;
  earthquakeTargets?: string[];
  onHexClick: (hexId: string) => void;
};

const biomeStyle: Record<string, { fill: string; stroke: string; resource: string }> = {
  Plains: { fill: "url(#plainsGradient)", stroke: "#ffd369", resource: "food" },
  Forest: { fill: "url(#forestGradient)", stroke: "#5bff9d", resource: "wood" },
  Mountains: { fill: "url(#mountainGradient)", stroke: "#9cc4ff", resource: "stone/ore" },
  Desert: { fill: "url(#desertGradient)", stroke: "#ffad69", resource: "energy" }
};

export function HexMap2D({ hexes, myAddress, selectedHex, onHexClick, earthquakeTargets = [] }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const quakeSet = new Set(earthquakeTargets);
  const [contextMenu, setContextMenu] = useState<{ hexId: string; x: number; y: number } | null>(null);
  const selectedTile = useMemo(
    () => hexes.find((hex) => hex.id === (contextMenu?.hexId ?? selectedHex)),
    [contextMenu?.hexId, hexes, selectedHex]
  );

  const openContextMenu = (hexId: string, clientX: number, clientY: number) => {
    const bounds = wrapRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setContextMenu({
      hexId,
      x: Math.max(12, Math.min(bounds.width - 220, clientX - bounds.left + 10)),
      y: Math.max(12, Math.min(bounds.height - 140, clientY - bounds.top + 10))
    });
  };

  return (
    <div
      className="map-wrap"
      ref={wrapRef}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest(".hex-context-menu")) {
          setContextMenu(null);
        }
      }}
      onContextMenu={(event) => {
        if (!(event.target as HTMLElement).closest(".hex-context-menu")) {
          event.preventDefault();
          setContextMenu(null);
        }
      }}
    >
      <TransformWrapper minScale={0.65} maxScale={2.1} wheel={{ step: 0.1 }}>
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: "100%", height: "100%" }}>
          <HexGrid width={1400} height={900} viewBox="-100 -100 250 210">
            <defs>
              <linearGradient id="plainsGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d3ff7d" />
                <stop offset="100%" stopColor="#8ecf3d" />
              </linearGradient>
              <linearGradient id="forestGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#79ffb2" />
                <stop offset="100%" stopColor="#2ab56c" />
              </linearGradient>
              <linearGradient id="mountainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#bfdbff" />
                <stop offset="100%" stopColor="#6186e5" />
              </linearGradient>
              <linearGradient id="desertGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffd799" />
                <stop offset="100%" stopColor="#f08f41" />
              </linearGradient>
            </defs>

            <Layout size={{ x: 6.6, y: 6.6 }} flat={false} spacing={1.05} origin={{ x: 0, y: 0 }}>
              {hexes.map((hex) => {
                const mine = hex.owner && myAddress && hex.owner.toLowerCase() === myAddress.toLowerCase();
                const selected = selectedHex === hex.id;
                const style = biomeStyle[hex.biome];
                const shake = quakeSet.has(hex.id);
                const ownerColor = colorFromAddress(hex.owner);
                const ownedStroke = hex.owner ? ownerColor : style.stroke;
                const stroke = selected ? "#ffffff" : ownedStroke;
                const strokeWidth = selected ? 1.1 : hex.owner ? 0.95 : 0.35;

                return (
                  <motion.g
                    key={`${hex.id}:${hex.structure?.level ?? 0}:${hex.structure?.builtAtRound ?? 0}`}
                    animate={shake ? { x: [0, -2, 2, -2, 2, 0] } : { x: 0 }}
                    transition={{ duration: 0.45 }}
                  >
                    <Hexagon
                      q={hex.q}
                      r={hex.r}
                      s={-hex.q - hex.r}
                      onClick={(event) => {
                        onHexClick(hex.id);
                        setContextMenu(null);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        const native = event as unknown as MouseEvent;
                        openContextMenu(hex.id, native.clientX, native.clientY);
                      }}
                      style={{
                        fill: style.fill,
                        stroke,
                        strokeWidth,
                        strokeDasharray: selected ? "1.4 0.8" : undefined,
                        filter: hex.structure
                          ? `drop-shadow(0 0 8px ${ownerColor}88)`
                          : selected
                            ? "drop-shadow(0 0 8px rgba(255,255,255,0.85))"
                            : mine
                              ? "drop-shadow(0 0 5px rgba(86,240,255,0.7))"
                              : "none",
                        cursor: "pointer"
                      }}
                    >
                      <Text
                        style={{
                          fontSize: "0.16em",
                          fill: "#f8fbff",
                          stroke: "#061025",
                          strokeWidth: "0.8px",
                          paintOrder: "stroke",
                          fontWeight: 700
                        }}
                      >
                        {hex.biome}
                      </Text>
                      <Text
                        y={4.7}
                        style={{
                          fontSize: "0.14em",
                          fill: "#eaf2ff",
                          stroke: "#061025",
                          strokeWidth: "0.8px",
                          paintOrder: "stroke",
                          fontWeight: 700
                        }}
                      >
                        {hex.id}
                      </Text>
                      {hex.structure && (
                        <Text
                          y={-4.6}
                          style={{
                            fontSize: "0.15em",
                            fill: ownerColor,
                            stroke: "#061025",
                            strokeWidth: "1px",
                            paintOrder: "stroke",
                            fontWeight: 900
                          }}
                        >
                          L{hex.structure.level}
                        </Text>
                      )}
                    </Hexagon>
                  </motion.g>
                );
              })}
            </Layout>
          </HexGrid>
        </TransformComponent>
      </TransformWrapper>

      {contextMenu && selectedTile ? (
        <div
          className="hex-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="hex-context-menu__title">{selectedTile.id}</p>
          <p>Biome: <strong>{selectedTile.biome}</strong></p>
          <p>Resource: <strong>{biomeStyle[selectedTile.biome].resource}</strong></p>
          <p>Owner: <strong>{selectedTile.owner ? `${selectedTile.owner.slice(0, 6)}…${selectedTile.owner.slice(-4)}` : "none"}</strong></p>
          <p>Structure: <strong>{selectedTile.structure ? `L${selectedTile.structure.level}` : "none"}</strong></p>
          <div className="hex-context-menu__actions">
            <button
              type="button"
              onClick={() => {
                onHexClick(selectedTile.id);
                setContextMenu(null);
              }}
            >
              Select tile
            </button>
            <button type="button" onClick={() => setContextMenu(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
