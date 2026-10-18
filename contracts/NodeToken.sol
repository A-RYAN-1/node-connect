// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title NodeToken (TOK)
/// @notice The reward token of node-connect. The supply is capped and only
///         the `Mining` contract can mint it.
/// @dev There is no admin: the only role holder is the minter passed to the
///      constructor, and nobody can grant `MINTER_ROLE` to anyone else.
contract NodeToken is ERC20Capped, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Hard cap on the total supply: 21 million TOK.
    uint256 public constant SUPPLY_CAP = 21_000_000 ether;

    constructor(address minter) ERC20("Node Token", "TOK") ERC20Capped(SUPPLY_CAP) {
        _grantRole(MINTER_ROLE, minter);
    }

    /// @notice Mints `amount` to `to`. Reverts above the cap.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}
