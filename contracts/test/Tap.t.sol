// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test, console2} from "forge-std/Test.sol";
import {Tap} from "../src/Tap.sol";
import {
    MockERC20,
    NoReturnToken,
    ReturnsFalseToken,
    FeeOnTransferToken,
    ReentrantToken
} from "./helpers/MockERC20.sol";

contract TapHandler is Test {
    Tap public tap;
    MockERC20 public token;

    address[] public users;
    uint256[] public nativeTapIds;
    uint256[] public tokenTapIds;

    constructor(Tap tap_, MockERC20 token_) {
        tap = tap_;
        token = token_;

        users.push(makeAddr("alice"));
        users.push(makeAddr("bob"));
        users.push(makeAddr("charlie"));
        users.push(makeAddr("david"));

        for (uint256 i = 0; i < users.length; i++) {
            vm.deal(users[i], 1000 ether);
            token.mint(users[i], 1_000_000 ether);
            vm.prank(users[i]);
            token.approve(address(tap), type(uint256).max);
        }
    }

    function createTap(uint8 userIdx, bool isToken, uint96 perDraw, uint32 cooldownSecs, uint96 initialBal) external {
        address user = users[userIdx % users.length];
        uint128 per = uint128(bound(perDraw, 1, 100 ether));
        uint64 cool = uint64(bound(cooldownSecs, 60, 30 days));

        if (isToken) {
            vm.prank(user);
            uint256 id = tap.create(address(token), per, cool, "Token Tap");
            tokenTapIds.push(id);
            if (initialBal > 0) {
                uint128 bal = uint128(bound(initialBal, 1, 1000 ether));
                vm.prank(user);
                tap.fundToken(id, bal);
            }
        } else {
            uint128 bal = uint128(bound(initialBal, 0, 1000 ether));
            vm.prank(user);
            uint256 id = tap.create{value: bal}(address(0), per, cool, "Native Tap");
            nativeTapIds.push(id);
        }
    }

    function fund(uint8 userIdx, uint8 tapIdx, uint96 amount) external {
        address user = users[userIdx % users.length];
        uint128 amt = uint128(bound(amount, 1, 50 ether));

        if (nativeTapIds.length > 0 && tapIdx % 2 == 0) {
            uint256 id = nativeTapIds[tapIdx % nativeTapIds.length];
            vm.prank(user);
            tap.fundNative{value: amt}(id);
        } else if (tokenTapIds.length > 0) {
            uint256 id = tokenTapIds[tapIdx % tokenTapIds.length];
            vm.prank(user);
            tap.fundToken(id, amt);
        }
    }

    function draw(uint8 userIdx, uint8 tapIdx) external {
        address user = users[userIdx % users.length];

        if (nativeTapIds.length > 0 && tapIdx % 2 == 0) {
            uint256 id = nativeTapIds[tapIdx % nativeTapIds.length];
            Tap.TapView memory v = tap.tapOf(id);
            if (v.balance >= v.perDraw && tap.nextDrawAt(id, user) == 0) {
                vm.prank(user);
                tap.draw(id);
            }
        } else if (tokenTapIds.length > 0) {
            uint256 id = tokenTapIds[tapIdx % tokenTapIds.length];
            Tap.TapView memory v = tap.tapOf(id);
            if (v.balance >= v.perDraw && tap.nextDrawAt(id, user) == 0) {
                vm.prank(user);
                tap.draw(id);
            }
        }
    }

    function withdraw(uint8 tapIdx, uint96 amount) external {
        if (nativeTapIds.length > 0 && tapIdx % 2 == 0) {
            uint256 id = nativeTapIds[tapIdx % nativeTapIds.length];
            Tap.TapView memory v = tap.tapOf(id);
            if (v.balance > 0) {
                uint128 amt = uint128(bound(amount, 1, v.balance));
                vm.prank(v.owner);
                tap.withdraw(id, amt);
            }
        } else if (tokenTapIds.length > 0) {
            uint256 id = tokenTapIds[tapIdx % tokenTapIds.length];
            Tap.TapView memory v = tap.tapOf(id);
            if (v.balance > 0) {
                uint128 amt = uint128(bound(amount, 1, v.balance));
                vm.prank(v.owner);
                tap.withdraw(id, amt);
            }
        }
    }

    function warp(uint32 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 60, 7 days));
    }

    function nativeBalanceSum() external view returns (uint256 sum) {
        for (uint256 i = 0; i < nativeTapIds.length; i++) {
            sum += tap.tapOf(nativeTapIds[i]).balance;
        }
    }

    function tokenBalanceSum() external view returns (uint256 sum) {
        for (uint256 i = 0; i < tokenTapIds.length; i++) {
            sum += tap.tapOf(tokenTapIds[i]).balance;
        }
    }
}

contract TapTest is Test {
    Tap public tap;
    MockERC20 public token;

    address public owner = makeAddr("owner");
    address public user1 = makeAddr("user1");
    address public user2 = makeAddr("user2");

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

    function setUp() public {
        vm.warp(1_760_000_000);
        tap = new Tap();
        token = new MockERC20("Test Token", "TST", 18);

        vm.deal(owner, 100 ether);
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);

        token.mint(owner, 10_000 ether);
        token.mint(user1, 10_000 ether);

        vm.prank(owner);
        token.approve(address(tap), type(uint256).max);
        vm.prank(user1);
        token.approve(address(tap), type(uint256).max);
    }

    function test_CreateNative_WithAndWithoutFunding() public {
        // Without funding
        vm.expectEmit(true, true, false, true);
        emit TapCreated(1, owner, address(0), 0.01 ether, 1 hours, "Empty Native Tap");
        vm.prank(owner);
        uint256 id1 = tap.create(address(0), 0.01 ether, 1 hours, "Empty Native Tap");
        assertEq(id1, 1);

        Tap.TapView memory v1 = tap.tapOf(1);
        assertEq(v1.owner, owner);
        assertEq(v1.token, address(0));
        assertEq(v1.perDraw, 0.01 ether);
        assertEq(v1.balance, 0);
        assertEq(v1.cooldown, 1 hours);
        assertEq(v1.draws, 0);

        // With funding
        vm.expectEmit(true, true, false, true);
        emit TapCreated(2, owner, address(0), 0.05 ether, 2 hours, "Funded Native Tap");
        vm.expectEmit(true, true, false, true);
        emit Funded(2, owner, 1 ether);
        vm.prank(owner);
        uint256 id2 = tap.create{value: 1 ether}(address(0), 0.05 ether, 2 hours, "Funded Native Tap");
        assertEq(id2, 2);

        Tap.TapView memory v2 = tap.tapOf(2);
        assertEq(v2.balance, 1 ether);

        uint256[] memory byOwner = tap.tapsBy(owner);
        assertEq(byOwner.length, 2);
        assertEq(byOwner[0], 1);
        assertEq(byOwner[1], 2);
    }

    function test_CreateToken_RejectsValue_NonContract() public {
        // Non-contract token address
        vm.expectRevert(abi.encodeWithSelector(Tap.NotAContract.selector, user1));
        vm.prank(owner);
        tap.create(user1, 100 ether, 1 hours, "Non contract");

        // Sending value with token tap
        vm.expectRevert(abi.encodeWithSelector(Tap.UnexpectedValue.selector));
        vm.prank(owner);
        tap.create{value: 1 ether}(address(token), 100 ether, 1 hours, "Token with value");
    }

    function test_Create_BadCooldown_ZeroPerDraw_LongName() public {
        // Zero per draw
        vm.expectRevert(abi.encodeWithSelector(Tap.ZeroAmount.selector));
        vm.prank(owner);
        tap.create(address(0), 0, 1 hours, "Zero");

        // Cooldown < 60 seconds
        vm.expectRevert(abi.encodeWithSelector(Tap.BadCooldown.selector, 59));
        vm.prank(owner);
        tap.create(address(0), 1 ether, 59, "Short");

        // Cooldown > 365 days
        uint64 tooLong = 365 days + 1;
        vm.expectRevert(abi.encodeWithSelector(Tap.BadCooldown.selector, tooLong));
        vm.prank(owner);
        tap.create(address(0), 1 ether, tooLong, "Long");

        // Name too long (> 40 bytes)
        string memory longName = "This name is definitely longer than 40 bytes allowed in tap";
        vm.expectRevert(abi.encodeWithSelector(Tap.NameTooLong.selector, bytes(longName).length, 40));
        vm.prank(owner);
        tap.create(address(0), 1 ether, 1 hours, longName);
    }

    function test_FundNative() public {
        vm.prank(owner);
        uint256 id = tap.create(address(0), 0.01 ether, 1 hours, "Tap");

        vm.expectRevert(abi.encodeWithSelector(Tap.ZeroAmount.selector));
        vm.prank(user1);
        tap.fundNative{value: 0}(id);

        vm.expectEmit(true, true, false, true);
        emit Funded(id, user1, 2 ether);
        vm.prank(user1);
        tap.fundNative{value: 2 ether}(id);

        assertEq(tap.tapOf(id).balance, 2 ether);
    }

    function test_FundToken_MeasuresDelta() public {
        vm.prank(owner);
        uint256 id = tap.create(address(token), 10 ether, 1 hours, "Token Tap");

        vm.expectEmit(true, true, false, true);
        emit Funded(id, owner, 500 ether);
        vm.prank(owner);
        tap.fundToken(id, 500 ether);

        assertEq(tap.tapOf(id).balance, 500 ether);
        assertEq(token.balanceOf(address(tap)), 500 ether);
    }

    function test_FundToken_FeeOnTransfer_Reverts() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        fot.mint(owner, 1000 ether);
        vm.prank(owner);
        fot.approve(address(tap), type(uint256).max);

        vm.prank(owner);
        uint256 id = tap.create(address(fot), 10 ether, 1 hours, "FOT Tap");

        vm.expectRevert(abi.encodeWithSelector(Tap.UnsupportedToken.selector));
        vm.prank(owner);
        tap.fundToken(id, 100 ether);
    }

    function test_FundToken_WrongAssetReverts() public {
        vm.prank(owner);
        uint256 nativeId = tap.create(address(0), 0.01 ether, 1 hours, "Native");
        uint256 tokenId = tap.create(address(token), 10 ether, 1 hours, "Token");

        // Fund token on native tap
        vm.expectRevert(abi.encodeWithSelector(Tap.WrongAsset.selector, nativeId));
        vm.prank(owner);
        tap.fundToken(nativeId, 50 ether);

        // Fund native on token tap
        vm.expectRevert(abi.encodeWithSelector(Tap.WrongAsset.selector, tokenId));
        vm.prank(owner);
        tap.fundNative{value: 1 ether}(tokenId);
    }

    function test_Draw_Native_Pays() public {
        vm.prank(owner);
        uint256 id = tap.create{value: 1 ether}(address(0), 0.02 ether, 1 hours, "Native");

        uint256 balBefore = user1.balance;
        vm.expectEmit(true, true, false, true);
        emit Drawn(id, user1, 0.02 ether);
        vm.prank(user1);
        tap.draw(id);

        assertEq(user1.balance - balBefore, 0.02 ether);
        assertEq(tap.tapOf(id).balance, 0.98 ether);
        assertEq(tap.tapOf(id).draws, 1);
    }

    function test_Draw_Token_Pays_NoReturnValueToken() public {
        NoReturnToken noRet = new NoReturnToken();
        noRet.mint(owner, 1000 ether);
        vm.prank(owner);
        noRet.approve(address(tap), type(uint256).max);

        vm.prank(owner);
        uint256 id = tap.create(address(noRet), 5 ether, 1 hours, "NoRet Tap");
        vm.prank(owner);
        tap.fundToken(id, 100 ether);

        vm.prank(user1);
        tap.draw(id);

        assertEq(noRet.balanceOf(user1), 5 ether);
        assertEq(tap.tapOf(id).balance, 95 ether);
    }

    function test_Draw_ReturnsFalseToken_Reverts() public {
        ReturnsFalseToken rf = new ReturnsFalseToken();
        rf.mint(owner, 1000 ether);
        vm.prank(owner);
        rf.approve(address(tap), type(uint256).max);

        vm.prank(owner);
        uint256 id = tap.create(address(rf), 5 ether, 1 hours, "RF Tap");

        // fundToken calls transferFrom which returns false -> UnsupportedToken
        vm.expectRevert(abi.encodeWithSelector(Tap.TransferFailed.selector));
        vm.prank(owner);
        tap.fundToken(id, 100 ether);
    }

    function test_Draw_Cooldown_Args_ThenAllowed() public {
        vm.prank(owner);
        uint256 id = tap.create{value: 1 ether}(address(0), 0.1 ether, 1 hours, "Timed Tap");

        vm.prank(user1);
        tap.draw(id);

        uint64 expectedNext = uint64(block.timestamp + 1 hours);
        vm.expectRevert(abi.encodeWithSelector(Tap.OnCooldown.selector, id, expectedNext));
        vm.prank(user1);
        tap.draw(id);

        // Warp past cooldown
        vm.warp(block.timestamp + 1 hours);
        vm.prank(user1);
        tap.draw(id);

        assertEq(tap.tapOf(id).draws, 2);
    }

    function test_Draw_ONCE_NeverAgain() public {
        vm.prank(owner);
        uint256 id = tap.create{value: 10 ether}(address(0), 1 ether, tap.ONCE(), "Once Tap");

        vm.prank(user1);
        tap.draw(id);

        // Advance 10 years
        vm.warp(block.timestamp + 3650 days);

        vm.expectRevert(abi.encodeWithSelector(Tap.OnCooldown.selector, id, tap.ONCE()));
        vm.prank(user1);
        tap.draw(id);
    }

    function test_Draw_Empty_Args() public {
        vm.prank(owner);
        uint256 id = tap.create{value: 0.05 ether}(address(0), 0.1 ether, 1 hours, "Dry Tap");

        vm.expectRevert(abi.encodeWithSelector(Tap.Empty.selector, id, 0.05 ether, 0.1 ether));
        vm.prank(user1);
        tap.draw(id);
    }

    function test_Withdraw_OwnerOnly_Amounts() public {
        vm.prank(owner);
        uint256 id = tap.create{value: 5 ether}(address(0), 0.1 ether, 1 hours, "Withdraw Tap");

        // Non-owner withdraw
        vm.expectRevert(abi.encodeWithSelector(Tap.NotOwner.selector, id, user1));
        vm.prank(user1);
        tap.withdraw(id, 1 ether);

        // Amount > balance
        vm.expectRevert(abi.encodeWithSelector(Tap.InsufficientBalance.selector, 5 ether, 6 ether));
        vm.prank(owner);
        tap.withdraw(id, 6 ether);

        // Successful withdrawal
        uint256 balBefore = owner.balance;
        vm.expectEmit(true, true, false, true);
        emit Withdrawn(id, owner, 2 ether);
        vm.prank(owner);
        tap.withdraw(id, 2 ether);

        assertEq(owner.balance - balBefore, 2 ether);
        assertEq(tap.tapOf(id).balance, 3 ether);
    }

    function test_NextDrawAt_AllStates() public {
        vm.prank(owner);
        uint256 idTimed = tap.create{value: 10 ether}(address(0), 0.1 ether, 1 hours, "Timed");
        uint256 idOnce = tap.create{value: 10 ether}(address(0), 0.1 ether, tap.ONCE(), "Once");

        // Never drawn
        assertEq(tap.nextDrawAt(idTimed, user1), 0);
        assertEq(tap.nextDrawAt(idOnce, user1), 0);

        // Draw from timed
        vm.prank(user1);
        tap.draw(idTimed);
        assertEq(tap.nextDrawAt(idTimed, user1), uint64(block.timestamp + 1 hours));

        // Warp past cooldown
        vm.warp(block.timestamp + 1 hours);
        assertEq(tap.nextDrawAt(idTimed, user1), 0);

        // Draw from ONCE
        vm.prank(user1);
        tap.draw(idOnce);
        assertEq(tap.nextDrawAt(idOnce, user1), tap.ONCE());
    }

    function test_Latest_Pagination() public {
        for (uint256 i = 1; i <= 5; i++) {
            vm.prank(owner);
            tap.create(address(0), 0.01 ether, 1 hours, "Tap");
        }

        Tap.TapView[] memory p1 = tap.latest(0, 3);
        assertEq(p1.length, 3);
        assertEq(p1[0].id, 5);
        assertEq(p1[1].id, 4);
        assertEq(p1[2].id, 3);

        Tap.TapView[] memory p2 = tap.latest(3, 3);
        assertEq(p2.length, 2);
        assertEq(p2[0].id, 2);
        assertEq(p2[1].id, 1);
    }

    function test_ReentrantToken_CannotDoubleDraw() public {
        ReentrantToken reent = new ReentrantToken();
        reent.mint(owner, 1000 ether);
        vm.prank(owner);
        reent.approve(address(tap), type(uint256).max);

        vm.prank(owner);
        uint256 id = tap.create(address(reent), 10 ether, 1 hours, "Reentrant Tap");
        vm.prank(owner);
        tap.fundToken(id, 100 ether);

        reent.setTarget(tap, id);
        reent.enableAttack(true);

        // Reentrant call during draw should fail with TransferFailed
        vm.expectRevert(abi.encodeWithSelector(Tap.TransferFailed.selector));
        vm.prank(user1);
        tap.draw(id);
    }

    function test_GasSnapshot_DrawNative() public {
        vm.prank(owner);
        uint256 id = tap.create{value: 10 ether}(address(0), 0.1 ether, 1 hours, "Gas Native");

        // Warm up user account
        vm.prank(user1);
        tap.draw(id);

        vm.warp(block.timestamp + 1 hours);
        uint256 g0 = gasleft();
        vm.prank(user1);
        tap.draw(id);
        uint256 used = g0 - gasleft();

        assertLt(used, 75_000);
    }

    function test_GasSnapshot_DrawToken() public {
        vm.prank(owner);
        uint256 id = tap.create(address(token), 10 ether, 1 hours, "Gas Token");
        vm.prank(owner);
        tap.fundToken(id, 500 ether);

        // Warm draw
        vm.prank(user1);
        tap.draw(id);

        vm.warp(block.timestamp + 1 hours);
        uint256 g0 = gasleft();
        vm.prank(user1);
        tap.draw(id);
        uint256 used = g0 - gasleft();

        assertLt(used, 95_000);
    }

    function test_GasSnapshot_Create() public {
        uint256 g0 = gasleft();
        vm.prank(owner);
        tap.create{value: 1 ether}(address(0), 0.05 ether, 1 hours, "Gas Create");
        uint256 used = g0 - gasleft();

        assertLt(used, 175_000);
    }

    function testFuzz_DrawsRespectCooldown(uint32 wait1) public {
        vm.prank(owner);
        uint256 id = tap.create{value: 10 ether}(address(0), 0.1 ether, 1 hours, "Fuzz Tap");

        vm.prank(user1);
        tap.draw(id);

        uint32 w1 = uint32(bound(wait1, 1, 2 hours));
        vm.warp(block.timestamp + w1);

        if (w1 < 1 hours) {
            vm.expectRevert();
            vm.prank(user1);
            tap.draw(id);
        } else {
            vm.prank(user1);
            tap.draw(id);
        }
    }

    function invariant_Conservation_Native() public {
        TapHandler handler = new TapHandler(tap, token);
        targetContract(address(handler));
        assertEq(address(tap).balance, handler.nativeBalanceSum());
    }

    function invariant_Conservation_Token() public {
        TapHandler handler = new TapHandler(tap, token);
        targetContract(address(handler));
        assertEq(token.balanceOf(address(tap)), handler.tokenBalanceSum());
    }
}
