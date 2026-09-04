// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPonsV2Factory} from "../src/interfaces/IPonsV2.sol";
import {ShareClaims} from "../src/ShareClaims.sol";
import {ShareKeys} from "../src/ShareKeys.sol";
import {ShareLaunchpad} from "../src/ShareLaunchpad.sol";
import {ShareSplitter} from "../src/ShareSplitter.sol";
import {MockCurve, MockERC20, MockEscrow, MockFactory} from "./Mocks.sol";

contract LaunchpadTest is Test {
    MockEscrow escrow;
    MockFactory factory;
    ShareClaims claims;
    ShareLaunchpad pad;
    MockERC20 pair;

    address creator = address(0xC0DE);
    uint16 constant MIN_SOCIAL = 2000;

    function setUp() public {
        escrow = new MockEscrow();
        factory = new MockFactory(escrow);
        claims = new ShareClaims(address(this), vm.addr(1));
        pad = new ShareLaunchpad(IPonsV2Factory(address(factory)), claims, MIN_SOCIAL);
        pair = new MockERC20();
        factory.approvePair(address(pair), true);
        vm.deal(creator, 100 ether);
    }

    function _params() internal view returns (IPonsV2Factory.LaunchParams memory p) {
        p.name = "Share Token";
        p.symbol = "SHARE";
        p.logo = "ipfs://bafyexample";
        p.description = "a token whose fees belong to somebody else";
        p.creatorTaxBps = 0;
        p.expectedEconomics = factory.economics();
    }

    function _social(string memory ref, string memory handle, uint16 bps)
        internal
        pure
        returns (ShareLaunchpad.RecipientInput memory)
    {
        return ShareLaunchpad.RecipientInput({
            platform: ShareKeys.Platform.X,
            accountRef: ref,
            handle: handle,
            wallet: address(0),
            bps: bps
        });
    }

    function _wallet(address w, uint16 bps) internal pure returns (ShareLaunchpad.RecipientInput memory) {
        return ShareLaunchpad.RecipientInput({
            platform: ShareKeys.Platform.Wallet,
            accountRef: "",
            handle: "",
            wallet: w,
            bps: bps
        });
    }

    function _defaultSplit() internal view returns (ShareLaunchpad.RecipientInput[] memory rs) {
        rs = new ShareLaunchpad.RecipientInput[](2);
        rs[0] = _social("1465280448", "octocat", 6000);
        rs[1] = _wallet(creator, 4000);
    }

    /*
      ⚠⚠ THE FEE AND THE PARAMS ARE READ BEFORE THE PRANK, NEVER INSIDE THE CALL.
      `vm.prank` applies to the NEXT call, and `factory.launchFee()` written inline is that call — so
      the prank is spent on a view read and the launch arrives from the test contract instead. It
      passes silently, and every assertion about who the creator is quietly checks the wrong address.
    */
    function _launch(ShareLaunchpad.RecipientInput[] memory rs)
        internal
        returns (address token, address curve, address splitter)
    {
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory p = _params();
        vm.prank(creator);
        return pad.launch{value: fee}(p, 0, address(0), rs);
    }

    /* --------------------------------------------------------------- happy -- */

    /**
     * ⭐⭐ ATOMIC. There is no observable state in which the token exists and its fees point
     * anywhere but the splitter.
     */
    function test_oneCallLaunchesSplitsAndRecords() public {
        (address token, address curve, address splitter) = _launch(_defaultSplit());

        assertEq(factory.getLaunchedToken(token).creatorFeeRecipient, splitter);
        assertEq(ShareSplitter(payable(splitter)).token(), token);
        assertEq(ShareSplitter(payable(splitter)).recipientCount(), 2);
        assertTrue(pad.isShareLaunch(token));
        assertEq(pad.count(), 1);

        ShareLaunchpad.Entry memory e = pad.entryOf(token);
        assertEq(e.creator, creator);
        assertEq(e.curve, curve);
        assertEq(e.socialBps, 6000);
        assertEq(e.recipientCount, 2);
    }

    /**
     * ⭐⭐ THE STORED LABEL AND THE PAID KEY ARE THE SAME BYTES BY CONSTRUCTION. Anyone can hash the
     * identity string in the registry and find it in the splitter. A listing that claims to pay one
     * account while the money goes to another cannot be built here.
     */
    function test_theRecordedIdentityIsTheKeyThatGetsPaid() public {
        (address token,, address splitter) = _launch(_defaultSplit());
        ShareLaunchpad.Recipient[] memory rs = pad.recipientsOf(token);

        assertEq(rs[0].identity, "x:1465280448");
        assertEq(rs[0].handle, "octocat");
        assertEq(keccak256(bytes(rs[0].identity)), ShareSplitter(payable(splitter)).beneficiaryAt(0));

        assertEq(rs[1].identity, string.concat("wallet:", ShareKeys.hexAddress(creator)));
        assertEq(keccak256(bytes(rs[1].identity)), ShareSplitter(payable(splitter)).beneficiaryAt(1));
    }

    function test_feesReachTheRecipientsEndToEnd() public {
        (address token, address curve, address splitter) = _launch(_defaultSplit());

        // A curve earning fees, then swept by the only address Pons allows: the splitter.
        vm.deal(address(this), 10 ether);
        MockCurve(payable(curve)).accrue{value: 10 ether}();
        ShareSplitter(payable(splitter)).sweepCurve(curve, 0);
        ShareSplitter(payable(splitter)).harvest();

        bytes32 benX = ShareKeys.beneficiary(ShareKeys.Platform.X, "1465280448", address(0));
        assertEq(claims.owed(token, benX, address(0)), 6 ether);

        // ⭐ And the wallet recipient can take theirs with no server in the loop at all.
        address[] memory launches = new address[](1);
        address[] memory assets = new address[](1);
        launches[0] = token;
        vm.prank(creator);
        assertEq(claims.claimAsWallet(launches, assets), 4 ether);
    }

    function test_launchOfReturnsBothHalvesInOneCall() public {
        (address token,,) = _launch(_defaultSplit());
        (ShareLaunchpad.Entry memory e, ShareLaunchpad.Recipient[] memory rs) = pad.launchOf(token);
        assertEq(e.token, token);
        assertEq(rs.length, 2);
    }

    /* ---------------------------------------------------------- validation -- */

    /// ⛔ The floor. A launch paying a stranger 1% while using their name is not a share launch.
    function test_theSocialFloorIsEnforced() public {
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](2);
        rs[0] = _social("1465280448", "octocat", 1000);
        rs[1] = _wallet(creator, 9000);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ShareLaunchpad.SocialShareTooSmall.selector, 1000, MIN_SOCIAL));
        pad.launch{value: fee}(pp, 0, address(0), rs);
    }

    /// ⚠ A launcher paying only themselves is not sharing, so wallets do not count towards the floor.
    function test_aWalletOnlySplitCannotMeetTheFloor() public {
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](1);
        rs[0] = _wallet(creator, 10000);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ShareLaunchpad.SocialShareTooSmall.selector, 0, MIN_SOCIAL));
        pad.launch{value: fee}(pp, 0, address(0), rs);
    }

    /**
     * ⛔⛔ THE FLOOR `deploy.sh` ACTUALLY SHIPS IS ZERO, AND NOTHING ELSE HERE RUNS AT IT.
     *
     * `MIN_SOCIAL` above is 2000, and so is the fork rehearsal's — the whole suite was written when
     * the floor was 20%. The operator removed it on 4 Sep 2026, which means the number every test in
     * this repo exercises is no longer the number that will be deployed, and `minSocialBps` is
     * `immutable`: it is chosen once by a shell variable, with no setter and no second chance.
     *
     * ➤ So this builds a second launchpad at the shipping value and makes the launch the change was
     *   made to allow — one wallet, 100%, no social recipient at all — which every other test in
     *   this file expects to revert.
     *
     * ⚠ `deploy-rehearse.sh` runs the same case against the REAL Pons factory, on the launchpad the
     * deploy script produced. This one is the version that runs with no network.
     */
    function test_atTheShippingFloorAWalletOnlyLaunchIsAccepted() public {
        ShareLaunchpad zeroFloor = new ShareLaunchpad(IPonsV2Factory(address(factory)), claims, 0);
        assertEq(zeroFloor.minSocialBps(), 0, "the floor under test is not the one deploy.sh sets");

        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](1);
        rs[0] = _wallet(creator, 10000);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();

        vm.prank(creator);
        (address token,, address splitter) = zeroFloor.launch{value: fee}(pp, 0, address(0), rs);

        ShareLaunchpad.Entry memory entry = zeroFloor.entryOf(token);
        assertEq(entry.socialBps, 0, "a wallet-only launch recorded a social share");
        assertEq(entry.recipientCount, 1);
        assertEq(ShareSplitter(payable(splitter)).recipientCount(), 1);

        // ⚠ Still one identity, still hashed the same way. A 100% wallet share is not a special case.
        assertEq(
            ShareSplitter(payable(splitter)).beneficiaryAt(0),
            ShareKeys.beneficiary(ShareKeys.Platform.Wallet, "", creator),
            "the sole recipient is not the wallet that was named"
        );
        assertEq(ShareSplitter(payable(splitter)).bpsAt(0), 10000);
    }

    /// ⚠ Zero is the floor being OFF, not the floor being satisfiable by nothing: a launch with no
    /// recipients at all is still refused, and by a different error.
    function test_theShippingFloorStillRequiresARecipient() public {
        ShareLaunchpad zeroFloor = new ShareLaunchpad(IPonsV2Factory(address(factory)), claims, 0);
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](0);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(ShareLaunchpad.NoRecipients.selector);
        zeroFloor.launch{value: fee}(pp, 0, address(0), rs);
    }

    function test_theSplitMustSumToTenThousand() public {
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](2);
        rs[0] = _social("1465280448", "octocat", 6000);
        rs[1] = _wallet(creator, 3000);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ShareLaunchpad.BadSplit.selector, 9000));
        pad.launch{value: fee}(pp, 0, address(0), rs);
    }

    /// ⚠ Two rows for one person is not a harmless 70 + 30: the site renders per row and the
    /// splitter credits per beneficiary, so neither number would be what they get.
    function test_theSameAccountTwiceIsRefused() public {
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](2);
        rs[0] = _social("1465280448", "octocat", 5000);
        rs[1] = _social("1465280448", "octocat", 5000);
        bytes32 ben = ShareKeys.beneficiary(ShareKeys.Platform.X, "1465280448", address(0));
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ShareLaunchpad.DuplicateRecipient.selector, ben));
        pad.launch{value: fee}(pp, 0, address(0), rs);
    }

    function test_moreThanEightRecipientsIsRefused() public {
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](9);
        for (uint256 i = 0; i < 9; i++) {
            rs[i] = _social(vm.toString(i + 1), "someone", uint16(i == 8 ? 10000 - 8 * 1000 : 1000));
        }
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ShareLaunchpad.TooManyRecipients.selector, 9, 8));
        pad.launch{value: fee}(pp, 0, address(0), rs);
    }

    /// ⚠ A social row with no label renders as an anonymous hash everywhere it appears.
    function test_aSocialRecipientNeedsAHandleToShow() public {
        ShareLaunchpad.RecipientInput[] memory rs = new ShareLaunchpad.RecipientInput[](2);
        rs[0] = _social("1465280448", "", 6000);
        rs[1] = _wallet(creator, 4000);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(ShareLaunchpad.EmptyHandle.selector);
        pad.launch{value: fee}(pp, 0, address(0), rs);
    }

    function test_anUnapprovedPairAssetIsRefused() public {
        MockERC20 other = new MockERC20();
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(ShareLaunchpad.PairTokenNotApproved.selector, address(other)));
        pad.launch{value: fee}(pp, 0, address(other), _defaultSplit());
    }

    function test_launchesClosedIsSaidPlainly() public {
        factory.setEnabled(false);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(ShareLaunchpad.LaunchesClosed.selector);
        pad.launch{value: fee}(pp, 0, address(0), _defaultSplit());
    }

    /**
     * ⛔ Checked HERE and not left to Pons. Pons's own revert lands after a splitter has been
     * deployed inside the transaction, and surfaces as an opaque factory error that tells the
     * launcher nothing about what actually moved.
     */
    function test_movedEconomicsAreNamed() public {
        IPonsV2Factory.LaunchParams memory p = _params();
        factory.setEconomics(bytes32(uint256(2)));
        uint256 fee = factory.launchFee();
        ShareLaunchpad.RecipientInput[] memory rs = _defaultSplit();
        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(ShareLaunchpad.EconomicsMoved.selector, bytes32(uint256(1)), bytes32(uint256(2)))
        );
        pad.launch{value: fee}(p, 0, address(0), rs);
    }

    /* ------------------------------------------------------------ registry -- */

    function test_thePageIsNewestFirstAndClamped() public {
        _launch(_defaultSplit());
        ShareLaunchpad.RecipientInput[] memory rs = _defaultSplit();
        rs[0] = _social("583231", "torvalds", 6000);
        (address second,,) = _launch(rs);

        ShareLaunchpad.Entry[] memory p = pad.page(0, 10);
        assertEq(p.length, 2);
        assertEq(p[0].token, second);

        // ⚠ Clamped, not reverting: a feed that throws when somebody scrolls one page too far is a
        // feed that breaks the moment two launches happen while a visitor is reading.
        assertEq(pad.page(5, 10).length, 0);
        assertEq(pad.page(1, 10).length, 1);
    }

    function test_recipientsPageMatchesThePage() public {
        _launch(_defaultSplit());
        ShareLaunchpad.RecipientInput[] memory rs = _defaultSplit();
        rs[0] = _social("583231", "torvalds", 6000);
        _launch(rs);

        ShareLaunchpad.Recipient[][] memory all = pad.recipientsPage(0, 10);
        assertEq(all.length, 2);
        assertEq(all[0][0].handle, "torvalds");
        assertEq(all[1][0].handle, "octocat");
    }

    /// ⚠ Reverts rather than returning a zeroed struct a caller would render as a launch paying nobody.
    function test_anUnknownTokenReverts() public {
        vm.expectRevert(ShareLaunchpad.ZeroAddress.selector);
        pad.entryOf(address(0xDEAD));
    }

    /* --------------------------------------------------------- entrypoints -- */

    /// ⛔ An empty array is not the same calldata as no array, so the plain call is still sent.
    function test_noExemptionsUsesTheThreeArgumentEntrypoint() public {
        _launch(_defaultSplit());
        assertFalse(factory.lastCallHadExemptions());
    }

    function test_declaringAnExemptionUsesTheOverload() public {
        address[] memory ex = new address[](1);
        ex[0] = creator;
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        pad.launchWithBuy{value: fee}(pp, 0, address(0), _defaultSplit(), ShareLaunchpad.DevBuy(0, 0), ex
        );
        assertTrue(factory.lastCallHadExemptions());
    }

    function test_aDevBuyWithNoPeripheryIsNamed() public {
        address[] memory ex = new address[](0);
        uint256 fee = factory.launchFee();
        IPonsV2Factory.LaunchParams memory pp = _params();
        vm.prank(creator);
        vm.expectRevert(ShareLaunchpad.DevBuyUnavailable.selector);
        pad.launchWithBuy{value: fee}(pp, 0, address(0), _defaultSplit(), ShareLaunchpad.DevBuy(1 ether, 1), ex
        );
    }
}
