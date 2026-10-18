// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {NodeToken} from "./NodeToken.sol";
import {Registry} from "./Registry.sol";
import {ChatAnchor} from "./ChatAnchor.sol";

/// @title Mining
/// @notice Mints TOK for proven chat activity. A claim needs
///         1. proof of activity: a Merkle proof that the caller sent at least
///            `MIN_MESSAGES` messages to one friend in an anchored epoch, and
///         2. proof of work: a nonce with keccak256(root, caller, nonce) below
///            the epoch's target.
///         The work is bound to the caller, each caller claims once per epoch,
///         the reward halves every `HALVING_INTERVAL` epochs, and every
///         failure reverts.
/// @dev Leaf format (double hashed, as in OpenZeppelin's merkle-tree):
///      keccak256(bytes.concat(keccak256(abi.encode(user, friend, messageCount)))).
///      The relayer only includes pairs that exchanged messages both ways.
contract Mining {
    /// @notice The token. Created here so this contract is its only minter.
    NodeToken public immutable token;
    Registry public immutable registry;
    ChatAnchor public immutable anchor;

    uint256 public constant BASE_REWARD = 50 ether;
    uint256 public constant HALVING_INTERVAL = 90; // epochs
    uint256 public constant MIN_MESSAGES = 5;
    uint256 public constant MIN_ACCOUNT_AGE = 1 days;
    uint256 public constant MAX_CLAIMS_PER_EPOCH = 100;

    /// @notice Claims per epoch the difficulty aims for.
    uint256 public constant DESIRED_CLAIMS = 10;
    /// @notice Starting target: about 2^16 hashes per claim.
    uint256 public constant INITIAL_TARGET = 2 ** 240;
    /// @notice The target moves at most this factor from the initial one.
    uint256 public constant MAX_TARGET_FACTOR = 16;

    mapping(uint256 => uint256) public claimsIn;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event Claimed(uint256 indexed epoch, address indexed user, address indexed friend, uint256 reward);

    error NotClaimable(uint256 epoch, uint256 current);
    error NotAnchored(uint256 epoch);
    error AlreadyClaimed(uint256 epoch, address user);
    error EpochFull(uint256 epoch);
    error NotRegistered(address user);
    error AccountTooNew(address user);
    error NotFriends(address user, address friend);
    error TooFewMessages(uint256 messageCount);
    error InvalidActivityProof();
    error InsufficientWork();

    constructor(Registry registry_, ChatAnchor anchor_) {
        registry = registry_;
        anchor = anchor_;
        token = new NodeToken(address(this));
    }

    /// @notice Claims the reward of `epoch` for the caller.
    /// @param epoch A finished and anchored epoch. Only the epoch right
    ///        before the current one can be claimed, which keeps the
    ///        claim count that sets the next difficulty final.
    /// @param friend The accepted friend the messages were sent to.
    /// @param messageCount The count in the caller's leaf.
    /// @param proof Merkle proof of the leaf against the epoch root.
    /// @param nonce The proof-of-work solution.
    function claim(
        uint256 epoch,
        address friend,
        uint256 messageCount,
        bytes32[] calldata proof,
        uint256 nonce
    ) external {
        uint256 current = anchor.currentEpoch();
        if (epoch + 1 != current) revert NotClaimable(epoch, current);
        bytes32 root = anchor.rootOf(epoch);
        if (root == bytes32(0)) revert NotAnchored(epoch);
        if (claimed[epoch][msg.sender]) revert AlreadyClaimed(epoch, msg.sender);
        if (claimsIn[epoch] >= MAX_CLAIMS_PER_EPOCH) revert EpochFull(epoch);

        uint64 registeredAt = registry.profileOf(msg.sender).registeredAt;
        if (registeredAt == 0) revert NotRegistered(msg.sender);
        if (block.timestamp < registeredAt + MIN_ACCOUNT_AGE) revert AccountTooNew(msg.sender);
        if (!registry.areFriends(msg.sender, friend)) revert NotFriends(msg.sender, friend);
        if (messageCount < MIN_MESSAGES) revert TooFewMessages(messageCount);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, friend, messageCount))));
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert InvalidActivityProof();

        if (uint256(keccak256(abi.encode(root, msg.sender, nonce))) >= targetFor(epoch)) {
            revert InsufficientWork();
        }

        claimed[epoch][msg.sender] = true;
        claimsIn[epoch] += 1;
        uint256 reward = rewardFor(epoch);
        emit Claimed(epoch, msg.sender, friend, reward);
        token.mint(msg.sender, reward);
    }

    /// @notice Reward per claim in `epoch`: halves every `HALVING_INTERVAL` epochs.
    function rewardFor(uint256 epoch) public pure returns (uint256) {
        return BASE_REWARD >> (epoch / HALVING_INTERVAL);
    }

    /// @notice Proof-of-work target of `epoch`. It is set by how many claims the
    ///         previous epoch had: more claims than desired make it harder,
    ///         fewer make it easier, within a factor of `MAX_TARGET_FACTOR`
    ///         of the initial target.
    function targetFor(uint256 epoch) public view returns (uint256) {
        if (epoch == 0) return INITIAL_TARGET;
        uint256 previousClaims = claimsIn[epoch - 1];
        uint256 highest = INITIAL_TARGET * MAX_TARGET_FACTOR;
        uint256 lowest = INITIAL_TARGET / MAX_TARGET_FACTOR;
        uint256 target = previousClaims == 0
            ? highest
            : (INITIAL_TARGET * DESIRED_CLAIMS) / previousClaims;
        if (target > highest) return highest;
        if (target < lowest) return lowest;
        return target;
    }
}
