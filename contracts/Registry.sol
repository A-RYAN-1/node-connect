// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/// @title Registry
/// @notice Identity and friendships of node-connect. A friendship needs a
///         request and an acceptance. Lists are not stored as arrays: clients
///         rebuild them from the events, so no function has unbounded cost.
contract Registry {
    struct Profile {
        string name;
        bytes32 encryptionKey; // X25519 public key used to encrypt messages to this user
        uint64 registeredAt;
    }

    uint256 public constant MAX_NAME_LENGTH = 32;

    mapping(address => Profile) private _profiles;
    mapping(address => mapping(address => bool)) private _friends;
    mapping(address => mapping(address => bool)) private _requested; // from => to
    mapping(address => mapping(address => bool)) private _blocked; // blocker => blocked

    event Registered(address indexed user, string name, bytes32 encryptionKey);
    event ProfileUpdated(address indexed user, string name, bytes32 encryptionKey);
    event FriendRequested(address indexed from, address indexed to);
    event FriendAccepted(address indexed from, address indexed to);
    event FriendDeclined(address indexed from, address indexed to);
    event FriendRemoved(address indexed user, address indexed friend);
    event Blocked(address indexed blocker, address indexed blocked);
    event Unblocked(address indexed blocker, address indexed unblocked);

    error AlreadyRegistered();
    error NotRegistered(address user);
    error InvalidName();
    error InvalidEncryptionKey();
    error SelfAction();
    error AlreadyFriends();
    error AlreadyRequested();
    error NoRequest();
    error NotFriends();
    error BlockedByRecipient();
    error BlockedByYou();

    modifier onlyRegistered(address user) {
        // slither-disable-next-line incorrect-equality
        if (_profiles[user].registeredAt == 0) revert NotRegistered(user);
        _;
    }

    /// @notice Creates the caller's profile.
    function register(string calldata name, bytes32 encryptionKey) external {
        if (_profiles[msg.sender].registeredAt != 0) revert AlreadyRegistered();
        _checkProfile(name, encryptionKey);
        _profiles[msg.sender] = Profile(name, encryptionKey, uint64(block.timestamp));
        emit Registered(msg.sender, name, encryptionKey);
    }

    /// @notice Changes the caller's name and encryption key.
    function updateProfile(string calldata name, bytes32 encryptionKey)
        external
        onlyRegistered(msg.sender)
    {
        _checkProfile(name, encryptionKey);
        Profile storage profile = _profiles[msg.sender];
        profile.name = name;
        profile.encryptionKey = encryptionKey;
        emit ProfileUpdated(msg.sender, name, encryptionKey);
    }

    /// @notice Asks `to` to become a friend.
    function request(address to) external onlyRegistered(msg.sender) onlyRegistered(to) {
        if (to == msg.sender) revert SelfAction();
        if (_friends[msg.sender][to]) revert AlreadyFriends();
        if (_blocked[to][msg.sender]) revert BlockedByRecipient();
        if (_blocked[msg.sender][to]) revert BlockedByYou();
        if (_requested[msg.sender][to]) revert AlreadyRequested();
        _requested[msg.sender][to] = true;
        emit FriendRequested(msg.sender, to);
    }

    /// @notice Accepts the request `from` sent to the caller.
    function accept(address from) external {
        if (!_requested[from][msg.sender]) revert NoRequest();
        if (_blocked[msg.sender][from]) revert BlockedByYou();
        delete _requested[from][msg.sender];
        // A request in the other direction is now redundant.
        delete _requested[msg.sender][from];
        _friends[msg.sender][from] = true;
        _friends[from][msg.sender] = true;
        emit FriendAccepted(from, msg.sender);
    }

    /// @notice Declines the request `from` sent to the caller.
    function decline(address from) external {
        if (!_requested[from][msg.sender]) revert NoRequest();
        delete _requested[from][msg.sender];
        emit FriendDeclined(from, msg.sender);
    }

    /// @notice Ends a friendship, for both sides.
    function remove(address friend) external {
        if (!_friends[msg.sender][friend]) revert NotFriends();
        delete _friends[msg.sender][friend];
        delete _friends[friend][msg.sender];
        emit FriendRemoved(msg.sender, friend);
    }

    /// @notice Blocks `user`: ends any friendship and pending requests, and
    ///         stops new requests from them.
    function blockUser(address user) external onlyRegistered(msg.sender) {
        if (user == msg.sender) revert SelfAction();
        _blocked[msg.sender][user] = true;
        delete _friends[msg.sender][user];
        delete _friends[user][msg.sender];
        delete _requested[msg.sender][user];
        delete _requested[user][msg.sender];
        emit Blocked(msg.sender, user);
    }

    /// @notice Lifts a block.
    function unblockUser(address user) external {
        delete _blocked[msg.sender][user];
        emit Unblocked(msg.sender, user);
    }

    function isRegistered(address user) external view returns (bool) {
        return _profiles[user].registeredAt != 0;
    }

    function profileOf(address user) external view returns (Profile memory) {
        return _profiles[user];
    }

    function areFriends(address a, address b) external view returns (bool) {
        return _friends[a][b];
    }

    function hasRequested(address from, address to) external view returns (bool) {
        return _requested[from][to];
    }

    function isBlocked(address blocker, address user) external view returns (bool) {
        return _blocked[blocker][user];
    }

    function _checkProfile(string calldata name, bytes32 encryptionKey) private pure {
        uint256 length = bytes(name).length;
        if (length == 0 || length > MAX_NAME_LENGTH) revert InvalidName();
        if (encryptionKey == bytes32(0)) revert InvalidEncryptionKey();
    }
}
