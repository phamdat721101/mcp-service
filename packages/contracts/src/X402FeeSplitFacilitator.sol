// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Minimal interface to USDC's EIP-3009 `transferWithAuthorization`.
interface IEip3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title X402FeeSplitFacilitator
 * @notice Atomic settlement for x402 paid MCP servers. Buyer signs ONE EIP-3009
 *         authorization payable to this contract; settle() pulls the full
 *         amount, then forwards (amount * (10000 - feeBps) / 10000) to the
 *         publisher and the residue to the gateway fee receiver — all in one
 *         transaction. No buyer-visible second signature, no async sweep.
 *
 *         Single Responsibility: this contract OWNS the split and emits a
 *         single canonical Settled event. It does NOT verify protocol-level
 *         envelope shape (gateway responsibility) or track sponsor balances
 *         (off-chain treasury responsibility).
 *
 * @dev Replay protection comes for free: the underlying ERC-20's
 *      `transferWithAuthorization` enforces nonce uniqueness on chain. We
 *      add an idempotency check on `paymentId` so two concurrent settle()
 *      calls with the same paymentId produce one settlement — useful when
 *      our own facilitator retries.
 */
contract X402FeeSplitFacilitator {
    /// @notice Maximum fee permitted: 1% (100 basis points). Hard ceiling.
    uint16 public constant MAX_FEE_BPS = 100;

    /// @notice Tracks settled paymentIds to enforce idempotency at our level.
    mapping(bytes32 => bool) public settled;

    /// @notice Emitted on successful settlement. Indexed for cheap filtering.
    event Settled(
        bytes32 indexed paymentId,
        address indexed token,
        address indexed from,
        address publisher,
        address feeReceiver,
        uint256 amount,
        uint256 fee
    );

    error FeeBpsTooHigh(uint16 feeBps);
    error PaymentAlreadySettled(bytes32 paymentId);
    error ZeroAmount();
    error ZeroAddress();

    /**
     * @notice Settle a buyer's signed EIP-3009 authorization, splitting the
     *         payment between publisher and feeReceiver atomically.
     *
     * @param token            The ERC-20 implementing EIP-3009 (USDC variant).
     * @param from             Buyer (signer of the authorization).
     * @param amount           Full amount of the authorization.
     * @param validAfter       Auth `validAfter` field (UNIX seconds).
     * @param validBefore      Auth `validBefore` field (UNIX seconds).
     * @param nonce            Auth `nonce` (replay-protected by ERC-20).
     * @param v,r,s            Buyer's signature components.
     * @param publisherPayTo   Where the publisher receives funds.
     * @param feeBps           Gateway fee in basis points; bounded by MAX_FEE_BPS.
     * @param feeReceiver      Where the gateway receives its fee.
     * @param paymentId        Caller-supplied unique id for idempotency.
     *
     * @return fee            Computed gateway fee.
     * @return publisherAmount Computed publisher payout.
     */
    function settle(
        address token,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s,
        address publisherPayTo,
        uint16 feeBps,
        address feeReceiver,
        bytes32 paymentId
    ) external returns (uint256 fee, uint256 publisherAmount) {
        // ── invariant guards (cheap; before any external call) ──
        if (feeBps > MAX_FEE_BPS) revert FeeBpsTooHigh(feeBps);
        if (amount == 0) revert ZeroAmount();
        if (publisherPayTo == address(0) || token == address(0)) revert ZeroAddress();
        // feeReceiver may equal publisher only when feeBps == 0 (degenerate but legal).
        if (feeBps != 0 && feeReceiver == address(0)) revert ZeroAddress();
        if (settled[paymentId]) revert PaymentAlreadySettled(paymentId);

        // Mark settled BEFORE external calls (Checks-Effects-Interactions).
        settled[paymentId] = true;

        // ── pull buyer funds via EIP-3009 ──
        IEip3009(token).transferWithAuthorization(
            from, address(this), amount, validAfter, validBefore, nonce, v, r, s
        );

        // ── compute split (matches packages/shared/src/types.ts computeFeeSplit) ──
        unchecked {
            // amount * feeBps fits in 256 bits because amount fits and feeBps <= 100.
            fee = (amount * uint256(feeBps)) / 10_000;
            publisherAmount = amount - fee;
        }

        // ── forward ──
        // Use raw transfer; USDC reverts on failure so we don't need return-value handling.
        IEip3009(token).transfer(publisherPayTo, publisherAmount);
        if (fee != 0) {
            IEip3009(token).transfer(feeReceiver, fee);
        }

        emit Settled(paymentId, token, from, publisherPayTo, feeReceiver, amount, fee);
    }
}
