// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "../access/ActorAware.sol";

contract Ticket is ERC721, ActorAware {
    uint256 public constant TICKET_PRICE = 0.01 ether;
    uint256 private _nextId = 1;

    mapping(address => bool) public hasTicket;

    event TicketBought(address indexed buyer, uint256 tokenId);

    constructor() ERC721("EquilibriumTicket", "EQT") {}

    function buyTicket() external payable {
        address buyer = _actor();
        require(!hasTicket[buyer], "Ticket already owned");
        require(msg.value >= TICKET_PRICE, "Insufficient payment");

        uint256 tokenId = _nextId;
        _nextId += 1;
        // Set state before external call (checks-effects-interactions)
        hasTicket[buyer] = true;
        emit TicketBought(buyer, tokenId);
        _safeMint(buyer, tokenId);
    }

    function withdraw(address payable to) external onlyOwner {
        require(to != address(0), "Recipient address required");
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");
        Address.sendValue(to, balance);
    }
}
