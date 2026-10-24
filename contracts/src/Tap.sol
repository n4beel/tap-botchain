// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/// @title Tap
/// @notice A public faucet engine for native BOT and ERC-20 tokens with per-wallet cooldowns.
///
/// @dev What this contract deliberately cannot do:
/// - It cannot tell people apart. One person with fifty wallets can draw fifty times;
///   a tap is a community pool you choose to let anyone draw from.
/// - The amount per draw and cooldown are permanently fixed at creation.
/// - It does not verify token authenticity or quality.
/// - Fee-on-transfer and rebasing tokens are explicitly measured and rejected.
/// - No admin, no pause, no blacklist, no backdoor.
contract Tap {
    uint64 public constant MIN_COOLDOWN = 60 seconds;
    uint64 public constant MAX_COOLDOWN = 365 days;
    uint64 public constant ONCE = type(uint64).max;
    uint256 public constant MAX_NAME_BYTES = 40;
    uint256 public constant MAX_PAGE = 50;

    struct TapData {
        address owner;        // 20 bytes ┐ slot 1
        uint64 cooldown;      //  8 bytes │ (ONCE = one draw per wallet, ever)
        uint32 draws;         //  4 bytes ┘
        address token;        // 20 bytes ┐ slot 2 (address(0) = native BOT)
        uint64 createdBlock;  //  8 bytes ┘
        uint128 perDraw;      // 16 bytes ┐ slot 3
        uint128 balance;      // 16 bytes ┘
    }

    struct TapView {
        uint256 id;
        address owner;
        address token;
        uint128 perDraw;
        uint128 balance;
        uint64 cooldown;
        uint32 draws;
        uint64 createdBlock;
    }

    mapping(uint256 => TapData) private _taps;
    mapping(uint256 => mapping(address => uint64)) private _lastDraw;
    mapping(address => uint256[]) private _tapsBy;
    uint256 public tapCount;

    uint256 private _reentrancyLocked;

    event TapCreated(
        uint256 indexed id,
        address indexed owner,
        address token,
        uint128 perDraw,
        uint64 cooldown,
        string name
    );
    event Funded(uint256 indexed id, address indexed funder, uint128 amount);
    event Drawn(uint256 indexed id, address indexed drawer, uint128 amount);
    event Withdrawn(uint256 indexed id, address indexed owner, uint128 amount);

    error BadCooldown(uint64 cooldown);
    error NameTooLong(uint256 length, uint256 max);
    error ZeroAmount();
    error NotAContract(address token);
    error UnexpectedValue();
    error WrongAsset(uint256 id);
    error UnsupportedToken();
    error NoSuchTap(uint256 id);
    error Empty(uint256 id, uint256 balance, uint256 perDraw);
    error OnCooldown(uint256 id, uint64 nextAt);
    error NotOwner(uint256 id, address caller);
    error InsufficientBalance(uint256 balance, uint256 requested);
    error TransferFailed();

    modifier nonReentrant() {
        if (_reentrancyLocked == 2) revert TransferFailed();
        _reentrancyLocked = 2;
        _;
        _reentrancyLocked = 1;
    }

    /// @notice Creates a new tap for native BOT or an ERC-20 token.
    /// @param token The token contract address, or address(0) for native BOT.
    /// @param perDraw Amount distributed on each valid draw call.
    /// @param cooldown Cooldown interval in seconds, or ONCE (type(uint64).max) for single-draw taps.
    /// @param name Descriptive tap label emitted in logs.
    function create(
        address token,
        uint128 perDraw,
        uint64 cooldown,
        string calldata name
    ) external payable returns (uint256 id) {
        if (perDraw == 0) revert ZeroAmount();
        if (cooldown != ONCE && (cooldown < MIN_COOLDOWN || cooldown > MAX_COOLDOWN)) {
            revert BadCooldown(cooldown);
        }
        if (bytes(name).length > MAX_NAME_BYTES) {
            revert NameTooLong(bytes(name).length, MAX_NAME_BYTES);
        }

        uint128 initialBalance = 0;
        if (token != address(0)) {
            if (token.code.length == 0) revert NotAContract(token);
            if (msg.value != 0) revert UnexpectedValue();
        } else {
            initialBalance = uint128(msg.value);
        }

        id = ++tapCount;

        _taps[id] = TapData({
            owner: msg.sender,
            cooldown: cooldown,
            draws: 0,
            token: token,
            createdBlock: uint64(block.number),
            perDraw: perDraw,
            balance: initialBalance
        });

        _tapsBy[msg.sender].push(id);

        emit TapCreated(id, msg.sender, token, perDraw, cooldown, name);

        if (initialBalance > 0) {
            emit Funded(id, msg.sender, initialBalance);
        }
    }

    /// @notice Tops up a native BOT tap.
    /// @param id The tap ID to fund.
    function fundNative(uint256 id) external payable {
        if (id == 0 || id > tapCount) revert NoSuchTap(id);
        TapData storage tap = _taps[id];
        if (tap.token != address(0)) revert WrongAsset(id);
        if (msg.value == 0) revert ZeroAmount();

        tap.balance += uint128(msg.value);
        emit Funded(id, msg.sender, uint128(msg.value));
    }

    /// @notice Tops up an ERC-20 tap, enforcing exact balance delta measurement.
    /// @param id The tap ID to fund.
    /// @param amount Amount of tokens to transfer in.
    function fundToken(uint256 id, uint128 amount) external nonReentrant {
        if (id == 0 || id > tapCount) revert NoSuchTap(id);
        TapData storage tap = _taps[id];
        if (tap.token == address(0)) revert WrongAsset(id);
        if (amount == 0) revert ZeroAmount();

        uint256 balBefore = _balanceOf(tap.token, address(this));
        _safeTransferFrom(tap.token, msg.sender, address(this), amount);
        uint256 balAfter = _balanceOf(tap.token, address(this));

        if (balAfter - balBefore != amount) revert UnsupportedToken();

        tap.balance += amount;
        emit Funded(id, msg.sender, amount);
    }

    /// @notice Draws the fixed perDraw amount from a tap if cooldown has elapsed.
    /// @param id The tap ID to draw from.
    function draw(uint256 id) external nonReentrant {
        if (id == 0 || id > tapCount) revert NoSuchTap(id);
        TapData storage tap = _taps[id];

        if (tap.balance < tap.perDraw) {
            revert Empty(id, tap.balance, tap.perDraw);
        }

        uint64 last = _lastDraw[id][msg.sender];
        if (last != 0) {
            if (tap.cooldown == ONCE) {
                revert OnCooldown(id, ONCE);
            }
            uint64 nextAt = last + tap.cooldown;
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp < nextAt) {
                revert OnCooldown(id, nextAt);
            }
        }

        // Effects before interactions
        _lastDraw[id][msg.sender] = tap.cooldown == ONCE ? ONCE : uint64(block.timestamp);
        tap.balance -= tap.perDraw;
        tap.draws += 1;

        // Interaction
        if (tap.token == address(0)) {
            (bool ok,) = msg.sender.call{value: tap.perDraw}("");
            if (!ok) revert TransferFailed();
        } else {
            _safeTransfer(tap.token, msg.sender, tap.perDraw);
        }

        emit Drawn(id, msg.sender, tap.perDraw);
    }

    /// @notice Allows the creator to withdraw remaining funds from their tap.
    /// @param id The tap ID.
    /// @param amount Amount to withdraw.
    function withdraw(uint256 id, uint128 amount) external nonReentrant {
        if (id == 0 || id > tapCount) revert NoSuchTap(id);
        TapData storage tap = _taps[id];

        if (msg.sender != tap.owner) {
            revert NotOwner(id, msg.sender);
        }
        if (amount == 0) revert ZeroAmount();
        if (amount > tap.balance) {
            revert InsufficientBalance(tap.balance, amount);
        }

        tap.balance -= amount;

        if (tap.token == address(0)) {
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            _safeTransfer(tap.token, msg.sender, amount);
        }

        emit Withdrawn(id, msg.sender, amount);
    }

    /// @notice Reads tap metadata by ID.
    function tapOf(uint256 id) external view returns (TapView memory) {
        if (id == 0 || id > tapCount) revert NoSuchTap(id);
        TapData storage t = _taps[id];
        return TapView({
            id: id,
            owner: t.owner,
            token: t.token,
            perDraw: t.perDraw,
            balance: t.balance,
            cooldown: t.cooldown,
            draws: t.draws,
            createdBlock: t.createdBlock
        });
    }

    /// @notice Returns the timestamp when who can next draw from tap id.
    /// Returns 0 if eligible now, ONCE if already drawn from a ONCE tap, or future unix timestamp.
    function nextDrawAt(uint256 id, address who) external view returns (uint64) {
        if (id == 0 || id > tapCount) revert NoSuchTap(id);
        uint64 last = _lastDraw[id][who];
        if (last == 0) return 0;
        if (_taps[id].cooldown == ONCE) return ONCE;
        uint64 nextAt = last + _taps[id].cooldown;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= nextAt) return 0;
        return nextAt;
    }

    /// @notice Returns newest-first slice of taps, clamped to MAX_PAGE.
    function latest(uint256 offset, uint256 count) external view returns (TapView[] memory items) {
        if (count > MAX_PAGE) count = MAX_PAGE;
        uint256 total = tapCount;
        if (offset >= total) {
            return new TapView[](0);
        }
        uint256 available = total - offset;
        uint256 n = count < available ? count : available;
        items = new TapView[](n);

        for (uint256 p = 0; p < n; p++) {
            uint256 id = total - offset - p;
            TapData storage t = _taps[id];
            items[p] = TapView({
                id: id,
                owner: t.owner,
                token: t.token,
                perDraw: t.perDraw,
                balance: t.balance,
                cooldown: t.cooldown,
                draws: t.draws,
                createdBlock: t.createdBlock
            });
        }
    }

    /// @notice Returns IDs of all taps created by who.
    function tapsBy(address who) external view returns (uint256[] memory) {
        return _tapsBy[who];
    }

    // --- Internal ERC-20 Safe Helpers ---

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _balanceOf(address token, address account) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, account)
        );
        if (!success || data.length < 32) {
            revert UnsupportedToken();
        }
        return abi.decode(data, (uint256));
    }
}
