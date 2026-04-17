// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Ticket is ERC721, Ownable {
    uint256 public constant TICKET_PRICE = 0.01 ether;
    uint256 private _nextId = 1;

    mapping(address => bool) public hasTicket;

    event TicketBought(address indexed buyer, uint256 tokenId);

    constructor() ERC721("EquilibriumTicket", "EQT") {}

    function buyTicket() external payable {
        require(!hasTicket[msg.sender], "Ticket already owned");
        require(msg.value >= TICKET_PRICE, "Insufficient payment");

        uint256 tokenId = _nextId;
        _nextId += 1;
        hasTicket[msg.sender] = true;
        _safeMint(msg.sender, tokenId);

        emit TicketBought(msg.sender, tokenId);
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }
}
