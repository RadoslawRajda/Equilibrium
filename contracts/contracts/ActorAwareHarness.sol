// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./ActorAware.sol";

contract ActorAwareHarness is ActorAware {
    function resolvedActor() external view returns (address) {
        return _actor();
    }
}
