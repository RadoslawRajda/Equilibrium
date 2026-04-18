import { motion } from "framer-motion";
import { Bot, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { short } from "../lib/gameUtils";

export type RegisteredChainAgent = { address: string; name: string; identity?: string };

type Props = {
  agents: RegisteredChainAgent[];
  registryError?: string | null;
  /** ERC-4337 session + paymaster (same path as Start game when bundler is configured). */
  uses4337?: boolean;
  busy?: boolean;
  onInvite: (controllerAddress: string) => void | Promise<void>;
};

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export function LobbyAgentInvitePanel({
  agents,
  registryError = null,
  uses4337 = false,
  busy = false,
  onInvite
}: Props) {
  const [pick, setPick] = useState("");
  const [manual, setManual] = useState("");

  const target = (pick.trim() || manual.trim()).trim();
  const canSubmit = ADDR_RE.test(target);

  const submit = useCallback(async () => {
    if (!canSubmit || busy) return;
    await onInvite(target);
  }, [canSubmit, busy, onInvite, target]);

  return (
    <div className="lobby-agent-invite-panel panel">
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.65rem" }}>
        <Bot size={20} style={{ color: "var(--accent)" }} aria-hidden />
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>Invite bot</h2>
      </div>
      <p className="selected-text" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", lineHeight: 1.45 }}>
        Agents from <code style={{ fontSize: "0.8em" }}>listAgents</code> on <code style={{ fontSize: "0.8em" }}>ERC8004PlayerAgentRegistry</code>.
        <br />
        <br />
        Invite calls <code style={{ fontSize: "0.8em" }}>inviteAgentToLobby</code> for the bot&apos;s{" "}
        <strong>controller EOA</strong>
        {uses4337 ? (
          <>
            , sent as an <strong>ERC-4337</strong> user operation.
          </>
        ) : (
          <> from your connected wallet.</>
        )}
      </p>

      {registryError ? (
        <p className="error-banner" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
          Registry: {registryError}
        </p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>From on-chain registry</span>
          <select
            value={pick}
            disabled={busy || agents.length === 0}
            onChange={(e) => {
              setPick(e.target.value);
              if (e.target.value) setManual("");
            }}
            style={{
              padding: "0.55rem 0.65rem",
              borderRadius: "10px",
              border: "1px solid rgba(130, 160, 255, 0.35)",
              background: "rgba(6, 10, 29, 0.65)",
              color: "var(--text)",
              fontSize: "0.9rem"
            }}
          >
            <option value="">{agents.length === 0 ? "— no agents in registry —" : "— choose —"}</option>
            {agents.map((a) => (
              <option key={a.address} value={a.address}>
                {a.name} · {short(a.address)}
                {a.identity ? ` · id ${short(a.identity)}` : ""}
              </option>
            ))}
          </select>
        </label>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            color: "var(--muted)",
            fontSize: "0.75rem"
          }}
        >
          <span style={{ flex: 1, height: "1px", background: "rgba(130,160,255,0.25)" }} />
          or paste address
          <span style={{ flex: 1, height: "1px", background: "rgba(130,160,255,0.25)" }} />
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Controller wallet (0x…)</span>
          <input
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder="0x…"
            value={manual}
            disabled={busy}
            onChange={(e) => {
              setManual(e.target.value);
              if (e.target.value.trim()) setPick("");
            }}
            style={{
              padding: "0.55rem 0.65rem",
              borderRadius: "10px",
              border: "1px solid rgba(130, 160, 255, 0.35)",
              background: "rgba(6, 10, 29, 0.65)",
              color: "var(--text)",
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.85rem"
            }}
          />
        </label>

        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          whileHover={{ scale: 1.02 }}
          disabled={!canSubmit || busy}
          onClick={() => void submit()}
          style={{ alignSelf: "flex-start", marginTop: "0.15rem" }}
        >
          <Send size={16} aria-hidden />
          {busy ? "Sending…" : uses4337 ? "Send invite" : "Send invite"}
        </motion.button>
      </div>
    </div>
  );
}
