// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Test} from "forge-std/Test.sol";
import {X402FeeSplitFacilitator} from "../src/X402FeeSplitFacilitator.sol";
import {MockUsdc} from "./mocks/MockUsdc.sol";

contract X402FeeSplitFacilitatorTest is Test {
    X402FeeSplitFacilitator internal facilitator;
    MockUsdc internal usdc;

    uint256 internal buyerKey = 0xB0B;
    address internal buyer;
    address internal publisher = address(0xCAFE);
    address internal feeReceiver = address(0xFEE);

    bytes32 internal constant TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function setUp() public {
        facilitator = new X402FeeSplitFacilitator();
        usdc = new MockUsdc();
        buyer = vm.addr(buyerKey);
        usdc.mint(buyer, 1_000_000_000); // 1,000 USDC
        vm.warp(1_700_000_000);
    }

    function _signAuth(uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(TYPEHASH, buyer, address(facilitator), value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(buyerKey, digest);
    }

    // ── happy path ──────────────────────────────────────────────────────────

    function test_settle_splitsCorrectly_50bps() public {
        uint256 amount = 1_000_000; // 1.00 USDC
        bytes32 nonce = bytes32(uint256(1));
        bytes32 paymentId = bytes32(uint256(0xAAAA));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);

        (uint256 fee, uint256 publisherAmount) = facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce, v, r, s, publisher, 50, feeReceiver, paymentId
        );

        assertEq(fee, 5_000);
        assertEq(publisherAmount, 995_000);
        assertEq(usdc.balanceOf(publisher), 995_000);
        assertEq(usdc.balanceOf(feeReceiver), 5_000);
        assertEq(usdc.balanceOf(address(facilitator)), 0);
        assertTrue(facilitator.settled(paymentId));
    }

    function test_settle_zeroFee_publisherGetsAll() public {
        uint256 amount = 123_456;
        bytes32 nonce = bytes32(uint256(2));
        bytes32 paymentId = bytes32(uint256(0xBBBB));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);

        (uint256 fee, uint256 publisherAmount) = facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce, v, r, s, publisher, 0, feeReceiver, paymentId
        );

        assertEq(fee, 0);
        assertEq(publisherAmount, amount);
        assertEq(usdc.balanceOf(publisher), amount);
        assertEq(usdc.balanceOf(feeReceiver), 0);
    }

    function test_settle_maxFee_100bps() public {
        uint256 amount = 100_000_000;
        bytes32 nonce = bytes32(uint256(3));
        bytes32 paymentId = bytes32(uint256(0xCCCC));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);

        (uint256 fee, uint256 publisherAmount) = facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce, v, r, s, publisher, 100, feeReceiver, paymentId
        );

        assertEq(fee, 1_000_000);
        assertEq(publisherAmount, 99_000_000);
    }

    function test_settle_emitsSettledEvent() public {
        uint256 amount = 2_000_000;
        bytes32 nonce = bytes32(uint256(4));
        bytes32 paymentId = bytes32(uint256(0xDDDD));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);

        vm.expectEmit(true, true, true, true);
        emit X402FeeSplitFacilitator.Settled(paymentId, address(usdc), buyer, publisher, feeReceiver, amount, 10_000);

        facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce, v, r, s, publisher, 50, feeReceiver, paymentId
        );
    }

    // ── reverts ─────────────────────────────────────────────────────────────

    function test_settle_revertsOnFeeBpsTooHigh() public {
        uint256 amount = 1_000_000;
        bytes32 nonce = bytes32(uint256(5));
        bytes32 paymentId = bytes32(uint256(0xEEEE));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);

        vm.expectRevert(abi.encodeWithSelector(X402FeeSplitFacilitator.FeeBpsTooHigh.selector, 101));
        facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce, v, r, s, publisher, 101, feeReceiver, paymentId
        );
    }

    function test_settle_revertsOnZeroAmount() public {
        bytes32 nonce = bytes32(uint256(6));
        bytes32 paymentId = bytes32(uint256(0xFFFF));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(0, 0, type(uint256).max, nonce);

        vm.expectRevert(X402FeeSplitFacilitator.ZeroAmount.selector);
        facilitator.settle(
            address(usdc), buyer, 0, 0, type(uint256).max, nonce, v, r, s, publisher, 50, feeReceiver, paymentId
        );
    }

    function test_settle_revertsOnZeroPublisher() public {
        uint256 amount = 1_000_000;
        bytes32 nonce = bytes32(uint256(7));
        bytes32 paymentId = bytes32(uint256(0x1234));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);

        vm.expectRevert(X402FeeSplitFacilitator.ZeroAddress.selector);
        facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce, v, r, s, address(0), 50, feeReceiver, paymentId
        );
    }

    function test_settle_revertsOnReplayedPaymentId() public {
        uint256 amount = 1_000_000;
        bytes32 nonce1 = bytes32(uint256(8));
        bytes32 nonce2 = bytes32(uint256(9));
        bytes32 paymentId = bytes32(uint256(0x5678));
        (uint8 v1, bytes32 r1, bytes32 s1) = _signAuth(amount, 0, type(uint256).max, nonce1);
        (uint8 v2, bytes32 r2, bytes32 s2) = _signAuth(amount, 0, type(uint256).max, nonce2);

        facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce1, v1, r1, s1, publisher, 50, feeReceiver, paymentId
        );

        vm.expectRevert(abi.encodeWithSelector(X402FeeSplitFacilitator.PaymentAlreadySettled.selector, paymentId));
        facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce2, v2, r2, s2, publisher, 50, feeReceiver, paymentId
        );
    }

    function test_settle_revertsOnExpiredAuth() public {
        uint256 amount = 1_000_000;
        bytes32 nonce = bytes32(uint256(10));
        bytes32 paymentId = bytes32(uint256(0x9ABC));
        uint256 validBefore = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, validBefore, nonce);

        vm.expectRevert(MockUsdc.AuthorizationExpired.selector);
        facilitator.settle(
            address(usdc), buyer, amount, 0, validBefore, nonce, v, r, s, publisher, 50, feeReceiver, paymentId
        );
    }

    function test_settle_revertsOnReplayedNonce() public {
        uint256 amount = 1_000_000;
        bytes32 nonce = bytes32(uint256(11));
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);

        facilitator.settle(
            address(usdc),
            buyer,
            amount,
            0,
            type(uint256).max,
            nonce,
            v,
            r,
            s,
            publisher,
            50,
            feeReceiver,
            bytes32(uint256(0xAA01))
        );

        vm.expectRevert(MockUsdc.AuthorizationAlreadyUsed.selector);
        facilitator.settle(
            address(usdc),
            buyer,
            amount,
            0,
            type(uint256).max,
            nonce,
            v,
            r,
            s,
            publisher,
            50,
            feeReceiver,
            bytes32(uint256(0xAA02))
        );
    }

    // ── fuzz ────────────────────────────────────────────────────────────────

    function testFuzz_settle_split(uint96 amountSeed, uint8 feeBpsSeed, uint256 nonceSeed) public {
        uint256 amount = uint256(amountSeed) + 1; // > 0
        uint16 feeBps = uint16(feeBpsSeed % 101); // [0, 100]
        bytes32 nonce = bytes32(nonceSeed);
        bytes32 paymentId = keccak256(abi.encode(nonce));
        usdc.mint(buyer, amount); // make sure buyer has enough

        (uint8 v, bytes32 r, bytes32 s) = _signAuth(amount, 0, type(uint256).max, nonce);
        (uint256 fee, uint256 publisherAmount) = facilitator.settle(
            address(usdc), buyer, amount, 0, type(uint256).max, nonce, v, r, s, publisher, feeBps, feeReceiver, paymentId
        );

        assertEq(fee + publisherAmount, amount);
        assertLe(fee, amount);
        assertEq(usdc.balanceOf(publisher), publisherAmount + 0); // publisher receives publisher's share
        assertEq(usdc.balanceOf(address(facilitator)), 0);
    }
}
