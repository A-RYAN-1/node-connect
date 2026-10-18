// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ChatAnchor
/// @notice Defines the daily epochs and stores, for each finished epoch, the
///         Merkle root of its activity leaves. The relayer posts the root
///         and publishes the batch it was built from (`batchUri`), so anyone
///         can recompute the root.
contract ChatAnchor is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    uint256 public constant EPOCH_LENGTH = 1 days;

    /// @notice Timestamp at which epoch 0 starts.
    uint256 public immutable genesis;

    mapping(uint256 => bytes32) private _roots;

    event Anchored(uint256 indexed epoch, bytes32 root, string batchUri);

    error EpochNotFinished(uint256 epoch, uint256 current);
    error AlreadyAnchored(uint256 epoch);
    error EmptyRoot();

    constructor(address admin, address relayer) {
        genesis = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RELAYER_ROLE, relayer);
    }

    /// @notice The epoch that contains the current block.
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - genesis) / EPOCH_LENGTH;
    }

    /// @notice Records the root of a finished epoch. One root per epoch, final.
    function anchor(uint256 epoch, bytes32 root, string calldata batchUri)
        external
        onlyRole(RELAYER_ROLE)
    {
        uint256 current = currentEpoch();
        if (epoch >= current) revert EpochNotFinished(epoch, current);
        if (root == bytes32(0)) revert EmptyRoot();
        if (_roots[epoch] != bytes32(0)) revert AlreadyAnchored(epoch);
        _roots[epoch] = root;
        emit Anchored(epoch, root, batchUri);
    }

    /// @notice The root of `epoch`, or zero when none was posted.
    function rootOf(uint256 epoch) external view returns (bytes32) {
        return _roots[epoch];
    }
}
