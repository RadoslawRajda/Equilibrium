// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IActorAuthority {
    function resolveActor(address caller, bytes calldata callData) external view returns (address);
}

interface ILobbySessionSponsorPool {
    function consumeSessionSponsorPool(uint256 lobbyId, uint256 amount, address payable receiver) external;
}

interface ISessionPolicyRegistry {
    function setSessionPolicyFromLobbyManager(
        address sessionKey,
        address actor,
        uint256 lobbyId,
        uint64 expiresAt,
        uint128 maxSponsoredWei,
        bool active
    ) external;
}

abstract contract ActorAware is Ownable2Step {
    address public actorAuthority;

    constructor() Ownable(msg.sender) {}

    event ActorAuthorityUpdated(address indexed previousAuthority, address indexed newAuthority);

    function setActorAuthority(address newAuthority) external onlyOwner {
        require(newAuthority != address(0), "Authority address required");
        emit ActorAuthorityUpdated(actorAuthority, newAuthority);
        actorAuthority = newAuthority;
    }

    function _actor() internal view returns (address) {
        address authority = actorAuthority;
        if (authority == address(0)) {
            return msg.sender;
        }

        return IActorAuthority(authority).resolveActor(msg.sender, msg.data);
    }
}

contract DirectActorAuthority is IActorAuthority {
    function resolveActor(address caller, bytes calldata) external pure returns (address) {
        return caller;
    }
}

contract SessionForwarderActorAuthority is IActorAuthority, ISessionPolicyRegistry, Ownable, ReentrancyGuard {
    constructor() Ownable(msg.sender) {}

    struct SessionPolicy {
        address actor;
        uint256 lobbyId;
        uint64 expiresAt;
        uint128 maxSponsoredWei;
        bool active;
    }

    address public sponsorPool;
    address public lobbyManager;
    address public trustedForwarder;
    mapping(address => SessionPolicy) public sessionPolicies;
    mapping(address => uint256) public sessionSponsoredWei;

    event SponsorPoolUpdated(address indexed previousPool, address indexed newPool);
    event LobbyManagerUpdated(address indexed previousLobbyManager, address indexed newLobbyManager);
    event TrustedForwarderUpdated(address indexed previousForwarder, address indexed newForwarder);
    event SessionPolicyUpdated(
        address indexed sessionKey,
        address indexed actor,
        uint256 indexed lobbyId,
        uint64 expiresAt,
        uint128 maxSponsoredWei,
        bool active
    );
    event SessionSponsored(address indexed sessionKey, uint256 indexed lobbyId, uint256 amount, address indexed receiver);

    function setSponsorPool(address newPool) external onlyOwner {
        require(newPool != address(0), "SponsorPool address required");
        emit SponsorPoolUpdated(sponsorPool, newPool);
        sponsorPool = newPool;
    }

    function setTrustedForwarder(address newForwarder) external onlyOwner {
        require(newForwarder != address(0), "Forwarder address required");
        emit TrustedForwarderUpdated(trustedForwarder, newForwarder);
        trustedForwarder = newForwarder;
    }

    function setLobbyManager(address newLobbyManager) external onlyOwner {
        require(newLobbyManager != address(0), "LobbyManager address required");
        emit LobbyManagerUpdated(lobbyManager, newLobbyManager);
        lobbyManager = newLobbyManager;
    }

    function setSessionPolicy(
        address sessionKey,
        address actor,
        uint256 lobbyId,
        uint64 expiresAt,
        uint128 maxSponsoredWei,
        bool active
    ) external onlyOwner {
        _setSessionPolicy(sessionKey, actor, lobbyId, expiresAt, maxSponsoredWei, active);
    }

    function setSessionPolicyFromLobbyManager(
        address sessionKey,
        address actor,
        uint256 lobbyId,
        uint64 expiresAt,
        uint128 maxSponsoredWei,
        bool active
    ) external {
        require(msg.sender == lobbyManager, "Only lobby manager");
        _setSessionPolicy(sessionKey, actor, lobbyId, expiresAt, maxSponsoredWei, active);
    }

    function _setSessionPolicy(
        address sessionKey,
        address actor,
        uint256 lobbyId,
        uint64 expiresAt,
        uint128 maxSponsoredWei,
        bool active
    ) internal {
        sessionPolicies[sessionKey] = SessionPolicy({
            actor: actor,
            lobbyId: lobbyId,
            expiresAt: expiresAt,
            maxSponsoredWei: maxSponsoredWei,
            active: active
        });
        sessionSponsoredWei[sessionKey] = 0;
        emit SessionPolicyUpdated(sessionKey, actor, lobbyId, expiresAt, maxSponsoredWei, active);
    }

    function sponsorSessionAction(address sessionKey, uint256 amount, address payable receiver) external onlyOwner nonReentrant {
        SessionPolicy memory policy = sessionPolicies[sessionKey];
        require(policy.active, "Session inactive");
        require(policy.actor != address(0), "Session actor missing");
        require(policy.lobbyId != 0, "Session lobby missing");
        require(policy.expiresAt >= block.timestamp, "Session expired");

        uint256 alreadySponsored = sessionSponsoredWei[sessionKey];
        uint256 nextSponsored = alreadySponsored + amount;
        require(nextSponsored <= policy.maxSponsoredWei, "Session sponsor limit exceeded");

        address pool = sponsorPool;
        require(pool != address(0), "Sponsor pool missing");
        sessionSponsoredWei[sessionKey] = nextSponsored;
        ILobbySessionSponsorPool(pool).consumeSessionSponsorPool(policy.lobbyId, amount, receiver);
        emit SessionSponsored(sessionKey, policy.lobbyId, amount, receiver);
    }

    function resolveActor(address caller, bytes calldata callData) external view returns (address) {
        SessionPolicy memory policy = sessionPolicies[caller];
        if (policy.active && policy.expiresAt >= block.timestamp && policy.actor != address(0)) {
            return policy.actor;
        }

        if (caller == trustedForwarder) {
            require(callData.length >= 20, "Forwarded actor missing");
            return _extractForwardedActor(callData);
        }

        return caller;
    }

    function _extractForwardedActor(bytes calldata callData) internal pure returns (address actor) {
        assembly {
            actor := shr(96, calldataload(add(callData.offset, sub(callData.length, 20))))
        }
    }
}
