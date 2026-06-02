// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/**
 * @notice Test-only USDC mock with EIP-3009 transferWithAuthorization.
 *         Verifies the EIP-712 signature exactly the way the live USDC does
 *         (subset of FiatTokenV2_1) so contract tests exercise the same path.
 */
contract MockUsdc {
    string public name = "USD Coin";
    string public symbol = "USDC";
    string public version = "2";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /// EIP-3009 nonce uniqueness per `from`.
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 public DOMAIN_SEPARATOR;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    error InvalidSignature();
    error AuthorizationExpired();
    error AuthorizationNotYetValid();
    error AuthorizationAlreadyUsed();
    error InsufficientBalance();

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
        totalSupply += value;
        emit Transfer(address(0), to, value);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

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
    ) external {
        if (block.timestamp < validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp > validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != from) revert InvalidSignature();

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (balanceOf[from] < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
