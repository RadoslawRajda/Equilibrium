// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Axial `q,r` string parsing for lazy map reads (`getHexTile` before a hex is stored).
library HexCoords {
    function parseIntSlice(bytes memory b, uint256 start, uint256 end) private pure returns (bool ok, int256 v) {
        if (start >= end) {
            return (false, 0);
        }
        uint256 i = start;
        bool neg = false;
        if (b[i] == "-") {
            neg = true;
            i++;
            if (i >= end) {
                return (false, 0);
            }
        } else if (b[i] == "+") {
            i++;
            if (i >= end) {
                return (false, 0);
            }
        }
        uint256 acc = 0;
        for (; i < end; i++) {
            uint8 c = uint8(b[i]);
            if (c < 48 || c > 57) {
                return (false, 0);
            }
            unchecked {
                acc = acc * 10 + (c - 48);
            }
            if (acc > uint256(type(int256).max)) {
                return (false, 0);
            }
        }
        int256 vi = int256(acc);
        if (neg) {
            vi = -vi;
        }
        return (true, vi);
    }

    function parseAxialHexId(string calldata s) external pure returns (bool ok, int256 q, int256 r) {
        bytes memory b = bytes(s);
        uint256 len = b.length;
        if (len < 3) {
            return (false, 0, 0);
        }
        uint256 comma = type(uint256).max;
        for (uint256 i = 0; i < len; i++) {
            if (b[i] == ",") {
                if (comma != type(uint256).max) {
                    return (false, 0, 0);
                }
                comma = i;
            }
        }
        if (comma == type(uint256).max || comma == 0 || comma >= len - 1) {
            return (false, 0, 0);
        }
        (bool qOk, int256 qv) = parseIntSlice(b, 0, comma);
        if (!qOk) {
            return (false, 0, 0);
        }
        (bool rOk, int256 rv) = parseIntSlice(b, comma + 1, len);
        if (!rOk) {
            return (false, 0, 0);
        }
        return (true, qv, rv);
    }
}
