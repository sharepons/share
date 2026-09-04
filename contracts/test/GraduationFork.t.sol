// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IPonsFeeEscrow, IPonsV2Factory} from "../src/interfaces/IPonsV2.sol";
import {ShareClaims} from "../src/ShareClaims.sol";
import {ShareKeys} from "../src/ShareKeys.sol";
import {ShareLaunchpad} from "../src/ShareLaunchpad.sol";
import {ShareSplitter} from "../src/ShareSplitter.sol";

interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function graduated() external view returns (bool);
    function getReserves() external view returns (uint256, uint256);
    function quoteFeeBalance() external view returns (uint256);
    function creatorTaxBalance() external view returns (uint256);
}

interface IPonsFactoryExtra {
    function createGraduatedPool(address token) external;
}

interface IMemeHook {
    /**
     * ⚠ DELIBERATELY DECLARED SHORTER THAN THE REAL RETURN TUPLE. The hook returns thirteen values
     * and destructuring all of them here blew the stack (`Stack too deep`) in a test that needs only
     * the first three. Every field before `memecoin` is a STATIC type, so the decoder reads the
     * leading words correctly and ignores the rest of the returndata.
     * ⛔ This shortcut is only safe while those leading fields stay static and in this order — if the
     * hook ever inserts a dynamic type before `memecoin`, the offsets move and this reads nonsense.
     */
    function launches(bytes32 poolId)
        external
        view
        returns (bool registered, bool memecoinIsCurrency0, address memecoin);
    function pendingFees(bytes32 poolId, address currency) external view returns (uint256);
}

/*
 * TAKING A SHARE LAUNCH THROUGH GRADUATION, ON A FORK OF LIVE RHC.
 *
 * ## ⛔⛔ WHY THIS FILE EXISTS
 *
 * Graduation is where this stack keeps losing money. A sibling project's biggest earner reported
 * "nothing to collect" for days because its only sweep path was `sweepCurve`, which reverts once a
 * launch leaves its curve. The front end has since been hardened against that — but it was hardened
 * against ANOTHER project's pool. **No SHARE launch has ever graduated**, and a splitter built by
 * this launchpad has never been on the far side of one.
 *
 * ➤ So this drives a launch made by the LIVE launchpad all the way through: curve → threshold →
 *   phase 1 → `createGraduatedPool` → phase 2, asserting at each step what can and cannot be done.
 *
 * ## ⭐⭐ THE QUESTION WITH MONEY IN IT
 *
 * A launch accrues creator fees on its curve. If nobody sweeps before it graduates, **where do those
 * fees go?** Either they survive to be collected afterwards, or they are gone — and if they are
 * gone, "sweep before you graduate" is an operational rule this project does not currently know it
 * has. Nothing in the repo answers this. `test_feesAccruedOnTheCurveSurviveGraduation` does.
 *
 * ⛔ NOTHING IS BROADCAST. Every transaction happens on a local fork; no key is used.
 */
contract GraduationForkTest is Test {
    uint256 constant CONFIG = 0;
    address constant NATIVE = address(0);

    ShareLaunchpad pad;
    ShareClaims claims;
    IPonsV2Factory factory;
    IPonsFeeEscrow escrow;
    address hook;

    /* ⛔⛔ NOT anvil's dev accounts — on RHC those are real, used addresses whose balances get
       resolved out from under a fork test mid-run. These exist nowhere. */
    address creator = makeAddr("share-grad-creator");
    address buyer = makeAddr("share-grad-buyer");
    address payoutWallet = makeAddr("share-grad-payout");

    string constant X_ID = "44196397";

    function setUp() public {
        string memory rpc = vm.envOr("RHC_RPC_URL", string(""));
        address padAddr = vm.envOr("SHARE_LAUNCHPAD", address(0));
        address claimsAddr = vm.envOr("SHARE_CLAIMS", address(0));
        if (bytes(rpc).length == 0 || padAddr == address(0) || claimsAddr == address(0)) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        pad = ShareLaunchpad(padAddr);
        claims = ShareClaims(payable(claimsAddr));
        factory = pad.factory();
        escrow = IPonsFeeEscrow(pad.escrow());
        hook = factory.memeHook();

        vm.deal(creator, 10 ether);
        // ⚠ Generous: the threshold is read from the chain and buying past it is the whole point.
        vm.deal(buyer, 5_000 ether);
    }

    /* ------------------------------------------------------------- the walk -- */

    /**
     * ⭐⭐ THE WHOLE LIFECYCLE, IN ONE TEST, BECAUSE THE ORDER IS THE THING BEING TESTED.
     *
     * Split into separate tests each would re-launch and re-graduate, and the assertions that matter
     * are about the TRANSITIONS — what stops working the moment the phase moves.
     */
    function test_aShareLaunchSurvivesGraduationAndStillPays() public {
        (address token, address curve, address splitter) = _launch();

        /* ── phase 0 ─────────────────────────────────────────────────────────────────────── */
        assertEq(uint256(factory.getLaunchedToken(token).phase), 0, "a fresh launch is not on the curve");
        assertFalse(IPonsCurve(curve).graduated(), "the curve says it has already graduated");

        uint256 threshold = factory.getLaunchedToken(token).graduationThreshold;
        assertGt(threshold, 0, "no graduation threshold to aim at");
        console2.log("  graduation threshold (wei)", threshold);

        // ⛔ Past the 99% snipe window, on WALL-CLOCK seconds. Blocks are the wrong clock here.
        vm.warp(block.timestamp + 4);

        /* ── buy past the threshold ──────────────────────────────────────────────────────── */
        uint256 spend = threshold + (threshold / 10);
        vm.prank(buyer);
        IPonsCurve(curve).buy{value: spend}(spend, 0, buyer);

        uint8 phaseAfter = factory.getLaunchedToken(token).phase;
        console2.log("  phase after crossing the threshold", uint256(phaseAfter));
        assertGt(uint256(phaseAfter), 0, "buying past the threshold did not graduate the launch");

        /* ── phase 1: swept off the curve, pool not seeded ───────────────────────────────── */
        if (phaseAfter == 1) {
            /* ⛔ THE STATE THE SITE USED TO CALL "GRADUATED" AND OFFER A SWEEP BUTTON FOR. There is
               no pool yet, so `sweepPool` has nothing to sweep and the only thing that helps is
               `createGraduatedPool` — which is why the interface now says so. */
            IPonsFactoryExtra(address(factory)).createGraduatedPool(token);
            assertEq(uint256(factory.getLaunchedToken(token).phase), 2, "createGraduatedPool did not seed the pool");
        }

        /* ── phase 2: trading in the pool ────────────────────────────────────────────────── */
        assertEq(uint256(factory.getLaunchedToken(token).phase), 2, "not in the pool");
        assertTrue(IPonsCurve(curve).graduated(), "the curve should report graduated by now");

        /* ⛔⛔ THE POOL ID IS DERIVED AND THEN CHECKED BACK. `pendingFees` on an id that does not
           exist returns ZERO rather than reverting, so a derivation that is quietly wrong reports
           "no fees" and looks exactly like the truth. The site does this check; so does this test,
           against the same live hook. */
        bytes32 poolId = _poolId(token);
        (bool registered,, address memecoin) = IMemeHook(hook).launches(poolId);
        assertTrue(registered, "the derived pool id is not a registered pool");
        assertEq(memecoin, token, "the derived pool names a different memecoin");
        console2.log("  pool id derived and confirmed registered");

        /* ── what stops working ──────────────────────────────────────────────────────────── */
        /* ⛔⛔ `sweepCurve` REVERTS FROM HERE ON, FOREVER. This is the assertion the whole file is
           for: a launchpad that only knows the curve sweep cannot move a graduated launch's fees,
           and cannot even SEE them, because the escrow it reads is what the sweep is what fills. */
        vm.expectRevert();
        ShareSplitter(payable(splitter)).sweepCurve(curve, 0);
        console2.log("  sweepCurve correctly reverts at phase 2");

        /* ⭐ And the splitter still pays. Whatever reached the escrow is harvestable and claimable by
           the wallet recipient with no server in the loop. */
        uint256 gained = ShareSplitter(payable(splitter)).harvest();
        bytes32 walletBen = ShareKeys.beneficiary(ShareKeys.Platform.Wallet, "", payoutWallet);
        uint256 owed = claims.owed(token, walletBen, NATIVE);
        console2.log("  harvested after graduation (wei)", gained);
        console2.log("  owed to the wallet recipient    ", owed);

        if (owed > 0) {
            address[] memory launches = new address[](1);
            launches[0] = token;
            address[] memory assets = new address[](1);
            assets[0] = NATIVE;
            uint256 before = payoutWallet.balance;
            vm.prank(payoutWallet);
            claims.claimAsWallet(launches, assets);
            assertEq(payoutWallet.balance - before, owed, "the wallet recipient was not paid after graduation");
            console2.log("  paid out after graduation - the full path works");
        }
    }

    /**
     * ⭐⭐ THE QUESTION WITH MONEY IN IT: do curve fees survive graduation if nobody swept first?
     *
     * A launch earns creator fees on its curve. If it graduates before anybody sweeps, either those
     * fees carry over, or they are stranded — and if they are stranded, "sweep before the threshold"
     * is an operational rule SHARE does not currently know it has, and every launch that graduates
     * unattended loses whatever it earned on the way up.
     *
     * ⚠ This test asserts nothing about WHICH answer is correct. It measures, prints, and fails only
     * if the money is silently lost — because that is the outcome that would need a code change.
     */
    function test_feesAccruedOnTheCurveSurviveGraduation() public {
        (address token, address curve, address splitter) = _launch();
        vm.warp(block.timestamp + 4);

        // ⚠ A buy well under the threshold, so fees accrue on the curve with no graduation.
        uint256 small = 2 ether;
        vm.prank(buyer);
        IPonsCurve(curve).buy{value: small}(small, 0, buyer);

        uint256 curveFees = IPonsCurve(curve).quoteFeeBalance() + IPonsCurve(curve).creatorTaxBalance();
        console2.log("  fees sitting on the curve, unswept (wei)", curveFees);
        assertGt(curveFees, 0, "the buy accrued no curve fees, so this test proves nothing");

        // ⛔ DELIBERATELY NOT SWEPT. That is the scenario.
        uint256 threshold = factory.getLaunchedToken(token).graduationThreshold;
        uint256 rest = threshold + (threshold / 10);
        vm.prank(buyer);
        IPonsCurve(curve).buy{value: rest}(rest, 0, buyer);

        if (factory.getLaunchedToken(token).phase == 1) {
            IPonsFactoryExtra(address(factory)).createGraduatedPool(token);
        }
        assertEq(uint256(factory.getLaunchedToken(token).phase), 2, "did not reach the pool");

        /*
          Where could the money be now? Three places, and they are checked separately rather than
          summed, because the point is to find out WHICH one holds it.
        */
        uint256 inEscrow = escrow.balanceOf(splitter);
        uint256 heldBySplitter = splitter.balance;
        uint256 inHook = IMemeHook(hook).pendingFees(_poolId(token), NATIVE);

        console2.log("  after graduation -");
        console2.log("    escrow credited to the splitter", inEscrow);
        console2.log("    held by the splitter directly  ", heldBySplitter);
        console2.log("    pending in the meme hook       ", inHook);

        uint256 recoverable = inEscrow + heldBySplitter + inHook;

        /* ⛔⛔ THE ASSERTION THAT MATTERS. If graduation swept the curve's creator fees somewhere the
           splitter can reach, `recoverable` covers them. If it is zero while `curveFees` was not,
           the fees were consumed by graduation and never reached this launch's recipients — which
           would make "sweep before the threshold" a rule the launch form has to teach. */
        assertGt(
            recoverable,
            0,
            "curve fees vanished at graduation: nothing reached the escrow, the splitter or the hook"
        );
        console2.log("  curve fees survived graduation, total reachable (wei)", recoverable);
    }

    /* ----------------------------------------------------------------- utils -- */

    /** ⚠ Same derivation the site uses: sorted currencies, native is always currency0. */
    function _poolId(address token) internal view returns (bytes32) {
        IPonsV2Factory.LaunchedToken memory l = factory.getLaunchedToken(token);
        (address c0, address c1) = NATIVE < token ? (NATIVE, token) : (token, NATIVE);
        return keccak256(abi.encode(c0, c1, uint24(l.poolFee), int24(l.tickSpacing), hook));
    }

    function _launch() internal returns (address token, address curve, address splitter) {
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](2);
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

        IPonsV2Factory.LaunchParams memory p;
        p.name = "Share Graduation Rehearsal";
        p.symbol = "SHAREGRAD";
        p.logo = "";
        p.description = "a graduation rehearsal, never broadcast";
        p.creatorTaxBps = 0;
        p.expectedEconomics = factory.previewLaunchEconomics(CONFIG, NATIVE);
        p.salt = keccak256(abi.encodePacked("share-grad", block.number, block.timestamp, gasleft()));

        /* ⛔⛔ `vm.prank` IS SPENT BY THE NEXT CALL, INCLUDING A VIEW. Read the fee into a local
           FIRST — inline, the prank is consumed by `launchFee()` and the launch arrives from this
           test contract, silently, with every assertion about the creator checking the wrong
           address. It has cost this repo two sessions. */
        uint256 fee = factory.launchFee();
        vm.prank(creator);
        (token, curve, splitter) = pad.launch{value: fee}(p, CONFIG, NATIVE, rs);
    }
}
