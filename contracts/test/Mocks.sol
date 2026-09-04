// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPonsV2Factory} from "../src/interfaces/IPonsV2.sol";

/*
  Stand-ins for the parts of Pons this launchpad talks to.

  ⚠⚠ THEY ARE NOT A SUBSTITUTE FOR A FORK, and nothing here should be read as one. They model the
  shapes that matter — two escrow ledgers, a sweep only the fee recipient may call, an exact native
  value check — so the launchpad's own logic can be tested without a network. Whether Pons still
  behaves this way is a question only `test/*Fork*` can answer, and that suite needs an RPC.
*/

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) internal virtual returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// A token that keeps 1% of every transfer. ⚠ Exists because crediting the REQUESTED amount rather
/// than the DELIVERED one is the classic way a vault promises money it does not hold.
contract FeeOnTransferERC20 is MockERC20 {
    function _move(address from, address to, uint256 amount) internal override returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        uint256 fee = amount / 100;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        return true;
    }
}

/// A token whose `transfer` returns false instead of reverting.
contract LyingERC20 is MockERC20 {
    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}

/**
 * Pons's fee escrow, with the property that matters most: TWO LEDGERS, and a launch lands in one.
 */
contract MockEscrow {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public balanceOfToken;

    error NothingToClaim();

    receive() external payable {}

    function creditNative(address who) external payable {
        balanceOf[who] += msg.value;
    }

    function creditToken(address who, address token, uint256 amount) external {
        MockERC20(token).transferFrom(msg.sender, address(this), amount);
        balanceOfToken[who][token] += amount;
    }

    /// ⚠ REVERTS when there is nothing, exactly as Pons does. Every caller has to wrap it.
    function claim() external returns (uint256) {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToClaim();
        balanceOf[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "send");
        return amount;
    }

    function claimToken(address token) external returns (uint256) {
        uint256 amount = balanceOfToken[msg.sender][token];
        if (amount == 0) revert NothingToClaim();
        balanceOfToken[msg.sender][token] = 0;
        MockERC20(token).transfer(msg.sender, amount);
        return amount;
    }
}

/// The bonding curve, refusing a sweep from anyone but the fee recipient.
contract MockCurve {
    address public feeRecipient;
    MockEscrow public escrow;
    uint256 public pendingFees;

    error NotFeeSweepOperator();

    constructor(MockEscrow escrow_, address feeRecipient_) {
        escrow = escrow_;
        feeRecipient = feeRecipient_;
    }

    function accrue() external payable {
        pendingFees += msg.value;
    }

    function sweepFees(uint256) external {
        if (msg.sender != feeRecipient) revert NotFeeSweepOperator();
        uint256 amount = pendingFees;
        pendingFees = 0;
        escrow.creditNative{value: amount}(feeRecipient);
    }
}

contract MockToken20 is MockERC20 {}

/**
 * The launch factory. Deploys a plain ERC-20 and hands back an address and a curve.
 *
 * ⚠ `launchToken` is OVERLOADED here for the same reason it is on the real one: an empty exemptions
 * array is not the same calldata as no array, and the launchpad picks between them.
 */
contract MockFactory {
    MockEscrow public immutable escrowContract;
    bool public launchEnabled = true;
    uint256 public launchFee = 0.0297 ether;
    uint256 public maxCreatorTaxBps = 500;
    address public launchForwarder;
    address public memeHook;
    bytes32 public economics = bytes32(uint256(1));

    mapping(address => bool) public approvedPairTokens;
    mapping(address => IPonsV2Factory.LaunchedToken) internal _launched;

    uint256 public launchCount;
    /// ⚠ Recorded so a test can assert WHICH entrypoint was used.
    bool public lastCallHadExemptions;

    error NativeValueMismatch(uint256 supplied, uint256 expected);

    constructor(MockEscrow escrow_) {
        escrowContract = escrow_;
    }

    function feeEscrow() external view returns (address) {
        return address(escrowContract);
    }

    function setEnabled(bool v) external {
        launchEnabled = v;
    }

    function setEconomics(bytes32 v) external {
        economics = v;
    }

    function approvePair(address token, bool ok) external {
        approvedPairTokens[token] = ok;
    }

    function previewLaunchEconomics(uint256, address) external view returns (bytes32) {
        return economics;
    }

    function getLaunchedToken(address token) external view returns (IPonsV2Factory.LaunchedToken memory) {
        return _launched[token];
    }

    function launchToken(IPonsV2Factory.LaunchParams calldata params, uint256 configId, address pairToken)
        external
        payable
        returns (address token, address curve)
    {
        lastCallHadExemptions = false;
        return _do(params, configId, pairToken);
    }

    function launchToken(
        IPonsV2Factory.LaunchParams calldata params,
        uint256 configId,
        address pairToken,
        address[] calldata
    ) external payable returns (address token, address curve) {
        lastCallHadExemptions = true;
        return _do(params, configId, pairToken);
    }

    function _do(IPonsV2Factory.LaunchParams calldata params, uint256, address pairToken)
        internal
        returns (address token, address curve)
    {
        // ⚠ EXACT, like the real one. A launchpad that forwards the wrong value fails here, loudly.
        if (msg.value != launchFee) revert NativeValueMismatch(msg.value, launchFee);
        MockToken20 t = new MockToken20();
        t.mint(address(this), 1_000_000_000 ether);
        token = address(t);
        curve = address(new MockCurve(escrowContract, params.creatorFeeRecipient));
        _launched[token] = IPonsV2Factory.LaunchedToken({
            token: token,
            curve: curve,
            deployer: msg.sender,
            creatorFeeRecipient: params.creatorFeeRecipient,
            pairToken: pairToken,
            graduationThreshold: 0,
            poolFee: 3000,
            tickSpacing: 60,
            creatorTaxBps: params.creatorTaxBps,
            buybackEnabled: params.buybackEnabled,
            phase: 0,
            sweptQuote: 0,
            sweptTokens: 0,
            sweptAt: 0,
            exists: true
        });
        launchCount++;
    }
}
