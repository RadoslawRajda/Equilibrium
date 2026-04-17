// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISessionAuthority {
    function sessionPolicies(address sessionKey)
        external
        view
        returns (address actor, uint256 lobbyId, uint64 expiresAt, uint128 maxSponsoredWei, bool active);

    function sessionSponsoredWei(address sessionKey) external view returns (uint256);

    function sponsorSessionAction(address sessionKey, uint256 amount, address payable receiver) external;
}

contract LobbyPaymasterHook is Ownable2Step, ReentrancyGuard {
    ISessionAuthority public sessionAuthority;
    address public entryPoint;
    /// @notice ERC-4337 paymaster contract allowed to pull lobby sponsor pool in postOp (via `reimburseSessionGas`).
    address public gasSponsor;

    event EntryPointUpdated(address indexed previousEntryPoint, address indexed newEntryPoint);
    event SessionAuthorityUpdated(address indexed previousAuthority, address indexed newAuthority);
    event GasSponsorUpdated(address indexed previousSponsor, address indexed newSponsor);
    event UserOperationSponsored(address indexed sessionKey, uint256 indexed lobbyId, uint256 amount, address indexed receiver);

    modifier onlyEntryPoint() {
        require(msg.sender == entryPoint, "Only entry point");
        _;
    }

    modifier onlyGasSponsor() {
        require(msg.sender == gasSponsor && gasSponsor != address(0), "Only gas sponsor");
        _;
    }

    constructor(address authority, address initialEntryPoint) Ownable(msg.sender) {
        sessionAuthority = ISessionAuthority(authority);
        entryPoint = initialEntryPoint;
    }

    function setEntryPoint(address newEntryPoint) external onlyOwner {
        emit EntryPointUpdated(entryPoint, newEntryPoint);
        entryPoint = newEntryPoint;
    }

    function setSessionAuthority(address newAuthority) external onlyOwner {
        emit SessionAuthorityUpdated(address(sessionAuthority), newAuthority);
        sessionAuthority = ISessionAuthority(newAuthority);
    }

    function setGasSponsor(address newSponsor) external onlyOwner {
        emit GasSponsorUpdated(gasSponsor, newSponsor);
        gasSponsor = newSponsor;
    }

    /// @notice Called by `LobbySessionPaymaster` after a sponsored UserOp to refund the paymaster from the lobby pool.
    function reimburseSessionGas(address sessionKey, uint256 amount, address payable receiver) external onlyGasSponsor nonReentrant {
        (, uint256 lobbyId, , , ) = sessionAuthority.sessionPolicies(sessionKey);
        sessionAuthority.sponsorSessionAction(sessionKey, amount, receiver);
        emit UserOperationSponsored(sessionKey, lobbyId, amount, receiver);
    }

    function previewSponsorship(address sessionKey, uint256 amount)
        external
        view
        returns (bool allowed, uint256 lobbyId, address actor, uint256 remainingWei, uint64 expiresAt)
    {
        (address sessionActor, uint256 sessionLobbyId, uint64 sessionExpiresAt, uint128 maxSponsoredWei, bool active) =
            sessionAuthority.sessionPolicies(sessionKey);

        if (!active || sessionActor == address(0) || sessionLobbyId == 0 || block.timestamp > sessionExpiresAt) {
            return (false, sessionLobbyId, sessionActor, 0, sessionExpiresAt);
        }

        uint256 alreadySponsored = sessionAuthority.sessionSponsoredWei(sessionKey);
        if (alreadySponsored >= maxSponsoredWei) {
            return (false, sessionLobbyId, sessionActor, 0, sessionExpiresAt);
        }

        uint256 remaining = uint256(maxSponsoredWei) - alreadySponsored;
        return (amount <= remaining, sessionLobbyId, sessionActor, remaining, sessionExpiresAt);
    }

    function sponsorUserOperation(address sessionKey, uint256 amount, address payable receiver)
        external
        onlyEntryPoint
        nonReentrant
    {
        (, uint256 lobbyId, , , ) = sessionAuthority.sessionPolicies(sessionKey);
        sessionAuthority.sponsorSessionAction(sessionKey, amount, receiver);
        emit UserOperationSponsored(sessionKey, lobbyId, amount, receiver);
    }
}
