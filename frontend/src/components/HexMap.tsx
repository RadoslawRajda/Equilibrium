import { motion } from "framer-motion";
import { HexGrid, Layout, Hexagon, Text } from "react-hexgrid";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { HexTile } from "../types";

type Props = {
  hexes: HexTile[];
  myAddress?: string;
  selectedHex?: string;
  earthquakeTargets?: string[];
  onHexClick: (hexId: string) => void;
};

const biomeStyle: Record<string, { fill: string; stroke: string }> = {
  Plains: { fill: "url(#plainsGradient)", stroke: "#ffd369" },
  Forest: { fill: "url(#forestGradient)", stroke: "#5bff9d" },
  Mountains: { fill: "url(#mountainGradient)", stroke: "#9cc4ff" },
  Desert: { fill: "url(#desertGradient)", stroke: "#ffad69" }
};

const ownerPalette = ["#56f0ff", "#ffd369", "#5bff9d", "#ff7d7d", "#9c7dff", "#ffad69"];

const colorFromAddress = (address?: string | null) => {
  if (!address) return "#f3f7ff";
  const hash = address.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return ownerPalette[hash % ownerPalette.length];
};

export function HexMap({ hexes, myAddress, selectedHex, onHexClick, earthquakeTargets = [] }: Props) {
  const quakeSet = new Set(earthquakeTargets);

  return (
    <div className="map-wrap">
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
                    key={hex.id}
                    animate={shake ? { x: [0, -2, 2, -2, 2, 0] } : { x: 0 }}
                    transition={{ duration: 0.45 }}
                  >
                    <Hexagon
                      q={hex.q}
                      r={hex.r}
                      s={-hex.q - hex.r}
                      onClick={() => onHexClick(hex.id)}
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
    </div>
  );
}
