// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPonsFeeEscrow} from "../src/interfaces/IPonsV2.sol";
import {ShareClaims} from "../src/ShareClaims.sol";
import {ShareKeys} from "../src/ShareKeys.sol";
import {ShareSplitter} from "../src/ShareSplitter.sol";
import {MockCurve, MockERC20, MockEscrow} from "./Mocks.sol";

contract SplitterTest is Test {
    MockEscrow escrow;
    ShareClaims claims;
    ShareSplitter splitter;
    MockERC20 pair;

    address launchToken = address(0x7000);

    bytes32 benAlice = ShareKeys.beneficiary(ShareKeys.Platform.X, "12345", address(0));
    bytes32 benBob = ShareKeys.beneficiary(ShareKeys.Platform.GitHub, "999", address(0));
    bytes32 benCarol = ShareKeys.beneficiary(ShareKeys.Platform.TikTok, "carol", address(0));

    function setUp() public {
        escrow = new MockEscrow();
        claims = new ShareClaims(address(this), vm.addr(1));
        pair = new MockERC20();
        splitter = _deploy(7000, 3000);
        splitter.bindToken(launchToken);
        vm.deal(address(this), 1000 ether);
    }

    function _deploy(uint16 a, uint16 b) internal returns (ShareSplitter) {
        bytes32[] memory bens = new bytes32[](2);
        uint16[] memory bps = new uint16[](2);
        bens[0] = benAlice;
        bens[1] = benBob;
        bps[0] = a;
        bps[1] = b;
        return new ShareSplitter(IPonsFeeEscrow(address(escrow)), claims, bens, bps);
    }

    /* --------------------------------------------------------- construction -- */

    /// ⛔ A split summing to less than 10000 would leak into a contract with no withdraw.
    function test_splitMustSumToTenThousand() public {
        vm.expectRevert(abi.encodeWithSelector(ShareSplitter.BadSplit.selector, 9000));
        _deploy(7000, 2000);
    }

    function test_aZeroShareIsRefused() public {
        vm.expectRevert(abi.encodeWithSelector(ShareSplitter.BadSplit.selector, 0));
        _deploy(10000, 0);
    }

    function test_bindingIsOnceAndOnlyByTheLaunchpad() public {
        ShareSplitter s = _deploy(5000, 5000);
        vm.prank(address(0xBAD));
        vm.expectRevert(ShareSplitter.NotLaunchpad.selector);
        s.bindToken(launchToken);

        s.bindToken(launchToken);
        vm.expectRevert(ShareSplitter.AlreadyBound.selector);
        s.bindToken(address(0x2));
    }

    /* -------------------------------------------------------------- harvest -- */

    function test_harvestPullsNativeAndCreditsBothRecipients() public {
        escrow.creditNative{value: 10 ether}(address(splitter));
        splitter.harvest();

        assertEq(claims.owed(launchToken, benAlice, address(0)), 7 ether);
        assertEq(claims.owed(launchToken, benBob, address(0)), 3 ether);
        assertEq(address(splitter).balance, 0);
    }

    /**
     * ⛔⛔ TWO LEDGERS, AND A LAUNCH LANDS IN ONE. A launch paired against an ERC-20 credits only the
     * token side; the native `harvest` succeeds and moves nothing, which is exactly how a live
     * earner gets reported as having made nothing.
     */
    function test_aPairedLaunchIsInvisibleToTheNativeHarvest() public {
        pair.mint(address(this), 100 ether);
        pair.approve(address(escrow), type(uint256).max);
        escrow.creditToken(address(splitter), address(pair), 100 ether);

        splitter.harvest();
        assertEq(claims.creditedForLaunch(launchToken, address(pair)), 0);

        splitter.harvestToken(address(pair));
        assertEq(claims.owed(launchToken, benAlice, address(pair)), 70 ether);
        assertEq(claims.owed(launchToken, benBob, address(pair)), 30 ether);
    }

    /// ⚠ Pons REVERTS when there is nothing to claim. Unguarded, a harvest would revert for the
    /// entire window between two trades.
    function test_harvestOnAnEmptyEscrowDoesNotRevert() public {
        splitter.harvest();
        splitter.harvestToken(address(pair));
    }

    function test_harvestManyDoesBothSidesInOneCall() public {
        escrow.creditNative{value: 1 ether}(address(splitter));
        pair.mint(address(this), 10 ether);
        pair.approve(address(escrow), type(uint256).max);
        escrow.creditToken(address(splitter), address(pair), 10 ether);

        address[] memory assets = new address[](1);
        assets[0] = address(pair);
        splitter.harvestMany(assets);

        assertEq(claims.creditedForLaunch(launchToken, address(0)), 1 ether);
        assertEq(claims.creditedForLaunch(launchToken, address(pair)), 10 ether);
    }

    /// ⭐ Permissionless. A recipient impatient for their share can run it themselves.
    function test_anybodyMayHarvest() public {
        escrow.creditNative{value: 1 ether}(address(splitter));
        vm.prank(address(0xFEE1));
        splitter.harvest();
        assertEq(claims.creditedForLaunch(launchToken, address(0)), 1 ether);
    }

    /* -------------------------------------------------------------- release -- */

    /// ⭐ Works off the BALANCE, so a direct tip is split on the same terms as a fee.
    function test_aDirectTransferIsSplitLikeAFee() public {
        (bool ok,) = address(splitter).call{value: 1 ether}("");
        assertTrue(ok);
        splitter.release(address(0));
        assertEq(claims.owed(launchToken, benAlice, address(0)), 0.7 ether);
    }

    /// ⚠ At most n-1 of the smallest unit, and it goes to the first recipient.
    function test_dustGoesToTheFirstRecipient() public {
        bytes32[] memory bens = new bytes32[](3);
        uint16[] memory bps = new uint16[](3);
        bens[0] = benAlice;
        bens[1] = benBob;
        bens[2] = benCarol;
        bps[0] = 3333;
        bps[1] = 3333;
        bps[2] = 3334;
        ShareSplitter s = new ShareSplitter(IPonsFeeEscrow(address(escrow)), claims, bens, bps);
        s.bindToken(launchToken);

        escrow.creditNative{value: 100}(address(s));
        s.harvest();

        uint256 total = claims.owed(launchToken, benAlice, address(0))
            + claims.owed(launchToken, benBob, address(0)) + claims.owed(launchToken, benCarol, address(0));
        assertEq(total, 100);
        assertEq(claims.owed(launchToken, benAlice, address(0)), 34);
        assertEq(address(s).balance, 0);
    }

    /// ⚠ A balance small enough to round somebody to zero must not revert the whole release.
    function test_aRoundedOutRecipientDoesNotStrandTheOthers() public {
        bytes32[] memory bens = new bytes32[](2);
        uint16[] memory bps = new uint16[](2);
        bens[0] = benAlice;
        bens[1] = benBob;
        bps[0] = 9999;
        bps[1] = 1;
        ShareSplitter s = new ShareSplitter(IPonsFeeEscrow(address(escrow)), claims, bens, bps);
        s.bindToken(launchToken);

        escrow.creditNative{value: 3}(address(s));
        s.harvest();
        assertEq(claims.owed(launchToken, benAlice, address(0)), 3);
        assertEq(claims.owed(launchToken, benBob, address(0)), 0);
        assertEq(address(s).balance, 0);
    }

    function test_everythingCreditedSumsToEverythingHarvested(uint96 amount) public {
        vm.assume(amount > 0);
        vm.deal(address(this), uint256(amount));
        escrow.creditNative{value: amount}(address(splitter));
        splitter.harvest();
        assertEq(claims.creditedForLaunch(launchToken, address(0)), amount);
        assertEq(address(splitter).balance, 0);
    }

    /* ---------------------------------------------------------------- sweep -- */

    /**
     * ⛔⛔ WITHOUT THE PASSTHROUGH NOBODY ON THIS SIDE CAN SWEEP. Pons refuses `sweepFees` from
     * everyone but its own operator and the fee recipient, which is the splitter.
     */
    function test_theSplitterCanSweepItsOwnCurve() public {
        MockCurve curve = new MockCurve(escrow, address(splitter));
        curve.accrue{value: 5 ether}();

        vm.expectRevert(MockCurve.NotFeeSweepOperator.selector);
        curve.sweepFees(0);

        splitter.sweepCurve(address(curve), 0);
        assertEq(escrow.balanceOf(address(splitter)), 5 ether);

        splitter.harvest();
        assertEq(claims.owed(launchToken, benAlice, address(0)), 3.5 ether);
    }

    /* ---------------------------------------------------------------- reads -- */

    /**
     * ⚠⚠ `pending` IS NOT WHAT THE LAUNCH HAS EARNED. Fees sit on the curve until somebody sweeps
     * and the escrow reads a truthful zero the whole time.
     */
    function test_pendingReportsZeroWhileFeesSitOnTheCurve() public {
        MockCurve curve = new MockCurve(escrow, address(splitter));
        curve.accrue{value: 5 ether}();
        assertEq(splitter.pending(address(0)), 0);
        splitter.sweepCurve(address(curve), 0);
        assertEq(splitter.pending(address(0)), 5 ether);
    }

    function test_recipientsAreReadable() public view {
        (bytes32[] memory bens, uint16[] memory bps) = splitter.recipients();
        assertEq(bens.length, 2);
        assertEq(bens[0], benAlice);
        assertEq(bps[1], 3000);
        assertEq(splitter.recipientCount(), 2);
    }

    /// ⛔ There is no setter. The whole promise rests on that being true.
    function test_thereIsNoWayToChangeTheSplit() public view {
        assertEq(splitter.bpsAt(0), 7000);
        assertEq(splitter.beneficiaryAt(0), benAlice);
    }
}
