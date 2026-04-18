import { decodeErrorResult } from "viem";

export function mapGameError(error: any): string {
  if (!error) return "An unexpected error occurred.";

  const message = (error?.message || error?.shortMessage || String(error)).toLowerCase();
  let decodedReason = "";

  // Check if there is a raw hex reason for Error(string) inside the message:
  const hexMatch = message.match(/(0x08c379a0[0-9a-fA-F]*)/i);
  if (hexMatch) {
    try {
      const decoded = decodeErrorResult({
        abi: [{ inputs: [{ name: "message", type: "string" }], name: "Error", type: "error" }],
        data: hexMatch[1] as `0x${string}`
      });
      if (decoded && decoded.args && typeof decoded.args[0] === 'string') {
        decodedReason = decoded.args[0].toLowerCase();
      }
    } catch (e) {
      // ignore decode error
    }
  }

  const textToSearch = decodedReason ? decodedReason : message;

  // Mapping configurations
  const errorMap: Array<{ match: string; message: string }> = [
    { match: "insufficient food", message: "You don't have enough food." },
    { match: "insufficient wood", message: "You don't have enough wood." },
    { match: "insufficient stone", message: "You don't have enough stone." },
    { match: "insufficient ore", message: "You don't have enough ore." },
    { match: "insufficient resources for structure", message: "You don't have enough resources to build this." },
    { match: "insufficient resources for upgrade", message: "You don't have enough resources to upgrade this." },
    { match: "insufficient resources", message: "You don't have enough resources." },
    { match: "not enough energy", message: "You don't have enough energy." },
    { match: "not enough resources to execute vote", message: "You don't have enough resources to execute this vote." },
    { match: "insufficient payment", message: "Insufficient payment provided." },
    { match: "insufficient funds", message: "You don't have enough native funds (ETH) to cover this action." },
    
    { match: "must be current player", message: "It's not your turn or you are not the active player." },
    { match: "player not active", message: "Your player is not active." },
    { match: "player not in lobby", message: "You are not in this lobby." },
    { match: "bad player", message: "Your player state is invalid or eliminated." },
    { match: "eliminated", message: "You have been eliminated from the game." },
    { match: "player already initialized", message: "Your player is already initialized." },

    { match: "structure already exists", message: "A structure already exists here." },
    { match: "structure exists", message: "A structure already exists here." },
    { match: "already max", message: "This structure is already at its maximum level." },
    { match: "no structure", message: "No active structure found on this hex." },
    { match: "invalid structure placement", message: "You can't place a structure here." },
    
    { match: "hex already owned", message: "This hex is already owned." },
    { match: "hex occupied", message: "This hex is already occupied." },
    { match: "not owner", message: "You do not own this structure or hex." },
    { match: "hex not owned by you", message: "You do not own this hex." },
    { match: "structure not owned by you", message: "This structure does not belong to you." },
    { match: "hex not found or has no active structure", message: "No active structure found on this hex." },
    { match: "must be adjacent to your hex", message: "You can only build adjacent to your territory." },
    { match: "must be adjacent", message: "You can only discover adjacent hexes." },
    { match: "no owned hexes", message: "You do not have any owned hexes." },
    { match: "bad hex id", message: "Invalid hex selected." },
    { match: "hex outside map", message: "Selected hex is outside the playable map area." },
    { match: "starting hex already chosen", message: "You have already chosen your starting hex." },

    { match: "production starts next round", message: "Structures start producing from the next round." },
    { match: "already collected this round", message: "You have already collected resources from this structure this round." },

    { match: "trade missing", message: "This trade offer doesn't exist." },
    { match: "trade accepted", message: "This trade offer has already been accepted." },
    { match: "already accepted", message: "This trade offer has already been accepted." },
    { match: "not target", message: "You are not the designated target for this trade offer." },
    { match: "trade expired", message: "This trade offer has expired." },
    { match: "offer expired", message: "This trade offer has expired." },
    { match: "cannot self-accept", message: "You cannot accept your own trade offer." },
    { match: "invalid bank trade", message: "Invalid resource types for bank trade." },
    { match: "bad bank bulk times", message: "Invalid number of bulk trade lots." },
    { match: "bad resource kind", message: "Invalid resource type." },

    { match: "no proposals", message: "Proposals cannot be created at this time." },
    { match: "zero round: end game only", message: "During round zero, only End Game proposals can be created." },
    { match: "use closeround 0 in zero round", message: "Use round 0 for proposals during round zero." },
    { match: "closeround must be future", message: "The proposal close round must be in the future." },
    { match: "resolved", message: "This proposal is already resolved." },
    { match: "cannot vote now", message: "You cannot vote at this time." },
    { match: "already voted", message: "You have already voted on this proposal." },
    { match: "voting active", message: "Voting is still active for this proposal." },
    { match: "voting closed", message: "The voting period for this proposal has closed." },
    { match: "voting still active", message: "The voting period is still active." },
    { match: "already executed", message: "This proposal has already been executed." },

    { match: "no balance to withdraw", message: "You have no balance to withdraw." },
    { match: "withdraw failed", message: "Failed to withdraw funds." },
    { match: "session sponsor transfer failed", message: "Failed to transfer sponsor funds." },
    
    { match: "game not running", message: "The game is not currently running." },
    { match: "lobby not found", message: "Lobby not found." },
    { match: "already started", message: "The game has already started." },
    { match: "not zero round", message: "It is not the starting round." },
    { match: "not active", message: "The game or player is not active." },

    { match: "lobby not open", message: "This lobby is not open." },
    { match: "lobby is full", message: "This lobby is already full." },
    { match: "already have ticket", message: "You already have a ticket for this lobby." },
    { match: "no lobby ticket", message: "You need a ticket to join this lobby." },
    { match: "host lost lobby ticket", message: "The host has lost their lobby ticket." },
    { match: "host has no ticket", message: "The host does not have a ticket." },
    { match: "no ticket", message: "You have no ticket." },
    { match: "must send exact ticket price", message: "You must send the exact ticket price to join." },
    
    { match: "cannot leave as sole participant", message: "You cannot leave the lobby when you are the only participant." },
    { match: "cannot kick sole participant", message: "You cannot kick the last participant." },
    { match: "cannot kick host", message: "You cannot kick the host of the lobby." },
    
    { match: "only host can cancel lobby", message: "Only the host can cancel the lobby." },
    { match: "host must cancel lobby", message: "Only the host can cancel the lobby." },
    { match: "only host can complete game", message: "Only the host can finish the game." },
    { match: "only host can invite", message: "Only the host can invite players." },
    { match: "only host can start game", message: "Only the host can start the game." },
    { match: "only host", message: "This action is restricted to the lobby host." },

    { match: "not game master executor", message: "Only the Game Master can perform this action." },
    { match: "grant cap exceeded", message: "Game Master grant limit exceeded." },
    { match: "session ttl must be > 0", message: "Session TTL must be greater than 0." },

    { match: "user rejected the request", message: "Transaction was rejected in your wallet." },
    { match: "user rejected", message: "Transaction was rejected in your wallet." },
  ];

  for (const mapping of errorMap) {
    if (textToSearch.includes(mapping.match)) {
      return mapping.message;
    }
  }

  // Fallback
  if (decodedReason) {
    return `Error: ${decodedReason[0].toUpperCase() + decodedReason.slice(1)}`;
  }

  if (error?.shortMessage) {
    return `Error: ${error.shortMessage}`;
  }
  
  if (error?.details) {
      if (error.details.length > 200) return `Error: ${error.details.substring(0, 200)}...`;
      return `Error: ${error.details}`;
  }

  const raw = String(error);
  if (raw.length > 200) {
    return `An unexpected error occurred: ${raw.substring(0, 200)}...`;
  }
  
  return raw;
}
