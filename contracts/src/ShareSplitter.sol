// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPonsCurveSweep, IPonsFeeEscrow, IPonsHookSweep} from "./interfaces/IPonsV2.sol";
import {ShareClaims} from "./ShareClaims.sol";

/*
 * One launch's fee recipient: the contract that divides what a token earns and hands each share to
 * the person it was launched for.
 *
 * ## What it is
 *
 * It is the `creatorFeeRecipient` of exactly one Pons V2 launch. It pulls that launch's fees out of
 * Pons's shared escrow, divides them by a split fixed at construction, and credits each share to a
 * beneficiary in ShareClaims. That is the whole contract. It has no owner, no setters, no
 * upgrade path, no arbitrary-call function and no withdraw.
 *
 * ## ⛔⛔ WHY THERE IS NO OWNER, AND WHY THAT IS THE PRODUCT
 *
 * "Fees are shared with @somebody" is worth nothing if the person who wrote the sentence can move
 * the money afterwards. Every launchpad that has broken this promise broke it the same way: not by
 * being hacked, but by somebody with a key making a discretionary decision.
 *
 * ➤ So the recipients and their shares are written at construction and there is no function in this
 * contract that can change either one. A holder can read that off the verified source in ten
 * seconds, which is worth more than any sentence on a website.
 *
 * ⚠⚠ It follows that a mistake in the constructor is PERMANENT — the same discipline Pons itself
 * forces with `creatorTaxBps`, which has no setter either. Rehearse against a fork.
 *
 * ## ⚠ WHAT THIS CANNOT PROMISE
 *
 * It cannot make anybody claim. A share credited to an X account nobody ever signs in as sits here
 * for good; there is no expiry and no reclaim, because either of those turns "their money" into
 * "their money for a while", and the person it belongs to was never asked.
 */
contract ShareSplitter {
    using SafeERC20 for IERC20;

    /* -------------------------------------------------------------- wiring -- */

    IPonsFeeEscrow public immutable escrow;
    ShareClaims public immutable claims;

    /// ⚠ Only this address may bind the token, and only once. It is the launchpad that made this.
    address public immutable launchpad;

    /**
     * The token this splitter earns for.
     *
     * ⛔ Set once, one call after deployment, and never again. It cannot be a constructor argument:
     * the splitter has to EXIST before the launch, because its address is what gets written into the
     * launch as `creatorFeeRecipient`. The launchpad does both in one transaction, so there is no
     * state anybody outside can observe in which this is still zero.
     */
    address public token;

    uint16 public constant BPS = 10_000;

    /*
      ⛔ Storage arrays rather than `immutable`, because Solidity has no immutable array. The
      guarantee is made the other way: nothing in this contract writes to either one after the
      constructor, and there is no function that could.
    */
    bytes32[] private _beneficiaries;
    uint16[] private _bps;

    /* -------------------------------------------------------------- events -- */

    event Harvested(address indexed asset, uint256 amount);
    event Released(address indexed asset, uint256 amount);
    event TokenBound(address indexed token);

    /* -------------------------------------------------------------- errors -- */

    error ZeroAddress();
    error NoRecipients();
    error LengthMismatch();
    error BadSplit(uint256 total);
    error NotLaunchpad();
    error AlreadyBound();
    error NotBound();

    constructor(IPonsFeeEscrow escrow_, ShareClaims claims_, bytes32[] memory beneficiaries_, uint16[] memory bps_) {
        if (address(escrow_) == address(0) || address(claims_) == address(0)) revert ZeroAddress();
        if (beneficiaries_.length == 0) revert NoRecipients();
        if (beneficiaries_.length != bps_.length) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < bps_.length; i++) {
            if (beneficiaries_[i] == bytes32(0)) revert ZeroAddress();
            if (bps_[i] == 0) revert BadSplit(0);
            total += bps_[i];
        }
        /* ⛔ EXACTLY 10000. A split that sums to less would leave a remainder in this contract with
           nobody credited for it and no way to get it out, which is a slow leak rather than a
           revert — the worst shape a bug can take here. */
        if (total != BPS) revert BadSplit(total);

        escrow = escrow_;
        claims = claims_;
        launchpad = msg.sender;
        _beneficiaries = beneficiaries_;
        _bps = bps_;
    }

    function bindToken(address token_) external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        if (token != address(0)) revert AlreadyBound();
        if (token_ == address(0)) revert ZeroAddress();
        token = token_;
        emit TokenBound(token_);
    }

    /// ⚠ Required. The escrow pays native fees by SENDING ether; without this every native claim
    /// this contract makes would revert inside Pons.
    receive() external payable {}

    /* ------------------------------------------------------------- harvest -- */

    /**
     * Pull the native fees out of the escrow and credit them.
     *
     * ⭐ Permissionless on purpose. The contract enforces the outcome, so there is no reason to care
     * who pays the gas, and a permissioned harvest is a harvest that stops the day one key goes
     * quiet. A recipient impatient for their share can run it themselves.
     */
    function harvest() public returns (uint256 gained) {
        uint256 before = address(this).balance;
        // ⚠ Pons reverts rather than returning zero when there is nothing to claim.
        try escrow.claim() {} catch {}
        gained = address(this).balance - before;
        if (gained != 0) emit Harvested(address(0), gained);
        _release(address(0));
    }

    /**
     * The same for a launch paired against an ERC-20.
     *
     * ⭐ UNLIKE THE CHARITY LAUNCHPAD THIS GREW OUT OF, EVERY PAIR ASSET IS FINE HERE. That one had
     * to sell tokenized stocks into USDG first, because its money had to leave Robinhood Chain over
     * a bridge that carries two assets. SHARE pays recipients on this chain, in whatever the launch
     * was paired against, so there is no bridge, no seller and no blocked asset. A launch paired
     * against GME pays its recipients in GME.
     */
    function harvestToken(address asset) public returns (uint256 gained) {
        if (asset == address(0)) revert ZeroAddress();
        uint256 before = IERC20(asset).balanceOf(address(this));
        try escrow.claimToken(asset) {} catch {}
        gained = IERC20(asset).balanceOf(address(this)) - before;
        if (gained != 0) emit Harvested(asset, gained);
        _release(asset);
    }

    /// One call for a cranker: both escrow ledgers in one transaction.
    function harvestMany(address[] calldata assets) external {
        harvest();
        for (uint256 i = 0; i < assets.length; i++) harvestToken(assets[i]);
    }

    /* --------------------------------------------------------------- sweep -- */

    /**
     * Move this launch's fees off its bonding curve and into the escrow, so `harvest` has something
     * to claim.
     *
     * ⛔⛔ WITHOUT THIS PASSTHROUGH NOBODY ON THIS SIDE CAN SWEEP AT ALL. Pons refuses `sweepFees`
     * from everyone except its own operator and the launch's fee recipient — which is this contract.
     * `harvest` is permissionless but the step before it is not, so the whole payout would sit
     * waiting on Pons's schedule.
     *
     * ⚠ The curve address is a parameter rather than stored because a splitter is deployed before
     * its curve exists. It is safe to leave open: the only thing this call can do is move money
     * that is already destined here.
     */
    function sweepCurve(address curve, uint256 minBuybackTokensOut) external {
        IPonsCurveSweep(curve).sweepFees(minBuybackTokensOut);
    }

    /**
     * The sweep for a GRADUATED launch.
     *
     * ⛔⛔ ITS ABSENCE IS A BUG WITH MONEY IN IT. Graduating kills the curve: fees stop accruing
     * there, start accruing in the meme hook, and `sweepCurve` reverts from then on. A launchpad
     * with only the curve sweep cannot move a graduated launch's fees and cannot even SEE them,
     * because the escrow balance it reads is what the sweep is what fills. The sibling project's
     * largest earner reported "nothing to collect" for days that way.
     */
    function sweepPool(address hook, bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut)
        external
    {
        IPonsHookSweep(hook).sweepPoolFees(poolId, minConversionQuoteOut, minBuybackTokensOut);
    }

    /* ------------------------------------------------------------- release -- */

    /**
     * Divide whatever this contract is holding and credit each recipient in the vault.
     *
     * ⭐ Works off the BALANCE, not off what a harvest returned. A direct transfer into this address
     * is therefore split on the same terms as a fee — somebody who wants to tip a token's recipients
     * can just send, and a fee that arrived by a route nobody anticipated is never stranded.
     *
     * ⚠ Sub-unit dust goes to the FIRST recipient. Some remainder is unavoidable when a balance does
     * not divide by the split, and the alternatives are leaving it (a growing untouchable crumb) or
     * a rotating index (state, for a wei). It is at most `n - 1` of the smallest unit per release.
     */
    function release(address asset) external {
        _release(asset);
    }

    function _release(address asset) internal {
        address launch = token;
        // ⚠ Not a revert. `harvest()` is called by the launchpad path and by crankers alike; before
        // the bind there is nothing to release anyway, and reverting would break the harvest.
        if (launch == address(0)) return;

        uint256 balance = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        if (balance == 0) return;

        uint256 n = _beneficiaries.length;
        uint256[] memory amounts = new uint256[](n);
        uint256 assigned;
        for (uint256 i = 0; i < n; i++) {
            uint256 cut = (balance * _bps[i]) / BPS;
            amounts[i] = cut;
            assigned += cut;
        }
        amounts[0] += balance - assigned;

        /* ⚠ Zeros are dropped rather than sent. The vault refuses a zero credit on purpose — it is
           always a mistake somewhere — and a balance small enough to round a recipient to nothing
           would otherwise revert the whole release and strand every other share with it. */
        uint256 live;
        for (uint256 i = 0; i < n; i++) if (amounts[i] != 0) live++;

        bytes32[] memory bens = new bytes32[](live);
        uint256[] memory amts = new uint256[](live);
        uint256 j;
        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] == 0) continue;
            bens[j] = _beneficiaries[i];
            amts[j] = amounts[i];
            j++;
        }

        if (asset == address(0)) {
            claims.fundMany{value: balance}(launch, bens, address(0), amts);
        } else {
            /* ⚠ `forceApprove`, not `approve`. USDT-style tokens revert on a non-zero to non-zero
               approval, and the pair asset here is whatever Pons approved rather than one this
               contract chose. */
            IERC20(asset).forceApprove(address(claims), balance);
            claims.fundMany(launch, bens, asset, amts);
            // ⚠ Driven to zero rather than left at whatever was not spent.
            IERC20(asset).forceApprove(address(claims), 0);
        }
        emit Released(asset, balance);
    }

    /* --------------------------------------------------------------- reads -- */

    /**
     * What is waiting to be credited: the escrow's ledger for this splitter plus anything already
     * pulled but not yet released.
     *
     * ⚠⚠ THIS IS NOT WHAT THE LAUNCH HAS EARNED. Fees sit on the curve — or, after graduation, in
     * the meme hook — until somebody sweeps, and the escrow reads a truthful zero the whole time.
     * A figure built only on this number reports a live earner as having made nothing, which is
     * exactly how a sibling project mislabelled its biggest token for days.
     */
    function pending(address asset) external view returns (uint256) {
        uint256 held = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 inEscrow =
            asset == address(0) ? escrow.balanceOf(address(this)) : escrow.balanceOfToken(address(this), asset);
        return held + inEscrow;
    }

    function recipientCount() external view returns (uint256) {
        return _beneficiaries.length;
    }

    function recipients() external view returns (bytes32[] memory beneficiaries, uint16[] memory bps) {
        return (_beneficiaries, _bps);
    }

    function beneficiaryAt(uint256 i) external view returns (bytes32) {
        return _beneficiaries[i];
    }

    function bpsAt(uint256 i) external view returns (uint16) {
        return _bps[i];
    }
}
