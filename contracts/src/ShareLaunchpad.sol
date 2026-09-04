// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPonsFeeEscrow, IPonsV2Factory, IPonsV2LaunchAndBuy} from "./interfaces/IPonsV2.sol";
import {ShareClaims} from "./ShareClaims.sol";
import {ShareKeys} from "./ShareKeys.sol";
import {ShareSplitter} from "./ShareSplitter.sol";

/*
 * SHARE — a launchpad where a token's fees belong to people who do not have to be here yet.
 *
 * ## What one call does
 *
 * 1. Deploys a ShareSplitter holding the recipients and their shares as fixed values.
 * 2. Launches the token on Pons V2 with `creatorFeeRecipient` set to that splitter.
 * 3. Binds the token to the splitter and records the whole split in an on-chain registry.
 *
 * ⭐⭐ ATOMIC, AND THAT IS THE POINT. Done as three transactions there is a window in which a live
 * token is trading under somebody's handle while its fees land in the launcher's own wallet — the
 * precise thing this exists to make impossible. A partial launch here does not exist: it reverts.
 *
 * ## ⭐⭐ THE RECIPIENT DOES NOT NEED A WALLET, AND DOES NOT NEED TO KNOW
 *
 * A share is keyed by an identity string — `x:12345`, `github:583231`, `instagram:@jane` — hashed
 * on chain. Nothing about the launch requires the person on the other end to have an address, an
 * account here, or any idea this happened. Their fees accrue from the first trade and wait. When
 * they eventually sign in, the money is already theirs and always was.
 *
 * ## ⛔⛔ WHY THE REGISTRY IS AN ARRAY AND NOT AN EVENT
 *
 * Robinhood Chain makes a block roughly every 100ms — around 861,000 a day — and the public RPC caps
 * `eth_getLogs` at 2,000 blocks, about three minutes of history. A launch feed built on events is
 * impossible to read from a browser and needs an indexer with a persisted cursor, a database, a
 * daemon and a port. An array read with `eth_call` needs none of those and cannot fall behind.
 *
 * ➤ So the site is static. There is no moment where the listing and the chain disagree, and the one
 * server SHARE does run — the thing that proves who you are — can be down without a single number
 * on the site being wrong.
 */
contract ShareLaunchpad {
    using SafeERC20 for IERC20;

    IPonsV2Factory public immutable factory;
    IPonsFeeEscrow public immutable escrow;
    ShareClaims public immutable claims;

    /*
     * The floor on how much of a launch must go to social accounts, fixed at deployment.
     *
     * ⛔⛔ A LAUNCHPAD THAT ACCEPTS ANY SPLIT IS NOT A SHARING LAUNCHPAD. Without a floor, the first
     * token to launch here paying a creator 99% and `@somebody` 1% would still carry that person's
     * name, their avatar and the registry listing — somebody else's identity doing the marketing for
     * a launch that was never going to pay them. The number is on chain and checkable rather than a
     * rule the front end promises to apply.
     *
     * ⚠ Wallet recipients do not count towards it. A launcher paying themselves is not sharing.
     */
    uint16 public immutable minSocialBps;

    /**
     * ⛔ Bounded because every release loops over it, and an unbounded split is a launch whose fees
     * can cost more gas to distribute than they are worth. Eight is well past what anybody has asked
     * for and still cheap to harvest.
     */
    uint8 public constant MAX_RECIPIENTS = 8;

    uint16 public constant BPS = 10_000;

    /*
     * One recipient, as recorded forever.
     *
     * ⭐⭐ `identity` IS THE PROMISE AND `handle` IS THE LABEL. The beneficiary that actually gets
     * paid is `keccak256(bytes(identity))`, and `identity` is built ON CHAIN from the platform and
     * the account reference — never accepted as a hash from the caller. So a listing that says it
     * pays `@octocat` and a splitter that pays somebody else cannot both exist. Anyone can hash the
     * string in this struct and compare it to what the splitter holds.
     */
    struct Recipient {
        /// ShareKeys.Platform as a plain integer, so a reader needs no enum.
        uint8 platform;
        uint16 bps;
        /// Zero unless the recipient is a plain wallet.
        address wallet;
        /// The canonical identity string. ⛔ Hash it to get the beneficiary.
        string identity;
        /// Display text as typed — `octocat`, `jane`. ⚠ Never used to decide who gets paid.
        string handle;
    }

    /// What a launcher fills in. ⚠ `handle` is display only; `accountRef` is what is hashed.
    struct RecipientInput {
        ShareKeys.Platform platform;
        /// A numeric account id for X and GitHub; the handle itself for Instagram and TikTok.
        string accountRef;
        string handle;
        /// Only read when `platform` is `Wallet`.
        address wallet;
        uint16 bps;
    }

    struct Entry {
        address token;
        address curve;
        address splitter;
        address creator;
        address pairToken;
        uint64 launchedAt;
        /// What the social recipients hold between them. ⚠ Recorded so a feed can sort by it.
        uint16 socialBps;
        uint8 recipientCount;
    }

    struct DevBuy {
        uint256 quoteIn;
        uint256 minTokensOut;
    }

    Entry[] private _launches;
    /// launch index → its recipients, in the order they were given.
    mapping(uint256 => Recipient[]) private _recipients;
    /// ⚠ Kept beside the array so a front end can ask "is this one of ours" without a scan.
    mapping(address => uint256) private _indexOfPlusOne;

    event ShareLaunch(
        address indexed token,
        address indexed splitter,
        address indexed creator,
        address pairToken,
        uint16 socialBps,
        uint8 recipientCount
    );
    event RecipientRecorded(address indexed token, bytes32 indexed beneficiary, uint8 platform, uint16 bps, string handle);

    error LaunchesClosed();
    error ZeroAddress();
    error NoRecipients();
    error TooManyRecipients(uint256 given, uint8 max);
    error BadSplit(uint256 total);
    error DuplicateRecipient(bytes32 beneficiary);
    error SocialShareTooSmall(uint16 asked, uint16 floorRequired);
    error EmptyHandle();
    error HandleTooLong();
    error PairTokenNotApproved(address pairToken);
    error EconomicsMoved(bytes32 pinned, bytes32 live);
    /// Pons has no periphery set, so no launch here can carry an atomic developer buy.
    error DevBuyUnavailable();

    constructor(IPonsV2Factory factory_, ShareClaims claims_, uint16 minSocialBps_) {
        if (address(factory_) == address(0) || address(claims_) == address(0)) revert ZeroAddress();
        if (minSocialBps_ > BPS) revert BadSplit(minSocialBps_);
        factory = factory_;
        escrow = IPonsFeeEscrow(factory_.feeEscrow());
        claims = claims_;
        minSocialBps = minSocialBps_;
    }

    /* -------------------------------------------------------------- launch -- */

    function launch(
        IPonsV2Factory.LaunchParams memory params,
        uint256 launchConfigId,
        address pairToken,
        RecipientInput[] calldata recipients
    ) external payable returns (address token, address curve, address splitter) {
        return _launch(params, launchConfigId, pairToken, recipients, DevBuy(0, 0), _noExemptions());
    }

    /**
     * The same launch, with a developer buy and declared snipe-tax exemptions.
     *
     * ## ⛔⛔ THE BOUGHT TOKENS GO TO `msg.sender`, AND THAT IS NOT A DETAIL
     *
     * Pons V1 chose the buyer for you: `initialBuyRecipient = feeWallet == 0 ? msg.sender :
     * feeWallet`, so a developer buy on a launch whose fee recipient was some other wallet bought
     * tokens that landed in THAT wallet. It has fired on this stack before and cost real supply.
     *
     * ➤ Here the fee recipient is a splitter — a contract with no owner and no way to move a token
     * balance out — so the V1 behaviour would send a launcher's own purchase somewhere it could
     * never be recovered from. V2 takes `recipient` explicitly and this passes `msg.sender`.
     *
     * @param devBuy `quoteIn` in the pair asset's own units, zero to opt out, and the slippage floor.
     *        ⚠ A zero `minTokensOut` is a free sandwich; the interface computes one.
     */
    function launchWithBuy(
        IPonsV2Factory.LaunchParams memory params,
        uint256 launchConfigId,
        address pairToken,
        RecipientInput[] calldata recipients,
        DevBuy calldata devBuy,
        address[] calldata snipeTaxExemptions
    ) external payable returns (address token, address curve, address splitter) {
        return _launch(params, launchConfigId, pairToken, recipients, devBuy, snipeTaxExemptions);
    }

    function _launch(
        IPonsV2Factory.LaunchParams memory params,
        uint256 launchConfigId,
        address pairToken,
        RecipientInput[] calldata inputs,
        DevBuy memory devBuy,
        address[] memory exemptions
    ) internal returns (address token, address curve, address splitter) {
        if (!factory.launchEnabled()) revert LaunchesClosed();
        if (pairToken != address(0) && !factory.approvedPairTokens(pairToken)) {
            revert PairTokenNotApproved(pairToken);
        }

        /*
          ⛔⛔ THE ECONOMICS PIN IS RE-CHECKED HERE, NOT JUST PASSED THROUGH.

          Pons already reverts if `expectedEconomics` has moved, and this is still not redundant: its
          revert surfaces as an opaque factory error AFTER a splitter has been deployed inside this
          transaction. That unwinds correctly and tells the launcher nothing. Checking first turns
          "the launch failed" into "the terms moved between your preview and your signature", which
          is the difference between a retry and a support message.
          ⚠ A zero pin means the caller opted out, which Pons permits. Not second-guessed here.
        */
        if (params.expectedEconomics != bytes32(0)) {
            bytes32 live = factory.previewLaunchEconomics(launchConfigId, pairToken);
            if (live != params.expectedEconomics) revert EconomicsMoved(params.expectedEconomics, live);
        }

        /* ⚠ One memory struct rather than eight locals. The legacy pipeline runs out of stack in
           this function otherwise, and the fix for that is a struct rather than turning `viaIR` on
           for the whole project — the compiler configuration is part of what gets verified. */
        Entry memory entry;
        entry.creator = msg.sender;
        entry.pairToken = pairToken;
        entry.launchedAt = uint64(block.timestamp);
        entry.recipientCount = uint8(inputs.length);

        bytes32[] memory bens;
        {
            uint16[] memory bps;
            (bens, bps, entry.socialBps) = _validate(inputs);
            entry.splitter = address(new ShareSplitter(escrow, claims, bens, bps));
        }

        /* ⭐ Overwritten, never trusted from the caller. The splitter is the only address that can be
           the fee recipient of a launch made here, and it did not exist until a moment ago. */
        params.creatorFeeRecipient = entry.splitter;

        (entry.token, entry.curve) = _launchOnPons(params, launchConfigId, pairToken, devBuy, exemptions);

        ShareSplitter(payable(entry.splitter)).bindToken(entry.token);

        _record(inputs, bens, entry);

        return (entry.token, entry.curve, entry.splitter);
    }

    /**
     * Sends the launch to Pons by the narrowest route that does what was asked.
     *
     * ⛔⛔ THREE ENTRYPOINTS, AND AN EMPTY ARRAY IS NOT THE SAME CALLDATA AS NO ARRAY. The plain
     * three-argument `launchToken` is still sent when there is nothing to declare and nothing to
     * buy, because that is the call Pons has always seen from a launchpad. The four-argument
     * overload is a different entrypoint; the periphery is a different contract entirely.
     */
    function _launchOnPons(
        IPonsV2Factory.LaunchParams memory params,
        uint256 launchConfigId,
        address pairToken,
        DevBuy memory devBuy,
        address[] memory exemptions
    ) private returns (address token, address curve) {
        if (devBuy.quoteIn == 0) {
            if (exemptions.length == 0) {
                return factory.launchToken{value: msg.value}(params, launchConfigId, pairToken);
            }
            return factory.launchToken{value: msg.value}(params, launchConfigId, pairToken, exemptions);
        }

        /* ⚠ Read live, never pinned. `launchForwarder` is a setter on the factory and only the
           address it currently returns may drive the atomic buy. */
        address forwarder = factory.launchForwarder();
        if (forwarder == address(0)) revert DevBuyUnavailable();

        if (pairToken != address(0)) {
            /*
              ⛔⛔ THE PERIPHERY PULLS THE QUOTE FROM ITS OWN CALLER, WHICH IS THIS CONTRACT.
              `transferFrom(msg.sender, …)` runs inside the periphery and its `msg.sender` is this
              launchpad, not the launcher. So the tokens come here first and are approved onward. A
              launcher who approved the periphery instead would watch their allowance sit unused.
            */
            IERC20(pairToken).safeTransferFrom(msg.sender, address(this), devBuy.quoteIn);
            IERC20(pairToken).forceApprove(forwarder, devBuy.quoteIn);
        }

        (token, curve,) = IPonsV2LaunchAndBuy(forwarder).launchAndBuy{value: msg.value}(
            params, launchConfigId, pairToken, devBuy.quoteIn, devBuy.minTokensOut, msg.sender, exemptions
        );

        // ⚠ Allowance driven to zero rather than left at whatever the periphery did not spend.
        if (pairToken != address(0)) IERC20(pairToken).forceApprove(forwarder, 0);
    }

    /* ------------------------------------------------------------ recipients -- */

    function _validate(RecipientInput[] calldata inputs)
        private
        view
        returns (bytes32[] memory bens, uint16[] memory bps, uint16 socialBps)
    {
        uint256 n = inputs.length;
        if (n == 0) revert NoRecipients();
        if (n > MAX_RECIPIENTS) revert TooManyRecipients(n, MAX_RECIPIENTS);

        bens = new bytes32[](n);
        bps = new uint16[](n);
        uint256 total;

        for (uint256 i = 0; i < n; i++) {
            RecipientInput calldata r = inputs[i];
            if (r.bps == 0) revert BadSplit(0);

            bytes32 ben = ShareKeys.beneficiary(r.platform, r.accountRef, r.wallet);

            /*
              ⛔ n² and deliberately so. `MAX_RECIPIENTS` is 8, so this is at most 28 comparisons —
              cheaper than the mapping writes a set would cost, and a mapping would persist between
              launches and have to be cleared.
              ⚠ Two entries for one person are not a harmless "70 + 30". The splitter credits per
              beneficiary and the site renders per row, so the same account would appear twice with
              two different numbers and neither would be what they get.
            */
            for (uint256 j = 0; j < i; j++) {
                if (bens[j] == ben) revert DuplicateRecipient(ben);
            }

            if (r.platform != ShareKeys.Platform.Wallet) {
                bytes memory h = bytes(r.handle);
                // ⚠ A social row with no label renders as an anonymous hash on every page it appears.
                if (h.length == 0) revert EmptyHandle();
                if (h.length > ShareKeys.MAX_ACCOUNT_REF) revert HandleTooLong();
                socialBps += r.bps;
            }

            bens[i] = ben;
            bps[i] = r.bps;
            total += r.bps;
        }

        if (total != BPS) revert BadSplit(total);
        if (socialBps < minSocialBps) revert SocialShareTooSmall(socialBps, minSocialBps);
    }

    function _record(RecipientInput[] calldata inputs, bytes32[] memory bens, Entry memory entry) private {
        uint256 index = _launches.length;
        _launches.push(entry);
        _indexOfPlusOne[entry.token] = index + 1;

        Recipient[] storage stored = _recipients[index];
        for (uint256 i = 0; i < inputs.length; i++) {
            RecipientInput calldata r = inputs[i];
            stored.push(
                Recipient({
                    platform: uint8(r.platform),
                    bps: r.bps,
                    wallet: r.platform == ShareKeys.Platform.Wallet ? r.wallet : address(0),
                    identity: ShareKeys.identity(r.platform, r.accountRef, r.wallet),
                    handle: r.platform == ShareKeys.Platform.Wallet ? "" : r.handle
                })
            );
            emit RecipientRecorded(entry.token, bens[i], uint8(r.platform), r.bps, r.handle);
        }

        emit ShareLaunch(
            entry.token, entry.splitter, entry.creator, entry.pairToken, entry.socialBps, entry.recipientCount
        );
    }

    function _noExemptions() private pure returns (address[] memory none) {
        none = new address[](0);
    }

    /* -------------------------------------------------------------- registry -- */

    function count() external view returns (uint256) {
        return _launches.length;
    }

    /**
     * A page of the registry, newest first.
     *
     * ⭐ Newest-first because that is the only order a launch feed is ever read in, and reversing a
     * page in the browser makes the page boundaries wrong. ⚠ Clamped rather than reverting past the
     * end: a feed that throws when somebody scrolls one page too far is a feed that breaks the
     * moment two launches happen while a visitor is reading.
     */
    function page(uint256 offset, uint256 limit) external view returns (Entry[] memory out) {
        uint256 n = _launches.length;
        if (offset >= n || limit == 0) return new Entry[](0);
        uint256 take = n - offset;
        if (take > limit) take = limit;
        out = new Entry[](take);
        for (uint256 i = 0; i < take; i++) {
            out[i] = _launches[n - 1 - offset - i];
        }
    }

    /// ⚠ Reverts for a token this launchpad did not create, rather than returning a zeroed struct
    /// that a caller would render as a share launch paying nobody.
    function entryOf(address token) external view returns (Entry memory) {
        return _launches[_indexOf(token)];
    }

    function recipientsOf(address token) external view returns (Recipient[] memory) {
        return _recipients[_indexOf(token)];
    }

    /**
     * Both halves of a launch in ONE call.
     *
     * ⭐ The token page needs the entry and its recipients together and nothing else; asking for
     * them separately is two round trips against a rate-limited public RPC for one screen.
     */
    function launchOf(address token) external view returns (Entry memory entry, Recipient[] memory recipients) {
        uint256 i = _indexOf(token);
        return (_launches[i], _recipients[i]);
    }

    /// A page of recipients, for a feed that wants to draw the split bars without a call per row.
    function recipientsPage(uint256 offset, uint256 limit) external view returns (Recipient[][] memory out) {
        uint256 n = _launches.length;
        if (offset >= n || limit == 0) return new Recipient[][](0);
        uint256 take = n - offset;
        if (take > limit) take = limit;
        out = new Recipient[][](take);
        for (uint256 i = 0; i < take; i++) {
            out[i] = _recipients[n - 1 - offset - i];
        }
    }

    function isShareLaunch(address token) external view returns (bool) {
        return _indexOfPlusOne[token] != 0;
    }

    function _indexOf(address token) private view returns (uint256) {
        uint256 idx = _indexOfPlusOne[token];
        if (idx == 0) revert ZeroAddress();
        return idx - 1;
    }
}
