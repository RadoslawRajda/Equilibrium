// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Structures is Ownable {
    enum Biome {
        Plains,
        Forest,
        Mountains,
        Desert
    }

    struct StructureState {
        address owner;
        uint8 level;
        bool exists;
        Biome biome;
    }

    mapping(bytes32 => StructureState) public structures;

    event StructureBuilt(bytes32 indexed hexId, address indexed owner, uint8 level, Biome biome);
    event StructureUpgraded(bytes32 indexed hexId, uint8 level);
    event StructureRemoved(bytes32 indexed hexId);

    constructor() Ownable(msg.sender) {}

    function build(bytes32 hexId, address structureOwner, Biome biome) external onlyOwner {
        require(structureOwner != address(0), "Structure owner required");
        require(!structures[hexId].exists, "Structure already exists");
        structures[hexId] = StructureState(structureOwner, 1, true, biome);
        emit StructureBuilt(hexId, structureOwner, 1, biome);
    }

    function upgrade(bytes32 hexId) external onlyOwner {
        require(structures[hexId].exists, "Structure not found");
        require(structures[hexId].level == 1, "Already max level");
        structures[hexId].level = 2;
        emit StructureUpgraded(hexId, 2);
    }

    function remove(bytes32 hexId) external onlyOwner {
        require(structures[hexId].exists, "Structure not found");
        delete structures[hexId];
        emit StructureRemoved(hexId);
    }
}
