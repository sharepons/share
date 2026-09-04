// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IPonsFeeEscrow, IPonsV2Factory} from "../src/interfaces/IPonsV2.sol";
import {ShareClaims} from "../src/ShareClaims.sol";
import {ShareKeys} from "../src/ShareKeys.sol";
import {ShareLaunchpad} from "../src/ShareLaunchpad.sol";
import {ShareSplitter} from "../src/ShareSplitter.sol";

interface IPonsCurveBuy {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);
}

/*
 * The contracts `deploy.sh` ACTUALLY DEPLOYED, driven against the real Pons V2.
 *
 * ## ⛔⛔ WHY THIS IS NOT test/PonsFork.t.sol AGAIN
 *
 * `PonsFork.t.sol` constructs its own launchpad with `new`, at `minSocialBps = 2000`. So does every
 * one of the 71 mock tests. **Nothing in this repo has ever exercised the value `deploy.sh` will
 * actually ship**, which since 4 Sep 2026 is `0` — and that number is `immutable`, chosen once, at
 * deploy time, by a shell variable, with no setter and no second chance. A launchpad deployed with
 * the wrong floor rejects launches forever and the only repair is a new launchpad and an orphaned
 * register.
 *
 * ➤ This file takes its addresses from the environment — `deploy-rehearse.sh` puts them there,
 *   having just run the real script — and asks the two questions the source-level suites cannot:
 *   is the deployed thing wired to live Pons, and does the floor it was born with permit the split
 *   the operator asked for.
 *
 * ⚠ Skipped unless `SHARE_LAUNCHPAD`, `SHARE_CLAIMS` and `RHC_RPC_URL` are all set, so
 * `forge test` still passes with no network and nothing deployed. ⛔ Skipped, never passed: a green
 * tick for a check that did not run is a lie about what was verified.
 *
 * ⛔ NOTHING HERE IS BROADCAST. `RHC_RPC_URL` points at the anvil `deploy-rehearse.sh` started.
 */
contract DeployedForkTest is Test {
    /// ⚠ The only launch config the live factory answers for. 1, 2 and 3 revert `0x68b42c59`.
    uint256 constant CONFIG = 0;
    address constant NATIVE = address(0);

    ShareLaunchpad pad;
    ShareClaims claims;
    IPonsV2Factory factory;
    IPonsFeeEscrow escrow;

    /* ⛔⛔ NOT anvil's dev accounts. Those addresses are real, used accounts on RHC and their
       balances get resolved out from under a fork test mid-run. These exist nowhere. */
    address creator = makeAddr("share-deployed-creator");
    address buyer = makeAddr("share-deployed-buyer");
    address soleWallet = makeAddr("share-deployed-sole-wallet");

    uint256 private _nonce;

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

        vm.deal(creator, 10 ether);
        vm.deal(buyer, 50 ether);
    }

    /**
     * ⛔ The deployed launchpad points at a factory that is live and taking launches.
     *
     * A launchpad is constructed with a factory address and can never be repointed. Deployed against
     * a retired one — which has happened to two projects on this stack — it builds, verifies, lists
     * on the site, and reverts on the first launch anybody tries.
     */
    function test_theDeployedLaunchpadPointsAtALiveOpenFactory() public view {
        assertGt(address(factory).code.length, 0, "no code at the factory the deployed pad holds");
        assertTrue(factory.launchEnabled(), "the factory is live but has CLOSED launches");
        assertGt(address(escrow).code.length, 0, "no code at the escrow the pad cached");
        assertEq(address(escrow), factory.feeEscrow(), "the pad cached an escrow Pons no longer uses");
    }

    /**
     * ⛔⛔ THE FLOOR THAT SHIPPED IS THE FLOOR THE OPERATOR ASKED FOR.
     *
     * `minSocialBps` was 2000 until 4 Sep 2026 and is now 0. It is `immutable`, so this is the one
     * moment it can be checked. Deployed at 2000 by an unnoticed stale default, every launch paying
     * mostly wallets reverts `SocialShareTooSmall` for the life of the contract.
     */
    function test_theDeployedFloorIsWhatTheOperatorAsked() public view {
        uint16 expected = uint16(vm.envOr("EXPECT_MIN_SOCIAL_BPS", uint256(0)));
        assertEq(pad.minSocialBps(), expected, "minSocialBps is not what was asked for, and it is PERMANENT");
    }

    /**
     * ⭐⭐ A LAUNCH PAYING ONE WALLET 100%, WHICH NO OTHER TEST IN THIS REPO CAN MAKE.
     *
     * This is the exact split the 4 Sep change was made to allow, and until now it existed only as a
     * shell variable and a paragraph. Every other suite runs at a 20% social floor, where this
     * launch reverts. Run against the deployed launchpad it is the only proof that the floor was
     * actually lowered in the contract that will take real launches.
     */
    function test_aLaunchPayingOneWalletEverythingIsAccepted() public {
        vm.assume(pad.minSocialBps() == 0);

        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](1);
        rs[0] = ShareLaunchpad.RecipientInput({
            platform: ShareKeys.Platform.Wallet,
            accountRef: "",
            handle: "",
            wallet: soleWallet,
            bps: 10_000
        });

        (address token,, address splitter) = _launch(rs);

        // ⭐ Pons's own record, not ours. This is the promise the site makes, read from the chain.
        assertEq(factory.getLaunchedToken(token).creatorFeeRecipient, splitter, "Pons does not name the splitter");

        /*
          ⭐⭐ EVERY LAUNCH MADE HERE IS DEPLOYED BY THE LAUNCHPAD, WHATEVER WALLET PAID FOR IT.

          Pons records `deployer` as whoever called `launchToken` — which is always this launchpad,
          never the person. So every token from this site shares one deployer on every explorer,
          while the wallet that signed stays the recorded `creator` and keeps its own developer buy.
          That is the same shape as the sibling launchpad, whose tokens all report
          `0xF1755477…EeEfE3`. ⚠ Asserted rather than assumed: it is the whole answer to "can all
          launches come from one wallet while everyone uses their own".
        */
        assertEq(factory.getLaunchedToken(token).deployer, address(pad), "the launchpad is not the on-chain deployer");
        assertEq(pad.entryOf(token).creator, creator, "the signing wallet is not the recorded creator");

        ShareLaunchpad.Entry memory entry = pad.entryOf(token);
        assertEq(entry.socialBps, 0, "a wallet-only launch recorded a social share");
        assertEq(entry.recipientCount, 1);
        assertEq(entry.creator, creator);
        assertTrue(pad.isShareLaunch(token));
    }

    /**
     * And the money from that launch reaches that one wallet — all of it, with no server involved.
     *
     * ⚠ Not a repeat of the fork rehearsal's round trip. That one splits 70/30 and proves the
     * arithmetic; this one proves a 100% share is not a special case that credits nobody, on the
     * contracts the deploy script produced.
     */
    function test_theSoleWalletCollectsTheWholeFee() public {
        vm.assume(pad.minSocialBps() == 0);

        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](1);
        rs[0] = ShareLaunchpad.RecipientInput({
            platform: ShareKeys.Platform.Wallet,
            accountRef: "",
            handle: "",
            wallet: soleWallet,
            bps: 10_000
        });

        (address token, address curve, address splitter) = _launch(rs);

        /* ⛔⛔ PAST THE SNIPE WINDOW, ON WALL-CLOCK SECONDS. A buy in the launch's own second pays a
           99% tax, and a version of this without the warp measures 69.3% and calls it the fee rate.
           `vm.roll` is the WRONG cheatcode — the window is three seconds, not three blocks. */
        vm.warp(block.timestamp + 3);
        uint256 spend = 2 ether;
        vm.prank(buyer);
        IPonsCurveBuy(curve).buy{value: spend}(spend, 0, buyer);

        ShareSplitter(payable(splitter)).sweepCurve(curve, 0);
        uint256 inEscrow = escrow.balanceOf(splitter);
        assertEq(inEscrow, (spend * 70) / 10_000, "the settled creator fee is no longer 0.7% of volume");

        uint256 gained = ShareSplitter(payable(splitter)).harvest();
        bytes32 ben = ShareKeys.beneficiary(ShareKeys.Platform.Wallet, "", soleWallet);

        // ⛔ The WHOLE harvest, not "most of it". With one recipient there is no dust to round away.
        assertEq(claims.owed(token, ben, NATIVE), gained, "a 100% recipient was not credited the whole fee");

        address[] memory launches = new address[](1);
        launches[0] = token;
        address[] memory assets = new address[](1);
        assets[0] = NATIVE;

        uint256 before = soleWallet.balance;
        vm.prank(soleWallet);
        claims.claimAsWallet(launches, assets);
        assertEq(soleWallet.balance - before, gained, "the sole recipient was not paid");

        console2.log("  buy (wei)          ", spend);
        console2.log("  fee to one wallet  ", gained);
    }

    /**
     * ⭐ The launchpad and the vault deploy.sh produced know about each other.
     *
     * They are deployed in two separate `forge create` calls and the launchpad takes the vault as a
     * constructor argument. Swap the argument order — an easy edit to a script nobody had run — and
     * the pair still deploys, still verifies, and credits every launch to a vault the site never
     * reads.
     */
    function test_theTwoDeployedContractsAreBoundToEachOther() public {
        vm.assume(pad.minSocialBps() == 0);

        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](1);
        rs[0] = ShareLaunchpad.RecipientInput({
            platform: ShareKeys.Platform.Wallet,
            accountRef: "",
            handle: "",
            wallet: soleWallet,
            bps: 10_000
        });

        assertEq(address(pad.claims()), address(claims), "the pad's vault is not the one that was deployed");

        (address token,, address splitter) = _launch(rs);
        // ⚠ The splitter is what actually credits, so it is the splitter's vault that matters.
        assertEq(address(ShareSplitter(payable(splitter)).claims()), address(claims), "the splitter credits a different vault");
        assertEq(ShareSplitter(payable(splitter)).token(), token, "the splitter is bound to a different token");
        assertEq(ShareSplitter(payable(splitter)).launchpad(), address(pad), "the splitter names a different launchpad");
    }

    /* ----------------------------------------------------------------- utils -- */

    function _launch(ShareLaunchpad.RecipientInput[] memory rs)
        internal
        returns (address token, address curve, address splitter)
    {
        IPonsV2Factory.LaunchParams memory p;
        p.name = "Share Deploy Rehearsal";
        p.symbol = "SHAREDEP";
        p.logo = "";
        p.description = "a deploy rehearsal, never broadcast";
        p.creatorTaxBps = 0;
        p.expectedEconomics = factory.previewLaunchEconomics(CONFIG, NATIVE);
        p.salt = keccak256(abi.encodePacked("share-deployed", block.number, block.timestamp, _nonce++));

        /* ⛔⛔ `vm.prank` IS SPENT BY THE NEXT CALL, INCLUDING A VIEW ONE. Read the fee into a local
           FIRST — written as `pad.launch{value: factory.launchFee()}` the prank is consumed by
           `launchFee()`, the launch arrives from this test contract, and every assertion about the
           creator silently checks the wrong address. It has cost this repo two sessions. */
        uint256 fee = factory.launchFee();
        vm.prank(creator);
        (token, curve, splitter) = pad.launch{value: fee}(p, CONFIG, NATIVE, rs);
    }
}
