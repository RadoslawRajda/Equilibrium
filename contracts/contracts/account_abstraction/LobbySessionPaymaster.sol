// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import "./AAHooks.sol";

/// @notice ERC-4337 EntryPoint v0.8 paymaster: pays gas from EntryPoint deposit, refunds from lobby session pool via `LobbyPaymasterHook`.
contract LobbySessionPaymaster is BasePaymaster {
    LobbyPaymasterHook public immutable hook;

    constructor(IEntryPoint _entryPoint, LobbyPaymasterHook _hook) BasePaymaster(_entryPoint) {
        hook = _hook;
    }

    function _validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256 maxCost)
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        (bool allowed, uint256 lobbyId, address actor, uint256 remainingWei, uint64 expiresAt) = hook.previewSponsorship(userOp.sender, maxCost);
        lobbyId; actor; remainingWei; expiresAt;
        require(allowed, "Lobby session not sponsored");
        return (abi.encode(userOp.sender), 0);
    }

    function _postOp(
        IPaymaster.PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) internal override {
        (mode, actualUserOpFeePerGas);
        address sessionKey = abi.decode(context, (address));
        if (actualGasCost == 0) {
            return;
        }
        hook.reimburseSessionGas(sessionKey, actualGasCost, payable(address(this)));
        uint256 bal = address(this).balance;
        if (bal > 0) {
            entryPoint.depositTo{value: bal}(address(this));
        }
    }

    receive() external payable {}
}
