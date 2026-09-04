// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShareClaims} from "../src/ShareClaims.sol";
import {ShareKeys} from "../src/ShareKeys.sol";
import {FeeOnTransferERC20, LyingERC20, MockERC20} from "./Mocks.sol";

contract ClaimsTest is Test {
    ShareClaims claims;
    MockERC20 token;

    address owner = address(0xA11CE);
    uint256 signerKey = 0xBEEF;
    address signer;

    address recipient = address(0xD00D);
    address launchA = address(0x1111);
    address launchB = address(0x2222);

    bytes32 benAlice = ShareKeys.beneficiary(ShareKeys.Platform.X, "12345", address(0));
    bytes32 benBob = ShareKeys.beneficiary(ShareKeys.Platform.GitHub, "999", address(0));

    function setUp() public {
        signer = vm.addr(signerKey);
        claims = new ShareClaims(owner, signer);
        token = new MockERC20();
        vm.deal(address(this), 1000 ether);
    }

    /* ------------------------------------------------------------- funding -- */

    function test_fundCreditsTheNamedPair() public {
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        assertEq(claims.owed(launchA, benAlice, address(0)), 1 ether);
        assertEq(claims.creditedForLaunch(launchA, address(0)), 1 ether);
        assertEq(claims.outstanding(address(0)), 1 ether);
    }

    /// ⚠ EXACT. Extra native ether would sit here credited to nobody.
    function test_fundRefusesAMismatchedValue() public {
        vm.expectRevert(abi.encodeWithSelector(ShareClaims.ValueMismatch.selector, 2 ether, 1 ether));
        claims.fund{value: 2 ether}(launchA, benAlice, address(0), 1 ether);
    }

    /// ⛔ There is no `receive`. A plain transfer cannot be attributed to anybody.
    function test_plainTransferIsRefused() public {
        (bool ok,) = address(claims).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_fundManySplitsOneTransfer() public {
        bytes32[] memory bens = new bytes32[](2);
        uint256[] memory amts = new uint256[](2);
        bens[0] = benAlice;
        bens[1] = benBob;
        amts[0] = 0.7 ether;
        amts[1] = 0.3 ether;
        claims.fundMany{value: 1 ether}(launchA, bens, address(0), amts);
        assertEq(claims.owed(launchA, benAlice, address(0)), 0.7 ether);
        assertEq(claims.owed(launchA, benBob, address(0)), 0.3 ether);
    }

    /**
     * ⛔⛔ A fee-on-transfer token delivers less than it was told to. Crediting the REQUESTED figure
     * would promise money this contract does not hold, and the shortfall would surface as a revert
     * on somebody's claim weeks later with the balance apparently right there.
     */
    function test_feeOnTransferCreditsWhatArrived() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20();
        fot.mint(address(this), 100 ether);
        fot.approve(address(claims), type(uint256).max);

        bytes32[] memory bens = new bytes32[](2);
        uint256[] memory amts = new uint256[](2);
        bens[0] = benAlice;
        bens[1] = benBob;
        amts[0] = 50 ether;
        amts[1] = 50 ether;
        claims.fundMany(launchA, bens, address(fot), amts);

        uint256 held = fot.balanceOf(address(claims));
        assertEq(held, 99 ether);
        assertEq(claims.outstanding(address(fot)), held);
        assertLe(
            claims.owed(launchA, benAlice, address(fot)) + claims.owed(launchA, benBob, address(fot)),
            held
        );
    }

    function test_zeroAmountIsRefused() public {
        vm.expectRevert(ShareClaims.ZeroAmount.selector);
        claims.fund{value: 0}(launchA, benAlice, address(0), 0);
    }

    /* --------------------------------------------------------- wallet claim -- */

    function test_walletClaimNeedsNobody() public {
        address wallet = address(0xC0FFEE);
        bytes32 ben = ShareKeys.walletBeneficiary(wallet);
        claims.fund{value: 2 ether}(launchA, ben, address(0), 2 ether);

        address[] memory launches = new address[](1);
        address[] memory assets = new address[](1);
        launches[0] = launchA;
        assets[0] = address(0);

        vm.prank(wallet);
        uint256 got = claims.claimAsWallet(launches, assets);
        assertEq(got, 2 ether);
        assertEq(wallet.balance, 2 ether);
        assertEq(claims.owed(launchA, ben, address(0)), 0);
        assertEq(claims.outstanding(address(0)), 0);
    }

    function test_walletClaimCannotReachAnotherWalletsShare() public {
        bytes32 ben = ShareKeys.walletBeneficiary(address(0xC0FFEE));
        claims.fund{value: 2 ether}(launchA, ben, address(0), 2 ether);

        address[] memory launches = new address[](1);
        address[] memory assets = new address[](1);
        launches[0] = launchA;
        assets[0] = address(0);

        vm.prank(address(0xBADBAD));
        vm.expectRevert(ShareClaims.NothingOwed.selector);
        claims.claimAsWallet(launches, assets);
    }

    /* ---------------------------------------------------- attestation claim -- */

    function _sign(bytes32 ben, address to, uint256 deadline, bytes32 salt, uint256 key)
        internal
        view
        returns (ShareClaims.Attestation memory a, bytes memory sig)
    {
        a = ShareClaims.Attestation({beneficiary: ben, recipient: to, deadline: deadline, salt: salt});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, claims.digestOf(a));
        sig = abi.encodePacked(r, s, v);
    }

    function _one(address launch, address asset)
        internal
        pure
        returns (address[] memory launches, address[] memory assets)
    {
        launches = new address[](1);
        assets = new address[](1);
        launches[0] = launch;
        assets[0] = asset;
    }

    function test_attestationPaysTheWholeOwedBalance() public {
        claims.fund{value: 3 ether}(launchA, benAlice, address(0), 3 ether);
        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(1)), signerKey);
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));

        uint256 got = claims.claimWithAttestation(a, sig, launches, assets);
        assertEq(got, 3 ether);
        assertEq(recipient.balance, 3 ether);
    }

    /**
     * ⭐⭐ THE ATTESTATION CARRIES NO AMOUNT. There is nothing here for the server to get wrong: the
     * figure is a subtraction the contract performs on its own ledger, so a second fund is simply
     * claimable by a second attestation and no arithmetic ever crosses the trust boundary.
     */
    function test_oneAttestationCoversManyLaunches() public {
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        claims.fund{value: 2 ether}(launchB, benAlice, address(0), 2 ether);

        address[] memory launches = new address[](2);
        address[] memory assets = new address[](2);
        launches[0] = launchA;
        launches[1] = launchB;

        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(7)), signerKey);
        assertEq(claims.claimWithAttestation(a, sig, launches, assets), 3 ether);
    }

    function test_attestationIsSingleUse() public {
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(2)), signerKey);
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        claims.claimWithAttestation(a, sig, launches, assets);

        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        vm.expectRevert(ShareClaims.AttestationAlreadyUsed.selector);
        claims.claimWithAttestation(a, sig, launches, assets);
    }

    function test_attestationFromAnyOtherKeyIsRefused() public {
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(3)), 0xDEAD);
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        vm.expectRevert(ShareClaims.BadSignature.selector);
        claims.claimWithAttestation(a, sig, launches, assets);
    }

    function test_expiredAttestationIsRefused() public {
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 10, bytes32(uint256(4)), signerKey);
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        vm.warp(block.timestamp + 11);
        vm.expectRevert(ShareClaims.AttestationExpired.selector);
        claims.claimWithAttestation(a, sig, launches, assets);
    }

    /// ⚠ Every signature has a mirror image that recovers to the same address. Refused, so nothing
    /// downstream can index one attestation by two different bytestrings.
    function test_malleableSignatureIsRefused() public {
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        ShareClaims.Attestation memory a = ShareClaims.Attestation({
            beneficiary: benAlice,
            recipient: recipient,
            deadline: block.timestamp + 600,
            salt: bytes32(uint256(5))
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, claims.digestOf(a));
        uint256 N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(N - uint256(s)), uint8(v == 27 ? 28 : 27));
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        vm.expectRevert(ShareClaims.BadSignature.selector);
        claims.claimWithAttestation(a, flipped, launches, assets);
    }

    /* ---------------------------------------------------------- ring fence -- */

    /**
     * ⭐⭐ THE PROPERTY THIS CONTRACT EXISTS FOR. Alice's attestation is perfectly valid and still
     * cannot reach a single wei of what launch B credited to Bob.
     */
    function test_oneRecipientCannotBePaidFromAnothers() public {
        claims.fund{value: 5 ether}(launchA, benBob, address(0), 5 ether);
        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(6)), signerKey);
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        vm.expectRevert(ShareClaims.NothingOwed.selector);
        claims.claimWithAttestation(a, sig, launches, assets);
        assertEq(claims.owed(launchA, benBob, address(0)), 5 ether);
    }

    function test_oneLaunchCannotBePaidFromAnother() public {
        claims.fund{value: 5 ether}(launchB, benAlice, address(0), 5 ether);
        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(8)), signerKey);
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        vm.expectRevert(ShareClaims.NothingOwed.selector);
        claims.claimWithAttestation(a, sig, launches, assets);
    }

    /* --------------------------------------------------------------- admin -- */

    /// ⭐ The owner is refused anything below the line of what is owed, even holding every key.
    function test_ownerCannotTakeWhatIsOwed() public {
        claims.fund{value: 4 ether}(launchA, benAlice, address(0), 4 ether);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ShareClaims.WouldTakeRecipientFunds.selector, 1, 0));
        claims.sweepStray(address(0), owner, 1);
    }

    function test_ownerMayTakeOnlyTheStray() public {
        claims.fund{value: 4 ether}(launchA, benAlice, address(0), 4 ether);
        // ⚠ Forced in, the way a selfdestruct or a coinbase payout arrives: no `receive` was called.
        vm.deal(address(claims), 4 ether + 0.5 ether);
        vm.prank(owner);
        claims.sweepStray(address(0), owner, 0.5 ether);
        assertEq(owner.balance, 0.5 ether);
        assertEq(claims.owed(launchA, benAlice, address(0)), 4 ether);
    }

    function test_pauseBlocksClaimsButNeverFunding() public {
        vm.prank(owner);
        claims.setPaused(true);
        // ⚠ Funding still works. A pause that strands fees in a splitter is a pause nobody can use.
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);

        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(9)), signerKey);
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        vm.expectRevert(ShareClaims.IsPaused.selector);
        claims.claimWithAttestation(a, sig, launches, assets);
    }

    function test_signerRotationInvalidatesTheOldKey() public {
        claims.fund{value: 1 ether}(launchA, benAlice, address(0), 1 ether);
        (ShareClaims.Attestation memory a, bytes memory sig) =
            _sign(benAlice, recipient, block.timestamp + 600, bytes32(uint256(10)), signerKey);
        vm.prank(owner);
        claims.setSigner(vm.addr(0xFACE));
        (address[] memory launches, address[] memory assets) = _one(launchA, address(0));
        vm.expectRevert(ShareClaims.BadSignature.selector);
        claims.claimWithAttestation(a, sig, launches, assets);
    }

    /// ⚠ Two steps. A one-step transfer to a mistyped address ends administration permanently.
    function test_ownershipHandoverIsTwoSteps() public {
        address next = address(0xBEEFBEEF);
        vm.prank(owner);
        claims.transferOwnership(next);
        assertEq(claims.owner(), owner);
        vm.prank(next);
        claims.acceptOwnership();
        assertEq(claims.owner(), next);
    }

    function test_nonOwnerIsRefused() public {
        vm.expectRevert(ShareClaims.NotOwner.selector);
        claims.setSigner(address(1));
    }

    function test_aLyingTokenTransferReverts() public {
        LyingERC20 bad = new LyingERC20();
        bad.mint(address(claims), 10 ether);
        vm.deal(address(claims), 0);
        vm.prank(owner);
        vm.expectRevert(ShareClaims.TransferFailed.selector);
        claims.sweepStray(address(bad), owner, 1 ether);
    }
}
