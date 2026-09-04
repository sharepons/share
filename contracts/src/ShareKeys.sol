// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * How a person becomes a `bytes32` — the one piece of shared vocabulary between this chain, the
 * server that signs attestations, and the front end that fills in a launch form.
 *
 * ## ⛔⛔ THE KEY IS DERIVED ON CHAIN, NEVER SUPPLIED
 *
 * The obvious design takes the `bytes32` as a launch argument and stores the handle beside it as
 * display text. It works, and it quietly makes the promise unverifiable: nothing stops a launch
 * from being recorded as paying `@alice` while the hash it actually pays belongs to somebody else,
 * and no reader can tell, because a hash of a string you do not have is a hash of nothing you can
 * check.
 *
 * ➤ So the launchpad takes the PLATFORM and the ACCOUNT REFERENCE and hashes them here. The stored
 * label and the paid key are the same bytes by construction. Anyone can recompute it.
 *
 * ## ⛔⛔ AN ID IS ONLY UNIQUE WITHIN ITS PLATFORM
 *
 * X account 12345 and GitHub account 12345 are different people, and both are small integers, so
 * early accounts on the two platforms collide with near certainty. The platform prefix is not
 * decoration: without it, one platform's users can claim another platform's money.
 *
 * ## ⛔⛔ TWO PLATFORMS ARE KEYED BY ID AND TWO ARE KEYED BY HANDLE, AND THAT IS NOT AN OVERSIGHT
 *
 * X and GitHub both publish an endpoint that resolves a typed handle to a stable numeric id that is
 * never reissued, so a launch aimed at them is aimed at an ACCOUNT: the recipient can rename
 * themselves and still be paid, and somebody who later registers their old name inherits nothing.
 *
 * Instagram and TikTok publish no such endpoint. Neither one will tell you who `@jane` is until
 * `@jane` has personally authorised your app, which is a thing that has not happened yet at the
 * moment somebody launches a token for her. There are exactly two honest options: refuse those
 * platforms, or key them on the handle and say so. This keys them on the handle and says so — in
 * the contract, in the interface, and on the launch form — because the alternative is pretending a
 * lookup exists.
 *
 * ⚠⚠ WHAT THAT MEANS FOR A RECIPIENT: an Instagram or TikTok share follows the NAME. If the account
 * is renamed and somebody else registers the old name, the new holder can claim it. That risk is
 * the recipient's and the launcher's, it is disclosed, and it is the reason the id-keyed platforms
 * are the default in the form.
 */
library ShareKeys {
    /**
     * ⚠ Order is part of the on-chain record. `Wallet` is 0 so a zeroed struct is a wallet with a
     * zero address, which every validation rejects, rather than a plausible social recipient.
     */
    enum Platform {
        Wallet,
        X,
        GitHub,
        Instagram,
        TikTok
    }

    error UnknownPlatform();
    error EmptyAccountRef();
    error AccountRefTooLong();
    // ⛔ An X or GitHub reference that is not a plain decimal id. @see the note on id-keying.
    error NotNumericId(string accountRef);
    error BadHandleCharacter(string accountRef);
    error ZeroWallet();

    /// Generous for an id, tight for a handle. X allows 15, GitHub 39, Instagram and TikTok 30.
    uint256 internal constant MAX_ACCOUNT_REF = 40;

    /*
     * The canonical identity string. ⛔⛔ The server derives the same string in `identity.ts` and
     * signs attestations against its hash; if these two ever disagree the server would attest to one
     * beneficiary while the money sat under another, and every claim would revert with the balance
     * plainly visible. Change one, change both, and the test that pins the vectors is
     * `test/Keys.t.sol`.
     *
     * ```
     *   x:1465280448        github:583231
     *   instagram:@jane     tiktok:@jane
     *   wallet:0xabc…def    (lower case, always)
     * ```
     */
    function identity(Platform platform, string memory accountRef, address wallet)
        internal
        pure
        returns (string memory)
    {
        if (platform == Platform.Wallet) {
            if (wallet == address(0)) revert ZeroWallet();
            return string.concat("wallet:", hexAddress(wallet));
        }

        bytes memory ref = bytes(accountRef);
        if (ref.length == 0) revert EmptyAccountRef();
        if (ref.length > MAX_ACCOUNT_REF) revert AccountRefTooLong();

        if (platform == Platform.X) {
            _requireDigits(accountRef);
            return string.concat("x:", accountRef);
        }
        if (platform == Platform.GitHub) {
            _requireDigits(accountRef);
            return string.concat("github:", accountRef);
        }
        /*
          ⚠ Lower cased HERE rather than trusted from the caller. Both platforms treat handles case
          insensitively, so `@Jane` and `@jane` are one account; two spellings hashing to two
          beneficiaries would credit one and pay the other, and the money would sit in the vault with
          every claim reverting.
        */
        string memory h = _lowerHandle(accountRef);
        if (platform == Platform.Instagram) return string.concat("instagram:@", h);
        if (platform == Platform.TikTok) return string.concat("tiktok:@", h);
        revert UnknownPlatform();
    }

    function beneficiary(Platform platform, string memory accountRef, address wallet)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(bytes(identity(platform, accountRef, wallet)));
    }

    /// The key a wallet recipient claims under, recomputed from an address with no help from anyone.
    function walletBeneficiary(address wallet) internal pure returns (bytes32) {
        if (wallet == address(0)) revert ZeroWallet();
        return keccak256(bytes(string.concat("wallet:", hexAddress(wallet))));
    }

    /**
     * ⚠⚠ LOWER CASE, ALWAYS, AND NEVER EIP-55. An address arrives checksummed from a wallet and in
     * lower case from most tooling. Hashing the string means two spellings of one address are two
     * different people to this system, so exactly one spelling is allowed to exist.
     */
    function hexAddress(address a) internal pure returns (string memory) {
        bytes16 digits = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        uint160 value = uint160(a);
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(value >> (8 * (19 - i)));
            out[2 + i * 2] = digits[b >> 4];
            out[3 + i * 2] = digits[b & 0x0f];
        }
        return string(out);
    }

    function _requireDigits(string memory s) private pure {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] < 0x30 || b[i] > 0x39) revert NotNumericId(s);
        }
        /* ⚠ A leading zero is refused because "07" and "7" are the same account to the platform and
           two different beneficiaries here. Neither platform ever issues one. */
        if (b.length > 1 && b[0] == 0x30) revert NotNumericId(s);
    }

    /**
     * ⚠ The charset is the intersection of what Instagram and TikTok allow: letters, digits, period
     * and underscore. A pasted URL, an at-sign, or a space is rejected rather than silently hashed into
     * a beneficiary nobody can ever sign in as.
     */
    function _lowerHandle(string memory s) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= 0x41 && c <= 0x5a) {
                out[i] = bytes1(uint8(c) + 32);
            } else if ((c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x2e || c == 0x5f) {
                out[i] = c;
            } else {
                revert BadHandleCharacter(s);
            }
        }
        return string(out);
    }
}
