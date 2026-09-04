// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IPonsFeeEscrow, IPonsV2Factory} from "../src/interfaces/IPonsV2.sol";
import {ShareClaims} from "../src/ShareClaims.sol";
import {ShareKeys} from "../src/ShareKeys.sol";
import {ShareLaunchpad} from "../src/ShareLaunchpad.sol";
import {ShareSplitter} from "../src/ShareSplitter.sol";

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/**
 * What a launched Pons V2 token says about ITSELF.
 *
 * ⛔⛔ EVERY ONE OF THESE IS WRITTEN IN THE CONSTRUCTOR AND HAS NO SETTER. A wrong name, symbol or
 * logo is wrong for the life of the token — the only remedy is launching a different one. `$GRAILS`
 * on a sibling project launched with an empty logo and it is empty forever.
 * ⚠ `logo` is a full URL, not an id, so the token also permanently pins a HOST. A sibling stranded
 * 22 of 24 token logos by retiring the domains they pointed at.
 */
interface IPonsTokenMetadata {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function logo() external view returns (string memory);
    function description() external view returns (string memory);
}

interface IPonsCurveBuy {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);
}

/*
 * SHARE against the REAL Pons V2, on a fork of Robinhood Chain.
 *
 * ## ⛔⛔ WHY THIS FILE EXISTS
 *
 * The other 71 tests run against `test/Mocks.sol` — a mock this repo wrote, which agrees with this
 * repo by construction. It cannot fail because Pons moved, because a struct field was added, because
 * `launchEnabled` went false, or because the factory address at the top of `deploy.sh` is pointing
 * at a retired deployment. Every one of those has happened on this stack:
 *
 *   • Pons V1 closed — `launchEnabled` went FALSE and every project here kept its address.
 *   • The V2 factory was REPLACED, and the sibling projects targeting the old one all still built.
 *   • A sibling's launch rehearsal shipped a stale default factory TWICE, and both times it PASSED.
 *
 * ➤ A mock suite going green is not evidence that a launch would work. This file is the only thing
 *   in the repo that talks to the deployed factory, so it is the one that has to run before a
 *   deploy and after any Pons announcement.
 *
 * ## ⚠ OPT-IN, AND THAT IS DELIBERATE
 *
 * Skipped unless `RHC_RPC_URL` is set, so `forge test` still passes on a plane. Run it with
 * `./rehearse.sh`, which also starts the loopback proxy this needs.
 *
 * ⛔ FORGE CANNOT SET A USER-AGENT AND RHC IS BEHIND CLOUDFLARE. Pointed straight at the public RPC
 * this dies at `Setting up 1 EVM` with challenge HTML. `cast` takes `--rpc-headers`; forge does not,
 * and `ETH_RPC_HEADERS` does not reach the fork backend. Hence the proxy.
 *
 * ## ⚠ NOTHING HERE IS BROADCAST
 *
 * Every launch, buy and sweep below happens on a local fork. No key is used and no transaction
 * leaves the machine. The launch fee is `vm.deal`'d.
 */
contract PonsForkTest is Test {
    /*
     * ⛔ The live factory, and the single most load-bearing constant in the repo. It is duplicated
     * from `deploy.sh` ON PURPOSE rather than read from an env var: a rehearsal that takes its
     * factory from the same place the deploy does cannot detect the address being wrong, which is
     * exactly how a sibling project rehearsed a stale factory green twice.
     */
    address constant FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;

    /// ⚠ The only launch config the live factory answers for. 1, 2 and 3 revert `0x68b42c59`.
    uint256 constant CONFIG = 0;

    /// ⚠ Native pair. Deliberately NOT in `approvedPairTokens` — see the test that pins that.
    address constant NATIVE = address(0);

    uint16 constant MIN_SOCIAL = 2000;

    IPonsV2Factory factory;
    IPonsFeeEscrow escrow;
    ShareClaims claims;
    ShareLaunchpad pad;

    /*
     * ⛔⛔ NOT anvil's dev accounts. On RHC those well-known addresses are REAL, USED addresses with
     * real balances and real nonces, and a fork test built on them watches its own funds move
     * underneath it mid-test. These are addresses that exist nowhere.
     */
    address creator = makeAddr("share-fork-creator");
    address buyer = makeAddr("share-fork-buyer");
    address payoutWallet = makeAddr("share-fork-payout");

    /// The X account id the social share is keyed to. ⚠ Any digits; nothing is looked up on chain.
    string constant X_ID = "44196397";

    /// ⚠ Two launches in one test would otherwise share a salt and collide.
    uint256 private _nonce;

    function setUp() public {
        string memory rpc = vm.envOr("RHC_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            // ⚠ Skipped, not failed. A missing RPC is "not run here", not "SHARE is broken".
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        factory = IPonsV2Factory(FACTORY);
        escrow = IPonsFeeEscrow(factory.feeEscrow());

        // ⚠ owner != signer, the same rule `deploy.sh` refuses to break.
        claims = new ShareClaims(makeAddr("share-fork-owner"), makeAddr("share-fork-signer"));
        pad = new ShareLaunchpad(factory, claims, MIN_SOCIAL);

        vm.deal(creator, 10 ether);
        vm.deal(buyer, 50 ether);
    }

    /* ------------------------------------------------- is Pons still there -- */

    /**
     * ⛔⛔ THE STALE-ADDRESS ALARM. If this fails, the address in `deploy.sh` and `IPonsV2.sol` is
     * wrong or Pons has closed launches, and NOTHING else in this repo would have told you: the
     * mock suite goes green either way.
     */
    function test_theFactoryThisRepoPinsIsLiveAndOpen() public view {
        assertGt(FACTORY.code.length, 0, "no code at the pinned factory - address is stale");
        assertTrue(factory.launchEnabled(), "launchEnabled is FALSE - Pons has closed this factory");
        assertGt(factory.launchFee(), 0, "launchFee reads zero - wrong ABI or wrong contract");
        assertGt(factory.maxCreatorTaxBps(), 0);
        assertTrue(address(escrow) != address(0), "factory returned a zero fee escrow");
        assertGt(address(escrow).code.length, 0, "the fee escrow has no code");
        assertGt(factory.memeHook().code.length, 0, "the meme hook has no code - sweepPool would fail");
    }

    /**
     * ⚠ Native is NOT an approved pair token on the live factory, and never will be — approval is a
     * map of ERC-20s. A launchpad that checked it unconditionally would reject every native launch,
     * which is the default one. This pins the real answer so the special case cannot be "tidied".
     */
    function test_nativeIsNotAnApprovedPairTokenAndMustStayASpecialCase() public view {
        assertFalse(factory.approvedPairTokens(NATIVE), "native became approved - the guard can change");
    }

    /// The escrow the launchpad cached at construction is the one the live factory names.
    function test_theLaunchpadCachedTheRealEscrow() public view {
        assertEq(address(pad.escrow()), address(escrow));
    }

    /* ---------------------------------------------------------- a real launch -- */

    /**
     * ⭐⭐ THE WHOLE PROMISE, READ BACK OUT OF PONS'S OWN STORAGE. SHARE claims a token's fees belong
     * to the named accounts from the first trade. That is true only if the REAL factory recorded the
     * splitter as `creatorFeeRecipient` — not the launcher, and not this launchpad.
     */
    function test_aRealLaunchNamesTheSplitterAsCreatorFeeRecipient() public {
        (address token, address curve, address splitter) = _launch();

        IPonsV2Factory.LaunchedToken memory rec = factory.getLaunchedToken(token);
        assertTrue(rec.exists, "Pons does not know this token");
        assertEq(rec.creatorFeeRecipient, splitter, "fees are NOT going to the splitter");
        assertEq(rec.curve, curve, "the curve the launchpad recorded is not the one Pons did");
        assertEq(rec.token, token);
        assertEq(rec.pairToken, NATIVE);

        // The splitter knows its token, so a release can reach the vault.
        assertEq(ShareSplitter(payable(splitter)).token(), token);
    }

    /**
     * ⛔⛔ THE METADATA A LAUNCH WRITES IS PERMANENT, AND NOTHING HERE CHECKED IT UNTIL NOW.
     *
     * `ShareLaunchpad._launch` takes `LaunchParams` by `memory` and overwrites exactly one field —
     * `creatorFeeRecipient`, which must become the splitter. Everything else is meant to reach Pons
     * untouched. "Meant to" was the entire guarantee: the mock suite never read a token back, and
     * this fork suite launched with `logo = ""`, so a launchpad that dropped or transposed name and
     * symbol would have passed all 73 tests and every rehearsal.
     *
     * ⚠ Read off the TOKEN, not off the params — the point is what the chain now says, forever.
     */
    function test_theLaunchedTokenCarriesTheExactNameSymbolAndLogo() public {
        IPonsV2Factory.LaunchParams memory p = _params();
        p.name = "Share Pons";
        p.symbol = "SHARE";
        p.logo = LOGO_URL;
        p.description = "share the fees";

        ShareLaunchpad.RecipientInput[] memory rs = _recipients();
        vm.prank(creator);
        (address token,,) = pad.launch{value: factory.launchFee()}(p, CONFIG, NATIVE, rs);

        IPonsTokenMetadata t = IPonsTokenMetadata(token);
        assertEq(t.name(), "Share Pons", "the NAME did not survive the launch");
        assertEq(t.symbol(), "SHARE", "the SYMBOL did not survive the launch");
        assertEq(t.logo(), LOGO_URL, "the LOGO did not survive the launch - it has no setter");
        assertEq(t.description(), "share the fees", "the DESCRIPTION did not survive the launch");
    }

    /**
     * ⛔ A LAUNCH WITH NO IMAGE SUCCEEDS SILENTLY. Nothing on chain requires a logo, so the failure
     * mode is not a revert — it is a token that exists, trades, and is blank on every terminal
     * forever. This test exists to state that out loud: if it ever starts failing because Pons began
     * rejecting an empty logo, that is GOOD NEWS and the interface should stop allowing one.
     * ⚠ It is also why the front end must upload and verify the image BEFORE the launch button.
     */
    function test_anEmptyLogoIsAcceptedByPons_whichIsWhyTheInterfaceMustNotAllowIt() public {
        IPonsV2Factory.LaunchParams memory p = _params();
        p.logo = "";
        ShareLaunchpad.RecipientInput[] memory rs = _recipients();
        vm.prank(creator);
        (address token,,) = pad.launch{value: factory.launchFee()}(p, CONFIG, NATIVE, rs);

        assertEq(IPonsTokenMetadata(token).logo(), "", "Pons now rejects an empty logo - tighten the interface");
    }

    /**
     * ⚠ Case and punctuation are preserved byte for byte. A launchpad that upper-cased a symbol or
     * trimmed a name would be a permanent, silent rewrite of what the launcher typed.
     */
    function test_metadataIsNotNormalisedOnTheWayThrough() public {
        IPonsV2Factory.LaunchParams memory p = _params();
        p.name = "  Share Pons  ";
        p.symbol = "sHaRe";
        p.logo = "https://sharepons.family/logos/UPPER-case_1.png";

        ShareLaunchpad.RecipientInput[] memory rs = _recipients();
        vm.prank(creator);
        (address token,,) = pad.launch{value: factory.launchFee()}(p, CONFIG, NATIVE, rs);

        IPonsTokenMetadata t = IPonsTokenMetadata(token);
        assertEq(t.name(), "  Share Pons  ", "the name was normalised - whitespace must reach the chain as typed");
        assertEq(t.symbol(), "sHaRe", "the symbol was case-folded somewhere in the path");
        assertEq(t.logo(), "https://sharepons.family/logos/UPPER-case_1.png", "the logo URL was rewritten");
    }

    /**
     * ⚠ The pin the launchpad re-checks before deploying anything has to match what the live
     * factory previews, or every launch reverts `EconomicsMoved` and the form looks broken.
     */
    function test_theEconomicsPinMatchesTheLivePreview() public {
        bytes32 live = factory.previewLaunchEconomics(CONFIG, NATIVE);
        assertTrue(live != bytes32(0), "the live preview is zero - wrong config id");

        (address token,,) = _launch();
        assertTrue(factory.getLaunchedToken(token).exists);
    }

    /* ------------------------------------------- fees, for real, end to end -- */

    /**
     * ⭐⭐ THE ONE THAT PROVES THERE IS MONEY IN IT — real curve, real fee, real escrow, real payout.
     *
     * buy on the live curve → `sweepCurve` past Pons's `NotFeeSweepOperator` gate → escrow credits
     * the splitter → `harvest` → the vault owes each beneficiary → a wallet recipient withdraws.
     *
     * ⛔ `sweepCurve` is the step a mock cannot vouch for: Pons refuses it from everyone but its own
     * operator and the launch's fee recipient, so this is the only proof the passthrough is enough.
     */
    function test_aRealBuyPaysTheRecipientsAllTheWayToAWithdrawal() public {
        (address token, address curve, address splitter) = _launch();

        uint256 spend = 2 ether;

        /* ⛔⛔ WARPED PAST THE SNIPE WINDOW ON PURPOSE, OR THIS TEST MEASURES THE WRONG NUMBER.
           A buy in the launch's own second pays a 99% snipe tax, so an unwarped version of this
           asserted a 69.3% "fee" and would have gone green on any fee rate Pons ever chose. Three
           seconds of wall clock is the whole window — see the test that pins it below. */
        vm.warp(block.timestamp + 3);
        vm.prank(buyer);
        IPonsCurveBuy(curve).buy{value: spend}(spend, 0, buyer);

        // ⚠ Fees sit on the CURVE until swept; the escrow reads a truthful zero before this.
        assertEq(escrow.balanceOf(splitter), 0, "the escrow should be empty before the sweep");

        ShareSplitter(payable(splitter)).sweepCurve(curve, 0);
        uint256 inEscrow = escrow.balanceOf(splitter);
        assertGt(inEscrow, 0, "sweepCurve moved nothing - the fee recipient gate or the ABI is wrong");

        /* ⭐ The real rate, pinned rather than merely non-zero: Pons charges 1% and the creator side
           is 70% of it, so a 2 ETH buy owes the recipients exactly 0.7%. An `assertGt(_, 0)` here
           would stay green if Pons cut the creator share to a hundredth of what it promises. */
        assertEq(inEscrow, (spend * 70) / 10_000, "the creator fee is no longer 0.7% of volume");

        // ⭐ Permissionless: a stranger pays the gas and the money still goes where it was promised.
        vm.prank(makeAddr("share-fork-stranger"));
        uint256 gained = ShareSplitter(payable(splitter)).harvest();
        assertEq(gained, inEscrow, "harvest did not pull the whole escrow balance");

        bytes32 socialBen = ShareKeys.beneficiary(ShareKeys.Platform.X, X_ID, address(0));
        bytes32 walletBen = ShareKeys.beneficiary(ShareKeys.Platform.Wallet, "", payoutWallet);

        uint256 owedSocial = claims.owed(token, socialBen, NATIVE);
        uint256 owedWallet = claims.owed(token, walletBen, NATIVE);
        assertGt(owedSocial, 0, "the social recipient was credited nothing");
        assertGt(owedWallet, 0, "the wallet recipient was credited nothing");

        // 7000 / 3000. ⚠ Dust goes to the first recipient, so this is >= not ==.
        assertGe(owedSocial, (gained * 7000) / 10_000);
        assertEq(owedSocial + owedWallet, gained, "credited total does not equal what was harvested");

        // ⭐ The wallet recipient needs no server and no attestation — this works from an explorer.
        address[] memory launches = new address[](1);
        launches[0] = token;
        address[] memory assets = new address[](1);
        assets[0] = NATIVE;

        uint256 before = payoutWallet.balance;
        vm.prank(payoutWallet);
        claims.claimAsWallet(launches, assets);
        assertEq(payoutWallet.balance - before, owedWallet, "the wallet recipient was not paid");

        // ⛔ The social share is untouched by somebody else's claim — the ring fence holds.
        assertEq(claims.owed(token, socialBen, NATIVE), owedSocial, "a claim moved another beneficiary's money");

        /* ⭐ Printed, not just asserted. Green ticks do not tell an operator whether a 2 ETH buy paid
           the recipients a meaningful amount or four wei, and the fee rate is Pons's to change. */
        console2.log("  buy (wei)            ", spend);
        console2.log("  fees swept to escrow ", inEscrow);
        console2.log("  owed @somebody  7000 ", owedSocial);
        console2.log("  owed wallet     3000 ", owedWallet);
    }

    /**
     * ⚠ `sweepCurve` on a launch that has never traded must not brick the harvest path. Pons reverts
     * rather than returning zero in several places; a rehearsal that only ever sweeps a curve with
     * money on it would never find out.
     */
    function test_harvestOnAFreshLaunchIsHarmless() public {
        (address token,, address splitter) = _launch();

        ShareSplitter(payable(splitter)).harvest();
        assertEq(claims.owed(token, ShareKeys.beneficiary(ShareKeys.Platform.X, X_ID, address(0)), NATIVE), 0);
    }

    /* ------------------------------------------------ what a mock cannot know -- */

    /**
     * ⛔⛔ THE SNIPE TAX IS 99% AND IT DECAYS ON WALL-CLOCK SECONDS, NOT BLOCKS.
     *
     * Measured on the live curve: a 2 ETH buy in the launch's own second pays 69.3% to the fee
     * recipient (70% of a 99% tax), 5.03% one second later, 0.83% at two, and the ordinary 0.7% from
     * three seconds on. The whole window is THREE SECONDS.
     *
     * ⚠⚠ THE CLOCK IS THE TRAP. `block.number` here does not move with wall time — this chain runs
     * two clocks, and a block advanced with the timestamp held still charges the FULL snipe tax.
     * Anything that reasons about the window in blocks is wrong in both directions.
     *
     * ⭐ For SHARE the tax is not a hazard, it is income: it accrues to the `creatorFeeRecipient`,
     * which on every launch made here is the splitter. A sniper front-running a SHARE launch pays
     * the people whose names are on it. That is worth saying on the site, and it is only true while
     * this test passes.
     */
    function test_theSnipeTaxIsHugeAndDecaysOnSecondsNotBlocks() public {
        uint256 spend = 2 ether;

        (, address curveA, address splitterA) = _launch();
        vm.roll(block.number + 1); // ⚠ a whole block, with the timestamp untouched
        vm.prank(buyer);
        IPonsCurveBuy(curveA).buy{value: spend}(spend, 0, buyer);
        ShareSplitter(payable(splitterA)).sweepCurve(curveA, 0);
        uint256 sniped = escrow.balanceOf(splitterA);

        (, address curveB, address splitterB) = _launch();
        vm.warp(block.timestamp + 3); // ⚠ three seconds, no new block
        vm.prank(buyer);
        IPonsCurveBuy(curveB).buy{value: spend}(spend, 0, buyer);
        ShareSplitter(payable(splitterB)).sweepCurve(curveB, 0);
        uint256 normal = escrow.balanceOf(splitterB);

        assertEq(normal, (spend * 70) / 10_000, "the settled rate is no longer 0.7%");
        assertGt(sniped, normal * 50, "a same-second buy is no longer taxed - the window moved");
        assertLt(sniped, spend, "the tax should never exceed the buy");
    }

    /**
     * ⭐⭐ AN ATOMIC DEVELOPER BUY NEEDS NO EXEMPTION, AND ITS TOKENS REACH THE LAUNCHER.
     *
     * Two separate things a mock cannot answer, and both are money:
     *
     * 1. **The empty exemptions array in the launch form is correct.** The buy settles in the launch
     *    transaction — the same second the token exists — which is the 99% band. If the periphery
     *    route were taxed like any other buyer, every developer buy made here would lose 99% of
     *    itself, and the form sends `[]`. It does not: the fee below is the ordinary 0.7%.
     * 2. **The V1 trap does not fire.** Pons V1 sent an initial buy to the FEE WALLET rather than the
     *    buyer, and it has cost real supply on this stack. Here the fee wallet is a splitter with no
     *    owner and no way to move a token balance, so the V1 behaviour would burn a launcher's
     *    purchase irrecoverably. V2 takes `recipient` and the launchpad passes `msg.sender`.
     */
    function test_anAtomicDevBuyIsUntaxedAndReachesTheLauncher() public {
        uint256 quote = 1 ether;

        // ⛔ Everything external resolved BEFORE the prank — see the note in `_launch`.
        IPonsV2Factory.LaunchParams memory p = _params();
        ShareLaunchpad.RecipientInput[] memory rs = _recipients();
        ShareLaunchpad.DevBuy memory devBuy = ShareLaunchpad.DevBuy(quote, 1);
        address[] memory noExemptions = new address[](0);
        uint256 value = factory.launchFee() + quote;

        uint256 ethBefore = creator.balance;
        vm.prank(creator);
        (address token, address curve, address splitter) =
            pad.launchWithBuy{value: value}(p, CONFIG, NATIVE, rs, devBuy, noExemptions);

        assertEq(ethBefore - creator.balance, value, "the launcher paid something other than fee + buy");
        assertGt(IERC20Balance(token).balanceOf(creator), 0, "the developer buy did NOT reach the launcher");
        assertEq(IERC20Balance(token).balanceOf(address(pad)), 0, "tokens stranded in the launchpad");
        assertEq(IERC20Balance(token).balanceOf(splitter), 0, "tokens stranded in the splitter - the V1 trap");

        ShareSplitter(payable(splitter)).sweepCurve(curve, 0);
        assertEq(
            escrow.balanceOf(splitter),
            (quote * 70) / 10_000,
            "the developer buy was snipe-taxed - the empty exemptions array is no longer safe"
        );
    }

    /**
     * ⭐⭐ A DECLARED WALLET BUYS IN THE SNIPE WINDOW AND PAYS THE ORDINARY FEE.
     *
     * This is the exact path the launch form takes for exemptions: `launchWithBuy` with `quoteIn: 0`
     * and a non-empty array. ⛔ The plain `launch` entrypoint CANNOT carry exemptions — it passes
     * `_noExemptions()` — and inside `_launchOnPons` a zero dev buy with a non-empty array is what
     * selects Pons's FOUR-argument `launchToken` (`0xa72101af`), the only overload that declares
     * wallets on a launch with no atomic buy. An empty array is not the same calldata as no array.
     *
     * ⚠ The control matters as much as the case: without it this test would pass just as happily if
     * exemptions did nothing at all and the snipe tax had simply been switched off.
     */
    function test_aDeclaredWalletIsExemptFromTheSnipeTax() public {
        uint256 spend = 2 ether;

        address[] memory declared = new address[](1);
        declared[0] = buyer;

        (, address curveA, address splitterA) = _launchWith(declared);
        // ⚠ No warp: the launch's own second, which is the 99% band.
        vm.prank(buyer);
        IPonsCurveBuy(curveA).buy{value: spend}(spend, 0, buyer);
        ShareSplitter(payable(splitterA)).sweepCurve(curveA, 0);
        uint256 exempt = escrow.balanceOf(splitterA);

        // ── the control: the SAME buy, same second, undeclared ──
        address[] memory none = new address[](0);
        (, address curveB, address splitterB) = _launchWith(none);
        vm.prank(buyer);
        IPonsCurveBuy(curveB).buy{value: spend}(spend, 0, buyer);
        ShareSplitter(payable(splitterB)).sweepCurve(curveB, 0);
        uint256 taxed = escrow.balanceOf(splitterB);

        assertEq(exempt, (spend * 70) / 10_000, "the declared wallet did NOT get the ordinary rate");
        assertGt(taxed, exempt * 50, "the control was not snipe-taxed, so this proves nothing");
    }

    /* ----------------------------------------------------------------- utils -- */

    function _recipients() internal view returns (ShareLaunchpad.RecipientInput[] memory rs) {
        rs = new ShareLaunchpad.RecipientInput[](2);
        rs[0] = ShareLaunchpad.RecipientInput({
            platform: ShareKeys.Platform.X,
            accountRef: X_ID,
            handle: "somebody",
            wallet: address(0),
            bps: 7000
        });
        rs[1] = ShareLaunchpad.RecipientInput({
            platform: ShareKeys.Platform.Wallet,
            accountRef: "",
            handle: "",
            wallet: payoutWallet,
            bps: 3000
        });
    }

    /* ⚠ The SHAPE the server actually produces: LOGO_PUBLIC_BASE + a 32-char hex digest + the
       real extension. Verified live — the upload endpoint returns exactly this and the URL
       answers 200 image/png. ⛔ The host is ours on purpose; a launch pins it forever. */
    string internal constant LOGO_URL = "https://sharepons.family/logos/446a55f04b820db560bab0f87ffac021.png";

    function _params() internal returns (IPonsV2Factory.LaunchParams memory p) {
        p.name = "Share Fork Rehearsal";
        p.symbol = "SHAREFORK";
        p.logo = "";
        p.description = "a fork rehearsal, never broadcast";
        p.creatorTaxBps = 0;
        p.expectedEconomics = factory.previewLaunchEconomics(CONFIG, NATIVE);
        p.salt = keccak256(abi.encodePacked("share-fork", block.number, block.timestamp, _nonce++));
    }

    /* The exemptions path: `launchWithBuy` with no developer buy — see `_launchOnPons`.
       ⛔ A plain `/*` block, not `/**`: Solidity's natspec parser treats any `@word` as a tag and
       rejects `@see` on a function, failing the whole build. */
    function _launchWith(address[] memory exemptions)
        internal
        returns (address token, address curve, address splitter)
    {
        IPonsV2Factory.LaunchParams memory p = _params();
        ShareLaunchpad.RecipientInput[] memory rs = _recipients();
        ShareLaunchpad.DevBuy memory noBuy = ShareLaunchpad.DevBuy(0, 0);
        uint256 fee = factory.launchFee();
        vm.prank(creator);
        (token, curve, splitter) = pad.launchWithBuy{value: fee}(p, CONFIG, NATIVE, rs, noBuy, exemptions);
    }

    function _launch() internal returns (address token, address curve, address splitter) {
        IPonsV2Factory.LaunchParams memory p = _params();
        ShareLaunchpad.RecipientInput[] memory rs = _recipients();

        /* ⛔⛔ `vm.prank` IS SPENT BY THE NEXT CALL, INCLUDING A VIEW. Written inline as
           `pad.launch{value: factory.launchFee()}` the prank is consumed by `launchFee()` and the
           launch arrives from this test contract instead of `creator` — silently, with every
           assertion about the creator then checking the wrong address. Read the fee FIRST. */
        uint256 fee = factory.launchFee();
        vm.prank(creator);
        (token, curve, splitter) = pad.launch{value: fee}(p, CONFIG, NATIVE, rs);
    }
}
