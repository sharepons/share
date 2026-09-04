// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShareKeys} from "../src/ShareKeys.sol";

/*
  ⛔⛔ THESE ARE THE VECTORS THE SERVER IS PINNED TO.

  `server/src/identity.ts` builds the same strings in TypeScript and signs attestations against
  their hashes. If the two ever disagree, the server attests to one beneficiary while the money sits
  under another and every claim reverts with the balance plainly visible on the token page. The
  matching test on that side is `server/test/identity.test.ts`, and it hard-codes the same strings.
*/
contract KeysTest is Test {
    function _identity(ShareKeys.Platform p, string memory ref, address w) internal pure returns (string memory) {
        return ShareKeys.identity(p, ref, w);
    }

    function test_xIsKeyedByNumericId() public pure {
        assertEq(_identity(ShareKeys.Platform.X, "1465280448", address(0)), "x:1465280448");
    }

    function test_githubIsKeyedByNumericId() public pure {
        assertEq(_identity(ShareKeys.Platform.GitHub, "583231", address(0)), "github:583231");
    }

    function test_instagramAndTiktokAreKeyedByHandle() public pure {
        assertEq(_identity(ShareKeys.Platform.Instagram, "jane", address(0)), "instagram:@jane");
        assertEq(_identity(ShareKeys.Platform.TikTok, "jane", address(0)), "tiktok:@jane");
    }

    /// ⛔ One account, one beneficiary. Two spellings would credit one and pay the other.
    function test_handleCaseIsFoldedOnChain() public pure {
        assertEq(_identity(ShareKeys.Platform.Instagram, "JaNe", address(0)), "instagram:@jane");
        assertEq(
            ShareKeys.beneficiary(ShareKeys.Platform.TikTok, "JANE", address(0)),
            ShareKeys.beneficiary(ShareKeys.Platform.TikTok, "jane", address(0))
        );
    }

    function test_handleAllowsDotAndUnderscore() public pure {
        assertEq(_identity(ShareKeys.Platform.Instagram, "ja_ne.01", address(0)), "instagram:@ja_ne.01");
    }

    function test_handleRejectsPastedUrlOrAtSign() public {
        vm.expectRevert(abi.encodeWithSelector(ShareKeys.BadHandleCharacter.selector, "@jane"));
        this.identityExternal(ShareKeys.Platform.Instagram, "@jane", address(0));

        vm.expectRevert(abi.encodeWithSelector(ShareKeys.BadHandleCharacter.selector, "tiktok.com/jane"));
        this.identityExternal(ShareKeys.Platform.TikTok, "tiktok.com/jane", address(0));
    }

    function test_idPlatformsRejectAHandle() public {
        vm.expectRevert(abi.encodeWithSelector(ShareKeys.NotNumericId.selector, "octocat"));
        this.identityExternal(ShareKeys.Platform.GitHub, "octocat", address(0));
    }

    /// ⚠ "07" and "7" are one account to the platform and two beneficiaries here, so one is refused.
    function test_idPlatformsRejectALeadingZero() public {
        vm.expectRevert(abi.encodeWithSelector(ShareKeys.NotNumericId.selector, "0123"));
        this.identityExternal(ShareKeys.Platform.X, "0123", address(0));
    }

    function test_walletIsLowerCaseHexAlways() public pure {
        address a = 0xabC1230000000000000000000000000000000DEf;
        assertEq(_identity(ShareKeys.Platform.Wallet, "", a), "wallet:0xabc1230000000000000000000000000000000def");
        assertEq(ShareKeys.walletBeneficiary(a), ShareKeys.beneficiary(ShareKeys.Platform.Wallet, "", a));
    }

    function test_walletHexRoundTripsForAnyAddress(address a) public pure {
        vm.assume(a != address(0));
        assertEq(bytes(ShareKeys.hexAddress(a)).length, 42);
        assertEq(vm.parseAddress(ShareKeys.hexAddress(a)), a);
    }

    /// ⛔⛔ The collision the platform prefix exists to prevent: both platforms number from small
    /// integers, so early accounts share ids with near certainty.
    function test_sameIdOnTwoPlatformsIsTwoPeople() public pure {
        assertTrue(
            ShareKeys.beneficiary(ShareKeys.Platform.X, "12345", address(0))
                != ShareKeys.beneficiary(ShareKeys.Platform.GitHub, "12345", address(0))
        );
    }

    function test_emptyAndOverlongRefsAreRefused() public {
        vm.expectRevert(ShareKeys.EmptyAccountRef.selector);
        this.identityExternal(ShareKeys.Platform.X, "", address(0));

        vm.expectRevert(ShareKeys.AccountRefTooLong.selector);
        this.identityExternal(ShareKeys.Platform.Instagram, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", address(0));
    }

    function test_zeroWalletIsRefused() public {
        vm.expectRevert(ShareKeys.ZeroWallet.selector);
        this.identityExternal(ShareKeys.Platform.Wallet, "", address(0));
    }

    function identityExternal(ShareKeys.Platform p, string calldata ref, address w)
        external
        pure
        returns (string memory)
    {
        return ShareKeys.identity(p, ref, w);
    }
}
