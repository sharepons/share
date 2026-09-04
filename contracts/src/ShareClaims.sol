// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The two shapes an ERC-20 transfer comes in. Some long-lived tokens return nothing at all.
interface IERC20Loose {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

import {ShareKeys} from "./ShareKeys.sol";

/**
 * SHARE's vault: where a launch's fees wait for the person they were launched for.
 *
 * ## Why a contract rather than the server just sending
 *
 * SHARE could pay people out of a hot wallet. It does not, because of the blast radius: a wallet
 * that can send can send everything, so one leaked key costs every recipient their balance at once.
 * Here the server holds a key that can only ever sign an ATTESTATION — a statement that a browser
 * signed in as a particular account. It cannot move money, cannot change a split and cannot decide
 * an amount. The recipient submits their own claim and pays their own gas.
 *
 * ## ⭐⭐ THE ATTESTATION CARRIES NO AMOUNT, AND THAT IS THE POINT
 *
 * The voucher design this grew out of has the server compute what somebody has earned and sign for
 * that number. It works, and it puts the arithmetic of every payout inside an off-chain process:
 * one bad subtraction and a recipient is paid out of somebody else's fees.
 *
 * ➤ Here the arithmetic is on chain and already done. The splitter divided each fee by the bps
 * written into it at launch and credited each beneficiary directly, so by the time anybody claims,
 * the amount is a subtraction this contract performs on its own ledger. The signer's whole job is
 * "this browser proved it holds X account 12345" — an identity claim, which is the one thing a
 * contract genuinely cannot check.
 *
 * ⚠ What a stolen signing key can still do: attest that an attacker's browser is somebody else's
 * account and drain that person's UNCLAIMED balance to an address of its choosing. That is real, it
 * is bounded by what is unclaimed, and revoking the key is one transaction from `owner`, which is a
 * key that never touches a server. Nothing here pretends otherwise.
 *
 * ## ⭐⭐ MONEY IS RING FENCED PER (LAUNCH, BENEFICIARY, ASSET)
 *
 * The straightforward version of this contract holds one pot per asset and lets any valid claim
 * draw from it. That works right up until something goes wrong, and then it fails in the worst way:
 * a claim paid out of the wrong pot, discovered by whoever's own claim bounces afterwards.
 *
 * ➤ So attribution lives HERE rather than in a database. Money enters against a named launch AND a
 * named beneficiary, and a claim can only ever draw what that exact pair was credited. One
 * recipient being paid from another's fees is not prevented by a rule, it is unrepresentable.
 *
 * ⭐ It also makes the owner harmless. `sweepStray` can only take what is NOT owed: `outstanding`
 * tracks every credited-but-unclaimed unit and the owner is refused anything below that line. SHARE
 * cannot take a recipient's fees even if SHARE wants to.
 *
 * ## ⛔⛔ THIS CONTRACT CAN NEVER BE REPLACED ONCE ANYBODY HAS CLAIMED
 *
 * `claimed` resets to zero at a new address while the splitters keep pointing at the old one. If it
 * must ever change, every live splitter has to be considered dead: they fund by address and cannot
 * be repointed.
 */
contract ShareClaims {
    /* --------------------------------------------------------------- roles -- */

    /// Can change the signer, pause claims, and take stray money. ⛔ Cannot touch what is owed.
    address public owner;

    /**
     * The key the server signs attestations with.
     *
     * ⚠ Deliberately separate from `owner`. This one lives on a server and is therefore the one
     * that will eventually be stolen; revoking it is one transaction from a key that does not.
     */
    address public signer;

    /// ⚠ Blocks CLAIMS only. Funding is never pausable: money must always be able to arrive, or a
    /// pause would strand fees in a splitter that has no way to hold them.
    bool public paused;

    address public pendingOwner;

    /* -------------------------------------------------------------- ledger -- */

    /// launch → beneficiary → asset → total ever credited to that triple. Native is `address(0)`.
    mapping(address => mapping(bytes32 => mapping(address => uint256))) public credited;

    /// launch → beneficiary → asset → total ever paid out.
    mapping(address => mapping(bytes32 => mapping(address => uint256))) public claimed;

    /// launch → asset → totals across every beneficiary, so the ledger is checkable in public.
    mapping(address => mapping(address => uint256)) public creditedForLaunch;
    mapping(address => mapping(address => uint256)) public claimedForLaunch;

    /**
     * asset → everything credited and not yet claimed, across every launch.
     *
     * ⭐ The line the owner cannot reach below. Kept as a running total rather than computed,
     * because summing a mapping is impossible and a figure the contract cannot check is a figure the
     * owner could argue with.
     */
    mapping(address => uint256) public outstanding;

    /// One attestation, one transaction. ⚠ Keyed by the whole digest, not by the salt: a salt reused
    /// with a different recipient would otherwise look like a fresh attestation.
    mapping(bytes32 => bool) public redeemed;

    /* -------------------------------------------------------------- EIP712 -- */

    /*
      ⛔⛔ CHANGING EITHER STRING BREAKS EVERY ATTESTATION, SILENTLY.
      The domain separator is built from these and baked into an immutable at deployment. Renaming
      the contract on a sibling project here once changed this hash while the deployed contract kept
      expecting the old one, and every signature would have been rejected with nothing looking wrong.
    */
    string public constant NAME = "ShareClaims";
    string public constant VERSION = "1";

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// ⚠ Field order and names are part of the hash and must match the server's typed data exactly.
    bytes32 private constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(bytes32 beneficiary,address recipient,uint256 deadline,bytes32 salt)");

    bytes32 private immutable _domainSeparator;

    /*
     * What the server says, and nothing more.
     *
     * @param beneficiary Who signed in, as `keccak256("x:12345")`. @see ShareKeys.
     * @param recipient Where they asked to be paid. ⚠ Chosen by the person signing in and bound into
     *        the signature, so an intercepted attestation cannot be redirected.
     * @param deadline Unix seconds. Short on purpose — an attestation is minted per claim.
     * @param salt Makes each attestation distinct. The digest is what is marked redeemed.
     */
    struct Attestation {
        bytes32 beneficiary;
        address recipient;
        uint256 deadline;
        bytes32 salt;
    }

    /* -------------------------------------------------------------- events -- */

    event Funded(address indexed launch, bytes32 indexed beneficiary, address indexed asset, uint256 amount);
    event Claimed(
        address indexed launch,
        bytes32 indexed beneficiary,
        address indexed recipient,
        address asset,
        uint256 amount
    );
    event AttestationRedeemed(bytes32 indexed digest, bytes32 indexed beneficiary, address recipient);
    event SignerChanged(address indexed previous, address indexed next);
    event OwnershipTransferStarted(address indexed previous, address indexed next);
    event OwnerChanged(address indexed previous, address indexed next);
    event PausedSet(bool paused);
    event StraySwept(address indexed asset, address indexed to, uint256 amount);

    /* -------------------------------------------------------------- errors -- */

    error NotOwner();
    error NotPendingOwner();
    error IsPaused();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroBeneficiary();
    error LengthMismatch();
    error ValueMismatch(uint256 sent, uint256 expected);
    error TransferFailed();
    error AttestationExpired();
    error AttestationAlreadyUsed();
    error BadSignature();
    error NothingOwed();
    /// ⭐ The owner reaching below the line of what is owed to recipients.
    error WouldTakeRecipientFunds(uint256 wanted, uint256 stray);
    error Reentrancy();

    uint256 private _entered = 1;

    modifier nonReentrant() {
        if (_entered != 1) revert Reentrancy();
        _entered = 2;
        _;
        _entered = 1;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address signer_) {
        if (owner_ == address(0) || signer_ == address(0)) revert ZeroAddress();
        owner = owner_;
        signer = signer_;
        _domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(NAME)), keccak256(bytes(VERSION)), block.chainid, address(this))
        );
    }

    /* ---------------------------------------------------------------- fund -- */

    /**
     * Credit one beneficiary against one launch.
     *
     * ⭐ Permissionless. Crediting somebody is only ever generous, and the thing that routes a
     * launch's fees here should not need anybody's permission to do it. A stranger topping up a
     * creator's balance is a feature.
     *
     * ⚠⚠ THERE IS NO `receive`. Money that arrives without naming a launch and a beneficiary cannot
     * be attributed to anybody, and a contract that accepts unattributable money is a contract with
     * a pot in it that somebody will eventually argue over. A plain transfer here reverts.
     */
    function fund(address launch, bytes32 beneficiary, address asset, uint256 amount) external payable {
        bytes32[] memory bens = new bytes32[](1);
        uint256[] memory amts = new uint256[](1);
        bens[0] = beneficiary;
        amts[0] = amount;
        _fundMany(launch, bens, asset, amts);
    }

    /**
     * Credit every recipient of one launch in a single call.
     *
     * ⭐ One call and one transfer for a whole split. The splitter releases this way because the
     * alternative — one `fund` per recipient — pays the ERC-20 transfer cost N times for money that
     * is already sitting in one place.
     */
    function fundMany(address launch, bytes32[] calldata beneficiaries, address asset, uint256[] calldata amounts)
        external
        payable
    {
        _fundMany(launch, beneficiaries, asset, amounts);
    }

    function _fundMany(address launch, bytes32[] memory beneficiaries, address asset, uint256[] memory amounts)
        private
    {
        if (launch == address(0)) revert ZeroAddress();
        if (beneficiaries.length != amounts.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (beneficiaries[i] == bytes32(0)) revert ZeroBeneficiary();
            if (amounts[i] == 0) revert ZeroAmount();
            total += amounts[i];
        }
        if (total == 0) revert ZeroAmount();

        if (asset == address(0)) {
            /* ⚠ EXACT. Accepting more than the sum would leave native ether in this contract
               credited to nobody, which is the unattributable pot `receive` exists to prevent. */
            if (msg.value != total) revert ValueMismatch(msg.value, total);
        } else {
            if (msg.value != 0) revert ValueMismatch(msg.value, 0);
            /*
              ⚠⚠ MEASURED, not assumed. A fee-on-transfer token delivers less than `amount`, and
              crediting the requested figure would promise money this contract does not hold — the
              shortfall surfacing as a revert on somebody's claim much later. What arrived is what
              gets credited, and a token that delivers nothing reverts here instead.
            */
            uint256 before = IERC20Loose(asset).balanceOf(address(this));
            _pull(asset, msg.sender, total);
            uint256 got = IERC20Loose(asset).balanceOf(address(this)) - before;
            if (got == 0) revert ZeroAmount();
            if (got != total) {
                for (uint256 i = 0; i < amounts.length; i++) {
                    amounts[i] = (amounts[i] * got) / total;
                }
                total = got;
            }
        }

        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amt = amounts[i];
            if (amt == 0) continue;
            credited[launch][beneficiaries[i]][asset] += amt;
            emit Funded(launch, beneficiaries[i], asset, amt);
        }
        creditedForLaunch[launch][asset] += total;
        outstanding[asset] += total;
    }

    /* --------------------------------------------------------------- reads -- */

    /// What one beneficiary can still take out of one launch, in one asset.
    function owed(address launch, bytes32 beneficiary, address asset) public view returns (uint256) {
        return credited[launch][beneficiary][asset] - claimed[launch][beneficiary][asset];
    }

    /**
     * The same question over many launches at once.
     *
     * ⭐ Exists so the claim page is ONE `eth_call`. Robinhood Chain makes a block roughly every
     * 100ms and its public RPC caps `eth_getLogs` at 2,000 blocks — about three minutes of history —
     * so nothing here can be answered from events. Reading a balance per launch in a loop from the
     * browser is dozens of round trips against a rate-limited endpoint.
     */
    function owedMany(address[] calldata launches, bytes32 beneficiary, address[] calldata assets)
        external
        view
        returns (uint256[] memory out)
    {
        if (launches.length != assets.length) revert LengthMismatch();
        out = new uint256[](launches.length);
        for (uint256 i = 0; i < launches.length; i++) {
            out[i] = owed(launches[i], beneficiary, assets[i]);
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparator;
    }

    function digestOf(Attestation calldata a) public view returns (bytes32) {
        bytes32 structHash =
            keccak256(abi.encode(ATTESTATION_TYPEHASH, a.beneficiary, a.recipient, a.deadline, a.salt));
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator, structHash));
    }

    /* --------------------------------------------------------------- claim -- */

    /**
     * Take everything owed to a wallet recipient, with no server involved at all.
     *
     * ⭐⭐ THE PATH THAT NEEDS NOBODY. A wallet's beneficiary is `keccak256("wallet:0x…")` and this
     * contract can recompute it from `msg.sender`, so a launcher who kept a share of their own
     * launch is never waiting on SHARE for anything. If this site disappears tomorrow, that money is
     * still reachable with a block explorer.
     */
    function claimAsWallet(address[] calldata launches, address[] calldata assets)
        external
        nonReentrant
        returns (uint256 total)
    {
        if (paused) revert IsPaused();
        bytes32 ben = ShareKeys.walletBeneficiary(msg.sender);
        total = _payOut(launches, assets, ben, msg.sender);
    }

    /**
     * Take everything owed to a social account, once the server has attested to who is asking.
     *
     * ⚠ The attestation is consumed whether it pays one launch or twenty: one signature, one
     * transaction. A recipient with a long list claims it all at once rather than paying gas per
     * launch and asking the server for a fresh signature each time.
     */
    function claimWithAttestation(
        Attestation calldata attestation,
        bytes calldata signature,
        address[] calldata launches,
        address[] calldata assets
    ) external nonReentrant returns (uint256 total) {
        if (paused) revert IsPaused();
        if (attestation.recipient == address(0)) revert ZeroAddress();
        if (attestation.beneficiary == bytes32(0)) revert ZeroBeneficiary();
        if (block.timestamp > attestation.deadline) revert AttestationExpired();

        bytes32 digest = digestOf(attestation);
        if (redeemed[digest]) revert AttestationAlreadyUsed();
        if (_recover(digest, signature) != signer) revert BadSignature();

        redeemed[digest] = true;
        emit AttestationRedeemed(digest, attestation.beneficiary, attestation.recipient);

        total = _payOut(launches, assets, attestation.beneficiary, attestation.recipient);
    }

    function _payOut(address[] calldata launches, address[] calldata assets, bytes32 beneficiary, address recipient)
        private
        returns (uint256 total)
    {
        if (launches.length != assets.length) revert LengthMismatch();

        for (uint256 i = 0; i < launches.length; i++) {
            address launch = launches[i];
            address asset = assets[i];
            uint256 amount = owed(launch, beneficiary, asset);
            /* ⚠ Skipped, not reverted. A claim list built from a page that was one block out of date
               would otherwise fail entirely because one row had just been paid. */
            if (amount == 0) continue;

            /* Effects before interactions, per pair: a token whose transfer calls back finds this
               entry already settled. `nonReentrant` is the belt; this is the braces. */
            claimed[launch][beneficiary][asset] += amount;
            claimedForLaunch[launch][asset] += amount;
            outstanding[asset] -= amount;
            total += amount;

            _push(asset, recipient, amount);
            emit Claimed(launch, beneficiary, recipient, asset, amount);
        }

        /* ⛔ A claim that moved nothing reverts rather than succeeding quietly. Somebody paid gas to
           be told an answer, and "your transaction worked and you received nothing" is not one. */
        if (total == 0) revert NothingOwed();
    }

    /* ------------------------------------------------------------ ownership -- */

    function setSigner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit SignerChanged(signer, next);
        signer = next;
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    /// ⚠ Two steps. A one-step transfer to a mistyped address ends this contract's administration
    /// permanently, and there is no redeploy that does not orphan every live splitter.
    function transferOwnership(address next) external onlyOwner {
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnerChanged(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /**
     * Take money that is not owed to anybody — a mistaken transfer in, or the dust left by a
     * fee-on-transfer token.
     *
     * ⛔⛔ THE FLOOR IS `outstanding`, AND IT IS CHECKED AGAINST THE REAL BALANCE. The owner can
     * take exactly what the contract holds beyond what it owes, which for a healthy vault is zero.
     */
    function sweepStray(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 held = asset == address(0) ? address(this).balance : IERC20Loose(asset).balanceOf(address(this));
        uint256 owedTotal = outstanding[asset];
        uint256 stray = held > owedTotal ? held - owedTotal : 0;
        if (amount > stray) revert WouldTakeRecipientFunds(amount, stray);
        _push(asset, to, amount);
        emit StraySwept(asset, to, amount);
    }

    /* -------------------------------------------------------------- moving -- */

    function _push(address asset, address to, uint256 amount) private {
        if (asset == address(0)) {
            /* ⚠ `call`, not `transfer`. A 2300 gas stipend breaks payouts to a smart-contract wallet,
               and multisigs are exactly who a large recipient will be. */
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
            return;
        }
        _check(asset, abi.encodeCall(IERC20Loose.transfer, (to, amount)));
    }

    function _pull(address asset, address from, uint256 amount) private {
        _check(asset, abi.encodeCall(IERC20Loose.transferFrom, (from, address(this), amount)));
    }

    /// ⚠ Tolerates a token that returns nothing, refuses one that returns false.
    function _check(address asset, bytes memory data) private {
        (bool ok, bytes memory ret) = asset.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    /**
     * ⚠⚠ `s` IS RANGE CHECKED. `ecrecover` accepts the high half of the curve order, so every
     * signature has a mirror image that recovers to the same address — a second distinct
     * `signature` for one digest. Here the digest is what is marked redeemed, so malleability
     * cannot double-spend an attestation; it is refused anyway because a signature scheme where two
     * bytestrings are both valid is a scheme somebody downstream will index by the wrong one.
     */
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert BadSignature();
        address recovered = ecrecover(digest, v, r, s);
        if (recovered == address(0)) revert BadSignature();
        return recovered;
    }
}
